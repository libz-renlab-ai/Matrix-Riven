/**
 * Process management for the digital-twin uploader daemon: PID lock,
 * upload cycle, and main loop with idle self-exit.
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
} from 'node:fs';
import path from 'node:path';
import { homedir as osHomedir } from 'node:os';
import { digitalTwinPaths } from '@matrix-riven/shared';
import {
  listPending,
  loadEntry,
  removeEntry,
  moveToDeadLetter,
  enforceCapacity,
  isEntryTooLarge,
  writeMetadataAtomic,
  type LoadedEntry,
  type QueueEntry,
} from './queue.js';
import { uploadEntry, type UploadOutcome, type FetchLike } from './uploader.js';
import { shouldDeadLetter } from './backoff.js';

export interface DaemonConfig {
  endpoint: string;
  token: string;
  user_id: string;
  machine_id: string;
  /** Issue #146 F9 — when first config persist happened. Null if pre-F9 config without backfill. */
  consented_at?: string | null;
}

export interface PidFileContent {
  pid: number;
  start_at: string;
}

/**
 * Outcome for one queue entry in one cycle.
 *
 * Issue #266 F7: failure bookkeeping switched from an in-RAM count
 * (`failures: number`) to a persisted ISO timestamp (`first_failed_at`)
 * because the daemon idle-self-exits every 15 min and the in-RAM
 * counter was being reset before pathological entries could ever reach
 * the dead-letter threshold. The dead-letter reason for stale entries
 * is therefore renamed `'too-old'` (was `'too-many-failures'`).
 */
export type CyclePerEntryOutcome =
  | { id: string; outcome: 'uploaded' }
  | { id: string; outcome: 'transient'; first_failed_at: string; status?: number; error?: string }
  | {
      id: string;
      outcome: 'dead-letter';
      reason: 'permanent-failure' | 'too-old';
      first_failed_at?: string;
      status?: number;
    }
  | { id: string; outcome: 'auth-failed' }
  | { id: string; outcome: 'invalid-metadata' }
  /**
   * Issue #266 F8 — entry's `.payload` is over the size cap. Moved to
   * dead-letter without ever being read into memory.
   */
  | { id: string; outcome: 'too-large'; payload_size: number };

export interface CycleSummary {
  scanned: number;
  outcomes: CyclePerEntryOutcome[];
  authFailed: boolean;
}

/** Returns true if the given pid is alive on this OS. */
export function isPidAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    // Sending signal 0 does no work but checks for the existence of the process.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // EPERM means the process exists but we lack signal permission.
    if (code === 'EPERM') return true;
    return false;
  }
}

export function readPidFile(home: string = osHomedir()): PidFileContent | null {
  const paths = digitalTwinPaths(home);
  if (!existsSync(paths.daemonPidFile)) return null;
  try {
    const raw = readFileSync(paths.daemonPidFile, 'utf-8');
    const obj = JSON.parse(raw) as Partial<PidFileContent>;
    if (typeof obj.pid !== 'number' || typeof obj.start_at !== 'string') return null;
    return { pid: obj.pid, start_at: obj.start_at };
  } catch {
    return null;
  }
}

export interface AcquirePidLockDeps {
  pid?: number;
  now?: () => Date;
  isPidAlive?: (pid: number) => boolean;
}

/**
 * Try to acquire the daemon PID lock. Returns true on success (lock acquired),
 * false if another live daemon already owns it or if we lost an EEXIST race
 * during stale-lock recovery. Stale locks (from a dead PID or with a
 * malformed pid file) are forcibly replaced.
 *
 * Issue #266 F6: the previous read-then-write implementation was a TOCTOU
 * race — two daemons starting concurrently could both read "no live owner"
 * and both write their own pid. The atomic path here uses
 * `writeFileSync(..., { flag: 'wx' })` so the kernel rejects with EEXIST
 * when the file already exists. EEXIST then triggers a single inspect +
 * unlink + retry, mirroring the prior stale-takeover semantics.
 */
export function acquirePidLock(
  home: string = osHomedir(),
  deps: AcquirePidLockDeps = {},
): boolean {
  const paths = digitalTwinPaths(home);
  const myPid = deps.pid ?? process.pid;
  const now = deps.now ?? (() => new Date());
  const aliveCheck = deps.isPidAlive ?? isPidAlive;

  mkdirSync(paths.digitalTwinDir, { recursive: true });

  const payload = JSON.stringify({
    pid: myPid,
    start_at: now().toISOString(),
  } satisfies PidFileContent);

  // Fast path: atomic create succeeds iff nobody held the lock.
  if (tryWritePidLockAtomic(paths.daemonPidFile, payload)) return true;

  // EEXIST — inspect the existing record.
  const existing = readPidFile(home);
  if (existing?.pid === myPid) {
    // Already ours (e.g. crash-recovery resume in the same process). Idempotent.
    return true;
  }
  if (existing && aliveCheck(existing.pid)) {
    return false;
  }

  // Stale (dead pid or unreadable record). Best-effort unlink then retry the
  // atomic create exactly once. A second EEXIST means we lost a race to
  // another would-be daemon — back off rather than loop.
  try {
    unlinkSync(paths.daemonPidFile);
  } catch {
    // best-effort
  }
  return tryWritePidLockAtomic(paths.daemonPidFile, payload);
}

function tryWritePidLockAtomic(path: string, payload: string): boolean {
  try {
    writeFileSync(path, payload, { flag: 'wx', encoding: 'utf-8' });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
}

export function releasePidLock(home: string = osHomedir()): void {
  const paths = digitalTwinPaths(home);
  try {
    unlinkSync(paths.daemonPidFile);
  } catch {
    // best-effort
  }
}

export interface RunCycleDeps {
  fetchFn?: FetchLike;
  uploader?: typeof uploadEntry;
  /**
   * Issue #266 F7 — current clock injector. Defaults to `new Date()`.
   * Tests pin the clock to deterministically exercise the 24h window.
   */
  now?: () => Date;
  /**
   * Issue #266 F8 — payload-size cap injector. Defaults to
   * `MAX_PAYLOAD_BYTES` (100MB). Tests pass a smaller value so they can
   * exercise the 'too-large' path without writing 100MB files.
   */
  maxPayloadBytes?: number;
}

/**
 * Run one upload cycle: scan pending/, upload each, classify outcomes.
 *
 * Issue #266 F7: the previous in-RAM failure counter (`Map<id, count>`)
 * was removed. Failure bookkeeping is now persisted on the metadata
 * file so the 24h dead-letter window survives daemon restarts.
 */
export async function runUploadCycle(
  config: DaemonConfig,
  home: string = osHomedir(),
  deps: RunCycleDeps = {},
): Promise<CycleSummary> {
  const uploader = deps.uploader ?? uploadEntry;
  const now = deps.now ?? (() => new Date());
  const maxBytes = deps.maxPayloadBytes;
  const entries = listPending(home);
  const outcomes: CyclePerEntryOutcome[] = [];
  let authFailed = false;

  for (const entry of entries) {
    if (authFailed) break;
    const out = await processEntry(entry, config, uploader, deps.fetchFn, home, now, maxBytes);
    outcomes.push(out);
    if (out.outcome === 'auth-failed') {
      authFailed = true;
    }
  }

  return { scanned: entries.length, outcomes, authFailed };
}

async function processEntry(
  entry: QueueEntry,
  config: DaemonConfig,
  uploader: typeof uploadEntry,
  fetchFn: FetchLike | undefined,
  home: string,
  now: () => Date,
  maxPayloadBytes: number | undefined,
): Promise<CyclePerEntryOutcome> {
  // Issue #266 F8: size-check the file before any readFileSync, so an
  // oversize payload never lands in RAM. Oversize entries go straight to
  // dead-letter as a distinct outcome (kept separate from
  // 'invalid-metadata' so dashboards can see the real reason).
  if (isEntryTooLarge(entry, maxPayloadBytes)) {
    moveToDeadLetter(entry, home);
    return { id: entry.id, outcome: 'too-large', payload_size: entry.payloadSize };
  }

  const loaded = loadEntry(entry);
  if (!loaded) {
    // unparseable metadata — move out of pending to avoid infinite churn
    moveToDeadLetter(entry, home);
    return { id: entry.id, outcome: 'invalid-metadata' };
  }

  const result: UploadOutcome = await uploader(
    {
      metadata: loaded.metadata,
      payloadBytes: loaded.payloadBytes,
      endpoint: config.endpoint,
      token: config.token,
      identity: {
        user_id: config.user_id,
        machine_id: config.machine_id,
        consented_at: config.consented_at ?? null,
      },
    },
    { fetchFn },
  );

  return classifyAndAct(entry, loaded, result, home, now());
}

function classifyAndAct(
  entry: QueueEntry,
  loaded: LoadedEntry,
  result: UploadOutcome,
  home: string,
  now: Date,
): CyclePerEntryOutcome {
  switch (result.kind) {
    case 'success': {
      removeEntry(entry);
      return { id: entry.id, outcome: 'uploaded' };
    }
    case 'auth-failed': {
      return { id: entry.id, outcome: 'auth-failed' };
    }
    case 'permanent-failure': {
      moveToDeadLetter(entry, home);
      const out: CyclePerEntryOutcome = {
        id: entry.id,
        outcome: 'dead-letter',
        reason: 'permanent-failure',
        status: result.status,
      };
      if (loaded.metadata.first_failed_at) {
        out.first_failed_at = loaded.metadata.first_failed_at;
      }
      return out;
    }
    case 'transient':
    case 'network-error': {
      // Issue #266 F7: persist first_failed_at on the first transient/network
      // failure so the 24h dead-letter window survives daemon restarts. The
      // metadata write uses temp + rename so an interrupted write never
      // leaves a half-parsed JSON file on disk.
      //
      // Best-effort: if the metadata write itself fails (disk full, EPERM,
      // etc.) we MUST NOT crash the daemon — a thrown error here would
      // bubble all the way through runUploadCycle → mainLoop and kill the
      // process, which the Stop hook would respawn → crash → respawn loop.
      // Instead we keep the in-cycle timestamp for the current outcome and
      // let the next cycle retry the persist.
      let firstFailedAt = loaded.metadata.first_failed_at ?? null;
      if (!firstFailedAt) {
        firstFailedAt = now.toISOString();
        try {
          writeMetadataAtomic(entry.metadataPath, {
            ...loaded.metadata,
            first_failed_at: firstFailedAt,
          });
        } catch {
          // best-effort persist; cycle continues with in-memory timestamp.
        }
      }
      if (shouldDeadLetter(firstFailedAt, now)) {
        moveToDeadLetter(entry, home);
        return {
          id: entry.id,
          outcome: 'dead-letter',
          reason: 'too-old',
          first_failed_at: firstFailedAt,
          status: 'status' in result ? result.status : undefined,
        };
      }
      return {
        id: entry.id,
        outcome: 'transient',
        first_failed_at: firstFailedAt,
        status: 'status' in result ? result.status : undefined,
        error: 'error' in result ? result.error : undefined,
      };
    }
  }
}

export const POLL_INTERVAL_MS = 60_000;
export const IDLE_EXIT_MS = 15 * 60_000;

export interface MainLoopDeps {
  /** Test hook: signals the loop should exit. */
  shouldStop?: () => boolean;
  /** Test hook: replace setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Test hook: replace runUploadCycle. */
  runCycle?: typeof runUploadCycle;
  /** Test hook: capture cycle summaries. */
  onCycle?: (summary: CycleSummary) => void;
  fetchFn?: FetchLike;
  pollIntervalMs?: number;
  idleExitMs?: number;
}

export interface MainLoopExit {
  reason: 'idle' | 'auth-failed' | 'stopped';
}

/**
 * The daemon main loop. Returns when the daemon should exit:
 *   - 'idle': pending/ has been empty for >= idleExitMs
 *   - 'auth-failed': uploader saw 401 — caller should exit non-zero
 *   - 'stopped': test hook requested stop
 */
export async function mainLoop(
  config: DaemonConfig,
  home: string = osHomedir(),
  deps: MainLoopDeps = {},
): Promise<MainLoopExit> {
  const sleep = deps.sleep ?? defaultSleep;
  const runCycle = deps.runCycle ?? runUploadCycle;
  const shouldStop = deps.shouldStop ?? (() => false);
  const pollMs = deps.pollIntervalMs ?? POLL_INTERVAL_MS;
  const idleMs = deps.idleExitMs ?? IDLE_EXIT_MS;

  let idleAccumulatedMs = 0;

  while (!shouldStop()) {
    enforceCapacity(home);

    const summary = await runCycle(config, home, { fetchFn: deps.fetchFn });
    deps.onCycle?.(summary);

    if (summary.authFailed) {
      return { reason: 'auth-failed' };
    }

    if (summary.scanned === 0) {
      idleAccumulatedMs += pollMs;
      if (idleAccumulatedMs >= idleMs) {
        return { reason: 'idle' };
      }
    } else {
      idleAccumulatedMs = 0;
    }

    if (shouldStop()) break;
    await sleep(pollMs);
  }

  return { reason: 'stopped' };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof t === 'object' && t !== null && 'unref' in t) {
      (t as { unref: () => void }).unref();
    }
  });
}
