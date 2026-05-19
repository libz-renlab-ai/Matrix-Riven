import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface DigitalTwinPaths {
  /**
   * Root directory for all Matrix-Riven runtime state on this machine.
   * Canonical layout: `<home>/.riven`. For machines migrating from TeamBrain
   * the legacy `<home>/.teamagent` directory is read transparently — see
   * `resolveDataRootDir` for the resolution rule.
   */
  dataRootDir: string;
  digitalTwinDir: string;
  configFile: string;
  machineIdFile: string;
  queueDir: string;
  pendingDir: string;
  deadLetterDir: string;
  recordingTempDir: string;
  daemonPidFile: string;
  /**
   * Sentinel file written every time the hourly scan fires. Contains a single
   * ISO timestamp. Acts as the time fence so the Stop hook can decide whether
   * the hourly slot has elapsed without spawning a separate daemon.
   */
  lastHourlyScanFile: string;
  /**
   * Local cache of the most recent successful quota probe. Persisted as a
   * serialized `CcSessionQuotaBlock` so a probe failure (401/429/network)
   * can still attach a stale snapshot to the envelope.
   */
  quotaCacheFile: string;
  /**
   * Combined stdout+stderr of the uploader daemon. The Stop-hook tap spawns
   * the daemon with this file as the child's stdio target, so a
   * `MODULE_NOT_FOUND` / auth-failure / crash is no longer invisible.
   * `riven digital-twin status` surfaces the last error line from here.
   */
  uploaderLogFile: string;
  /**
   * Local copy of the most-recently-installed client manifest. Auto-updater
   * compares this against the server's `/v1/client-latest/manifest` to decide
   * whether to fetch new bins. Missing = pre-auto-update install (treated as
   * "first ever update" by the double-gate).
   */
  manifestFile: string;
  /**
   * Auto-updater single-flight lock. Holds `PID=<pid>\nTS=<iso>` of the running
   * updater so concurrent SessionStart hooks short-circuit.
   */
  autoUpdateLockFile: string;
  /** Append-only log of every auto-update attempt (success or failure). */
  autoUpdateLogFile: string;
}

const RIVEN_DIRNAME = '.riven';
const LEGACY_DIRNAME = '.teamagent';

let _legacyWarned = false;

/**
 * Resolve the data-root directory for a given home.
 *
 * Resolution rule (single source of truth for the TeamBrain → Matrix-Riven
 * rename):
 *
 *   1. If `<home>/.riven` exists → use it.
 *   2. Else if `<home>/.teamagent` exists → use it, emit a one-shot
 *      deprecation warning, and let the caller go on reading legacy data.
 *   3. Else → use `<home>/.riven` (fresh install).
 *
 * Rule (1) winning over (2) means once a user runs `riven digital-twin login`
 * the new layout takes over even if the legacy directory still exists. There
 * is no automatic copy — a future `riven migrate` subcommand handles that.
 *
 * `existsFn` is injectable so tests can drive both branches without touching
 * the real filesystem.
 */
export function resolveDataRootDir(
  home: string,
  existsFn: (p: string) => boolean = existsSync,
): string {
  const rivenDir = join(home, RIVEN_DIRNAME);
  const legacyDir = join(home, LEGACY_DIRNAME);
  if (existsFn(rivenDir)) return rivenDir;
  if (existsFn(legacyDir)) {
    warnLegacyOnce(legacyDir, rivenDir);
    return legacyDir;
  }
  return rivenDir;
}

function warnLegacyOnce(legacyDir: string, rivenDir: string): void {
  if (_legacyWarned) return;
  _legacyWarned = true;
  try {
    process.stderr.write(
      `[riven] DEPRECATED: reading data from legacy ${legacyDir}; rename or copy to ${rivenDir} before the legacy path is removed\n`,
    );
  } catch {
    /* never block a Stop hook */
  }
}

/** Reset the legacy-path warning cache. Intended for tests. */
export function _resetLegacyPathWarning(): void {
  _legacyWarned = false;
}

export function digitalTwinPaths(home: string = homedir()): DigitalTwinPaths {
  const dataRootDir = resolveDataRootDir(home);
  const digitalTwinDir = join(dataRootDir, 'digital-twin');
  const queueDir = join(digitalTwinDir, 'queue');
  return {
    dataRootDir,
    digitalTwinDir,
    configFile: join(dataRootDir, 'digital-twin.json'),
    machineIdFile: join(digitalTwinDir, 'machine-id'),
    queueDir,
    pendingDir: join(queueDir, 'pending'),
    deadLetterDir: join(queueDir, 'dead-letter'),
    recordingTempDir: join(queueDir, 'recording_temp'),
    daemonPidFile: join(digitalTwinDir, 'daemon.pid'),
    lastHourlyScanFile: join(digitalTwinDir, 'last-hourly-scan.txt'),
    quotaCacheFile: join(digitalTwinDir, 'quota-cache.json'),
    uploaderLogFile: join(digitalTwinDir, 'uploader.log'),
    manifestFile: join(digitalTwinDir, 'manifest.json'),
    autoUpdateLockFile: join(digitalTwinDir, 'auto-update.lock'),
    autoUpdateLogFile: join(digitalTwinDir, 'auto-update.log'),
  };
}

export const DEFAULT_PATHS: DigitalTwinPaths = digitalTwinPaths();
