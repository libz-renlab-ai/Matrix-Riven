/**
 * Issue #283 — hourly-scan scheduler gate + atomic fence write.
 *
 * Two responsibilities, kept here because they go together:
 *
 *   1. Decide whether the hourly flow should fire on this Stop tick
 *      (`shouldRunHourlyScan`, pure) given the last-fired timestamp and a
 *      configurable window.
 *   2. Atomically record that the flow fired (`recordHourlyScanFired`) so
 *      two concurrent Stop hooks racing this code path cannot both win.
 *
 * Pure logic stays pure; filesystem touches accept injected fs hooks via
 * deps so tests stay hermetic.
 */

import {
  existsSync as defaultExistsSync,
  readFileSync as defaultReadFileSync,
  openSync as defaultOpenSync,
  writeSync as defaultWriteSync,
  closeSync as defaultCloseSync,
  mkdirSync as defaultMkdirSync,
  unlinkSync as defaultUnlinkSync,
  writeFileSync as defaultWriteFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

export interface SchedulerReadDeps {
  existsSync?: (p: string) => boolean;
  readFileSync?: (p: string, encoding: 'utf8') => string;
}

export interface SchedulerWriteDeps extends SchedulerReadDeps {
  openSync?: (p: string, flags: string) => number;
  writeSync?: (fd: number, data: string) => void;
  closeSync?: (fd: number) => void;
  mkdirSync?: (p: string, opts: { recursive: true }) => void;
  unlinkSync?: (p: string) => void;
  writeFileSync?: (p: string, data: string) => void;
}

/**
 * Read the last-hourly-scan timestamp from disk. Returns null when the
 * file is missing, unreadable, or doesn't contain a valid ISO date string.
 * Defensive against hand-edited / partially-written fence files.
 */
export function loadLastHourlyScanAt(
  fencePath: string,
  deps: SchedulerReadDeps = {},
): Date | null {
  const ex = deps.existsSync ?? defaultExistsSync;
  const rd = deps.readFileSync ?? defaultReadFileSync;
  if (!ex(fencePath)) return null;
  let raw: string;
  try {
    raw = rd(fencePath, 'utf8');
  } catch {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

/**
 * Pure: should the hourly scan fire now?
 *
 *   - First-ever run (lastScanAt === null)             → true
 *   - Elapsed time >= windowMinutes                    → true
 *   - Clock jumped backwards (lastScanAt > now)        → true (safer to
 *     re-fire than silently sit idle forever waiting for a future fence)
 *   - Otherwise                                        → false
 */
export function shouldRunHourlyScan(args: {
  lastScanAt: Date | null;
  now: Date;
  windowMinutes: number;
}): boolean {
  const { lastScanAt, now, windowMinutes } = args;
  if (lastScanAt === null) return true;
  const elapsedMs = now.getTime() - lastScanAt.getTime();
  if (elapsedMs < 0) return true;
  return elapsedMs >= windowMinutes * 60_000;
}

/**
 * Atomically record "scan fired at <now>" using O_EXCL on a sibling
 * `.lock` file. Two concurrent Stop hooks racing this code path cannot
 * both think they won — the loser gets EEXIST on openSync and returns
 * 'lost-race' without touching the fence file.
 *
 * Sequence:
 *   1. mkdir -p dirname(fencePath)           (best-effort)
 *   2. openSync(`<fence>.lock`, 'wx')        (atomic O_EXCL acquire)
 *   3. writeFile(fencePath, now.toISOString())
 *   4. close + unlink the lock               (best-effort cleanup)
 */
export function recordHourlyScanFired(
  fencePath: string,
  now: Date,
  deps: SchedulerWriteDeps = {},
): 'fired' | 'lost-race' {
  const md = deps.mkdirSync ?? defaultMkdirSync;
  const open = deps.openSync ?? defaultOpenSync;
  const wrFd = deps.writeSync ?? defaultWriteSync;
  const cls = deps.closeSync ?? defaultCloseSync;
  const unl = deps.unlinkSync ?? defaultUnlinkSync;
  const wrFile = deps.writeFileSync ?? defaultWriteFileSync;

  const lockPath = `${fencePath}.lock`;

  // Best-effort parent dir creation. Some failure modes (EACCES on a
  // non-existent path) should not crash the Stop hook — fall through and
  // let openSync error out instead, which we'll treat as lost-race.
  try {
    md(dirname(fencePath), { recursive: true });
  } catch {
    /* best-effort */
  }

  let fd: number;
  try {
    fd = open(lockPath, 'wx');
  } catch {
    return 'lost-race';
  }

  // Stamp the lock file with our pid as a debugging breadcrumb. Not
  // load-bearing — the lock's existence is the mutex, content is just
  // forensics. Failures here must not interrupt the write to fencePath.
  try {
    wrFd(fd, `${process.pid}\n`);
  } catch {
    /* best-effort */
  }

  try {
    wrFile(fencePath, now.toISOString());
  } finally {
    try {
      cls(fd);
    } catch {
      /* best-effort */
    }
    try {
      unl(lockPath);
    } catch {
      /* best-effort — stale .lock files are tolerable; the next caller's
       * openSync will fail with EEXIST and return 'lost-race', which is
       * correct for this rare error path. */
    }
  }

  return 'fired';
}
