/**
 * Auto-updater orchestrator. Wired into bin-auto-updater.cjs.
 *
 * Flow:
 *   1. Acquire single-flight lock; silently exit if another updater is running.
 *   2. Resolve collector base URL (saved digital-twin.json `uploader.endpoint`).
 *   3. GET /v1/client-latest/manifest. 404 → silently exit (no manifest published).
 *   4. Compare against local manifest with double-gate (version+timestamp).
 *   5. Download every file to `.new`, sha256-verifying as we go.
 *   6. Atomic-rename `.new` → live, backing up live to `.old`.
 *   7. Probe new uploader with RIVEN_UPLOADER_DRYRUN=1 (5s budget).
 *      If probe fails: rollback from .old, report, exit.
 *   8. Restart uploader daemon (graceful SIGTERM, 10s, then SIGKILL).
 *   9. Write new local manifest.
 *  10. Append success log line, release lock.
 */
import { homedir, hostname } from 'node:os';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  digitalTwinPaths,
  loadConfig,
  getUserId,
  getMachineId,
  readEnvWithLegacy,
} from '@matrix-riven/shared';
import { acquireLock } from './lockfile.js';
import {
  readLocalManifest,
  writeLocalManifest,
  shouldUpdate,
  validateManifest,
} from './manifest.js';
import { verifyManifestHmac } from './hmac.js';
import { downloadAllFiles } from './download.js';
import {
  applyReplacements,
  buildReplacePlans,
  cleanupOldBackups,
  rollbackReplacements,
} from './replace.js';
import { probeUploader } from './probe.js';
import { restartUploader } from './daemon-restart.js';
import { reportError } from './report.js';
import { appendLog } from './log.js';
import type { ClientManifest, UpdateErrorReport, UpdateStage } from './types.js';

const MANIFEST_FETCH_TIMEOUT_MS = 10_000;

export interface RunUpdaterOptions {
  /** Override home for tests. */
  home?: string;
  /** Override collector base URL (skip config lookup). For tests. */
  baseUrlOverride?: string;
  /** Provide an alternate fetch (for tests). */
  fetchImpl?: typeof fetch;
  /** Provide a clock (for tests). */
  now?: () => Date;
}

export interface RunUpdaterResult {
  ok: boolean;
  outcome:
    | 'lock-held'
    | 'no-config'
    | 'manifest-404'
    | 'manifest-fetch-failed'
    | 'manifest-invalid'
    | 'same-version'
    | 'manifest-suspicious'
    | 'download-failed'
    | 'replace-failed'
    | 'probe-failed'
    | 'daemon-restart-failed'
    | 'updated';
  detail?: string;
  /** Manifest version that this updater attempted to apply (when applicable). */
  to_version?: string;
}

function resolveHome(opt?: string): string {
  if (opt && opt.length > 0) return opt;
  const env = readEnvWithLegacy(process.env, 'RIVEN_HOME', 'TEAMAGENT_HOME');
  if (env && env.length > 0) return env;
  return process.env.HOME ?? process.env.USERPROFILE ?? homedir();
}

function resolveBaseUrl(home: string, opt?: string): string | null {
  if (opt && opt.length > 0) return opt;
  try {
    const paths = digitalTwinPaths(home);
    const cfg = loadConfig(paths.configFile);
    if (!cfg) return null;
    const ep = cfg.uploader?.endpoint;
    if (typeof ep !== 'string' || ep.length === 0) return null;
    const u = new URL(ep);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return ep;
  } catch {
    return null;
  }
}

function resolveIdentity(): { user_id: string; machine_id: string } {
  let user_id: string;
  try {
    const r = getUserId({ timeoutMs: 200 });
    user_id = r && r.length > 0 ? r : `unknown@${hostname()}`;
  } catch {
    user_id = `unknown@${hostname()}`;
  }
  let machine_id: string;
  try {
    const r = getMachineId();
    machine_id = r && r.length > 0 ? r : hostname();
  } catch {
    machine_id = hostname();
  }
  return { user_id, machine_id };
}

async function fetchRemoteManifest(
  baseUrl: string,
  fetchImpl: typeof fetch,
): Promise<
  | { ok: true; manifest: ClientManifest }
  | { ok: false; status: 'not-published' | 'fetch-failed' | 'invalid'; detail: string }
> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/client-latest/manifest`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MANIFEST_FETCH_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetchImpl(url, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, status: 'fetch-failed', detail: err instanceof Error ? err.message : String(err) };
  }
  clearTimeout(timer);
  if (resp.status === 404) return { ok: false, status: 'not-published', detail: 'no manifest published' };
  if (!resp.ok) return { ok: false, status: 'fetch-failed', detail: `HTTP ${resp.status}` };
  let json: unknown;
  try {
    json = await resp.json();
  } catch (err) {
    return { ok: false, status: 'invalid', detail: err instanceof Error ? err.message : String(err) };
  }
  const m = validateManifest(json);
  if (!m) return { ok: false, status: 'invalid', detail: 'manifest schema validation failed' };
  // HMAC verification — opt-in. If env unset, skipped silently. If env set,
  // a missing or mismatched hmac aborts with `invalid`.
  // We pass the raw parsed JSON so the hmac_sha256 field is visible to verify.
  const rawWithHmac = json as ClientManifest & { hmac_sha256?: unknown };
  const verify = verifyManifestHmac(rawWithHmac);
  if (!verify.ok) {
    return { ok: false, status: 'invalid', detail: `manifest HMAC verification failed: ${verify.reason}` };
  }
  return { ok: true, manifest: m };
}

export async function runUpdater(options: RunUpdaterOptions = {}): Promise<RunUpdaterResult> {
  const home = resolveHome(options.home);
  const paths = digitalTwinPaths(home);
  // Stash home on result for downstream resolveBaseUrl — passing the wrong
  // value (e.g. dirname(digitalTwinDir)) double-applies the .riven join.
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());

  // Ensure parent dir for the lock file exists (fresh install path).
  try {
    if (!existsSync(paths.digitalTwinDir)) {
      mkdirSync(paths.digitalTwinDir, { recursive: true });
    }
  } catch (err) {
    appendLog(paths.autoUpdateLogFile, `bootstrap mkdir failed: ${String(err)}`);
    return { ok: false, outcome: 'no-config', detail: 'cannot create digital-twin dir' };
  }

  // 1. lock
  const lock = acquireLock(paths.autoUpdateLockFile, now);
  if (!lock.ok || !lock.holder) {
    appendLog(paths.autoUpdateLogFile, `skipped (lock held by another updater)`);
    return { ok: true, outcome: 'lock-held' };
  }
  let result: RunUpdaterResult;
  try {
    result = await runWithLock(home, paths, fetchImpl, options.baseUrlOverride, now);
  } finally {
    lock.holder.release();
  }
  return result;
}

async function runWithLock(
  home: string,
  paths: ReturnType<typeof digitalTwinPaths>,
  fetchImpl: typeof fetch,
  baseUrlOverride: string | undefined,
  now: () => Date,
): Promise<RunUpdaterResult> {
  // 2. resolve collector
  const baseUrl = resolveBaseUrl(home, baseUrlOverride);
  if (!baseUrl) {
    appendLog(paths.autoUpdateLogFile, 'no collector configured — skipped');
    return { ok: true, outcome: 'no-config' };
  }

  const localManifest = readLocalManifest(paths.manifestFile);
  const identity = resolveIdentity();

  async function emitError(stage: UpdateStage, toVersion: string | null, message: string): Promise<void> {
    const report: UpdateErrorReport = {
      machine_id: identity.machine_id,
      user_id: identity.user_id,
      from_version: localManifest?.version ?? null,
      to_version: toVersion,
      stage,
      error_message: message,
      ts: now().toISOString(),
    };
    await reportError(baseUrl!, report, { fetchImpl }).catch(() => {});
    appendLog(paths.autoUpdateLogFile, `ERROR stage=${stage} msg=${message}`);
  }

  // 3. fetch manifest
  const manifestResult = await fetchRemoteManifest(baseUrl, fetchImpl);
  if (!manifestResult.ok) {
    if (manifestResult.status === 'not-published') {
      appendLog(paths.autoUpdateLogFile, 'no manifest published on server');
      return { ok: true, outcome: 'manifest-404' };
    }
    await emitError('fetch-manifest', null, manifestResult.detail);
    return {
      ok: false,
      outcome: manifestResult.status === 'fetch-failed' ? 'manifest-fetch-failed' : 'manifest-invalid',
      detail: manifestResult.detail,
    };
  }
  const remote = manifestResult.manifest;

  // 4. double-gate
  const decision = shouldUpdate(localManifest, remote);
  if (!decision.update) {
    if (decision.reason === 'same-version') {
      appendLog(paths.autoUpdateLogFile, `current (version=${remote.version})`);
      return { ok: true, outcome: 'same-version', to_version: remote.version };
    }
    if (decision.reason === 'disabled') {
      const noteSuffix = decision.note ? ` note="${decision.note}"` : '';
      appendLog(paths.autoUpdateLogFile, `PAUSED (operator kill-switch) version=${remote.version}${noteSuffix}`);
      return { ok: true, outcome: 'same-version', to_version: remote.version, detail: 'kill-switch' };
    }
    if (decision.reason === 'manifest-suspicious') {
      await emitError(
        'manifest-suspicious',
        remote.version,
        `remote version=${decision.detail.remoteVersion} but generated_at not newer than local (remote_ts=${decision.detail.remoteTs} local_ts=${decision.detail.localTs}). Refusing to downgrade.`,
      );
      return { ok: false, outcome: 'manifest-suspicious', detail: 'remote timestamp not newer than local' };
    }
    // no-local — proceed as a fresh install
  }

  // 5. download all
  const dl = await downloadAllFiles(baseUrl, paths.digitalTwinDir, remote.files, { fetchImpl });
  if (!dl.ok) {
    await emitError(
      dl.result.reason === 'sha256' ? 'sha256' : 'download',
      remote.version,
      `file=${dl.failed.name} reason=${dl.result.reason} detail=${dl.result.detail}`,
    );
    return { ok: false, outcome: 'download-failed', detail: dl.result.detail, to_version: remote.version };
  }

  // 6. atomic rename
  const plans = buildReplacePlans(paths.digitalTwinDir, dl.newPaths);
  const swap = applyReplacements(plans);
  if (!swap.ok || !swap.failed) {
    if (!swap.ok && swap.failed) {
      rollbackReplacements(swap.completed);
      await emitError('rename', remote.version, `file=${swap.failed.plan.livePath} error=${swap.failed.error}`);
      return { ok: false, outcome: 'replace-failed', detail: swap.failed.error, to_version: remote.version };
    }
  }

  // 7. probe new uploader
  const uploaderBin = join(paths.digitalTwinDir, 'bin-uploader.cjs');
  const probe = await probeUploader(uploaderBin);
  if (!probe.ok) {
    rollbackReplacements(plans);
    await emitError('probe', remote.version, probe.detail ?? 'probe failed');
    return { ok: false, outcome: 'probe-failed', detail: probe.detail, to_version: remote.version };
  }

  // 8. restart daemon
  const restart = await restartUploader({
    uploaderBinPath: uploaderBin,
    pidFile: paths.daemonPidFile,
    logFile: paths.uploaderLogFile,
  });
  if (!restart.ok) {
    // CTO review 2026-05-19: if we get here we've killed the old daemon and
    // failed to spawn the new one. Writing the new local manifest now would
    // cause the next SessionStart to short-circuit on `same-version` and the
    // machine would be stuck without a running uploader. Skip the manifest
    // write so the next SessionStart re-runs the full pipeline. The .old
    // backups have been swapped onto live disk already; rollback would not
    // bring the daemon back. Best fallback: try one more spawn (no kill),
    // mark as updated-but-degraded.
    await emitError('daemon-restart', remote.version, restart.detail ?? 'unknown restart failure');
    appendLog(
      paths.autoUpdateLogFile,
      `DEGRADED daemon-restart failed: ${restart.detail ?? 'unknown'} — next SessionStart will retry`,
    );
    // Note: we still clean up .old (running daemon would have been killed
    // anyway). Don't write manifest. The Stop hook's tap path (which
    // unconditionally spawns the daemon if missing) will eventually pick up.
    cleanupOldBackups(plans);
    return {
      ok: false,
      outcome: 'daemon-restart-failed',
      detail: restart.detail,
      to_version: remote.version,
    };
  }

  // 9. write new local manifest
  try {
    writeLocalManifest(paths.manifestFile, remote);
  } catch (err) {
    // Files are already swapped; just log.
    appendLog(paths.autoUpdateLogFile, `manifest write failed: ${String(err)}`);
  }

  // 10. cleanup .old backups + success log
  cleanupOldBackups(plans);
  appendLog(
    paths.autoUpdateLogFile,
    `UPDATED from=${localManifest?.version ?? 'none'} to=${remote.version} files=${remote.files.length}` +
      (restart.killedOld ? ' restarted-daemon' : '') +
      (restart.newPid ? ` new-pid=${restart.newPid}` : ''),
  );

  return { ok: true, outcome: 'updated', to_version: remote.version };
}

export { acquireLock } from './lockfile.js';
export { readLocalManifest, writeLocalManifest, shouldUpdate, validateManifest } from './manifest.js';
export { downloadOneFile, downloadAllFiles } from './download.js';
export {
  applyReplacements,
  buildReplacePlans,
  rollbackReplacements,
  cleanupOldBackups,
} from './replace.js';
export { probeUploader } from './probe.js';
export { restartUploader } from './daemon-restart.js';
export { reportError } from './report.js';
export { appendLog } from './log.js';
export {
  CLIENT_BIN_WHITELIST,
  type ClientBinName,
  type ClientManifest,
  type ClientManifestFile,
  type UpdateErrorReport,
  type UpdateStage,
} from './types.js';
