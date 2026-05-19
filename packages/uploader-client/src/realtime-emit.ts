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
import { homedir, hostname } from "node:os";
import {
  CC_STATUS_SCHEMA_VERSION,
  digitalTwinPaths,
  getMachineId,
  getUserId,
  loadConfig,
  readEnvWithLegacy,
  type CcStatusSnapshot,
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
   * Optional raw user prompt text. Issue #308 grill §3 mandates "完整存 raw
   * prompt" for leader-side evidence / replay. The caller (UserPromptSubmit
   * hook) is responsible for gating this behind the
   * `RIVEN_REALTIME_RAW_PROMPT=1` env opt-in — emit threads whatever it
   * receives directly to `CcStatusSnapshot.raw_prompt`. Empty string is
   * treated as "unset" (so an opt-in caller can still skip individual
   * empty prompts).
   */
  readonly rawPrompt?: string;
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

/** Test-only — clears the in-process identity + config-url caches. */
export function __resetIdentityCacheForTests(): void {
  cachedUserId = null;
  cachedMachineId = null;
  cachedClientVersion = null;
  cachedConfigBaseUrl = CONFIG_URL_UNREAD;
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
      cachedClientVersion = parsed.version.slice(0, 64);
      return cachedClientVersion;
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

function buildSnapshot(input: EmitInput): CcStatusSnapshot {
  if (!cachedUserId) {
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
  // Opt-in raw prompt evidence. Defense-in-depth — the hook layer
  // (bin-user-prompt-submit.ts) is the policy boundary, but a future direct
  // caller of emitCcStatus would otherwise bypass the env gate. Re-check
  // here so the transport refuses to send prompt content unless
  // RIVEN_REALTIME_RAW_PROMPT=1 (or the legacy TEAMAGENT_REALTIME_RAW_PROMPT)
  // is explicitly set, regardless of what the caller passed.
  if (
    typeof input.rawPrompt === "string" &&
    input.rawPrompt.length > 0 &&
    readEnv("RIVEN_REALTIME_RAW_PROMPT", "TEAMAGENT_REALTIME_RAW_PROMPT") === "1"
  ) {
    snap.raw_prompt = input.rawPrompt;
  }
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
