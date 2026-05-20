/**
 * `GET /api/client-update-status` — powers the dashboard "🔄 Updates" tab.
 *
 * Joins three live sources at request time (no cache):
 *   - manifest.json (current published version)
 *   - latest cc-status snapshot per user (for `client_version` distribution)
 *   - tail of client-update-errors.jsonl (last 7 days, capped)
 *
 * Computed once per UI refresh — these calls are infrequent (operator-facing).
 */
import { existsSync, openSync, closeSync, fstatSync, readSync, statSync } from 'node:fs';
import { readLatestAllUsers } from '@matrix-riven/shared';
import { readManifestFromDir } from './manifest-route.js';
import { sanitizeErrorReport } from './error-ingest.js';
import type { ClientUpdateErrorReport, ClientUpdateStatus } from './types.js';

const MAX_RECENT_ERRORS = 50;
const MAX_USERS_PER_VERSION_PREVIEW = 10;
/** Tail at most this many lines from errors JSONL. Beyond this an operator wants `grep`, not a UI. */
const MAX_ERROR_LINES_SCAN = 2000;
/** Tail-read window: only the last 1 MiB of the JSONL gets parsed by the UI route. */
const TAIL_BYTES = 1024 * 1024;
/** How far back the "by_stage_24h" + recent-errors window is. */
const ERRORS_WINDOW_MS = 24 * 60 * 60 * 1000;

function tsMs(s: string): number {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Read the tail of a JSONL log without loading the whole file into memory.
 * CTO review: a 30-client deployment over months will grow the file
 * unboundedly; reading the full thing OOMs the collector. We pread() the last
 * 1 MiB from disk and parse only that.
 */
function readErrorsTail(filePath: string): ClientUpdateErrorReport[] {
  if (!existsSync(filePath)) return [];
  let fd: number | null = null;
  try {
    fd = openSync(filePath, 'r');
    const stat = fstatSync(fd);
    const size = stat.size;
    const readLen = Math.min(size, TAIL_BYTES);
    const offset = size - readLen;
    const buf = Buffer.allocUnsafe(readLen);
    if (readLen > 0) {
      readSync(fd, buf, 0, readLen, offset);
    }
    let text = buf.toString('utf8');
    // If we started mid-line (offset > 0), drop the leading partial line.
    if (offset > 0) {
      const nl = text.indexOf('\n');
      if (nl >= 0) text = text.slice(nl + 1);
    }
    const lines = text.split('\n');
    const out: ClientUpdateErrorReport[] = [];
    for (let i = lines.length - 1; i >= 0 && out.length < MAX_ERROR_LINES_SCAN; i--) {
      const line = lines[i];
      if (!line || line.length === 0) continue;
      try {
        const parsed = JSON.parse(line);
        const r = sanitizeErrorReport(parsed);
        if (r !== null) out.push(r);
      } catch {
        // skip malformed lines silently — a partial last line is normal mid-write.
      }
    }
    return out;
  } catch {
    return [];
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

export interface StatusAggregateInputs {
  /** Path to client-latest dir. */
  clientLatestDir: string;
  /** Path to errors JSONL. */
  errorsJsonlPath: string;
  /** Path to the transcripts/cc-status root (`outputDir`). Used to read cc-status. */
  outputDir: string;
  /** Clock for "now". */
  now: Date;
}

export function buildClientUpdateStatus(inputs: StatusAggregateInputs): ClientUpdateStatus {
  // 1. Manifest
  const manifestResult = readManifestFromDir(inputs.clientLatestDir);
  const manifest = 'status' in manifestResult ? null : manifestResult;

  // 2. Distribution from latest cc-status per session, deduped by (user, client_version)
  const userVersionMap = new Map<string, Map<string, true>>(); // version -> set of users
  let allRows: ReturnType<typeof readLatestAllUsers> = [];
  try {
    allRows = readLatestAllUsers(inputs.outputDir, inputs.now);
  } catch {
    allRows = [];
  }
  // For each unique (user, latest version), bucket
  // Per-user latest record: which client_version did THIS user most recently report?
  const userLatestVersion = new Map<string, string>();
  for (const row of allRows) {
    const v = (row.client_version ?? 'unknown') || 'unknown';
    const existing = userLatestVersion.get(row.user_id);
    // Keep freshest by ts
    if (!existing) {
      userLatestVersion.set(row.user_id, v);
    }
    // readLatestAllUsers returns rows sorted by ts desc, so first occurrence is freshest.
  }
  for (const [user, version] of userLatestVersion.entries()) {
    if (!userVersionMap.has(version)) userVersionMap.set(version, new Map());
    userVersionMap.get(version)!.set(user, true);
  }
  const distribution = [...userVersionMap.entries()]
    .map(([version, users]) => ({
      client_version: version,
      user_count: users.size,
      users: [...users.keys()].sort().slice(0, MAX_USERS_PER_VERSION_PREVIEW),
    }))
    .sort((a, b) => b.user_count - a.user_count);

  // 3. Errors
  const allErrors = readErrorsTail(inputs.errorsJsonlPath);
  const nowMs = inputs.now.getTime();
  const cutoff = nowMs - ERRORS_WINDOW_MS;
  const within24h = allErrors.filter((e) => tsMs(e.ts) >= cutoff);
  const byStage: Record<string, number> = {};
  for (const e of within24h) {
    byStage[e.stage] = (byStage[e.stage] ?? 0) + 1;
  }
  // Recent: latest 50 by ts desc
  const recent = [...allErrors]
    .sort((a, b) => tsMs(b.ts) - tsMs(a.ts))
    .slice(0, MAX_RECENT_ERRORS);

  return {
    manifest,
    distribution,
    errors: {
      total_24h: within24h.length,
      by_stage_24h: byStage,
      recent,
    },
  };
}

/** Test-only helper: stat the errors JSONL to confirm growth in integration tests. */
export function errorsFileStat(filePath: string): { exists: boolean; size: number } {
  if (!existsSync(filePath)) return { exists: false, size: 0 };
  try {
    return { exists: true, size: statSync(filePath).size };
  } catch {
    return { exists: true, size: 0 };
  }
}
