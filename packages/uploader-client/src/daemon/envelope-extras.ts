/**
 * Bucket 1/2 — assemble the `EnvelopeExtras` block that piggy-backs on every
 * cc-session upload. Runs inside the upload daemon, NOT the Stop-hook path,
 * so the cost of reading settings.json / CLAUDE.md / credentials is off the
 * critical path.
 *
 * Three buckets of data:
 *   1. Cheap, in-memory   (node version, timezone, proxy flag, shell)
 *   2. Filesystem reads   (settings.json digest, CLAUDE.md, OAuth expiry)
 *   3. Subprocess sniffs  (pnpm/git/cc version)  — cached for the lifetime
 *      of this daemon process
 *
 * Every field is best-effort: failures swallow + omit. The collector treats
 * absence as "unknown", never as a misleading zero.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir, platform } from 'node:os';
import { dirname, join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { EnvelopeExtras, HostInfo, SettingsDigest } from '@matrix-riven/shared';

const MAX_CLAUDE_MD_BYTES = 64 * 1024;
const SETTINGS_PATH = join('.claude', 'settings.json');
const CREDENTIALS_PATH = join('.claude', '.credentials.json');

// Per-daemon-process cache for subprocess sniffs (pnpm/git/cc versions).
const sniffCache: Record<string, string | null> = {};

function sniffVersion(cmd: string, args: readonly string[]): string | undefined {
  const cacheKey = `${cmd}::${args.join(' ')}`;
  if (cacheKey in sniffCache) return sniffCache[cacheKey] ?? undefined;
  try {
    const r = spawnSync(cmd, args, {
      timeout: 1000,
      encoding: 'utf-8',
      windowsHide: true,
    });
    if (r.status === 0 && typeof r.stdout === 'string') {
      const v = r.stdout.trim().split(/\r?\n/)[0] ?? '';
      const result = v.length > 0 ? v : null;
      sniffCache[cacheKey] = result;
      return result ?? undefined;
    }
  } catch {
    /* sniff failure — cache as null below */
  }
  sniffCache[cacheKey] = null;
  return undefined;
}

function computeHostInfo(): Partial<HostInfo> {
  const out: Partial<HostInfo> = {};
  out.node_version = process.versions.node;
  try {
    out.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    /* ICU absent in this build */
  }
  const proxy =
    process.env.HTTP_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.http_proxy ||
    process.env.https_proxy;
  if (proxy) out.via_proxy = true;
  // Shell: $SHELL on POSIX, $ComSpec on Windows. Basename only.
  const shellPath = process.env.SHELL || process.env.ComSpec || '';
  if (shellPath) out.shell = basename(shellPath);
  const pnpmVer = sniffVersion('pnpm', ['--version']);
  if (pnpmVer) out.pnpm_version = pnpmVer;
  const gitVer = sniffVersion('git', ['--version']);
  if (gitVer) {
    // "git version 2.47.1.windows.1" → "2.47.1.windows.1"
    const m = /^git version (.+)$/.exec(gitVer);
    out.git_version = m ? m[1] : gitVer;
  }
  // CC version: CC itself sets CLAUDE_CODE_VERSION when it spawns hooks. If
  // not set, try `claude --version` once and cache.
  const envCc = process.env.CLAUDE_CODE_VERSION || process.env.CLAUDECODE_VERSION;
  if (envCc) out.cc_version = envCc;
  else {
    const sniffed = sniffVersion('claude', ['--version']);
    if (sniffed) out.cc_version = sniffed;
  }
  return out;
}

function computeSettingsDigest(home: string): SettingsDigest | undefined {
  const p = join(home, SETTINGS_PATH);
  if (!existsSync(p)) return undefined;
  try {
    const buf = readFileSync(p);
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const size = buf.length;
    let hookCount = 0;
    const plugins: string[] = [];
    try {
      const parsed = JSON.parse(buf.toString('utf-8')) as Record<string, unknown>;
      if (parsed.hooks && typeof parsed.hooks === 'object') {
        for (const arr of Object.values(parsed.hooks as Record<string, unknown>)) {
          if (Array.isArray(arr)) hookCount += arr.length;
        }
      }
      const en = parsed.enabledPlugins;
      if (en && typeof en === 'object') {
        for (const [name, enabled] of Object.entries(en as Record<string, unknown>)) {
          if (enabled === true) plugins.push(name);
        }
      }
    } catch {
      /* unparseable — still report sha256 + size, but no hook/plugin breakdown */
    }
    return { sha256, size, hook_count: hookCount, plugins };
  } catch {
    return undefined;
  }
}

function findClaudeMd(startCwd: string): string | null {
  // Look in cwd and up to 5 ancestor levels for a CLAUDE.md.
  let dir = startCwd;
  for (let i = 0; i < 6; i++) {
    const p = join(dir, 'CLAUDE.md');
    try {
      if (existsSync(p) && statSync(p).isFile()) return p;
    } catch {
      /* */
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function computeClaudeMd(cwd: string): { content: string; size: number } | undefined {
  const p = findClaudeMd(cwd);
  if (!p) return undefined;
  try {
    const st = statSync(p);
    if (!st.isFile()) return undefined;
    if (st.size > MAX_CLAUDE_MD_BYTES) {
      // Truncate at the cap — record the original size so the dashboard knows
      // the trail was cut.
      const buf = readFileSync(p);
      return { content: buf.slice(0, MAX_CLAUDE_MD_BYTES).toString('utf-8'), size: st.size };
    }
    return { content: readFileSync(p, 'utf-8'), size: st.size };
  } catch {
    return undefined;
  }
}

function computeOauthExpiresAt(home: string): string | undefined {
  const p = join(home, CREDENTIALS_PATH);
  if (!existsSync(p)) return undefined;
  try {
    const raw = readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // CC's credentials file stores claudeAiOauth.expiresAt (unix seconds OR ISO).
    // Walk a few candidate paths defensively.
    const oauth = parsed.claudeAiOauth as Record<string, unknown> | undefined;
    const candidates: unknown[] = [
      oauth?.expiresAt,
      oauth?.expires_at,
      parsed.expires_at,
      parsed.expiresAt,
    ];
    for (const c of candidates) {
      if (typeof c === 'string' && c.length > 0) return c;
      if (typeof c === 'number' && Number.isFinite(c)) {
        // unix seconds or ms — heuristic: > 2e10 means ms
        const ms = c > 2e10 ? c : c * 1000;
        return new Date(ms).toISOString();
      }
    }
  } catch {
    /* missing or malformed */
  }
  return undefined;
}

/**
 * Build all envelope-extra fields for one upload. `cwd` is the cc-session
 * metadata.cwd (the developer's project directory at tap time).
 */
export interface ComputeExtrasInput {
  cwd?: string;
  /** Stats from scanTranscriptForStats — pass through to envelope. */
  redactionsByKind?: Record<string, number>;
  redactionsByLocation?: {
    in_user_prompt: number;
    in_assistant_response: number;
    in_tool_use_input: number;
    in_tool_result: number;
  };
}

export function computeEnvelopeExtras(input: ComputeExtrasInput): EnvelopeExtras {
  const home = homedir();
  const out: EnvelopeExtras = {};
  const host = computeHostInfo();
  if (Object.keys(host).length > 0) out.hostInfo = host;
  const sd = computeSettingsDigest(home);
  if (sd) out.settingsDigest = sd;
  const cm = input.cwd ? computeClaudeMd(input.cwd) : undefined;
  if (cm) out.claudeMd = cm;
  const oauth = computeOauthExpiresAt(home);
  if (oauth) out.oauthExpiresAt = oauth;
  if (input.redactionsByKind) out.l1RedactionsByKind = input.redactionsByKind;
  if (input.redactionsByLocation) out.l1RedactionsByLocation = input.redactionsByLocation;
  return out;
}

/** Test-only — reset the version-sniff cache between unit tests. */
export function __resetEnvelopeExtrasCacheForTests(): void {
  for (const k of Object.keys(sniffCache)) delete sniffCache[k];
}

// Suppress unused-import warning under tsc strict: keep platform around for
// future per-OS branches without re-importing.
void platform;
