/**
 * Queue operations for the digital-twin uploader daemon.
 *
 * Layout under `<dataRootDir>/digital-twin/queue/`:
 *   pending/<ulid>.payload  + <ulid>.json
 *   dead-letter/<ulid>.payload + <ulid>.json
 *   recording_temp/         (PR-4)
 *
 * tap-session writes payload+metadata pairs into pending/. The daemon scans
 * pending/ on each tick, uploads, and either unlinks (success), retries
 * (transient failure), or moves to dead-letter once 24h has elapsed since
 * the entry's persisted `first_failed_at` (issue #266 F7).
 */
import {
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  renameSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import path from 'node:path';
import { homedir as osHomedir } from 'node:os';
import { digitalTwinPaths, type DigitalTwinPaths, MAX_PAYLOAD_BYTES, isCcSessionMetadata, type CcSessionMetadata, isRecordingMetadata, type RecordingMetadata } from '@matrix-riven/shared';

export const DEFAULT_QUEUE_CAPACITY_BYTES = 5_000 * 1024 * 1024; // 5000 MB

export interface QueueEntry {
  id: string;
  payloadPath: string;
  metadataPath: string;
  mtimeMs: number;
  payloadSize: number;
  metadataSize: number;
}

/**
 * Issue #146 F3: a pending queue entry is now polymorphic over kind. The
 * daemon dispatches uploader endpoint + envelope builder based on
 * `metadata.kind`; loadEntry validates either shape and returns the
 * matching tagged metadata.
 */
export type LoadedEntryMetadata = CcSessionMetadata | RecordingMetadata;

export interface LoadedEntry {
  entry: QueueEntry;
  payloadBytes: Buffer;
  metadata: LoadedEntryMetadata;
}

function getPaths(home: string): DigitalTwinPaths {
  return digitalTwinPaths(home);
}

function safeStat(p: string): { mtimeMs: number; size: number } | null {
  try {
    const s = statSync(p);
    return { mtimeMs: s.mtimeMs, size: s.size };
  } catch {
    return null;
  }
}

/**
 * List queue entries in `pending/` sorted by metadata mtime ASC (oldest first).
 * An entry is only listed when BOTH `<id>.payload` and `<id>.json` exist —
 * partial pairs (mid-write) are skipped this tick and picked up next time.
 */
export function listPending(home: string = osHomedir()): QueueEntry[] {
  const paths = getPaths(home);
  if (!existsSync(paths.pendingDir)) return [];

  const names = readdirSync(paths.pendingDir);
  const ids = new Set<string>();
  for (const n of names) {
    if (n.endsWith('.payload')) ids.add(n.slice(0, -'.payload'.length));
    else if (n.endsWith('.json')) ids.add(n.slice(0, -'.json'.length));
  }

  const out: QueueEntry[] = [];
  for (const id of ids) {
    const payloadPath = path.join(paths.pendingDir, `${id}.payload`);
    const metadataPath = path.join(paths.pendingDir, `${id}.json`);
    const ps = safeStat(payloadPath);
    const ms = safeStat(metadataPath);
    if (!ps || !ms) continue; // partial pair
    out.push({
      id,
      payloadPath,
      metadataPath,
      mtimeMs: ms.mtimeMs,
      payloadSize: ps.size,
      metadataSize: ms.size,
    });
  }
  out.sort((a, b) => a.mtimeMs - b.mtimeMs);
  return out;
}

/**
 * Issue #266 F8 — payload-size guard.
 *
 * True if the entry's on-disk payload exceeds the daemon's hard size
 * cap. The daemon calls this before `loadEntry` so an oversize file
 * never gets `readFileSync`-ed into RAM. The caller is expected to move
 * the entry to dead-letter so it does not get retried indefinitely.
 */
export function isEntryTooLarge(
  entry: QueueEntry,
  maxBytes: number = MAX_PAYLOAD_BYTES,
): boolean {
  return entry.payloadSize > maxBytes;
}

/** Load a queue entry's payload bytes + parsed metadata. Returns null if metadata is invalid. */
export function loadEntry(entry: QueueEntry): LoadedEntry | null {
  let payloadBytes: Buffer;
  try {
    payloadBytes = readFileSync(entry.payloadPath);
  } catch {
    return null;
  }
  let metadataRaw: string;
  try {
    metadataRaw = readFileSync(entry.metadataPath, 'utf-8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadataRaw);
  } catch {
    return null;
  }
  // Issue #146 F3: kind-aware validation. cc-session and recording metadata
  // share the on-disk pair shape (<id>.payload + <id>.json) but use distinct
  // schemas; loadEntry accepts either.
  if (isCcSessionMetadata(parsed)) {
    return { entry, payloadBytes, metadata: parsed };
  }
  if (isRecordingMetadata(parsed)) {
    return { entry, payloadBytes, metadata: parsed };
  }
  return null;
}

/**
 * Issue #266 F7 — atomically replace a queue entry's `.json` metadata file.
 *
 * The daemon scans `pending/` every 60s, so an interrupted write would
 * leave a half-written JSON document and `loadEntry` would falsely
 * dead-letter the entry for "invalid metadata" on the next tick. The
 * temp + rename pattern is atomic on every filesystem we ship to.
 */
export function writeMetadataAtomic(
  metadataPath: string,
  metadata: LoadedEntryMetadata,
): void {
  const tmp = `${metadataPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(metadata, null, 2), 'utf-8');
  renameSync(tmp, metadataPath);
}

/** Delete payload + metadata after successful upload. */
export function removeEntry(entry: QueueEntry): void {
  for (const p of [entry.payloadPath, entry.metadataPath]) {
    try {
      unlinkSync(p);
    } catch {
      // best-effort
    }
  }
}

/** Move payload + metadata into `dead-letter/`. */
export function moveToDeadLetter(entry: QueueEntry, home: string = osHomedir()): void {
  const paths = getPaths(home);
  mkdirSync(paths.deadLetterDir, { recursive: true });
  for (const src of [entry.payloadPath, entry.metadataPath]) {
    const base = path.basename(src);
    const dst = path.join(paths.deadLetterDir, base);
    try {
      renameSync(src, dst);
    } catch {
      // Cross-device or Windows lock — try copy + unlink fallback omitted for brevity;
      // best-effort: leave the file in pending/ and log via caller.
    }
  }
}

interface CapacityUnit {
  /** 1 or 2 absolute file paths forming an `<id>` pair (payload + metadata), or an orphan singleton. */
  paths: string[];
  /** Sum of file sizes in this unit. */
  totalSize: number;
  /** Smallest mtime among the unit's files — used for FIFO eviction. */
  oldestMtimeMs: number;
}

/**
 * Enforce queue capacity: when pending/ + dead-letter/ total bytes exceed
 * `maxBytes`, delete the oldest `<id>` pairs (by oldest mtime in the pair)
 * until under the limit.
 *
 * Issue #266 F5: deletion is **pair-aware**. The pre-F5 implementation
 * iterated raw files and could unlink an `<id>.payload` while leaving the
 * matching `<id>.json` behind (or vice-versa), producing orphans that
 * later daemon ticks would skip via `listPending` but never reap.
 * The new logic groups files by `<id>` stem inside each directory and
 * deletes every file in the pair atomically. Pre-existing orphans from
 * older daemon versions are treated as their own one-file unit and
 * remain deletable.
 *
 * Returns the list of paths that were deleted (in deletion order).
 */
export function enforceCapacity(
  home: string = osHomedir(),
  maxBytes: number = DEFAULT_QUEUE_CAPACITY_BYTES,
): string[] {
  const paths = getPaths(home);
  const units: CapacityUnit[] = [];

  for (const dir of [paths.pendingDir, paths.deadLetterDir]) {
    if (!existsSync(dir)) continue;
    const idToFiles = new Map<string, string[]>();
    for (const n of readdirSync(dir)) {
      let id: string;
      if (n.endsWith('.payload')) id = n.slice(0, -'.payload'.length);
      else if (n.endsWith('.json')) id = n.slice(0, -'.json'.length);
      else continue;
      const abs = path.join(dir, n);
      const list = idToFiles.get(id);
      if (list) list.push(abs);
      else idToFiles.set(id, [abs]);
    }
    for (const filesForId of idToFiles.values()) {
      let totalSize = 0;
      let oldestMtimeMs = Number.POSITIVE_INFINITY;
      for (const abs of filesForId) {
        const s = safeStat(abs);
        if (!s) continue;
        totalSize += s.size;
        if (s.mtimeMs < oldestMtimeMs) oldestMtimeMs = s.mtimeMs;
      }
      if (!Number.isFinite(oldestMtimeMs)) continue;
      units.push({ paths: filesForId, totalSize, oldestMtimeMs });
    }
  }

  let total = units.reduce((acc, u) => acc + u.totalSize, 0);
  if (total <= maxBytes) return [];

  units.sort((a, b) => a.oldestMtimeMs - b.oldestMtimeMs);
  const deleted: string[] = [];
  for (const u of units) {
    if (total <= maxBytes) break;
    for (const p of u.paths) {
      try {
        unlinkSync(p);
        deleted.push(p);
      } catch {
        // best-effort: a single locked file must not strand its sibling.
      }
    }
    total -= u.totalSize;
  }
  return deleted;
}
