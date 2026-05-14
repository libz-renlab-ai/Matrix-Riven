/**
 * Issue #283 — incremental upload planner for the hourly digital-twin scan.
 *
 * Three responsibilities, all thin & test-friendly:
 *
 *   1. Walk `~/.claude/projects/<sanitized-cwd>/<session-id>.jsonl` two
 *      levels deep and produce a flat list of LocalSession entries with
 *      mtime preserved (filesystem-touching; deps injected for tests).
 *   2. Filter that list down to a single UTC day boundary (pure).
 *   3. Compute the diff against the set of session IDs the collector
 *      already has for this user/date — `local ∖ serverKnown` — and
 *      return it deduped + sorted ascending (pure).
 *
 * The walker is best-effort: any project subdir whose `readdirSync` throws
 * (permission denied, race with a deletion, etc.) is skipped rather than
 * propagated, so a single bad dir doesn't take down the scan.
 */

import {
  existsSync as defaultExistsSync,
  readdirSync as defaultReaddirSync,
  statSync as defaultStatSync,
} from 'node:fs';
import { join } from 'node:path';

export interface LocalSession {
  /** Absolute path to the transcript jsonl. */
  transcriptPath: string;
  /** session_id parsed from filename (basename without `.jsonl`). */
  sessionId: string;
  /** File mtime in unix ms — used to filter to "today". */
  mtimeMs: number;
}

export interface ScanLocalDeps {
  existsSync?: (p: string) => boolean;
  readdirSync?: (p: string) => string[];
  statSync?: (p: string) => { mtimeMs: number; isFile: () => boolean };
}

/**
 * Walk `~/.claude/projects/` two levels (project dir → jsonl files).
 * Filters to files with `.jsonl` suffix only. Returns LocalSession[]
 * with mtime preserved. Best-effort: dirs that fail to read are skipped.
 */
export function listLocalSessions(
  home: string,
  deps?: ScanLocalDeps,
): LocalSession[] {
  const existsSync = deps?.existsSync ?? defaultExistsSync;
  const readdirSync = deps?.readdirSync ?? defaultReaddirSync;
  const statSync = deps?.statSync ?? defaultStatSync;

  const projectsDir = join(home, '.claude', 'projects');
  if (!existsSync(projectsDir)) {
    return [];
  }

  let projectDirs: string[];
  try {
    projectDirs = readdirSync(projectsDir);
  } catch {
    return [];
  }

  const results: LocalSession[] = [];
  for (const projectName of projectDirs) {
    const projectPath = join(projectsDir, projectName);
    let entries: string[];
    try {
      entries = readdirSync(projectPath);
    } catch {
      // Permission denied / race with delete / not a directory — skip.
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) {
        continue;
      }
      const transcriptPath = join(projectPath, entry);
      let stat: { mtimeMs: number; isFile: () => boolean };
      try {
        stat = statSync(transcriptPath);
      } catch {
        continue;
      }
      if (!stat.isFile()) {
        continue;
      }
      const sessionId = entry.slice(0, -'.jsonl'.length);
      results.push({
        transcriptPath,
        sessionId,
        mtimeMs: stat.mtimeMs,
      });
    }
  }
  return results;
}

/**
 * Compute the [start, endExclusive) unix-ms boundaries for a UTC date
 * string (YYYY-MM-DD). End is the start of the *next* UTC day.
 */
function utcDayBoundsMs(utcDate: string): { startMs: number; endMs: number } {
  // Parse YYYY-MM-DD as a UTC midnight. Date.UTC is tz-safe.
  const parts = utcDate.split('-').map((s) => Number.parseInt(s, 10));
  const yyyy = parts[0] ?? 0;
  const mm = parts[1] ?? 1;
  const dd = parts[2] ?? 1;
  const startMs = Date.UTC(yyyy, mm - 1, dd, 0, 0, 0, 0);
  const endMs = startMs + 24 * 60 * 60 * 1000;
  return { startMs, endMs };
}

/**
 * Filter a LocalSession[] to those whose mtime falls within the given
 * UTC date string (YYYY-MM-DD) — pure function. The window is
 * half-open: [00:00:00.000 UTC, 00:00:00.000 next-day UTC).
 */
export function filterToUtcDate(
  sessions: LocalSession[],
  utcDate: string,
): LocalSession[] {
  const { startMs, endMs } = utcDayBoundsMs(utcDate);
  return sessions.filter((s) => s.mtimeMs >= startMs && s.mtimeMs < endMs);
}

/**
 * Pure: compute the set of session IDs we should upload now.
 *   local ∖ serverKnown  →  ascending lexicographic order
 *
 * `serverKnown` is the set of session IDs the collector already has
 * for this user/date (from GET /api/sessions). Dedupes locally first
 * (same session may appear under multiple project dirs).
 */
export function planIncrementalUpload(args: {
  localSessions: LocalSession[];
  serverKnownIds: ReadonlySet<string>;
}): string[] {
  const { localSessions, serverKnownIds } = args;
  const locallySeen = new Set<string>();
  for (const s of localSessions) {
    locallySeen.add(s.sessionId);
  }
  const diff: string[] = [];
  for (const id of locallySeen) {
    if (!serverKnownIds.has(id)) {
      diff.push(id);
    }
  }
  diff.sort();
  return diff;
}
