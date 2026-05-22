import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import type { Socket } from 'node:net';
import { gunzipSync } from 'node:zlib';
import {
  writeFileSync,
  renameSync,
  unlinkSync,
  mkdirSync,
  readdirSync,
  statSync,
  existsSync,
  readFileSync,
  appendFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve as resolvePath, sep } from 'node:path';
import { DASHBOARD_HTML } from './dashboard-html.js';
import { safeUserId, dateStamp, readEnvWithLegacy } from '@matrix-riven/shared';
import {
  appendCcStatusSnapshot,
  readLatestPerSession,
  readLatestForSession,
  readLatestAllUsers,
  readHistory,
} from '@matrix-riven/shared';
// M2 (对话上传通道) — member self-view stats ("成员可以查看自己的『已上传对话
// 总量、最近一次上传时间、敏感字段被模糊化次数』").
import { computeMemberStats } from './member-stats.js';
// M2 (对话上传通道) — transport security on the conversation-upload path.
// `wrapServerWithHttps` reuses the plain-HTTP request listener over TLS;
// `requireBearerToken` gates POST /v1/cc-sessions when RIVEN_AUTH_TOKEN (or
// legacy BPP_AUTH_TOKEN) is set.
import { wrapServerWithHttps } from './https-server.js';
import { requireBearerToken } from './auth-gate.js';
// M2 — server-side L2 scan ("第二层敏感信息扫描（兜底）"): the catch-all for
// anything the member's L1 pass missed before a transcript lands on disk.
import { detectSensitiveText, redactSensitiveText } from '@matrix-riven/shared';
// Leadership overview (Task 8) — GET /api/overview wires these two together.
import { scanForOverview } from './overview/disk-scan.js';
import { buildOverview } from './overview/aggregator.js';
// Client auto-update (2026-05-19) — manifest / file / error-ingest / status routes.
import {
  handleManifestRequest,
  handleFileRequest,
  sanitizeErrorReport,
  appendErrorReport,
  buildClientUpdateStatus,
  resolveClientLatestDir,
  resolveErrorsJsonlPath,
} from './client-update/index.js';
// Task 15 — Leadership API + HTML routes (replaces legacy /api/overview in the
// dispatch order so the new aggregator + cache wins over the old disk-scan path).
import { TtlCache } from './leadership/cache.js';
import { handleLeadershipRequest, type LeadershipRouteDeps } from './leadership/routes.js';
// P-D1 — on-disk session index. Built async at startup when missing, appended
// after each successful POST so scanAllSessions has a fast cold-start path.
import { appendIndex, rebuildAllIndexes } from './leadership/index.js';
// L-11 — LLM narrative layer boot wiring. `LLM_ENABLED=false` (default) keeps
// the dashboard byte-identical to pre-L-8: no cache file is created, no worker
// is started, and `llmCache` stays undefined so the aggregator skips its
// enrichment pass.
import { readLlmConfig } from './leadership/llm/config.js';
import { LlmCache } from './leadership/llm/cache.js';
import {
  startWorker,
  type WorkerHandle,
} from './leadership/llm/worker.js';
import { collectWorkerInputs } from './leadership/llm/inputs.js';

/** Cap raw POST body to bound memory + reject obvious DoS payloads. */
export const MAX_BODY_BYTES = 32 * 1024 * 1024;
/** Cap gzip output to defeat zip-bomb DoS (jsonl rarely compresses >30x). */
export const MAX_DECOMPRESSED_BYTES = 256 * 1024 * 1024;

/**
 * Detect synthetic transcripts produced by `bin-digital-twin inject-mock`.
 *
 * The CLI's `inject-mock` subcommand writes a fixed two-line transcript with
 * `"inject-mock probe"` (user) + `"inject-mock ack"` (assistant) as evidence
 * payload — used as a local upload-pipeline smoke test. The `RIVEN_UPLOADER_DRYRUN=1`
 * env keeps these from hitting a server when used correctly, but historical
 * INSTALL.md guidance had readers run the uploader without it, leaking ~376 byte
 * synthetic sessions into prod `<user>/<date>/` dirs.
 *
 * INSTALL.md guidance is already fixed (bb4ca35), but server-side rejection is
 * defense in depth: any caller (old client, custom script, AI agent reading old
 * docs) cannot pollute the collector regardless of CLI-side gates.
 *
 * Returns true when both marker phrases appear in the decoded transcript text.
 * A real session would only contain these strings if the user manually typed
 * them; the false-positive rate is acceptable for a debug payload identifier.
 */
export function isInjectMockTranscript(transcriptText: string): boolean {
  return (
    transcriptText.includes('"inject-mock probe"') &&
    transcriptText.includes('"inject-mock ack"')
  );
}

/**
 * Top-level directories under `outputDir` that are NOT user data and must
 * be filtered out of `GET /api/users`. The collector co-locates publish /
 * auto-update artifacts (`client-latest/`) and append-only error logs
 * (`client-update-errors.jsonl`) under the same root as per-user upload
 * dirs (`<user_id>/<date>/...`). Without this filter the dashboard /
 * `/api/users` consumer sees `client-latest` as a phantom team member.
 *
 * Files at the top level are already excluded by `listDirNames` (filters
 * to directory entries); this set covers the directory-typed reserved
 * names. Add to this set when new top-level dirs are introduced.
 */
const RESERVED_TOP_LEVEL_DIRS = new Set<string>([
  'client-latest', // populated by `scripts/publish-client.mjs`
]);

/**
 * Email TLDs we treat as "real" — Matrix-Riven's `getUserId()` produces these
 * out of `git config user.email`. Anything outside this allowlist is treated
 * as a hostname-fallback "ghost" identifier.
 *
 * Keep small + explicit. False-positive cost (rejecting a real user) is
 * higher than false-negative cost (failing to filter a ghost).
 */
const REAL_EMAIL_TLDS = [
  '.com', '.cn', '.io', '.org', '.net', '.dev', '.ai', '.co',
  '.app', '.me', '.us', '.uk', '.eu', '.gov', '.edu',
];

/**
 * Detect Matrix-Riven's `${unix_user}@${hostname}` identity fallback.
 *
 * `getUserId()` (packages/shared/src/identity.ts) calls
 * `git config user.email` and falls back to `${userInfo().username}@${hostname()}`
 * when git is absent, `user.email` is unset, or the shell-out times out.
 * That fallback produces user_ids the collector treats as full members
 * (own `<user>/<date>/` tree), even though they're typically the SAME
 * physical person whose Stop hook tags transcripts with their real email
 * via `cfg.identity.user_id` from `~/.riven/digital-twin.json`.
 *
 *   isGhostUserId('hrdai@qq.com')                              → false
 *   isGhostUserId('horton2048@users.noreply.github.com')       → false (`.com`)
 *   isGhostUserId('19723@hut')                                 → true  (bare host)
 *   isGhostUserId('blink@BlinkdeMacBook-Air.local')            → true  (`.local`)
 *   isGhostUserId('neurobot@NeuroBot')                         → true
 *
 * Shape test only. A "sole-identity ghost" (someone whose only upload identity
 * IS this form) still matches — the redundant-vs-sole distinction is made by
 * the call site cross-referencing against existing non-ghost transcripts.
 */
export function isGhostUserId(userId: string): boolean {
  const at = userId.lastIndexOf('@');
  if (at <= 0) return false; // empty local part or no '@' → not classified
  const host = userId.slice(at + 1);
  if (host.length === 0) return false;
  if (host.endsWith('.local')) return true;
  const lower = host.toLowerCase();
  for (const tld of REAL_EMAIL_TLDS) {
    if (lower.endsWith(tld)) return false;
  }
  // Plain bare hostname (no `.`) — classic `${user}@${hostname}` fallback.
  if (!host.includes('.')) return true;
  // Dot present but unknown TLD → conservative: treat as real.
  return false;
}

/**
 * Return true when some non-ghost user_id already has a transcript for
 * `sessionId` on `date` under `outputDir`. Used to detect "redundant ghost"
 * cc-status uploads: a cc-status snapshot arrives tagged with a ghost
 * user_id, but the real-email user on the same machine has already POSTed
 * (or will POST, race window only) the full transcript for the same session.
 *
 * Scoped to a single date subdir for cost — Matrix-Riven session_ids are
 * UUIDv4 / ULID, unique per CC instance, so cross-day collisions are
 * effectively impossible. `date` is derived from the snapshot's `ts` field
 * by the caller.
 */
function hasNonGhostTranscript(
  outputDir: string,
  sessionId: string,
  date: string,
): boolean {
  let users: string[];
  try {
    users = readdirSync(outputDir);
  } catch {
    return false;
  }
  for (const u of users) {
    if (isGhostUserId(u)) continue;
    const candidate = join(outputDir, u, date, `${sessionId}.jsonl`);
    // Defense-in-depth: confirm the resolved path still sits under outputDir
    // before we trust the `readdirSync` entry. Symlinks / traversal-laden
    // user_ids that survived `safeUserId` shouldn't reach this code, but
    // the existsSync below would happily follow a symlink out.
    if (!isUnder(outputDir, candidate)) continue;
    if (existsSync(candidate)) return true;
  }
  return false;
}

/**
 * Counterpart to `hasNonGhostTranscript`: after a transcript lands, sweep
 * every ghost-shape user dir for a paired `<sessionId>.cc-status.jsonl`
 * fragment and unlink it. Pre-PR landing of `realtime-emit` identity-from-
 * config (libz-renlab-ai/Matrix-Riven#3) clients still emit cc-status under
 * the hostname fallback even when transcripts go to the real email; this
 * sweep keeps the on-disk tree from accumulating those orphans for the
 * leadership dashboard / `/api/users` listing.
 *
 * Peer-gated. Mirrors the precondition of the cc-status pre-check (gate #1):
 * the sweep only fires when a NON-GHOST user already holds the transcript
 * for `sessionId` on `date`. If the just-arrived transcript itself was
 * posted by a sole-identity ghost (e.g. `lv@lvjiawendeMacBook-Air.local`
 * — whose ONLY upload identity is the hostname form, no real-email peer
 * exists), the sweep bails. Without this gate the sweep would unlink the
 * sole-identity ghost's OWN cc-status under their own user dir — a P0
 * data-loss bug caught in cold-read of an earlier rev of this commit.
 *
 * Best-effort. Errors are swallowed — a sweep failure must not 5xx a
 * successful transcript write.
 *
 * Returns the number of files removed (for the response payload + logging).
 */
function sweepRedundantGhostCcStatus(
  outputDir: string,
  sessionId: string,
  date: string,
): number {
  // Peer gate: identical semantics to gate #1's `hasNonGhostTranscript`.
  // Only proceed when a non-ghost user holds a transcript for the same
  // session_id on the same date — otherwise nothing is "redundant" to clean.
  if (!hasNonGhostTranscript(outputDir, sessionId, date)) return 0;

  let users: string[];
  try {
    users = readdirSync(outputDir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const u of users) {
    if (!isGhostUserId(u)) continue;
    const candidate = join(outputDir, u, date, `${sessionId}.cc-status.jsonl`);
    if (!isUnder(outputDir, candidate)) continue;
    try {
      if (existsSync(candidate)) {
        unlinkSync(candidate);
        removed++;
      }
    } catch {
      // best-effort — next sweep will retry
    }
  }
  return removed;
}

export interface MockServerOptions {
  /** Port to bind. Use 0 to pick an ephemeral port. */
  port: number;
  /** Where to write decoded payloads. Defaults to ./test-output under process.cwd(). */
  outputDir?: string;
  /** Bind host. Defaults to 127.0.0.1. */
  host?: string;
  /** Clock for date-stamping subdirectories. Defaults to () => new Date(). */
  now?: () => Date;
  /**
   * M2 — when set, serve over TLS using this PEM key+cert pair instead of
   * plain HTTP. The same request listener is reused via `wrapServerWithHttps`;
   * the handle's `url` reports `https://`.
   */
  tls?: { keyPath: string; certPath: string };
  /**
   * When set (non-empty), `POST /v1/cc-sessions` requires a matching
   * `Authorization: Bearer <token>`. Defaults to the `RIVEN_AUTH_TOKEN` env
   * var (legacy `BPP_AUTH_TOKEN` accepted with a deprecation warning).
   * Empty/undefined = auth disabled (dev/test default).
   */
  authToken?: string;
  /**
   * Comma-list of project names treated as "main" for slacking detection.
   * Forwarded to `LeadershipRouteDeps.mainProjects`. Empty/undefined leaves
   * the slacking signal dormant (no false positives in a fresh deploy).
   */
  mainProjects?: string[];
}

export interface MockServerHandle {
  url: string;
  port: number;
  outputDir: string;
  close(): Promise<void>;
}

const ROUTE_CC_SESSIONS = '/v1/cc-sessions';
/** Issue #350 — lightweight CC runtime status snapshot ingress (plain JSON, not gzipped). */
const ROUTE_CC_STATUS = '/v1/cc-status';
/** Client auto-update — operator-visible error ingest. */
const ROUTE_CLIENT_UPDATE_ERROR = '/v1/client-update-error';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z0-9._-]+$/;

function send(res: ServerResponse, status: number, body?: unknown): void {
  res.statusCode = status;
  // 2026-05-19 QA-6 P2: every response — including outer-dispatcher 404 /
  // 405 fall-throughs — gets the same defensive headers as the leadership
  // routes. Previously HEAD / or POST /<unknown> returned the body or
  // status code without nosniff / X-Frame / CSP, contradicting /landing's
  // "all-routes carry security headers" copy.
  if (!res.headersSent) {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('cache-control', 'no-store');
  }
  if (body !== undefined) {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  } else {
    res.end();
  }
}

/**
 * Validate a raw user_id string for use in dashboard GET endpoints.
 * Returns the value if it round-trips through safeUserId unchanged AND
 * does not contain path separators or `..`. Otherwise returns null.
 */
function validateUserParam(raw: string | undefined): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (raw.includes('/') || raw.includes('\\') || raw.includes('..')) return null;
  if (safeUserId(raw) !== raw) return null;
  return raw;
}

/**
 * Round-2 QA P0 (EM N1): strict ingest-side user_id format check. POST
 * envelopes whose user_id doesn't match are rejected with 400 BEFORE any
 * filesystem write. Previously the only gate was safeUserId (which only
 * sanitized), so penetration-test payloads like `xss_+alert_1___@test.com`
 * and `svg_onload_1_@x.com` got created as actual user directories and then
 * appeared as "team members" on real-data /people view. Allowed shapes:
 *   - email-style:    LOCAL@DOMAIN.TLD  (simplified RFC5321)
 *   - local-part only: starts with alnum, contains alnum/./_/-, ≤ 64 chars
 * Both forms must START with alphanumeric — that rejects payloads opening
 * with punctuation or special chars (`xss_+`, `<script`, `..`, etc.).
 */
const PENTEST_SUBSTRINGS = ['xss', 'svg_onload', 'onerror', 'attacker', 'evil', 'pwn', 'eve@', 'script_alert', '__alert', '_alert_', 'alert(1)', 'javascript:'];
export function isValidUserId(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 254) return false;
  // Round-7 QA P0 (EM): even alphanumeric-only payloads like `anon_attacker`
  // need to be rejected. Add a blocklist of obviously-pentest substrings on
  // top of the shape gate; mirrored at read-time in transcript-loader and
  // disk-scan so any legacy residue is filtered from the UI.
  const lower = raw.toLowerCase();
  for (const bad of PENTEST_SUBSTRINGS) if (lower.includes(bad)) return false;
  // Email shape — most common in real deployments.
  if (raw.includes('@')) {
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}@[A-Za-z0-9][A-Za-z0-9.-]{0,253}(?:\.[A-Za-z]{1,24})?$/.test(raw);
  }
  // Bare local-part / username — e.g. legacy installs without email.
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(raw);
}

function validateDateParam(raw: string | undefined): string | null {
  if (typeof raw !== 'string') return null;
  if (!DATE_RE.test(raw)) return null;
  // Also reject syntactically-valid but impossible dates like 2026-13-99.
  const parts = raw.split('-');
  const yyyy = Number(parts[0]);
  const mm = Number(parts[1]);
  const dd = Number(parts[2]);
  if (!Number.isFinite(yyyy) || !Number.isFinite(mm) || !Number.isFinite(dd)) {
    return null;
  }
  if (mm < 1 || mm > 12) return null;
  if (dd < 1 || dd > 31) return null;
  // Best-effort calendar sanity check via UTC Date.
  const probe = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (
    probe.getUTCFullYear() !== yyyy ||
    probe.getUTCMonth() !== mm - 1 ||
    probe.getUTCDate() !== dd
  ) {
    return null;
  }
  return raw;
}

export function validateIdParam(raw: string | undefined): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (raw.includes('..')) return null;
  return ID_RE.test(raw) ? raw : null;
}

/**
 * Issue #283 — defensive type guard for the optional `envelope.quota` block.
 * All six fields must be present with the exact expected primitive type. Numeric
 * fields additionally must be finite (rejects NaN / Infinity). Returning false
 * here causes the POST handler to silently skip writing the quota.json sidecar
 * while still persisting the transcript — quota is non-critical metadata, a
 * malformed block must not 4xx the whole upload.
 */
export function isValidQuotaBlock(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.subscription_tier === 'string' &&
    typeof o.five_hour_utilization === 'number' &&
    Number.isFinite(o.five_hour_utilization) &&
    typeof o.seven_day_utilization === 'number' &&
    Number.isFinite(o.seven_day_utilization) &&
    typeof o.five_hour_reset_at === 'number' &&
    Number.isFinite(o.five_hour_reset_at) &&
    typeof o.seven_day_reset_at === 'number' &&
    Number.isFinite(o.seven_day_reset_at) &&
    typeof o.probed_at === 'string' &&
    typeof o.stale === 'boolean'
  );
}

/**
 * Atomic write via tmp + rename. Prevents the dashboard from reading a
 * half-written file and also avoids data loss on concurrent writes.
 */
function atomicWriteFileSync(target: string, data: Buffer): void {
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  writeFileSync(tmp, data);
  try {
    renameSync(tmp, target);
  } catch {
    // Windows: rename can fail if target exists. Fall back to unlink + rename.
    try {
      unlinkSync(target);
    } catch {
      // target may not exist; ignore
    }
    renameSync(tmp, target);
  }
}

type GetableExt = 'jsonl' | 'ogg' | 'mov' | 'mp4' | 'webm' | 'mkv';
function validateExtParam(raw: string | undefined): GetableExt | null {
  if (
    raw === 'jsonl' ||
    raw === 'ogg' ||
    raw === 'mov' ||
    raw === 'mp4' ||
    raw === 'webm' ||
    raw === 'mkv'
  ) {
    return raw;
  }
  return null;
}

function contentTypeForExt(ext: GetableExt): string {
  switch (ext) {
    case 'jsonl':
      return 'text/plain; charset=utf-8';
    case 'ogg':
      return 'audio/ogg';
    case 'mov':
      return 'video/quicktime';
    case 'mp4':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'mkv':
      return 'video/x-matroska';
  }
}

/** Confirm a resolved path stays under outputDir (defense-in-depth vs traversal). */
function isUnder(parent: string, child: string): boolean {
  const p = resolvePath(parent);
  const c = resolvePath(child);
  if (c === p) return true;
  return c.startsWith(p + sep);
}

function listDirNames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

interface SessionEntry {
  id: string;
  ext: 'jsonl' | 'ogg';
  size: number;
  mtime: string;
}

function listSessions(dir: string): SessionEntry[] {
  if (!existsSync(dir)) return [];
  let entries: SessionEntry[] = [];
  try {
    const files = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile());
    for (const f of files) {
      const m = /^(.+)\.(jsonl|ogg)$/.exec(f.name);
      if (!m || m[1] === undefined || m[2] === undefined) continue;
      const id: string = m[1];
      const ext = m[2] as 'jsonl' | 'ogg';
      try {
        const st = statSync(join(dir, f.name));
        entries.push({
          id,
          ext,
          size: st.size,
          mtime: st.mtime.toISOString(),
        });
      } catch {
        // ignore unreadable files
      }
    }
  } catch {
    return [];
  }
  entries.sort((a, b) => (a.mtime < b.mtime ? 1 : a.mtime > b.mtime ? -1 : 0));
  return entries;
}

function parseQuery(url: string): URLSearchParams {
  const idx = url.indexOf('?');
  return new URLSearchParams(idx >= 0 ? url.slice(idx + 1) : '');
}

/**
 * Below this value an all-digits `since` param is read as epoch *seconds*; at
 * or above it, epoch *milliseconds*. 1e12 ms ≈ 2001-09; 1e12 s ≈ year 33658 —
 * so the heuristic is unambiguous for any realistic timestamp.
 */
const EPOCH_MS_THRESHOLD = 1e12;
/** Largest millisecond value `new Date(...)` accepts (±100,000,000 days). */
const MAX_DATE_MS = 8.64e15;

/**
 * Issue #350 — parse the `since` query param for `/api/cc-status/history`.
 * Accepts ISO-8601, epoch milliseconds, or epoch seconds; missing/garbage
 * falls back to "24h ago" so a bare `?user=&session=` still returns something
 * bounded rather than the whole history. The result is always clamped to
 * `[0, MAX_DATE_MS]` — without that, `?since=99999999999999999` would flow into
 * `new Date(sinceMs).toISOString()` below, throw a `RangeError` inside the
 * request handler, and crash the (unauthenticated) collector process.
 */
function parseSinceMs(raw: string | null | undefined, nowMs: number): number {
  let ms = nowMs - 24 * 60 * 60 * 1000;
  if (typeof raw === 'string' && raw.length > 0) {
    if (/^\d+$/.test(raw)) {
      const n = Number(raw);
      if (Number.isFinite(n)) ms = n < EPOCH_MS_THRESHOLD ? n * 1000 : n;
    } else {
      const parsed = Date.parse(raw);
      if (Number.isFinite(parsed)) ms = parsed;
    }
  }
  if (!Number.isFinite(ms)) return 0;
  return Math.min(Math.max(0, ms), MAX_DATE_MS);
}

function handleGet(
  req: IncomingMessage,
  res: ServerResponse,
  outputDir: string,
  now: () => Date,
): void {
  const url = req.url ?? '';
  const path = url.split('?')[0] ?? '';

  if (path === '/' || path === '/index.html') {
    // Round-1 QA P0 (security): legacy Phase-1 dashboard at `/` was served
    // without ANY security headers (no CSP, no X-Frame-Options, no nosniff,
    // no Referrer-Policy), contradicting the /landing claim of "全路由响应都
    // 带 nosniff + X-Frame-Options". Apply the same baseline as the
    // leadership routes.
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'");
    res.setHeader('cache-control', 'no-store');
    res.statusCode = 200;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(DASHBOARD_HTML);
    return;
  }

  const q = parseQuery(url);

  // M2 — GET /v1/member-stats?user=<id>. A member's self-view of their own
  // upload activity: 已上传对话总量 / 最近一次上传时间 / 敏感字段被模糊化次数.
  // Computed on demand from the output-dir tree (no running counter).
  if (path === '/v1/member-stats') {
    const user = q.get('user');
    if (typeof user !== 'string' || user.length === 0) {
      send(res, 400, { ok: false, error: 'user query param required' });
      return;
    }
    send(res, 200, { ok: true, ...computeMemberStats(outputDir, user) });
    return;
  }

  // ── Issue #350 — CC runtime status query API. Unauthenticated, like the
  //    other /api/* endpoints (the issue body flags LAN-readability as a known
  //    exposure; adding auth to /api/* is a separate issue). ──────────────────
  if (path === '/api/cc-status/all') {
    send(res, 200, { sessions: readLatestAllUsers(outputDir, now()) });
    return;
  }
  if (path === '/api/cc-status/history') {
    const user = validateUserParam(q.get('user') ?? undefined);
    const session = validateIdParam(q.get('session') ?? undefined);
    if (!user) {
      send(res, 400, { error: 'invalid user' });
      return;
    }
    if (!session) {
      send(res, 400, { error: 'invalid session' });
      return;
    }
    const sinceMs = parseSinceMs(q.get('since'), now().getTime());
    send(res, 200, {
      user_id: user,
      session_id: session,
      since: new Date(sinceMs).toISOString(),
      history: readHistory(outputDir, user, session, sinceMs, now()),
    });
    return;
  }
  if (path === '/api/cc-status') {
    const user = validateUserParam(q.get('user') ?? undefined);
    if (!user) {
      send(res, 400, { error: 'invalid user' });
      return;
    }
    const sessionRaw = q.get('session');
    if (sessionRaw !== null) {
      const session = validateIdParam(sessionRaw);
      if (!session) {
        send(res, 400, { error: 'invalid session' });
        return;
      }
      const row = readLatestForSession(outputDir, user, session, now());
      if (!row) {
        send(res, 404, { error: 'not found' });
        return;
      }
      send(res, 200, row);
      return;
    }
    send(res, 200, { sessions: readLatestPerSession(outputDir, user, now()) });
    return;
  }

  if (path === '/api/users') {
    const users = listDirNames(outputDir)
      .filter((n) => !RESERVED_TOP_LEVEL_DIRS.has(n))
      .sort((a, b) => a.localeCompare(b));
    send(res, 200, { users });
    return;
  }

  if (path === '/api/dates') {
    const user = validateUserParam(q.get('user') ?? undefined);
    if (!user) {
      send(res, 400, { error: 'invalid user' });
      return;
    }
    const userDir = join(outputDir, user);
    if (!isUnder(outputDir, userDir)) {
      send(res, 400, { error: 'invalid path' });
      return;
    }
    const dates = listDirNames(userDir)
      .filter((n) => DATE_RE.test(n))
      .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    send(res, 200, { dates });
    return;
  }

  if (path === '/api/sessions') {
    const user = validateUserParam(q.get('user') ?? undefined);
    const date = validateDateParam(q.get('date') ?? undefined);
    if (!user) {
      send(res, 400, { error: 'invalid user' });
      return;
    }
    if (!date) {
      send(res, 400, { error: 'invalid date' });
      return;
    }
    const dir = join(outputDir, user, date);
    if (!isUnder(outputDir, dir)) {
      send(res, 400, { error: 'invalid path' });
      return;
    }
    send(res, 200, { sessions: listSessions(dir) });
    return;
  }

  if (path === '/api/quota') {
    const user = validateUserParam(q.get('user') ?? undefined);
    const date = validateDateParam(q.get('date') ?? undefined);
    if (!user) {
      send(res, 400, { error: 'invalid user' });
      return;
    }
    if (!date) {
      send(res, 400, { error: 'invalid date' });
      return;
    }
    const quotaFile = join(outputDir, user, date, 'quota.json');
    if (!isUnder(outputDir, quotaFile)) {
      send(res, 400, { error: 'invalid path' });
      return;
    }
    if (!existsSync(quotaFile)) {
      send(res, 404, { error: 'not found' });
      return;
    }
    try {
      const raw = readFileSync(quotaFile, 'utf8');
      const parsed = JSON.parse(raw);
      send(res, 200, parsed);
    } catch (err) {
      send(res, 500, {
        error: 'read failed',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  // Task 8 — leadership-overview view. Wraps disk-scan + aggregator behind
  // one read-only GET. `date=` defaults to today (UTC, via `dateStamp`); a
  // malformed param 400s through the same `validateDateParam` used by
  // `/api/dates` and `/api/sessions`. `scanForOverview` is documented
  // never-throws but the try/catch is belt-and-suspenders against future
  // refactors that might forget that contract.
  if (path === '/api/overview') {
    const dateRaw = q.get('date');
    const date =
      dateRaw === null ? dateStamp(undefined, now()) : validateDateParam(dateRaw);
    if (date === null) {
      send(res, 400, { error: 'invalid date format', expected: 'YYYY-MM-DD' });
      return;
    }
    let raw;
    try {
      raw = scanForOverview(outputDir, date);
    } catch (err) {
      send(res, 500, {
        error: 'scan failed',
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    send(res, 200, buildOverview(raw, date));
    return;
  }

  // Client auto-update — manifest fetch
  if (path === '/v1/client-latest/manifest') {
    handleManifestRequest(req, res, resolveClientLatestDir(outputDir));
    return;
  }

  // Client auto-update — file stream
  if (path.startsWith('/v1/client-latest/files/')) {
    handleFileRequest(res, resolveClientLatestDir(outputDir), path);
    return;
  }

  // Client auto-update — dashboard data
  if (path === '/api/client-update-status') {
    const status = buildClientUpdateStatus({
      clientLatestDir: resolveClientLatestDir(outputDir),
      errorsJsonlPath: resolveErrorsJsonlPath(outputDir),
      outputDir,
      now: now(),
    });
    send(res, 200, status);
    return;
  }

  if (path === '/api/file') {
    const user = validateUserParam(q.get('user') ?? undefined);
    const date = validateDateParam(q.get('date') ?? undefined);
    const id = validateIdParam(q.get('id') ?? undefined);
    const ext = validateExtParam(q.get('ext') ?? undefined);
    if (!user) {
      send(res, 400, { error: 'invalid user' });
      return;
    }
    if (!date) {
      send(res, 400, { error: 'invalid date' });
      return;
    }
    if (!id) {
      send(res, 400, { error: 'invalid id' });
      return;
    }
    if (!ext) {
      send(res, 400, { error: 'invalid ext' });
      return;
    }
    const filePath = join(outputDir, user, date, `${id}.${ext}`);
    if (!isUnder(outputDir, filePath)) {
      send(res, 400, { error: 'invalid path' });
      return;
    }
    if (!existsSync(filePath)) {
      send(res, 404, { error: 'not found' });
      return;
    }
    try {
      const buf = readFileSync(filePath);
      res.statusCode = 200;
      res.setHeader('content-type', contentTypeForExt(ext));
      res.setHeader('content-length', String(buf.length));
      // Swallow client-disconnect EPIPE/ECONNRESET — already-sent response,
      // nothing to recover. Without this listener the error crashes Node.
      res.on('error', () => {});
      res.end(buf);
    } catch (err) {
      send(res, 500, {
        error: 'read failed',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  send(res, 404);
}

/**
 * M2 — append a single L2 scan alert event to `_audit/<date>.jsonl` under
 * outputDir.  Replicates the essential write format of the original
 * `appendAudit` from bpp/store without pulling in bpp dependencies.
 * "第二层服务端扫描如果命中第一层漏掉的敏感字段，必须记一条警报"
 */
function appendL2Alert(
  outputDir: string,
  alert: {
    schema_version: number;
    id: string;
    event_type: string;
    actor: string;
    timestamp: string;
    metadata: {
      matched_rule_kinds: string[];
      session_id: string;
      date: string;
      route: string;
    };
  },
): void {
  const date = alert.timestamp.slice(0, 10);
  const dir = resolvePath(outputDir, '_audit');
  mkdirSync(dir, { recursive: true });
  const file = resolvePath(dir, `${date}.jsonl`);
  appendFileSync(file, JSON.stringify(alert) + '\n', 'utf8');
}

export async function startMockServer(opts: MockServerOptions): Promise<MockServerHandle> {
  const outputDir = opts.outputDir ?? join(process.cwd(), 'test-output');
  mkdirSync(outputDir, { recursive: true });
  const host = opts.host ?? '127.0.0.1';
  const now = opts.now ?? (() => new Date());
  // Token-auth gate on the conversation-upload endpoint. Empty string means
  // auth is disabled (the dev/test default).
  const authToken =
    opts.authToken ??
    readEnvWithLegacy(process.env, 'RIVEN_AUTH_TOKEN', 'BPP_AUTH_TOKEN') ??
    '';

  // Task 15 — shared TTL cache for all leadership endpoints (30s TTL keeps the
  // dashboard snappy under polling while bounding disk-scan frequency).
  const leadershipCache = new TtlCache<unknown>(30_000);

  // L-11 — LLM narrative layer. Read config from env; when disabled (default)
  // `llmCache` stays undefined and no worker is started — the aggregator's
  // `attachLlmFields` short-circuits on the missing cache so behaviour is
  // byte-identical to pre-L-8. When enabled, we load the on-disk cache before
  // the server binds (load is cheap — a single readFile) so the first
  // /api/overview request can read whatever cached lines the previous process
  // wrote. The worker itself starts AFTER `server.listen` resolves so its
  // first tick can never race the listen callback.
  const llmCfg = readLlmConfig(process.env);
  let llmCache: LlmCache | undefined;
  let llmWorker: WorkerHandle | undefined;
  if (llmCfg.enabled) {
    llmCache = new LlmCache(join(llmCfg.cacheDir, 'v1.jsonl'));
    await llmCache.load();
  }

  const leadershipDeps: LeadershipRouteDeps = {
    collectorDir: outputDir,
    cache: leadershipCache,
    now,
    llmCache,
    // Forward the same Bearer token to the leadership dispatcher so when the
    // operator sets `RIVEN_AUTH_TOKEN`, the dashboard endpoints require auth
    // too — not just `POST /v1/cc-sessions`. Empty string disables (LAN
    // demos, localhost tests).
    authToken: authToken || undefined,
    // Forward main-project list so the slacking signal can fire.
    mainProjects: opts.mainProjects,
  };

  const requestHandler = (req: IncomingMessage, res: ServerResponse): void => {
    // Task 15 — Leadership API + HTML routes take precedence over the legacy
    // handlers so the new aggregator wins over /api/overview etc.
    //
    // Pass non-GET requests too: the leadership dispatcher recognises its
    // own paths and emits 405 (not_method_allowed) for POST/PUT/DELETE.
    // Without that, `POST /api/overview` would fall through to the cc-
    // session POST router and 404, which is REST-incorrect and confusing.
    if (handleLeadershipRequest(req, res, leadershipDeps)) {
      return;
    }
    if (req.method === 'GET') {
      // Round-1 QA P0 (security): legacy GET surface (/api/file, /api/users,
      // /api/dates, /api/sessions, /api/quota, /api/cc-status/*, /v1/member-
      // stats) returns raw transcript content + user PII. Until each route is
      // individually re-evaluated, gate the whole surface on `authToken` when
      // it's configured. The Phase-1 dashboard at `/` is still served (it
      // needs ?sid= which is a separate ACL).
      const legacyPath = (req.url ?? '').split('?')[0] ?? '';
      const legacyNeedsAuth =
        legacyPath.startsWith('/api/') ||
        legacyPath === '/v1/member-stats';
      if (authToken && legacyNeedsAuth) {
        const auth = requireBearerToken(req.headers, authToken);
        if (!auth.ok) {
          send(res, 401, { error: 'unauthorized' });
          return;
        }
      }
      handleGet(req, res, outputDir, now);
      return;
    }
    if (req.method !== 'POST') {
      send(res, 405);
      return;
    }
    const route = (req.url ?? '').split('?')[0] ?? '';
    if (
      route !== ROUTE_CC_SESSIONS &&
      route !== ROUTE_CC_STATUS &&
      route !== ROUTE_CLIENT_UPDATE_ERROR
    ) {
      send(res, 404);
      return;
    }

    // Round-1 QA P2 (security): CSRF / DNS-rebinding hardening. Reject POST
    // requests carrying browser-origin signals — uploader clients send a
    // bespoke `X-Riven-Client: uploader` header (or the legacy `User-Agent:
    // matrix-riven-uploader`), so any POST that looks like a browser
    // (Origin / Referer set, no riven client marker) is refused. This blocks
    // a DNS-rebound site at 127.0.0.1 from submitting forged sessions.
    const xClient = String(req.headers['x-riven-client'] ?? '');
    const ua = String(req.headers['user-agent'] ?? '');
    const looksLikeRivenClient =
      xClient === 'uploader' || /matrix-riven-uploader/i.test(ua);
    const origin = String(req.headers['origin'] ?? '');
    const referer = String(req.headers['referer'] ?? '');
    if (!looksLikeRivenClient && (origin.length > 0 || referer.length > 0)) {
      send(res, 403, { error: 'csrf_blocked' });
      return;
    }

    // M2 — token auth on the conversation-upload endpoint. When RIVEN_AUTH_TOKEN
    // is set, POST /v1/cc-sessions requires a matching Bearer token. Checked
    // BEFORE the body read so a missing/wrong token 401s regardless of payload.
    //
    // Round-2 QA P0 (security): cc-status POST was previously unguarded even
    // with authToken set — any anonymous caller could inject a status snapshot
    // for any user_id, poisoning the leadership dashboard's "live status"
    // column. Now both POST routes go through the same gate.
    if (authToken && (route === ROUTE_CC_SESSIONS || route === ROUTE_CC_STATUS)) {
      const auth = requireBearerToken(req.headers, authToken);
      if (!auth.ok) {
        send(res, 401, { error: 'unauthorized' });
        return;
      }
    }

    let bodyBytes = 0;
    let aborted = false;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      bodyBytes += chunk.length;
      if (bodyBytes > MAX_BODY_BYTES) {
        aborted = true;
        send(res, 413, { error: 'payload too large', limit: MAX_BODY_BYTES });
        // Do NOT destroy the request — that races the response flush and the
        // client sees ECONNRESET instead of 413. Just discard subsequent chunks
        // (memory stays bounded by the per-chunk handler's early-return).
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      let json: unknown;
      try {
        json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch (err) {
        send(res, 400, {
          error: 'invalid json',
          detail: err instanceof Error ? err.message : String(err),
        });
        return;
      }

      // Client auto-update — POST /v1/client-update-error: append validated
      // report to JSONL. Best-effort writes; ingest never 5xx's a disk error.
      if (route === ROUTE_CLIENT_UPDATE_ERROR) {
        const report = sanitizeErrorReport(json);
        if (report === null) {
          send(res, 400, { error: 'invalid error report' });
          return;
        }
        const r = appendErrorReport(resolveErrorsJsonlPath(outputDir), report);
        if (!r.ok) {
          // Don't 5xx — the failing path is server-disk, not client's fault.
          // 202 Accepted communicates "we got it but couldn't persist".
          send(res, 202, { ok: false, persisted: false, reason: r.reason });
          return;
        }
        send(res, 200, { ok: true });
        return;
      }

      // Issue #350 — CC status snapshot: plain JSON body, no gzip, no envelope.
      // sanitizeCcStatusSnapshot does the allowlist + type checks; a malformed
      // body 400s (unlike the optional quota sidecar on /v1/cc-sessions, the
      // snapshot IS the payload here).
      if (route === ROUTE_CC_STATUS) {
        // Round-3 QA P1 (security): /v1/cc-sessions gates user_id via
        // isValidUserId; this sibling path didn't. In no-token mode the
        // same pentest payload (`xss_+alert_1___@test.com` etc.) could
        // still pollute the dashboard via /v1/cc-status. Apply the same
        // gate here BEFORE handing to appendCcStatusSnapshot.
        const snapObj = json as Record<string, unknown> | null;
        const ccUser = snapObj?.user_id;
        if (typeof ccUser === 'string' && ccUser.length > 0 && !isValidUserId(ccUser)) {
          send(res, 400, { error: 'invalid user_id', detail: 'user_id must be an email or [A-Za-z0-9][A-Za-z0-9._-]{0,63} local-part' });
          return;
        }
        // Redundant-ghost gate: reject cc-status snapshots that arrive tagged
        // with a hostname-fallback user_id when the same session_id already
        // has a real transcript under a non-ghost user_id. The realtime hook
        // bin pre-PR #3 emits under the `${user}@${host}` form even when the
        // transcript-upload Stop hook reads identity from
        // `~/.riven/digital-twin.json` — same physical CC session, two
        // different user_ids on disk. Reject the ghost snapshot fragment
        // here rather than write+sweep later.
        //
        // Return 200 (not 4xx) so any client retry-on-error path doesn't
        // hammer the gate.
        const snapUid = typeof ccUser === 'string' ? ccUser : '';
        const snapSid = typeof snapObj?.session_id === 'string' ? snapObj.session_id : '';
        const snapTs = typeof snapObj?.ts === 'string' ? snapObj.ts : '';
        if (snapUid && snapSid && isGhostUserId(snapUid)) {
          const snapDate = dateStamp(snapTs, now());
          if (hasNonGhostTranscript(outputDir, snapSid, snapDate)) {
            send(res, 200, {
              ok: true,
              dropped: 'redundant-ghost',
              user_id: snapUid,
              session_id: snapSid,
              date: snapDate,
              detail:
                'cc-status under hostname-fallback user_id; real transcript ' +
                'already present under a non-ghost user for this session_id',
            });
            return;
          }
        }
        const r = appendCcStatusSnapshot(outputDir, json, now());
        if (!r.ok) {
          if (r.reason === 'path') {
            send(res, 400, { error: 'invalid path' });
          } else if (r.reason === 'io') {
            send(res, 500, { error: 'write failed' });
          } else {
            send(res, 400, { error: 'invalid cc-status snapshot' });
          }
          return;
        }
        send(res, 200, {
          ok: true,
          user_id: r.user_id,
          date: r.date,
          session_id: r.session_id,
        });
        return;
      }

      const isLog = route === ROUTE_CC_SESSIONS;
      const obj = json as Record<string, unknown>;
      const envelope = (obj.envelope ?? {}) as Record<string, unknown>;
      const idRaw = envelope.session_id;
      let id: string;
      if (typeof idRaw === 'string' && idRaw.length > 0) {
        const validated = validateIdParam(idRaw);
        if (validated === null) {
          send(res, 400, { error: 'invalid id', detail: 'id must match [A-Za-z0-9._-]+ and not contain ".."' });
          return;
        }
        id = validated;
      } else {
        // Fallback for missing id — randomized to avoid collisions on concurrent uploads.
        id = `unknown-${Date.now()}-${randomUUID().slice(0, 8)}`;
      }

      const payloadBlock = (isLog ? obj.transcript : obj.audio) as
        | Record<string, unknown>
        | undefined;
      const contentB64 = payloadBlock?.content;
      if (typeof contentB64 !== 'string' || contentB64.length === 0) {
        send(res, 400, { error: 'missing content', route });
        return;
      }

      try {
        const buf = Buffer.from(contentB64, 'base64');
        let decoded = isLog
          ? gunzipSync(buf, { maxOutputLength: MAX_DECOMPRESSED_BYTES })
          : buf;
        if (decoded.length > MAX_DECOMPRESSED_BYTES) {
          send(res, 413, {
            error: 'decompressed payload too large',
            limit: MAX_DECOMPRESSED_BYTES,
          });
          return;
        }
        const ext = isLog ? 'jsonl' : 'ogg';
        // Round-2 QA P0 (EM N1): previously safeUserId only sanitized; any
        // string would round-trip into a writable user dir, so the security
        // round's penetration test payloads (`xss_+alert_1___@test.com`,
        // `svg_onload_1_@x.com`, etc.) ended up displayed as legitimate
        // "team members" on real-data /people view. Now we *reject* explicit
        // user_ids that don't match a basic email-or-localpart shape BEFORE
        // writing. Missing / null / empty user_id is still allowed and
        // collapses to 'unknown' (legacy uploaders depend on that fallback).
        if (typeof envelope.user_id === 'string' && envelope.user_id.length > 0 && !isValidUserId(envelope.user_id)) {
          send(res, 400, { error: 'invalid user_id', detail: 'user_id must be an email or [A-Za-z0-9][A-Za-z0-9._-]{0,63} local-part' });
          return;
        }
        const userIdSafe = safeUserId(envelope.user_id);
        const date = dateStamp(envelope.captured_at, now());
        const targetDir = join(outputDir, userIdSafe, date);
        const targetFile = join(targetDir, `${id}.${ext}`);
        // Defense-in-depth: confirm the resolved write path stays under outputDir.
        if (!isUnder(outputDir, targetFile)) {
          send(res, 400, { error: 'invalid path' });
          return;
        }

        // Reject synthetic `inject-mock` transcripts before anything lands on
        // disk. The CLI's `inject-mock` subcommand is meant for a local
        // upload-pipeline smoke test guarded by `RIVEN_UPLOADER_DRYRUN=1`; any
        // payload reaching this point with both marker strings is a real POST
        // that would pollute the collector (see `isInjectMockTranscript`
        // doc-comment for history + rationale).
        //
        // Defense-in-depth on top of the INSTALL.md fix (commit bb4ca35): old
        // clients, hand-crafted POSTs, and AI agents following stale docs all
        // hit this gate. Returns 200 with `dropped: 'inject-mock'` rather than
        // 4xx so clients with retry-on-error logic do not loop on this case.
        if (isLog) {
          const decodedText = decoded.toString('utf8');
          if (isInjectMockTranscript(decodedText)) {
            send(res, 200, {
              ok: true,
              dropped: 'inject-mock',
              user_id: userIdSafe,
              date,
              detail:
                'synthetic transcript not accepted on this endpoint; ' +
                'use RIVEN_UPLOADER_DRYRUN=1 for local smoke tests',
            });
            return;
          }
        }

        // M2 — server-side L2 scan ("第二层敏感信息扫描（兜底）"). The member's
        // L1 pass runs in the uploader daemon; this is the catch-all for
        // anything L1 missed — a disabled rule, a bypassed collector, a
        // hand-crafted POST. On a hit the transcript is redacted BEFORE it
        // lands, and the alert is recorded below — silently scrubbing is not
        // enough ("必须记一条警报").
        let l2MatchedKinds: string[] = [];
        let l2RedactionCount = 0;
        if (isLog) {
          const text = decoded.toString('utf8');
          const findings = detectSensitiveText(text);
          if (findings.length > 0) {
            // Record only the matched RULE KINDS, never the matched text — an
            // alert that echoed the secret would itself be a privacy leak.
            l2MatchedKinds = [...new Set(findings.map((f) => f.kind))].sort();
            l2RedactionCount = findings.length;
            decoded = Buffer.from(redactSensitiveText(text), 'utf8');
          }
        }

        mkdirSync(targetDir, { recursive: true });
        atomicWriteFileSync(targetFile, decoded);

        // Redundant-ghost sweep: if the realtime cc-status snapshots for this
        // session were already POSTed under a hostname-fallback user_id (the
        // pre-PR #3 client bug) BEFORE this transcript arrived, the cc-status
        // gate above couldn't catch them — at that earlier moment no
        // transcript existed yet. Now that the transcript is on disk, sweep
        // every ghost-shape user dir on the same date and unlink any
        // `<sid>.cc-status.jsonl` orphan.
        //
        // Best-effort. Errors swallowed: a sweep failure must never 5xx an
        // otherwise-successful transcript write.
        let ghostSweepRemoved = 0;
        if (isLog) {
          try {
            ghostSweepRemoved = sweepRedundantGhostCcStatus(outputDir, id, date);
          } catch {
            // tracked via response field; explicit catch silences lint
          }
        }

        // P-D1 — append to the per-leaf session index so subsequent cold-start
        // scans can skip directory enumeration. Best-effort: any failure is
        // recovered by the next `rebuildIndex` at server start. We read the
        // real on-disk mtime (not `Date.now()`) because the loader validates
        // index freshness against `statSync(...).mtimeMs`, and FS timestamp
        // truncation can drift the two values by 1-1000 ms on some platforms.
        if (isLog) {
          const capturedAtRaw = envelope.captured_at;
          const capturedAt =
            typeof capturedAtRaw === 'string' && capturedAtRaw.length > 0
              ? capturedAtRaw
              : now().toISOString();
          let mtimeMs = Date.now();
          try {
            mtimeMs = statSync(targetFile).mtimeMs;
          } catch {
            /* file should always exist here; fall back to wall clock */
          }
          appendIndex(targetDir, {
            sessionId: id,
            file: `${id}.${ext}`,
            mtime: mtimeMs,
            capturedAt,
          }).catch(() => {
            /* non-fatal: rebuildIndex will catch up on next restart */
          });
        }

        // Issue #283 — write quota.json sidecar when envelope carries a
        // well-formed quota block. Latest write per <user>/<date>/ wins
        // (overwrites). Malformed quota is silently skipped; the transcript
        // is the primary payload and must not 4xx because of a bad sidecar.
        if (isLog) {
          const quotaCandidate = (obj.envelope as Record<string, unknown> | undefined)?.quota;
          if (isValidQuotaBlock(quotaCandidate)) {
            const quotaFile = join(targetDir, 'quota.json');
            if (isUnder(outputDir, quotaFile)) {
              try {
                const quotaBuf = Buffer.from(JSON.stringify(quotaCandidate), 'utf8');
                atomicWriteFileSync(quotaFile, quotaBuf);
              } catch {
                // Defense-in-depth: never let a quota sidecar failure 5xx the
                // transcript upload. Best-effort write only.
              }
            }
          }
        }

        // M2 — per-session redaction-count sidecar. `GET /v1/member-stats`
        // sums these on demand for "敏感字段被模糊化次数" — there is no running
        // counter to drift. l1 = the member's uploader pass (carried on the
        // envelope); l2 = this server's fallback pass.
        //
        // Bucket 1/2 — the same sidecar is extended to carry envelope-level
        // metadata that's not in the transcript itself: host info extras,
        // settings_digest, claude_md, OAuth expiry, and L1 by-kind /
        // by-location breakdowns. Written whenever ANY of these fields is
        // present (clean transcript with no bucket 1/2 data → no sidecar,
        // unchanged from old behavior).
        if (isLog) {
          const l1RedactionCount =
            typeof obj.l1_redaction_count === 'number' &&
            obj.l1_redaction_count >= 0
              ? obj.l1_redaction_count
              : 0;
          const meta: Record<string, unknown> = {};
          if (l1RedactionCount > 0) meta.l1_redaction_count = l1RedactionCount;
          if (l2RedactionCount > 0) meta.l2_redaction_count = l2RedactionCount;
          // Bucket 1/2 envelope-level fields. Pluck whatever the client sent;
          // dashboards treat absence as "unknown".
          const envHost = envelope.host;
          if (envHost && typeof envHost === 'object') meta.host = envHost;
          if (envelope.settings_digest) meta.settings_digest = envelope.settings_digest;
          if (envelope.claude_md) meta.claude_md = envelope.claude_md;
          if (envelope.l1_redactions_by_kind) meta.l1_redactions_by_kind = envelope.l1_redactions_by_kind;
          if (envelope.l1_redactions_by_location) meta.l1_redactions_by_location = envelope.l1_redactions_by_location;
          if (envelope.oauth_expires_at) meta.oauth_expires_at = envelope.oauth_expires_at;
          if (Object.keys(meta).length > 0) {
            const metaFile = join(targetDir, `${id}.meta.json`);
            if (isUnder(outputDir, metaFile)) {
              try {
                atomicWriteFileSync(
                  metaFile,
                  Buffer.from(JSON.stringify(meta), 'utf8'),
                );
              } catch {
                // best-effort sidecar — never 5xx a successful upload
              }
            }
          }
        }

        // "第二层服务端扫描如果命中第一层漏掉的敏感字段，必须记一条警报". An
        // audit-append failure must never 5xx an otherwise-successful upload —
        // the transcript is already safely on disk, redacted.
        if (l2MatchedKinds.length > 0) {
          try {
            appendL2Alert(outputDir, {
              schema_version: 1,
              id: `l2-${randomUUID()}`,
              event_type: 'l2_scan_alert',
              actor: userIdSafe,
              timestamp: now().toISOString(),
              metadata: {
                matched_rule_kinds: l2MatchedKinds,
                session_id: id,
                date,
                route,
              },
            });
          } catch {
            // best-effort audit — never block a successful upload
          }
        }

        send(res, 200, {
          ok: true,
          id,
          user_id: userIdSafe,
          date,
          ...(ghostSweepRemoved > 0 ? { ghost_cc_status_swept: ghostSweepRemoved } : {}),
        });
      } catch (err) {
        // 2026-05-19 QA-5 ops P2: distinguish "client sent bad bytes"
        // (400) from "we couldn't write to disk" (500). Zlib raises
        // Z_DATA_ERROR for non-gzip and corrupt streams; a malformed
        // base64 string yields a length-mismatched Buffer that gunzip
        // also rejects with Z_DATA_ERROR or similar. Either is a 400.
        // Reserve 500 for unexpected fs / OOM faults so an ops dashboard
        // can alert correctly on 5xx counts.
        const msg = err instanceof Error ? err.message : String(err);
        const zErr = (err as { code?: string })?.code ?? '';
        const isDecodeError =
          zErr === 'Z_DATA_ERROR' ||
          zErr === 'Z_BUF_ERROR' ||
          zErr === 'Z_STREAM_ERROR' ||
          /incorrect header check|invalid stored block lengths|invalid distance|invalid literal\/lengths|gzip|deflate/i.test(msg);
        if (isDecodeError) {
          send(res, 400, { error: 'invalid_transcript_encoding', route });
        } else {
          send(res, 500, {
            error: 'decode or write failed',
            detail: msg,
          });
        }
      }
    });
    req.on('error', () => {
      if (!res.headersSent) {
        send(res, 500);
      }
    });
  };

  // M2 — when TLS opts are present, serve the SAME request listener over TLS
  // via `wrapServerWithHttps` (the plain-HTTP server below is built but never
  // `.listen()`-ed in that case). Plain HTTP otherwise — tests, dev, and
  // behind-nginx-TLS deploys are unaffected.
  const httpServer = createServer(requestHandler);
  const server: Server | HttpsServer = opts.tls
    ? wrapServerWithHttps({
        httpsKeyPath: opts.tls.keyPath,
        httpsCertPath: opts.tls.certPath,
        http: httpServer,
      })
    : httpServer;

  // Track open sockets so close() can force-destroy slow connections instead of
  // hanging until systemd's TimeoutStopSec SIGKILL.
  const sockets = new Set<Socket>();
  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  return new Promise<MockServerHandle>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, host, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('mock server failed to bind'));
        return;
      }
      // P-D1 — warm the per-leaf session index on first boot. Deferred via
      // setImmediate so it can never block the `listen` callback resolving;
      // any error is swallowed because a missing index just means the next
      // scan falls through to legacy enumeration.
      setImmediate(() => {
        rebuildAllIndexes(outputDir).catch(() => {
          /* non-fatal — scanAllSessions degrades to readdirSync */
        });
      });

      // L-11 — start the LLM narrative worker AFTER `listen` resolves so its
      // first tick can never race the listen callback. `collectInputs` is
      // wired to the real input collector — each tick loads sessions from
      // `outputDir`, builds the overview snapshot via the aggregator, and
      // maps T1..T5 inputs using the SAME builders the aggregator's
      // cache-only render path uses (so worker writes and aggregator reads
      // hit the same cache keys).
      if (llmCfg.enabled && llmCache !== undefined) {
        const cache = llmCache;
        llmWorker = startWorker({
          cache,
          cfg: llmCfg,
          collectInputs: () => collectWorkerInputs({ collectorDir: outputDir, now }),
          log: (msg: string) => console.log(`[llm-worker] ${msg}`),
        });
      }

      resolve({
        url: `${opts.tls ? 'https' : 'http'}://${host}:${addr.port}`,
        port: addr.port,
        outputDir,
        close: () =>
          new Promise<void>((r, rej) => {
            // L-11 — stop the LLM worker BEFORE closing the HTTP server so
            // its interval timer can't fire one more tick while teardown is
            // in flight. `stop()` is synchronous + idempotent.
            if (llmWorker) {
              llmWorker.stop();
              llmWorker = undefined;
            }
            server.close((err) => (err ? rej(err) : r()));
            // Force-destroy any in-flight connections so a slowloris client
            // can't keep the process alive past graceful close.
            for (const s of sockets) s.destroy();
            sockets.clear();
          }),
      });
    });
  });
}
