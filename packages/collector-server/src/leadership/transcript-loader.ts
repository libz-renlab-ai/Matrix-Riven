import { gunzipSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import type {
  ParsedSession,
  ParsedEnvelope,
  ParsedMessage,
  ParsedToolUse,
  ParsedToolResult,
} from './types.js';
import { loadIndexSync, INDEX_FILENAME, type IndexEntry } from './index.js';

/**
 * P-D1 follow-up — In-process parsed-session cache.
 *
 * The on-disk index (P-D1) shaved off `readdirSync` + per-file `statSync`
 * but the dominant cold-start cost remains JSON parse + gunzip per
 * transcript. This module-level Map keeps every successfully-parsed
 * session in memory keyed on `${absPath}|${mtimeMs}` so the second and
 * subsequent `scanAllSessions` calls in a server lifetime skip parsing
 * entirely — only `readFileSync` and the cache lookup run.
 *
 * The key includes mtime so any file edit naturally invalidates the
 * cached entry. Stale-mtime entries for the same path remain in memory
 * (memory waste, not correctness) until the eviction sweep below trims
 * them. Eviction drops oldest 20 % when size exceeds MAX_CACHE_ENTRIES;
 * at ~100 KB per ParsedSession that caps memory around 500 MB.
 */
const parsedCache = new Map<string, ParsedSession>();
const MAX_CACHE_ENTRIES = 5000;

function cacheKey(absPath: string, mtimeMs: number): string {
  return `${absPath}|${mtimeMs}`;
}

function maybeEvict(): void {
  if (parsedCache.size <= MAX_CACHE_ENTRIES) return;
  const toDelete = Math.floor(parsedCache.size * 0.2);
  let i = 0;
  for (const key of parsedCache.keys()) {
    if (i >= toDelete) break;
    parsedCache.delete(key);
    i++;
  }
}

/** Test-only — reset the parsed-session cache. Not exported via barrel. */
export function __resetParsedCacheForTests(): void {
  parsedCache.clear();
}

/**
 * Parse one on-disk envelope JSON (the format collector-server writes).
 * Returns null when the envelope is unparseable; callers skip-and-continue
 * because one corrupt file must not stop the scan.
 */
export function parseEnvelopeBuffer(buf: Buffer): ParsedSession | null {
  let raw: unknown;
  try {
    raw = JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const envBlock = obj.envelope as Record<string, unknown> | undefined;
  const tBlock = obj.transcript as { compression?: string; content?: string } | undefined;
  if (!envBlock || !tBlock || typeof tBlock.content !== 'string') return null;

  let jsonl: string;
  try {
    jsonl = gunzipSync(Buffer.from(tBlock.content, 'base64')).toString('utf8');
  } catch {
    return null;
  }

  const envelope: ParsedEnvelope = {
    id: str(envBlock.id, 'unknown'),
    userId: str(envBlock.user_id, 'unknown'),
    machineId: str(envBlock.machine_id, 'unknown'),
    sessionId: str(envBlock.session_id, 'unknown'),
    cwd: str(envBlock.cwd, ''),
    projectName:
      (typeof envBlock.project_name === 'string' && envBlock.project_name.trim()) ||
      deriveProjectName(str(envBlock.cwd, '')),
    capturedAt: str(envBlock.captured_at, new Date(0).toISOString()),
    rivenVersion: str(envBlock.riven_version, 'unknown'),
    consentedAt: envBlock.consented_at == null ? null : String(envBlock.consented_at),
  };
  // Plugin-future fast path: when the uploader has already resolved
  // `git config --get remote.origin.url` and emitted it in the envelope,
  // prefer that authoritative value over scanning the transcript text.
  const rawGitRemote = envBlock.git_remote;
  if (typeof rawGitRemote === 'string' && rawGitRemote.length > 0) {
    const norm = findGithubRemote(rawGitRemote) ?? null;
    if (norm) envelope.gitRemote = norm;
  }

  const messages: ParsedMessage[] = [];
  let firstTs: Date | undefined;
  let lastTs: Date | undefined;
  let firstModel: string | undefined;
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (!rec || typeof rec !== 'object') continue;
    const msg = parseMessageRecord(rec as Record<string, unknown>);
    if (!msg) continue;
    messages.push(msg);
    if (msg.ts) {
      if (!firstTs || msg.ts < firstTs) firstTs = msg.ts;
      if (!lastTs || msg.ts > lastTs) lastTs = msg.ts;
    }
    if (!firstModel && msg.model) firstModel = msg.model;
    if (msg.tokens) {
      tokens.input += msg.tokens.input ?? 0;
      tokens.output += msg.tokens.output ?? 0;
      tokens.cacheRead += msg.tokens.cacheRead ?? 0;
      tokens.cacheCreation += msg.tokens.cacheCreation ?? 0;
    }
  }

  const startTs = firstTs ?? new Date(envelope.capturedAt);
  const endTs = lastTs ?? startTs;

  const parsed: ParsedSession = {
    envelope,
    l1RedactionCount: typeof obj.l1_redaction_count === 'number' ? obj.l1_redaction_count : 0,
    messages,
    durationMs: Math.max(0, endTs.getTime() - startTs.getTime()),
    startTs,
    endTs,
    model: firstModel,
    tokens,
  };
  // When envelope didn't carry an authoritative git_remote field, do the
  // one-time transcript scan now so downstream consumers can rely on
  // `envelope.gitRemote` without re-walking the message list.
  if (!envelope.gitRemote) {
    const found = extractRemoteFromSession(parsed);
    if (found) envelope.gitRemote = found;
  }
  return parsed;
}

function parseMessageRecord(rec: Record<string, unknown>): ParsedMessage | null {
  const ts = typeof rec.timestamp === 'string' ? new Date(rec.timestamp) : undefined;
  const inner = (rec.message as Record<string, unknown> | undefined) ?? rec;
  const roleRaw = String(inner.role ?? rec.type ?? '');
  let role: 'user' | 'assistant' | 'tool';
  if (roleRaw === 'assistant') role = 'assistant';
  else if (roleRaw === 'tool') role = 'tool';
  else role = 'user';

  const content = inner.content;
  let text = '';
  const toolUses: ParsedToolUse[] = [];
  const toolResults: ParsedToolResult[] = [];

  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const p = part as Record<string, unknown>;
      switch (p.type) {
        case 'text':
          text += (text ? '\n' : '') + String(p.text ?? '');
          break;
        case 'tool_use':
          toolUses.push({
            name: String(p.name ?? 'unknown'),
            input: (p.input as Record<string, unknown>) ?? {},
          });
          break;
        case 'tool_result': {
          const c = p.content;
          let resultText = '';
          if (typeof c === 'string') resultText = c;
          else if (Array.isArray(c)) {
            for (const x of c) {
              if (x && typeof x === 'object' && (x as Record<string, unknown>).type === 'text') {
                resultText += String((x as Record<string, unknown>).text ?? '');
              }
            }
          }
          toolResults.push({
            toolUseId: typeof p.tool_use_id === 'string' ? p.tool_use_id : undefined,
            isError: p.is_error === true,
            text: resultText,
          });
          break;
        }
      }
    }
  }

  const usage = inner.usage as Record<string, unknown> | undefined;
  const tokens = usage
    ? {
        input: numOrUndef(usage.input_tokens),
        output: numOrUndef(usage.output_tokens),
        cacheRead: numOrUndef(usage.cache_read_input_tokens),
        cacheCreation: numOrUndef(usage.cache_creation_input_tokens),
      }
    : undefined;

  return {
    role,
    ts,
    text,
    toolUses,
    toolResults,
    tokens,
    model: typeof inner.model === 'string' ? inner.model : undefined,
  };
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}
function numOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Common last-path segments that should NOT be treated as project names.
 * Retained from the legacy walk-from-right algorithm; in the new walk-from-root
 * algorithm they serve as an additional skip alongside CONTAINER_DIRS so we
 * never bottom out on a generic build / test folder.
 * Case-insensitive — all entries lower-cased; lookups lower-case the segment.
 */
const COMMON_LAST_SEGMENTS = new Set([
  'src', 'dist', 'test', 'tests', '__tests__',
  'node_modules', '.claude', '.git', 'build', 'out', 'target',
  'lib', 'bin', 'public', 'static',
]);

/**
 * Per-OS user-home prefixes. When a cwd matches one of these, everything up to
 * and including the username segment is stripped, so the next segment is a
 * candidate project root (e.g. `/home/u/Matrix-Riven/...` → walk from
 * `Matrix-Riven/...`).
 *
 * Order matters only insofar as we want the most specific Windows form to
 * win when both could match — `^[A-Z]:\/Users\/[^/]+\/` covers the canonical
 * Windows user-profile path.
 */
const HOME_PREFIX_PATTERNS: RegExp[] = [
  /^\/home\/[^/]+\//,
  /^\/Users\/[^/]+\//,
  /^[A-Z]:\/Users\/[^/]+\//i,
  /^\/root\//,
];

/**
 * Top-level / container-style directories that hold *many* unrelated projects.
 * We walk past these from root toward leaf so the project name resolves to the
 * actual repo, not its parent workspace folder. Add cautiously: any name in
 * here is permanently skipped during project-name derivation.
 */
const CONTAINER_DIRS = new Set<string>([
  'projects', 'project', 'workspace', 'workspaces', 'work',
  'code', 'codes', 'src', 'documents', 'desktop',
  'dev', 'develop', 'repos', 'repo', 'git', 'github',
  'github.com', 'gitlab.com',
  '.cache', '.local',
  // Claude Code conventions — `.claude/worktrees/<slug>` is a transient
  // worktree, never a project root. Skip past so we land on the repo above.
  '.claude', 'worktrees',
  // Windows system folders that leak through when no home prefix matches
  // (e.g. `C:\Users\x\AppData\Local\…` or paths that resolve to `Users`
  // as a standalone segment because the username was missing).
  'users', 'appdata', 'local', 'roaming', 'temp', 'tmp',
  // Common literal fallback that should never surface
  'unknown', 'private', 'jobs',
]);

/**
 * Noise patterns we never want to surface as a project name:
 *   - pure-hex hashes (commit-id-ish: `38a51917`)
 *   - bench fixture names from earlier dogfood runs
 *   - explicitly-disabled folders
 *   - underscore-prefix temp dirs (`_456`, `_temp`)
 *   - pure numeric dirs
 *   - the lowercase-prefix + random-CamelCase suffix shape (`teamagent-2xvaUa`)
 *     that bench fixtures generate
 *   - bare drive letters (`C:` / `D:`) leaked through when no home prefix matched
 */
const NOISE_NAME_PATTERNS: RegExp[] = [
  /^[0-9a-f]{6,}$/i,
  /-bench-/i,
  /-disabled-/i,
  /^_/,
  /^\d+$/,
  // bench-fixture shape: lowercase-prefix then a random alnum suffix with at
  // least one capital. Matches `teamagent-2xvaUa`, `foo-Bar9XyZ`, etc.; does
  // NOT match conventional kebab names like `collector-server`.
  /^[a-z]+-[A-Za-z0-9]*[A-Z][A-Za-z0-9]*$/,
  /^[a-z]:$/i,
  // Claude Code auto-generated worktree names: 3-word lowercase-kebab with
  // a whimsical adjective + verb-ing + noun. Examples:
  //   snug-mixing-kazoo, stateless-dancing-corbato, squishy-moseying-lovelace,
  //   whimsical-napping-sunset, enumerated-roaming-engelbart, ticklish-floating-engelbart.
  // The pattern requires (1) exactly two hyphens, (2) the MIDDLE token ending
  // in `ing` — that's the distinctive shape that separates a worktree slug
  // from real 3-part repo names. Keeps `collector-server-core` etc. safe.
  /^[a-z]+-[a-z]+ing-[a-z]+$/,
];

/**
 * Returns true when `name` looks like a generated / scratch directory name
 * that should not appear as a leadership-dashboard project. The caller
 * decides what to do (skip in derivation, drop from project list, etc.).
 *
 * Also treats CONTAINER_DIRS as noise: when a cwd contained nothing past a
 * generic workspace folder, `deriveProjectName` falls back to that segment
 * (e.g. `/private/tmp` → `tmp`). We don't want `tmp` / `unknown` / `projects`
 * surfacing on the dashboard, so they're filtered here at the project-list
 * gate.
 */
export function isNoiseProjectName(name: string): boolean {
  if (!name || name.length < 2) return true;
  if (CONTAINER_DIRS.has(name.toLowerCase())) return true;
  if (name === 'unknown') return true;
  return NOISE_NAME_PATTERNS.some((rx) => rx.test(name));
}

/**
 * Derive a project name from a cwd path when envelope.project_name is missing.
 *
 * Algorithm (walk-from-root, post-2026-05-17 calibration):
 *   1. Normalize Windows separators → '/'.
 *   2. Strip the user-home prefix (`/home/<u>/`, `C:/Users/<u>/`, etc.) so the
 *      first remaining segment is a candidate project root.
 *   3. Walk segments left-to-right; skip CONTAINER_DIRS (`projects`, `code`...),
 *      noise (hash/bench/temp), and COMMON_LAST_SEGMENTS (legacy skip list).
 *      Return the first segment that survives all three filters.
 *   4. Last resort: return the right-most segment so we never return `unknown`
 *      for a non-empty path.
 *
 * Edge cases:
 *   - empty cwd → 'unknown'
 *   - all segments filtered → last segment (so dashboard still has a label)
 *   - handles both POSIX `/` and Windows `\` separators
 */
export function deriveProjectName(cwd: string): string {
  if (!cwd) return 'unknown';
  let trimmed = cwd.replace(/\\/g, '/');
  for (const rx of HOME_PREFIX_PATTERNS) {
    const m = trimmed.match(rx);
    if (m) {
      trimmed = trimmed.slice(m[0].length);
      break;
    }
  }
  const parts = trimmed.split('/').filter((p) => p.length > 0);
  if (parts.length === 0) return 'unknown';
  for (const part of parts) {
    const lc = part.toLowerCase();
    if (CONTAINER_DIRS.has(lc)) continue;
    if (isNoiseProjectName(part)) continue;
    if (COMMON_LAST_SEGMENTS.has(lc)) continue;
    return part;
  }
  return parts[parts.length - 1]!;
}

export interface ScanOptions {
  fromDate?: string;
  toDate?: string;
}

/**
 * Parse a raw Claude Code `.jsonl` transcript file (the native on-disk format
 * that Claude Code itself writes — NOT the envelope-wrapped `.json` format that
 * the collector server uploads).  Each line is a conversation event.
 *
 * We synthesise a ParsedSession from the top-level fields that appear on every
 * line (cwd, sessionId) plus the per-line `type`, `message`, `timestamp` fields.
 */
export function parseRawJsonlBuffer(
  buf: Buffer,
  userId: string,
  dateStr: string,
  sessionId: string,
): ParsedSession | null {
  const text = buf.toString('utf8');
  const lines = text.split('\n');

  let cwd = '';
  let firstTs: Date | undefined;
  let lastTs: Date | undefined;
  let firstModel: string | undefined;
  const messages: ParsedMessage[] = [];
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

  for (const line of lines) {
    if (!line.trim()) continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    // Grab cwd from any line that has it
    if (!cwd && typeof rec.cwd === 'string') cwd = rec.cwd;

    // Only process user/assistant turns
    const eventType = rec.type as string | undefined;
    if (eventType !== 'user' && eventType !== 'assistant') continue;

    const ts = typeof rec.timestamp === 'string' ? new Date(rec.timestamp) : undefined;
    if (ts) {
      if (!firstTs || ts < firstTs) firstTs = ts;
      if (!lastTs || ts > lastTs) lastTs = ts;
    }

    const msgRaw = rec.message as Record<string, unknown> | undefined;
    if (!msgRaw) continue;

    const roleRaw = String(msgRaw.role ?? '');
    let role: 'user' | 'assistant' | 'tool';
    if (roleRaw === 'assistant') role = 'assistant';
    else if (roleRaw === 'tool') role = 'tool';
    else role = 'user';

    const content = msgRaw.content;
    let msgText = '';
    const toolUses: ParsedToolUse[] = [];
    const toolResults: ParsedToolResult[] = [];

    if (typeof content === 'string') {
      msgText = content;
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (!part || typeof part !== 'object') continue;
        const p = part as Record<string, unknown>;
        switch (p.type) {
          case 'text':
            msgText += (msgText ? '\n' : '') + String(p.text ?? '');
            break;
          case 'tool_use':
            toolUses.push({
              name: String(p.name ?? 'unknown'),
              input: (p.input as Record<string, unknown>) ?? {},
            });
            break;
          case 'tool_result': {
            const c = p.content;
            let resultText = '';
            if (typeof c === 'string') resultText = c;
            else if (Array.isArray(c)) {
              for (const x of c) {
                if (x && typeof x === 'object' && (x as Record<string, unknown>).type === 'text') {
                  resultText += String((x as Record<string, unknown>).text ?? '');
                }
              }
            }
            toolResults.push({
              toolUseId: typeof p.tool_use_id === 'string' ? p.tool_use_id : undefined,
              isError: p.is_error === true,
              text: resultText,
            });
            break;
          }
        }
      }
    }

    const model = typeof msgRaw.model === 'string' ? msgRaw.model : undefined;
    if (!firstModel && model) firstModel = model;

    const usage = msgRaw.usage as Record<string, unknown> | undefined;
    let msgTokens: ParsedMessage['tokens'];
    if (usage) {
      msgTokens = {
        input: numOrUndef(usage.input_tokens),
        output: numOrUndef(usage.output_tokens),
        cacheRead: numOrUndef(usage.cache_read_input_tokens),
        cacheCreation: numOrUndef(usage.cache_creation_input_tokens),
      };
      tokens.input += msgTokens.input ?? 0;
      tokens.output += msgTokens.output ?? 0;
      tokens.cacheRead += msgTokens.cacheRead ?? 0;
      tokens.cacheCreation += msgTokens.cacheCreation ?? 0;
    }

    messages.push({ role, ts, text: msgText, toolUses, toolResults, tokens: msgTokens, model });
  }

  // Need at least one timestamped message to be useful
  if (!firstTs) {
    // Fallback: derive from dateStr (YYYY-MM-DD)
    const d = new Date(dateStr + 'T00:00:00.000Z');
    if (isNaN(d.getTime())) return null;
    firstTs = d;
    lastTs = d;
  }

  const projectName = cwd ? deriveProjectName(cwd) : 'unknown';

  const envelope: ParsedEnvelope = {
    id: sessionId,
    userId,
    machineId: 'snapshot',
    sessionId,
    cwd,
    projectName,
    capturedAt: firstTs.toISOString(),
    rivenVersion: 'snapshot',
    consentedAt: null,
  };

  const startTs = firstTs;
  const endTs = lastTs ?? firstTs;

  const parsed: ParsedSession = {
    envelope,
    l1RedactionCount: 0,
    messages,
    durationMs: Math.max(0, endTs.getTime() - startTs.getTime()),
    startTs,
    endTs,
    model: firstModel,
    tokens,
  };
  // Raw `.jsonl` transcripts (the local Claude Code on-disk format) never
  // carry an envelope.git_remote — always scan the messages for github
  // URLs so the leadership dashboard can still resolve `owner/repo`.
  const found = extractRemoteFromSession(parsed);
  if (found) envelope.gitRemote = found;
  return parsed;
}

// ---------------------------------------------------------------------------
// GitHub remote resolution — 2026-05-17 project-identity rebuild
// ---------------------------------------------------------------------------

/**
 * Match a GitHub remote URL inside `s` and return the `owner/repo` form.
 * Recognises the three shapes we see in cc-session transcripts:
 *
 *   - SSH:   `git@github.com:owner/repo[.git]`
 *   - HTTPS: `https://github.com/owner/repo[.git][/...]`
 *   - bare:  `github.com/owner/repo` (rare; appears in docs/README quotes)
 *
 * The first match wins; trailing `/` and `.git` are stripped before return so
 * the canonical form is always identifier-shaped. Returns null when the input
 * is empty, nullable, or contains no recognisable github URL.
 *
 * Exported because the envelope-parser uses it to normalise an authoritative
 * `envelope.git_remote` plugin field, and the tests pin its behaviour.
 */
export function findGithubRemote(s: string | undefined | null): string | null {
  if (!s) return null;
  // SSH form: git@github.com:owner/repo[.git]
  const ssh = s.match(/git@github\.com:([\w.-]+\/[\w.-]+?)(?:\.git)?(?=$|[\s,'"])/);
  if (ssh && ssh[1]) return normaliseOwnerRepo(ssh[1]);
  // HTTPS form: https://github.com/owner/repo[.git][/...]
  const https = s.match(
    /https?:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?(?=$|[/\s,?#'"])/,
  );
  if (https && https[1]) return normaliseOwnerRepo(https[1]);
  return null;
}

function normaliseOwnerRepo(s: string): string {
  // Strip any trailing slash, `.git`, or stray trailing periods picked up
  // from sentence punctuation (e.g. "see github.com/owner/repo." in prose).
  return s
    .replace(/\/$/, '')
    .replace(/\.git$/, '')
    .replace(/\.+$/, '');
}

/**
 * Common placeholder `owner/repo` slugs that appear in documentation or
 * example URLs. We never want these surfacing as a real project identity,
 * since they'd collapse unrelated sessions that happened to include the
 * example URL in a prompt or transcript.
 */
const PLACEHOLDER_REMOTES = new Set([
  'owner/repo',
  'foo/bar',
  'user/repo',
  'org/repo',
  'username/repo',
  'example/example',
  'your-org/your-repo',
]);

/**
 * Scan a parsed session for the first github.com URL inside any Bash command,
 * tool-result text, or other string-valued tool-input field. Used at parse
 * time so every ParsedSession gets `envelope.gitRemote` populated once and
 * downstream consumers (aggregator, propagation pass) skip re-scanning.
 *
 * Returns null when nothing is found; callers should then rely on cwd-prefix
 * propagation across sibling sessions (`propagateRemotes`) or the
 * `deriveProjectName` cwd-walk fallback.
 *
 * Placeholder slugs (`owner/repo`, `foo/bar`, etc.) are filtered out — those
 * almost always come from documentation/example URLs and would otherwise
 * collapse unrelated sessions that quoted the same example.
 */
export function extractRemoteFromSession(session: ParsedSession): string | null {
  for (const m of session.messages) {
    for (const tu of m.toolUses) {
      if (tu.name === 'Bash' && typeof tu.input.command === 'string') {
        const found = findGithubRemote(tu.input.command);
        if (found && !PLACEHOLDER_REMOTES.has(found.toLowerCase())) return found;
      }
      // Also peek into other string-valued tool inputs (file paths in
      // Write/Edit, URLs in WebFetch, etc.) for occasional embedded
      // github.com references.
      for (const v of Object.values(tu.input)) {
        if (typeof v === 'string') {
          const found = findGithubRemote(v);
          if (found && !PLACEHOLDER_REMOTES.has(found.toLowerCase())) return found;
        }
      }
    }
    for (const tr of m.toolResults) {
      const found = findGithubRemote(tr.text);
      if (found && !PLACEHOLDER_REMOTES.has(found.toLowerCase())) return found;
    }
  }
  return null;
}

/**
 * Resolve a session's project identity. Priority:
 *
 *   1. `envelope.gitRemote` — `owner/repo`, authoritative when set
 *   2. `envelope.projectName` — Phase-1 upstream uploader field, when
 *      present and not the literal "unknown" sentinel
 *   3. `deriveProjectName(cwd)` — last-resort heuristic walk
 *
 * Returning a string lets `aggregator.groupBy` use the resolved identity as
 * the grouping key, which automatically collapses multi-cwd sessions of the
 * same repo into one project entry.
 */
export function resolveProjectIdentity(envelope: ParsedEnvelope): string {
  if (envelope.gitRemote) return envelope.gitRemote;
  if (
    envelope.projectName &&
    envelope.projectName.trim() &&
    envelope.projectName !== 'unknown'
  ) {
    return envelope.projectName;
  }
  return deriveProjectName(envelope.cwd ?? '');
}

/**
 * Fill in `envelope.gitRemote` for sessions whose cwd shares a prefix with
 * at least one other session that did discover a github URL. Without this
 * step, only sessions that actually ran `git remote -v` / `git clone …`
 * would carry a remote; everything else in the same repo would still group
 * by the cwd-derived name and collide with the remote-derived sibling.
 *
 * Algorithm:
 *   1. For each session that already has a remote, strip the user-home
 *      prefix from its cwd so `/home/u/proj-a/src` becomes `proj-a/src`.
 *      Index every prefix from the full path down to the FIRST segment
 *      past home (`proj-a`). This bounds propagation to the repo-root
 *      level — a sibling cwd `/home/u/proj-b/lib` will not collide because
 *      `proj-b` is a different first-post-home segment.
 *   2. For each remote-less session, normalise its cwd the same way and
 *      pick the longest matching indexed prefix. Longest-match wins so a
 *      nested repo doesn't inherit its grandparent's remote.
 *
 * The home-prefix-strip uses the same `HOME_PREFIX_PATTERNS` that
 * `deriveProjectName` uses, so cross-platform behaviour stays consistent.
 * Sessions whose cwd is too short to have a repo-root segment (e.g. just
 * `/home/u`) are skipped on the source side — we have no meaningful key
 * to anchor the propagation.
 *
 * Mutates envelopes in place. Idempotent. Exported so the data-trust tests
 * can pin behaviour directly.
 */
export function propagateRemotes(sessions: ParsedSession[]): void {
  const cwdToRemote = new Map<string, string>();
  for (const s of sessions) {
    if (!s.envelope.gitRemote || !s.envelope.cwd) continue;
    const stripped = stripHomePrefix(s.envelope.cwd);
    const segments = stripped.split('/').filter(Boolean);
    if (segments.length === 0) continue;
    // Index from the full path down to the first segment past home (the
    // repo-root candidate). We never index just the home-prefix portion
    // itself, so unrelated repos under the same `/home/u/` won't collide.
    for (let i = segments.length; i >= 1; i--) {
      const prefix = '/' + segments.slice(0, i).join('/');
      if (!cwdToRemote.has(prefix)) cwdToRemote.set(prefix, s.envelope.gitRemote);
    }
  }
  for (const s of sessions) {
    if (s.envelope.gitRemote || !s.envelope.cwd) continue;
    const cwd = '/' + stripHomePrefix(s.envelope.cwd).split('/').filter(Boolean).join('/');
    let bestPrefix: string | null = null;
    let bestRemote: string | null = null;
    for (const [prefix, remote] of cwdToRemote) {
      if (cwd === prefix || cwd.startsWith(prefix + '/')) {
        if (!bestPrefix || prefix.length > bestPrefix.length) {
          bestPrefix = prefix;
          bestRemote = remote;
        }
      }
    }
    if (bestRemote) s.envelope.gitRemote = bestRemote;
  }
}

/**
 * Internal helper — strip the user-home prefix (`/home/<u>/`, `C:/Users/<u>/`,
 * etc.) from a cwd so propagation indices anchor to repo-root segments rather
 * than shared ancestor directories. Returns the input unchanged (with `\` →
 * `/`) when no home pattern matches.
 */
function stripHomePrefix(cwd: string): string {
  let normalised = cwd.replace(/\\/g, '/');
  for (const rx of HOME_PREFIX_PATTERNS) {
    const m = normalised.match(rx);
    if (m) {
      normalised = normalised.slice(m[0].length);
      break;
    }
  }
  return normalised;
}

export function scanAllSessions(collectorDir: string, opts: ScanOptions = {}): ParsedSession[] {
  if (!existsSync(collectorDir)) return [];
  let users: string[];
  try {
    users = readdirSync(collectorDir);
  } catch {
    return [];
  }
  const out: ParsedSession[] = [];
  for (const userDir of users) {
    const userPath = path.join(collectorDir, userDir);
    let s: ReturnType<typeof statSync> | null;
    try {
      s = statSync(userPath);
    } catch {
      continue;
    }
    if (!s.isDirectory()) continue;

    let dateDirs: string[];
    try {
      dateDirs = readdirSync(userPath);
    } catch {
      continue;
    }
    for (const dateDir of dateDirs) {
      if (opts.fromDate && dateDir < opts.fromDate) continue;
      if (opts.toDate && dateDir > opts.toDate) continue;
      const datePath = path.join(userPath, dateDir);
      scanLeafDir(datePath, userDir, dateDir, out);
    }
  }
  // 2026-05-17 — fill in `envelope.gitRemote` for sessions that didn't run
  // any git commands themselves but share a cwd tree with a session that
  // did. Without this step, sibling sessions of the same repo would still
  // group separately under their cwd-derived names and inflate the project
  // list.
  propagateRemotes(out);
  return out;
}

/**
 * P-D1 — Scan one leaf `<user>/<date>` directory, preferring the on-disk
 * index when present and current. The index lets us skip `readdirSync` plus
 * a per-file `statSync`; falling back to the legacy enumeration if the index
 * is missing, empty, or has any mtime mismatch keeps correctness intact.
 *
 * Output is appended to `out` to keep allocation patterns identical to the
 * pre-index loop (caller batches a single array across all leaves).
 */
function scanLeafDir(
  datePath: string,
  userDir: string,
  dateDir: string,
  out: ParsedSession[],
): void {
  const idx = loadIndexSync(datePath);
  if (idx.entries.length > 0 && indexLooksCurrent(datePath, idx.entries)) {
    // Index fast path: mtime is already in the index entry, no stat needed.
    for (const e of idx.entries) {
      parseAndPush(path.join(datePath, e.file), e.file, userDir, dateDir, out, e.mtime);
    }
    return;
  }
  // Legacy enumeration path — used when no index exists yet or any entry
  // has a stale mtime (a new file may have landed between rebuilds).
  let files: string[];
  try {
    files = readdirSync(datePath);
  } catch {
    return;
  }
  for (const f of files) {
    if (f === INDEX_FILENAME) continue;
    const filePath = path.join(datePath, f);
    let mtimeMs: number | undefined;
    try {
      mtimeMs = statSync(filePath).mtimeMs;
    } catch {
      // File vanished between readdir and stat — skip silently.
      continue;
    }
    parseAndPush(filePath, f, userDir, dateDir, out, mtimeMs);
  }
}

/**
 * Returns true iff every indexed file still exists with the recorded mtime.
 * One mismatch → fall back to a full scan (cheap: a stat call per indexed
 * file, no parsing). This avoids serving stale data when a transcript was
 * overwritten or a new file appeared since the last index rebuild.
 */
function indexLooksCurrent(datePath: string, entries: IndexEntry[]): boolean {
  for (const e of entries) {
    try {
      const st = statSync(path.join(datePath, e.file));
      if (st.mtimeMs !== e.mtime) return false;
    } catch {
      return false; // file disappeared since the index was built
    }
  }
  return true;
}

/**
 * Read + parse a single session file, then push to `out`. Used by both the
 * index fast path and the legacy enumeration fallback so format dispatch
 * lives in exactly one place.
 *
 * Consults the module-level `parsedCache` on entry: if a parsed session
 * exists for this `(absPath, mtimeMs)` pair, we skip the disk read AND
 * the parse and reuse the cached object directly. This is the P-D1
 * follow-up optimization — most cold scans after the first land here.
 */
function parseAndPush(
  filePath: string,
  fileName: string,
  userDir: string,
  dateDir: string,
  out: ParsedSession[],
  mtimeMs: number,
): void {
  const key = cacheKey(filePath, mtimeMs);
  const cached = parsedCache.get(key);
  if (cached) {
    out.push(cached);
    return;
  }
  let buf: Buffer;
  try {
    buf = readFileSync(filePath);
  } catch {
    return;
  }
  let parsed: ParsedSession | null = null;
  if (fileName.endsWith('.json')) {
    parsed = parseEnvelopeBuffer(buf);
  } else if (fileName.endsWith('.jsonl')) {
    const sessionId = fileName.slice(0, -'.jsonl'.length);
    parsed = parseRawJsonlBuffer(buf, userDir, dateDir, sessionId);
  }
  if (parsed) {
    parsedCache.set(key, parsed);
    maybeEvict();
    out.push(parsed);
  }
}
