/**
 * Env-gated fire-and-forget emitter wired into the SessionStart and
 * UserPromptSubmit hook bundles.
 *
 * When `RIVEN_REALTIME_URL` (or legacy `TEAMAGENT_REALTIME_URL`) is set, emit
 * one cc-status snapshot per hook fire; when it's unset, fall through to the
 * saved digital-twin config endpoint, and if neither resolves no-op.
 *
 * Contract:
 *   - Never throws. Every call is wrapped in try/catch; any failure logs at
 *     most one line to stderr (and only if RIVEN_REALTIME_DEBUG=1).
 *   - Never blocks. The fetch is fire-and-forget — we `void` the promise and
 *     return synchronously. The hook lifecycle drains microtasks before
 *     exiting, so the timeout fires inside the same process tick.
 *   - Never retries. Drops on timeout / 5xx / network.
 *
 * Env (legacy `TEAMAGENT_*` names are accepted with a deprecation warning):
 *   RIVEN_REALTIME_URL          — base URL (e.g. http://127.0.0.1:9787). Unset → fall back to saved config.
 *   RIVEN_REALTIME_TOKEN        — optional bearer for the receiver.
 *   RIVEN_REALTIME_ALLOW_REMOTE — "1" to allow non-loopback env URLs.
 *   RIVEN_REALTIME_RAW_PROMPT   — "1" to thread raw_prompt onto the snapshot.
 *   RIVEN_REALTIME_DEBUG        — "1" logs every emit outcome.
 *   RIVEN_DISABLED              — "1" hard kill switch.
 *   RIVEN_HOME                  — override for $HOME (test seam).
 *
 * Usage:
 *   import { emitCcStatus } from "./realtime-emit.js";
 *   emitCcStatus({ event: "session_start", sessionId, cwd });
 */
import { homedir, hostname, loadavg, cpus, freemem, totalmem } from "node:os";
import { existsSync, readFileSync, statSync } from "node:fs";
import {
  CC_STATUS_SCHEMA_VERSION,
  digitalTwinPaths,
  getMachineId,
  getUserId,
  loadConfig,
  readEnvWithLegacy,
  type CcStatusSnapshot,
  type CcSessionQuotaBlock,
  type DigitalTwinConfig,
} from "@matrix-riven/shared";
import {
  postCcStatusSnapshot,
  type PostCcStatusOutcome,
} from "./realtime-client.js";

// Hosts considered safe to push cc-status to without RIVEN_REALTIME_ALLOW_REMOTE=1.
// Adversarial review on PR #404: an attacker who can set the env var (hostile
// dotfile sync, supply-chain pnpm script, social engineering) gets cwd + git
// email + machine id + bearer token exfiltrated to any URL. Default to
// loopback-only so an "innocent" remote URL fails closed.
const LOOPBACK_HOSTS = new Set([
  "127.0.0.1",
  "localhost",
  "::1",
  "[::1]",
  "0.0.0.0",
]);

function urlIsLoopback(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  // hostname strips brackets from IPv6 already
  return LOOPBACK_HOSTS.has(parsed.hostname);
}

export interface EmitInput {
  /** Which hook fired ("session_start" | "user_prompt_submit" | ...). */
  readonly event: string;
  /** Claude Code session id from the hook input. */
  readonly sessionId?: string;
  /** Working directory at hook fire time. */
  readonly cwd?: string;
  /** Optional git branch (caller does the cheap `git rev-parse` if it wants). */
  readonly gitBranch?: string;
  /** Optional model id from the hook payload. */
  readonly model?: string;
  /** Optional context token count from the hook payload. */
  readonly contextTokens?: number;
  /**
   * Optional raw user prompt text. Bucket 1/2 (G1) flipped the default: raw
   * prompts ARE emitted unless the user explicitly opts out via
   * `RIVEN_REALTIME_RAW_PROMPT=0` (or legacy `TEAMAGENT_REALTIME_RAW_PROMPT=0`).
   * Empty string is still treated as "unset".
   */
  readonly rawPrompt?: string;
  /**
   * Bucket 1/2 — extra snapshot fields the caller wants to thread through
   * (event-specific or cross-cutting metrics). Sanitized server-side; client
   * just copies. Use this for `tool_name`, `user_decision`, `cpu_pct`, etc.
   */
  readonly extras?: Partial<CcStatusSnapshot>;
  /**
   * Optional path to the in-progress Claude Code transcript jsonl. CC sends
   * this on every hook stdin payload as `transcript_path`. When present and
   * the file is small enough to scan inside the hook budget, `buildSnapshot`
   * extracts cumulative metrics (turn_count, tool_calls_total/failed,
   * files_touched, context_tokens, model, session_started_at,
   * session_health) and fills them into the snapshot. Skipped when missing
   * or oversized.
   */
  readonly transcriptPath?: string;
}

const TIMEOUT_MS = 50;

/**
 * Read an env var by its `RIVEN_*` name, falling back to the legacy
 * `TEAMAGENT_*` name with a one-shot deprecation warning. Treats an empty
 * string as "unset" (env-var semantics for flag / URL / token use).
 */
function readEnv(rivenName: string, legacyName: string): string | undefined {
  return readEnvWithLegacy(process.env, rivenName, legacyName);
}

function debugLog(line: string): void {
  if (readEnv("RIVEN_REALTIME_DEBUG", "TEAMAGENT_REALTIME_DEBUG") === "1") {
    try {
      process.stderr.write(`[realtime-emit] ${line}\n`);
    } catch {
      // best-effort
    }
  }
}

// Cache identity once per process: getUserId() shells out to `git config
// user.email` (typ. 30-60ms on macOS) and getMachineId() touches disk to
// read/write the machine-id sentinel. Both are stable for the process
// lifetime and called per-hook, so caching keeps emitCcStatus well under
// the 50ms hook-critical-path target.
//
// Empty-string guard: getUserId() returns the unix-account fallback when git
// is installed but `user.email` is unset (common on fresh CI runners). We
// still want to treat empty as "not yet resolved" so a later working git
// config picks up — the `|| !cachedUserId` clause handles that.
let cachedUserId: string | null = null;
let cachedMachineId: string | null = null;
let cachedClientVersion: string | null = null;

/**
 * Cached digital-twin config-derived realtime URL. Read once per process from
 * `<dataRootDir>/digital-twin.json` so each hook fire stays under the 50ms
 * critical-path budget. Three terminal states:
 *
 *   '__unread'    — uninitialized; trigger one fs read on next emit
 *   null          — config absent / disabled / unparseable; skip emit
 *   string        — resolved baseUrl from `uploader.endpoint`
 */
const CONFIG_URL_UNREAD = "__unread" as const;
let cachedConfigBaseUrl: string | null | typeof CONFIG_URL_UNREAD = CONFIG_URL_UNREAD;

/**
 * Cached digital-twin quota cache (subscription_tier + 5h/7d utilization
 * + reset timestamps + stale flag). Read once per process so each hook
 * fire stays cheap. Three states: '__unread' (first call attempts read),
 * null (cache missing / unparseable), block (usable). Declared up here
 * with the other process-scoped caches so `__resetIdentityCacheForTests`
 * (below) can clear it without TDZ.
 */
const QUOTA_UNREAD = "__unread" as const;
let cachedQuotaBlock:
  | CcSessionQuotaBlock
  | null
  | typeof QUOTA_UNREAD = QUOTA_UNREAD;

/** Test-only — clears the in-process identity + config-url + quota caches. */
export function __resetIdentityCacheForTests(): void {
  cachedUserId = null;
  cachedMachineId = null;
  cachedClientVersion = null;
  cachedConfigBaseUrl = CONFIG_URL_UNREAD;
  cachedQuotaBlock = QUOTA_UNREAD;
}

/**
 * Bucket 1/2 (C1) — cheap host metrics sampled at hook fire time. Returns a
 * `Partial<CcStatusSnapshot>` ready to merge into `EmitInput.extras`. Each
 * field is best-effort: probe failures are swallowed (the snapshot just
 * omits the unknown field).
 */
export function sampleHostMetrics(): Partial<CcStatusSnapshot> {
  const out: Partial<CcStatusSnapshot> = {};
  try {
    const load = loadavg();
    const cpuCount = cpus().length || 1;
    // Windows returns [0,0,0]; treat as unknown.
    if (Array.isArray(load) && Number.isFinite(load[0]) && (load[0] as number) > 0) {
      out.cpu_pct = Math.round(((load[0] as number) / cpuCount) * 100) / 100;
    }
  } catch {
    /* loadavg unavailable */
  }
  try {
    const free = freemem();
    const total = totalmem();
    if (Number.isFinite(total) && total > 0) {
      out.mem_used_mb = Math.round((total - free) / (1024 * 1024));
      out.mem_total_mb = Math.round(total / (1024 * 1024));
    }
  } catch {
    /* mem unavailable */
  }
  return out;
}

/**
 * Read the locally-installed manifest version. Cached on first call to keep
 * the hook critical path cheap. Returns "unknown" if the file is missing or
 * malformed — old pre-auto-update installs report that string in cc-status
 * payloads, which makes them visible in the Updates dashboard.
 */
function resolveClientVersion(): string {
  if (cachedClientVersion !== null) return cachedClientVersion;
  try {
    const paths = digitalTwinPaths(homeForConfig());
    // Lazy require to avoid loading fs at module init.
    const { existsSync, readFileSync } = require('node:fs') as typeof import('node:fs');
    if (!existsSync(paths.manifestFile)) {
      cachedClientVersion = 'unknown';
      return cachedClientVersion;
    }
    const raw = readFileSync(paths.manifestFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.version === 'string' && parsed.version.length > 0) {
      const v: string = parsed.version.slice(0, 64);
      cachedClientVersion = v;
      return v;
    }
  } catch {
    // fall through
  }
  cachedClientVersion = 'unknown';
  return cachedClientVersion;
}

/**
 * Resolve the realtime cc-status base URL.
 *
 * Order of precedence:
 *   1. `RIVEN_REALTIME_URL` (or legacy `TEAMAGENT_REALTIME_URL`) env var,
 *      gated to loopback unless `RIVEN_REALTIME_ALLOW_REMOTE=1`. The loopback
 *      gate is a security boundary: an attacker who can flip an env var must
 *      not be able to exfiltrate cwd / git email / bearer to an arbitrary URL.
 *   2. `<dataRootDir>/digital-twin.json` `uploader.endpoint`, when the file
 *      exists and `uploader.enabled === true`. This path **bypasses** the
 *      loopback gate intentionally: the URL there was written either by the
 *      user running `riven digital-twin login` or by `ensureDefaultConfig`
 *      auto-creating the team-shared config — the team's explicit, persistent
 *      choice, not an environmental override an attacker can flip mid-session.
 *
 * Returns null when neither source resolves a usable URL — emitCcStatus then
 * skips.
 */
function resolveBaseUrl(): string | null {
  const envUrl = readEnv("RIVEN_REALTIME_URL", "TEAMAGENT_REALTIME_URL");
  if (envUrl) {
    if (
      urlIsLoopback(envUrl) ||
      readEnv("RIVEN_REALTIME_ALLOW_REMOTE", "TEAMAGENT_REALTIME_ALLOW_REMOTE") === "1"
    ) {
      return envUrl;
    }
    debugLog(
      `skip env URL (non-loopback, set RIVEN_REALTIME_ALLOW_REMOTE=1 to override) url=${envUrl}`,
    );
    return null;
  }
  // Env unset → check the user's saved digital-twin config.
  if (cachedConfigBaseUrl === CONFIG_URL_UNREAD) {
    cachedConfigBaseUrl = readConfigBaseUrl();
  }
  return cachedConfigBaseUrl;
}

/**
 * Resolve `$HOME` for the config lookup. Test seam: env-override takes
 * precedence so the test sandbox (which mkdtemps a tmp HOME) works on
 * Windows too, where `os.homedir()` reads SHGetKnownFolderPath and
 * ignores `$env:USERPROFILE` / `$env:HOME` overrides.
 */
function homeForConfig(): string {
  const overridden = readEnvWithLegacy(process.env, "RIVEN_HOME", "TEAMAGENT_HOME");
  return (
    overridden ??
    process.env.HOME ??
    process.env.USERPROFILE ??
    homedir()
  );
}

function readConfigBaseUrl(): string | null {
  try {
    const paths = digitalTwinPaths(homeForConfig());
    const cfg: DigitalTwinConfig | null = loadConfig(paths.configFile);
    if (!cfg) return null;
    if (!cfg.uploader?.enabled) return null;
    const ep = cfg.uploader?.endpoint;
    if (typeof ep !== "string" || ep.length === 0) return null;
    // Cheap sanity check — must parse as http(s) URL.
    try {
      const u = new URL(ep);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    } catch {
      return null;
    }
    return ep;
  } catch {
    return null;
  }
}

/**
 * Read `identity.user_id` from the digital-twin config (the value the user
 * established at `bin-digital-twin login`). This is the SAME source the
 * transcript-upload path (`bin-uploader.ts`) reads, so cc-status snapshots
 * and transcripts land under the same `user_id` on the collector instead of
 * splitting (the bug that produced ghost `neurobot@NeuroBot` directories
 * alongside the real `hrdai@qq.com` data).
 *
 * Returns null when the config is missing, unparseable, has no identity
 * block, or has an empty `user_id` string — caller falls back to
 * `getUserId()` (git config / hostname) in that order.
 */
function readConfigUserId(): string | null {
  try {
    const paths = digitalTwinPaths(homeForConfig());
    const cfg: DigitalTwinConfig | null = loadConfig(paths.configFile);
    if (!cfg) return null;
    const id = cfg.identity?.user_id;
    if (typeof id !== "string" || id.length === 0) return null;
    return id;
  } catch {
    return null;
  }
}

/**
 * Maximum transcript jsonl file size we'll fully scan inside the hook
 * critical path. CC transcripts grow append-only and can hit tens of MB on
 * long sessions; reading 35MB blocks the SessionStart / UserPromptSubmit
 * hook well past the 50ms budget on a slow disk. When the file exceeds
 * this cap, `scanTranscript` bails and the snapshot ships without
 * transcript-derived fields (better than blocking the user's CC turn).
 */
const TRANSCRIPT_SCAN_MAX_BYTES = 4 * 1024 * 1024;

interface TranscriptStats {
  turnCount: number;
  toolCallsTotal: number;
  toolCallsFailed: number;
  filesTouched: number;
  contextTokens?: number;
  model?: string;
  sessionStartedAt?: string;
}

/**
 * Parse a CC transcript jsonl file and accumulate cumulative session
 * metrics. Pure synchronous read — caller is expected to size-cap via
 * `TRANSCRIPT_SCAN_MAX_BYTES` so we don't blow the hook budget.
 *
 * Fields and their derivation:
 *   - turn_count           ← count of `type:'user'` lines that are NOT
 *                            tool_result responses (= actual user turns)
 *   - tool_calls_total     ← count of `tool_use` blocks across all
 *                            assistant turns
 *   - tool_calls_failed    ← count of `tool_result` blocks with
 *                            `is_error: true`
 *   - files_touched        ← cardinality of unique `file_path` values
 *                            seen on Edit/Write `tool_use.input`
 *   - context_tokens       ← LATEST assistant turn's
 *                            input + cache_creation + cache_read tokens
 *                            (CC's "context window load" on that turn)
 *   - model                ← LATEST assistant turn's `message.model`
 *   - session_started_at   ← first line's `timestamp`
 *
 * cost_usd is NOT derived here — CC's transcript doesn't include cost;
 * computing it would require a per-model pricing table out of scope for
 * the hook path.
 *
 * Returns null on any read / parse error or when the file is oversized.
 */
function scanTranscript(transcriptPath: string): TranscriptStats | null {
  let raw: string;
  try {
    const st = statSync(transcriptPath);
    if (!st.isFile()) return null;
    if (st.size > TRANSCRIPT_SCAN_MAX_BYTES) return null;
    raw = readFileSync(transcriptPath, "utf8");
  } catch {
    return null;
  }
  const stats: TranscriptStats = {
    turnCount: 0,
    toolCallsTotal: 0,
    toolCallsFailed: 0,
    filesTouched: 0,
  };
  const files = new Set<string>();
  for (const line of raw.split("\n")) {
    if (!line) continue;
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    // session_started_at — first line with a timestamp wins
    if (!stats.sessionStartedAt && typeof r.timestamp === "string") {
      stats.sessionStartedAt = r.timestamp;
    }
    const type = typeof r.type === "string" ? r.type : "";
    const message = r.message as Record<string, unknown> | undefined;
    if (!message || typeof message !== "object") continue;
    if (type === "user") {
      // Count only actual user turns (not tool_result responses CC sends back
      // to the model under the same `type:'user'` wrapper).
      const content = message.content;
      let isToolResult = false;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            typeof block === "object" &&
            block &&
            (block as Record<string, unknown>).type === "tool_result"
          ) {
            isToolResult = true;
            const b = block as Record<string, unknown>;
            if (b.is_error === true) stats.toolCallsFailed++;
          }
        }
      }
      if (!isToolResult) stats.turnCount++;
    } else if (type === "assistant") {
      const m = message.model;
      if (typeof m === "string" && m.length > 0) stats.model = m;
      const usage = message.usage as Record<string, unknown> | undefined;
      if (usage) {
        const sum =
          toFiniteInt(usage.input_tokens) +
          toFiniteInt(usage.cache_creation_input_tokens) +
          toFiniteInt(usage.cache_read_input_tokens);
        if (sum > 0) stats.contextTokens = sum;
      }
      const content = message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (typeof block !== "object" || !block) continue;
          const b = block as Record<string, unknown>;
          if (b.type !== "tool_use") continue;
          stats.toolCallsTotal++;
          const tool = typeof b.name === "string" ? (b.name as string) : "";
          if (tool === "Edit" || tool === "Write") {
            const input = b.input as Record<string, unknown> | undefined;
            const fp = input?.file_path;
            if (typeof fp === "string" && fp.length > 0) files.add(fp);
          }
        }
      }
    }
  }
  stats.filesTouched = files.size;
  return stats;
}

function toFiniteInt(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0
    ? Math.floor(v)
    : 0;
}

/**
 * Read the digital-twin quota cache (subscription_tier + 5h/7d utilization
 * + reset timestamps + stale flag). Written by the hourly probe in
 * `quota/probe.ts` + `quota/state.ts`. Cache is declared with the other
 * process-scoped caches near top of file. Result cached for the rest of
 * the process lifetime.
 */
function readQuotaBlock(): CcSessionQuotaBlock | null {
  if (cachedQuotaBlock !== QUOTA_UNREAD) return cachedQuotaBlock;
  try {
    const paths = digitalTwinPaths(homeForConfig());
    const cacheFile = `${paths.digitalTwinDir}/quota-cache.json`;
    if (!existsSync(cacheFile)) {
      cachedQuotaBlock = null;
      return null;
    }
    const raw = readFileSync(cacheFile, "utf8");
    const parsed = JSON.parse(raw) as CcSessionQuotaBlock;
    // Minimal shape check — the probe writes the full block atomically so
    // a half-written file would fail JSON.parse already, but a manual
    // edit or schema drift might land a partial object. Demand the four
    // numeric fields at minimum.
    if (
      typeof parsed?.five_hour_utilization === "number" &&
      typeof parsed?.seven_day_utilization === "number"
    ) {
      cachedQuotaBlock = parsed;
      return parsed;
    }
    cachedQuotaBlock = null;
    return null;
  } catch {
    cachedQuotaBlock = null;
    return null;
  }
}

function buildSnapshot(input: EmitInput): CcStatusSnapshot {
  if (!cachedUserId) {
    // Identity resolution priority — must match the transcript-upload path
    // (`bin-uploader.ts`) so a single CC session lands every artifact under
    // the same `user_id` on the collector:
    //   1. `digital-twin.json identity.user_id`  ← canonical, set at `login`
    //   2. `git config user.email`               ← fallback for unconfigured installs
    //   3. `${username}@${hostname()}`           ← last-resort fallback (no git, no email)
    //
    // Before this priority was introduced, realtime hooks only consulted
    // steps 2-3 and ignored the config file entirely. A user whose `git config
    // user.email` came back empty (non-git cwd, unset local + global) would
    // see the same physical session split into two `user_id`s: transcripts
    // under their real id (from config) and cc-status snapshots under the
    // hostname fallback. The collector then surfaced a phantom user.
    const fromConfig = readConfigUserId();
    if (fromConfig) {
      cachedUserId = fromConfig;
    } else {
      try {
        // Hard 200ms cap on the git shell-out. A stuck git config (NFS HOME,
        // corporate proxy resolving git LFS, etc.) would otherwise block the
        // SessionStart critical path on the FIRST emit. Cache hits after that.
        const resolved = getUserId({ timeoutMs: 200 });
        cachedUserId = resolved && resolved.length > 0
          ? resolved
          : `unknown@${hostname()}`;
      } catch {
        cachedUserId = `unknown@${hostname()}`;
      }
    }
  }
  if (!cachedMachineId) {
    try {
      const resolved = getMachineId();
      cachedMachineId = resolved && resolved.length > 0 ? resolved : hostname();
    } catch {
      cachedMachineId = hostname();
    }
  }
  const userId = cachedUserId;
  const machineId = cachedMachineId;
  const snap: CcStatusSnapshot = {
    schema_version: CC_STATUS_SCHEMA_VERSION,
    session_id: input.sessionId || `unknown-${Date.now()}`,
    user_id: userId,
    ts: new Date().toISOString(),
    event: input.event,
    display_name: userId.split("@")[0] || userId,
    machine_id: machineId,
    client_version: resolveClientVersion(),
  };
  if (input.cwd) snap.cwd = input.cwd;
  if (input.gitBranch) snap.git_branch = input.gitBranch;
  if (input.model) snap.model = input.model;
  // Clamp contextTokens to a finite non-negative integer so a future caller
  // can't pump NaN/Infinity/objects through. Math.floor coerces a bool to a
  // number, but the typed param already excludes that.
  if (
    typeof input.contextTokens === "number" &&
    Number.isFinite(input.contextTokens) &&
    input.contextTokens >= 0
  ) {
    const tokens = Math.floor(input.contextTokens);
    snap.context_tokens = tokens;
    snap.context_pct = Math.round((tokens / 200_000) * 100) / 100;
  }
  // Bucket 1/2 (G1) — raw prompt evidence is now DEFAULT-ON. Opt out by
  // setting RIVEN_REALTIME_RAW_PROMPT=0 (or the legacy TEAMAGENT_* var).
  // Empty-string prompts are still treated as "unset" so an opt-in caller
  // can skip empty prompts.
  if (
    typeof input.rawPrompt === "string" &&
    input.rawPrompt.length > 0 &&
    readEnv("RIVEN_REALTIME_RAW_PROMPT", "TEAMAGENT_REALTIME_RAW_PROMPT") !== "0"
  ) {
    snap.raw_prompt = input.rawPrompt;
  }

  // Transcript-derived cumulative metrics. CC emits `transcript_path` on
  // every hook stdin payload; when present + the file fits inside the
  // critical-path scan budget, fold per-session cumulative stats into the
  // snapshot. Caller-provided model / contextTokens (from CC stdin if it
  // exposes them on a future hook revision) win over scan-derived values.
  if (input.transcriptPath) {
    const scan = scanTranscript(input.transcriptPath);
    if (scan) {
      if (scan.turnCount > 0) snap.turn_count = scan.turnCount;
      if (scan.toolCallsTotal > 0) snap.tool_calls_total = scan.toolCallsTotal;
      if (scan.toolCallsFailed > 0) snap.tool_calls_failed = scan.toolCallsFailed;
      if (scan.filesTouched > 0) snap.files_touched = scan.filesTouched;
      if (scan.sessionStartedAt) snap.session_started_at = scan.sessionStartedAt;
      if (scan.model && !snap.model) snap.model = scan.model;
      if (scan.contextTokens !== undefined && snap.context_tokens === undefined) {
        snap.context_tokens = scan.contextTokens;
        const pct = Math.round((scan.contextTokens / 200_000) * 100) / 100;
        snap.context_pct = pct;
        // session_health threshold mirrors CcSessionHealth contract in
        // shared/cc-status/types.ts — 200k = 100% load → "OVER_200K" once
        // the latest assistant turn exceeds it (CC's own statusline uses
        // the same threshold).
        snap.session_health = pct > 1.0 ? "OVER_200K" : "OK";
      }
    }
  }

  // Quota cache from the hourly probe (subscription_tier + 5h/7d
  // utilization + reset timestamps + stale flag). Probe writes the cache
  // file atomically from `quota/state.ts:writeQuotaCache`; here we just
  // fold its fields into the snapshot if the file exists. Absent cache
  // (probe never succeeded — e.g. no Max subscription, no OAuth token)
  // leaves these fields unset, same as before.
  const quota = readQuotaBlock();
  if (quota) {
    snap.subscription_tier = quota.subscription_tier;
    snap.five_hour_utilization = quota.five_hour_utilization;
    snap.seven_day_utilization = quota.seven_day_utilization;
    if (typeof quota.five_hour_reset_at === "number") {
      snap.five_hour_reset_at = quota.five_hour_reset_at;
    }
    if (typeof quota.seven_day_reset_at === "number") {
      snap.seven_day_reset_at = quota.seven_day_reset_at;
    }
    snap.quota_stale = quota.stale;
  }

  // Bucket 1/2 — copy through caller-supplied extras (host metrics, tool_name,
  // user_decision, cpu_pct, etc). Runs LAST so explicit caller-supplied values
  // beat transcript-scan-derived ones. Server-side `sanitizeCcStatusSnapshot`
  // is the actual whitelist; this assign just lets the hook bins thread
  // event-specific fields without each bin building a snapshot from scratch.
  if (input.extras) Object.assign(snap, input.extras);
  return snap;
}

/**
 * Synchronous: builds the snapshot, kicks off the POST, returns immediately.
 * The promise is intentionally discarded — there's no caller that can act on
 * the outcome, and the contract is "never block the hook path".
 */
export function emitCcStatus(input: EmitInput): void {
  // Defense-in-depth: the kill switch is also honored by the two existing
  // hook bundles before they call here, but any future direct caller (a
  // third hook, a CLI subcommand, an integration test) gets the same opt-out
  // for free by reading the env var here.
  if (readEnv("RIVEN_DISABLED", "TEAMAGENT_DISABLED") === "1") {
    debugLog(`skip (RIVEN_DISABLED=1) event=${input.event}`);
    return;
  }
  // `resolveBaseUrl()` consolidates the env-var path (loopback-gated,
  // unchanged threat model) with a saved-config fallback
  // (`<dataRootDir>/digital-twin.json` `uploader.endpoint` when `enabled`).
  // The saved-config path is intentionally not loopback-gated — see the
  // function comment for the security rationale.
  const baseUrl = resolveBaseUrl();
  if (!baseUrl) {
    debugLog(`skip (no base URL resolved) event=${input.event}`);
    return;
  }
  let snapshot: CcStatusSnapshot;
  try {
    snapshot = buildSnapshot(input);
  } catch (err) {
    debugLog(`build-failed err=${String(err)}`);
    return;
  }
  const bearerToken = readEnv("RIVEN_REALTIME_TOKEN", "TEAMAGENT_REALTIME_TOKEN");
  try {
    void postCcStatusSnapshot(snapshot, {
      baseUrl,
      timeoutMs: TIMEOUT_MS,
      ...(bearerToken ? { bearerToken } : {}),
      onOutcome: (outcome: PostCcStatusOutcome) =>
        debugLog(`event=${input.event} outcome=${outcome}`),
    });
  } catch (err) {
    debugLog(`fire-failed err=${String(err)}`);
  }
}
