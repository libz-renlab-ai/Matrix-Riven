import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  listLocalSessions,
  filterToUtcDate,
  planIncrementalUpload,
  type LocalSession,
  type ScanLocalDeps,
} from '../scan.js';

/**
 * Build a fake fs deps trio backed by a flat map.
 *
 *   directories: path → list of immediate children (basenames)
 *   files:       path → mtimeMs ; presence here means `isFile() === true`
 *
 * Any path that throws is registered via `dirsThatThrow`. We treat any
 * path present in `directories` or `files` as "exists", to keep
 * existsSync logic boring.
 */
function makeFakeFs(opts: {
  directories: Record<string, string[]>;
  files: Record<string, number>;
  dirsThatThrow?: Set<string>;
}): ScanLocalDeps {
  const { directories, files, dirsThatThrow } = opts;
  return {
    existsSync: (p: string) => {
      return p in directories || p in files;
    },
    readdirSync: (p: string) => {
      if (dirsThatThrow?.has(p)) {
        throw new Error(`EACCES: ${p}`);
      }
      const entries = directories[p];
      if (entries === undefined) {
        throw new Error(`ENOTDIR: ${p}`);
      }
      return entries;
    },
    statSync: (p: string) => {
      const mtimeMs = files[p];
      if (mtimeMs === undefined) {
        // Treat unknown paths or directories as non-files for the walker.
        return {
          mtimeMs: 0,
          isFile: () => false,
        };
      }
      return {
        mtimeMs,
        isFile: () => true,
      };
    },
  };
}

describe('incremental/scan', () => {
  describe('listLocalSessions()', () => {
    it('empty home (no .claude/projects/) returns []', () => {
      const deps = makeFakeFs({ directories: {}, files: {} });
      expect(listLocalSessions('/home/u', deps)).toEqual([]);
    });

    it('walks two project dirs and three jsonl files', () => {
      const projectsDir = join('/home/u', '.claude', 'projects');
      const projA = join(projectsDir, 'projA');
      const projB = join(projectsDir, 'projB');
      const fileA1 = join(projA, 'sess-1.jsonl');
      const fileA2 = join(projA, 'sess-2.jsonl');
      const fileB1 = join(projB, 'sess-3.jsonl');
      const deps = makeFakeFs({
        directories: {
          [projectsDir]: ['projA', 'projB'],
          [projA]: ['sess-1.jsonl', 'sess-2.jsonl'],
          [projB]: ['sess-3.jsonl'],
        },
        files: {
          [fileA1]: 1_000,
          [fileA2]: 2_000,
          [fileB1]: 3_000,
        },
      });
      const got = listLocalSessions('/home/u', deps);
      expect(got).toHaveLength(3);
      // Order is not guaranteed across project dirs, so check by content.
      const byId = new Map(got.map((s) => [s.sessionId, s]));
      expect(byId.get('sess-1')).toEqual({
        transcriptPath: fileA1,
        sessionId: 'sess-1',
        mtimeMs: 1_000,
      });
      expect(byId.get('sess-2')).toEqual({
        transcriptPath: fileA2,
        sessionId: 'sess-2',
        mtimeMs: 2_000,
      });
      expect(byId.get('sess-3')).toEqual({
        transcriptPath: fileB1,
        sessionId: 'sess-3',
        mtimeMs: 3_000,
      });
    });

    it('skips non-jsonl entries (.DS_Store, .txt, dotfiles)', () => {
      const projectsDir = join('/home/u', '.claude', 'projects');
      const projA = join(projectsDir, 'projA');
      const realFile = join(projA, 'sess-1.jsonl');
      const deps = makeFakeFs({
        directories: {
          [projectsDir]: ['projA'],
          [projA]: ['.DS_Store', 'notes.txt', 'sess-1.jsonl', 'README.md'],
        },
        files: {
          [realFile]: 5_000,
        },
      });
      const got = listLocalSessions('/home/u', deps);
      expect(got).toHaveLength(1);
      expect(got[0]?.sessionId).toBe('sess-1');
    });

    it('skips project subdirs that throw on readdirSync (does not crash)', () => {
      const projectsDir = join('/home/u', '.claude', 'projects');
      const projOk = join(projectsDir, 'projOk');
      const projBad = join(projectsDir, 'projBad');
      const okFile = join(projOk, 'sess-1.jsonl');
      const deps = makeFakeFs({
        directories: {
          [projectsDir]: ['projOk', 'projBad'],
          [projOk]: ['sess-1.jsonl'],
          // projBad intentionally absent from `directories`, but listed
          // in `dirsThatThrow` so readdir throws EACCES.
        },
        files: {
          [okFile]: 1_234,
        },
        dirsThatThrow: new Set([projBad]),
      });
      const got = listLocalSessions('/home/u', deps);
      expect(got).toHaveLength(1);
      expect(got[0]?.sessionId).toBe('sess-1');
    });
  });

  describe('filterToUtcDate()', () => {
    it('filters to a single UTC day boundary (timestamps spanning the day)', () => {
      const dayStart = Date.UTC(2026, 4, 11, 0, 0, 0, 0); // 2026-05-11 00:00 UTC
      const dayMid = Date.UTC(2026, 4, 11, 14, 30, 0, 0);
      const beforeDay = dayStart - 60_000;
      const afterDay = dayStart + 24 * 60 * 60 * 1000 + 60_000;
      const sessions: LocalSession[] = [
        { transcriptPath: '/p/a.jsonl', sessionId: 'a', mtimeMs: beforeDay },
        { transcriptPath: '/p/b.jsonl', sessionId: 'b', mtimeMs: dayStart },
        { transcriptPath: '/p/c.jsonl', sessionId: 'c', mtimeMs: dayMid },
        { transcriptPath: '/p/d.jsonl', sessionId: 'd', mtimeMs: afterDay },
      ];
      const got = filterToUtcDate(sessions, '2026-05-11');
      expect(got.map((s) => s.sessionId)).toEqual(['b', 'c']);
    });

    it('day boundaries are half-open: [00:00 inclusive, next-day 00:00 exclusive)', () => {
      const dayStart = Date.UTC(2026, 4, 11, 0, 0, 0, 0);
      const dayEnd = Date.UTC(2026, 4, 11, 23, 59, 59, 999);
      const nextDayStart = Date.UTC(2026, 4, 12, 0, 0, 0, 0);
      const sessions: LocalSession[] = [
        { transcriptPath: '/p/s.jsonl', sessionId: 'start', mtimeMs: dayStart },
        { transcriptPath: '/p/e.jsonl', sessionId: 'end', mtimeMs: dayEnd },
        { transcriptPath: '/p/n.jsonl', sessionId: 'next', mtimeMs: nextDayStart },
      ];
      const got = filterToUtcDate(sessions, '2026-05-11');
      expect(got.map((s) => s.sessionId)).toEqual(['start', 'end']);
    });

    it('empty input → empty output', () => {
      expect(filterToUtcDate([], '2026-05-11')).toEqual([]);
    });
  });

  describe('planIncrementalUpload()', () => {
    function mkSession(id: string, path = `/p/${id}.jsonl`): LocalSession {
      return { transcriptPath: path, sessionId: id, mtimeMs: 0 };
    }

    it('all new (server empty) → returns all session IDs ascending', () => {
      const got = planIncrementalUpload({
        localSessions: [mkSession('zeta'), mkSession('alpha'), mkSession('mu')],
        serverKnownIds: new Set<string>(),
      });
      expect(got).toEqual(['alpha', 'mu', 'zeta']);
    });

    it('all known → returns empty', () => {
      const got = planIncrementalUpload({
        localSessions: [mkSession('a'), mkSession('b')],
        serverKnownIds: new Set(['a', 'b']),
      });
      expect(got).toEqual([]);
    });

    it('partial overlap → returns only the diff (ascending)', () => {
      const got = planIncrementalUpload({
        localSessions: [
          mkSession('a'),
          mkSession('b'),
          mkSession('c'),
          mkSession('d'),
        ],
        serverKnownIds: new Set(['b', 'd']),
      });
      expect(got).toEqual(['a', 'c']);
    });

    it('local has duplicates (same sessionId in multiple project dirs) → dedupes before returning', () => {
      const got = planIncrementalUpload({
        localSessions: [
          mkSession('dup', '/p/projA/dup.jsonl'),
          mkSession('dup', '/p/projB/dup.jsonl'),
          mkSession('uniq', '/p/projA/uniq.jsonl'),
        ],
        serverKnownIds: new Set<string>(),
      });
      expect(got).toEqual(['dup', 'uniq']);
    });
  });
});
