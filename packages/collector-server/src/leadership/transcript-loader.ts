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

  return {
    envelope,
    l1RedactionCount: typeof obj.l1_redaction_count === 'number' ? obj.l1_redaction_count : 0,
    messages,
    durationMs: Math.max(0, endTs.getTime() - startTs.getTime()),
    startTs,
    endTs,
    model: firstModel,
    tokens,
  };
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
 * When cwd ends in one of these, walk back toward root to find a real name.
 * Case-insensitive — all entries lower-cased; lookups lower-case the segment.
 */
const COMMON_LAST_SEGMENTS = new Set([
  'src', 'dist', 'test', 'tests', '__tests__',
  'node_modules', '.claude', '.git', 'build', 'out', 'target',
  'lib', 'bin', 'public', 'static',
]);

/**
 * Derive a project name from a cwd path when envelope.project_name is missing.
 * Walks from the last segment back toward root, skipping common build/test
 * directories that would otherwise collide many unrelated projects on the
 * same name (e.g. every "src" subfolder becoming a "src" project).
 *
 * Edge cases:
 *   - empty cwd → 'unknown'
 *   - single-segment cwd → that segment
 *   - all segments are common → last segment as last resort
 *   - handles both POSIX `/` and Windows `\` separators
 */
export function deriveProjectName(cwd: string): string {
  const parts = cwd.replace(/\\/g, '/').split('/').filter(p => p.length > 0);
  if (parts.length === 0) return 'unknown';
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!COMMON_LAST_SEGMENTS.has(parts[i]!.toLowerCase())) return parts[i]!;
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

  return {
    envelope,
    l1RedactionCount: 0,
    messages,
    durationMs: Math.max(0, endTs.getTime() - startTs.getTime()),
    startTs,
    endTs,
    model: firstModel,
    tokens,
  };
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
    for (const e of idx.entries) {
      parseAndPush(path.join(datePath, e.file), e.file, userDir, dateDir, out);
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
    parseAndPush(path.join(datePath, f), f, userDir, dateDir, out);
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
 */
function parseAndPush(
  filePath: string,
  fileName: string,
  userDir: string,
  dateDir: string,
  out: ParsedSession[],
): void {
  let buf: Buffer;
  try {
    buf = readFileSync(filePath);
  } catch {
    return;
  }
  if (fileName.endsWith('.json')) {
    const parsed = parseEnvelopeBuffer(buf);
    if (parsed) out.push(parsed);
  } else if (fileName.endsWith('.jsonl')) {
    const sessionId = fileName.slice(0, -'.jsonl'.length);
    const parsed = parseRawJsonlBuffer(buf, userDir, dateDir, sessionId);
    if (parsed) out.push(parsed);
  }
}
