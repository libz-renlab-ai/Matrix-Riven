import { describe, it, expect, beforeEach } from 'vitest';
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  utimesSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ulid } from 'ulid';
import {
  listPending,
  loadEntry,
  removeEntry,
  moveToDeadLetter,
  enforceCapacity,
  isEntryTooLarge,
  DEFAULT_QUEUE_CAPACITY_BYTES,
} from '../queue.js';
import { MAX_PAYLOAD_BYTES, digitalTwinPaths } from '@matrix-riven/shared';
import type { CcSessionMetadata } from '@matrix-riven/shared';

function freshHome(): string {
  const home = join(tmpdir(), `dt-q-${ulid()}`);
  mkdirSync(home, { recursive: true });
  return home;
}

function metaForId(id: string): CcSessionMetadata {
  return {
    id,
    kind: 'cc-session',
    session_id: `sess-${id}`,
    cwd: '/proj',
    project_name: 'proj',
    transcript_path: '/x',
    payload_size: 4,
    captured_at: '2026-05-08T00:00:00Z',
    source: 'stop-hook',
    host: { os: 'linux', arch: 'x64', hostname: 'h' },
    teamagent_version: '0.0.0',
    schema_version: 1,
  };
}

function writeEntry(home: string, id: string, payload: string, mtime?: Date): void {
  const paths = digitalTwinPaths(home);
  mkdirSync(paths.pendingDir, { recursive: true });
  const payloadPath = join(paths.pendingDir, `${id}.payload`);
  const metadataPath = join(paths.pendingDir, `${id}.json`);
  writeFileSync(payloadPath, payload, 'utf-8');
  writeFileSync(metadataPath, JSON.stringify(metaForId(id)), 'utf-8');
  if (mtime) {
    utimesSync(payloadPath, mtime, mtime);
    utimesSync(metadataPath, mtime, mtime);
  }
}

describe('listPending', () => {
  let home: string;
  beforeEach(() => {
    home = freshHome();
  });

  it('returns empty when pending/ does not exist', () => {
    expect(listPending(home)).toEqual([]);
  });

  it('returns paired entries', () => {
    writeEntry(home, 'a', 'AAA');
    writeEntry(home, 'b', 'BBB');
    const got = listPending(home);
    expect(got.map((e) => e.id).sort()).toEqual(['a', 'b']);
    expect(got[0]!.payloadPath.endsWith('.payload')).toBe(true);
    expect(got[0]!.metadataPath.endsWith('.json')).toBe(true);
  });

  it('skips entries missing one half of the pair', () => {
    const paths = digitalTwinPaths(home);
    mkdirSync(paths.pendingDir, { recursive: true });
    // payload-only
    writeFileSync(join(paths.pendingDir, 'lonely.payload'), 'x', 'utf-8');
    // metadata-only
    writeFileSync(join(paths.pendingDir, 'orphan.json'), '{}', 'utf-8');
    expect(listPending(home)).toEqual([]);
  });

  it('sorts by mtime ASC (oldest first)', () => {
    writeEntry(home, 'newest', 'x', new Date('2026-05-08T03:00:00Z'));
    writeEntry(home, 'middle', 'x', new Date('2026-05-08T02:00:00Z'));
    writeEntry(home, 'oldest', 'x', new Date('2026-05-08T01:00:00Z'));
    const got = listPending(home);
    expect(got.map((e) => e.id)).toEqual(['oldest', 'middle', 'newest']);
  });
});

describe('loadEntry', () => {
  it('returns payload bytes + parsed metadata', () => {
    const home = freshHome();
    writeEntry(home, 'load-1', 'hello');
    const [e] = listPending(home);
    if (!e) throw new Error('expected entry');
    const loaded = loadEntry(e);
    expect(loaded).not.toBeNull();
    expect(loaded!.payloadBytes.toString('utf-8')).toBe('hello');
    expect(loaded!.metadata.id).toBe('load-1');
  });

  it('returns null when metadata JSON is invalid', () => {
    const home = freshHome();
    const paths = digitalTwinPaths(home);
    mkdirSync(paths.pendingDir, { recursive: true });
    writeFileSync(join(paths.pendingDir, 'bad.payload'), 'x', 'utf-8');
    writeFileSync(join(paths.pendingDir, 'bad.json'), 'not-json', 'utf-8');
    const [e] = listPending(home);
    if (!e) throw new Error('expected entry');
    expect(loadEntry(e)).toBeNull();
  });

  it('returns null when metadata fails type guard', () => {
    const home = freshHome();
    const paths = digitalTwinPaths(home);
    mkdirSync(paths.pendingDir, { recursive: true });
    writeFileSync(join(paths.pendingDir, 'wrong.payload'), 'x', 'utf-8');
    writeFileSync(join(paths.pendingDir, 'wrong.json'), JSON.stringify({ id: 1 }), 'utf-8');
    const [e] = listPending(home);
    if (!e) throw new Error('expected entry');
    expect(loadEntry(e)).toBeNull();
  });
});

describe('removeEntry', () => {
  it('unlinks both payload and metadata', () => {
    const home = freshHome();
    writeEntry(home, 'rm-1', 'x');
    const [e] = listPending(home);
    if (!e) throw new Error('expected entry');
    expect(existsSync(e.payloadPath)).toBe(true);
    removeEntry(e);
    expect(existsSync(e.payloadPath)).toBe(false);
    expect(existsSync(e.metadataPath)).toBe(false);
  });

  it('does not throw if files already gone', () => {
    const home = freshHome();
    writeEntry(home, 'rm-2', 'x');
    const [e] = listPending(home);
    if (!e) throw new Error('expected entry');
    removeEntry(e);
    expect(() => removeEntry(e)).not.toThrow();
  });
});

describe('moveToDeadLetter', () => {
  it('moves both files into dead-letter/', () => {
    const home = freshHome();
    writeEntry(home, 'dl-1', 'x');
    const [e] = listPending(home);
    if (!e) throw new Error('expected entry');
    moveToDeadLetter(e, home);

    const paths = digitalTwinPaths(home);
    expect(existsSync(e.payloadPath)).toBe(false);
    expect(existsSync(e.metadataPath)).toBe(false);
    expect(existsSync(join(paths.deadLetterDir, 'dl-1.payload'))).toBe(true);
    expect(existsSync(join(paths.deadLetterDir, 'dl-1.json'))).toBe(true);
    const dlMeta = JSON.parse(
      readFileSync(join(paths.deadLetterDir, 'dl-1.json'), 'utf-8'),
    );
    expect(dlMeta.id).toBe('dl-1');
  });
});

describe('enforceCapacity', () => {
  it('returns empty when total bytes <= maxBytes', () => {
    const home = freshHome();
    writeEntry(home, 'a', 'x'.repeat(100));
    expect(enforceCapacity(home, 1_000_000)).toEqual([]);
  });

  it('deletes oldest files until under limit', () => {
    const home = freshHome();
    writeEntry(home, 'old', 'x'.repeat(200), new Date('2026-05-01T00:00:00Z'));
    writeEntry(home, 'mid', 'x'.repeat(200), new Date('2026-05-02T00:00:00Z'));
    writeEntry(home, 'new', 'x'.repeat(200), new Date('2026-05-03T00:00:00Z'));

    const deleted = enforceCapacity(home, 800); // total ~ 1200 bytes (3*200 payload + small metadata)
    // Should delete at least 'old' first.
    expect(deleted.length).toBeGreaterThan(0);
    expect(deleted[0]).toMatch(/old\.(payload|json)/);
  });

  it('default capacity is 5000 MB', () => {
    expect(DEFAULT_QUEUE_CAPACITY_BYTES).toBe(5000 * 1024 * 1024);
  });

  // Issue #266 F5 — pair-aware deletion + orphan tolerance.
  describe('issue #266 F5: pair-aware', () => {
    it('removes the entire <id> pair atomically (no orphans left behind)', () => {
      const home = freshHome();
      writeEntry(home, 'old', 'x'.repeat(500), new Date('2026-05-01T00:00:00Z'));
      writeEntry(home, 'new', 'x'.repeat(500), new Date('2026-05-02T00:00:00Z'));

      enforceCapacity(home, 700); // forces eviction of at least one pair

      const paths = digitalTwinPaths(home);
      const oldPayload = join(paths.pendingDir, 'old.payload');
      const oldMeta = join(paths.pendingDir, 'old.json');
      // The oldest pair must be deleted *together* — never one half without the other.
      expect(existsSync(oldPayload)).toBe(existsSync(oldMeta));
    });

    it('leaves zero orphans across pending/ + dead-letter/ after eviction', () => {
      const home = freshHome();
      // Three pairs in pending/, plenty over budget.
      writeEntry(home, 'p1', 'x'.repeat(400), new Date('2026-05-01T00:00:00Z'));
      writeEntry(home, 'p2', 'x'.repeat(400), new Date('2026-05-02T00:00:00Z'));
      writeEntry(home, 'p3', 'x'.repeat(400), new Date('2026-05-03T00:00:00Z'));

      enforceCapacity(home, 500); // keep only the newest pair

      const paths = digitalTwinPaths(home);
      const names = readdirSync(paths.pendingDir);
      const payloadIds = names
        .filter((n) => n.endsWith('.payload'))
        .map((n) => n.slice(0, -'.payload'.length))
        .sort();
      const metaIds = names
        .filter((n) => n.endsWith('.json'))
        .map((n) => n.slice(0, -'.json'.length))
        .sort();
      expect(payloadIds).toEqual(metaIds);
    });

    it('tolerates pre-existing orphans (from older daemon versions)', () => {
      const home = freshHome();
      const paths = digitalTwinPaths(home);
      mkdirSync(paths.pendingDir, { recursive: true });
      // Half-pair from an older buggy run: payload without metadata.
      writeFileSync(join(paths.pendingDir, 'lonely.payload'), 'x'.repeat(1000), 'utf-8');
      utimesSync(
        join(paths.pendingDir, 'lonely.payload'),
        new Date('2026-04-01T00:00:00Z'),
        new Date('2026-04-01T00:00:00Z'),
      );
      writeEntry(home, 'fresh', 'x'.repeat(400), new Date('2026-05-01T00:00:00Z'));

      expect(() => enforceCapacity(home, 500)).not.toThrow();
      // The oldest unit — the orphan — must be evicted first.
      expect(existsSync(join(paths.pendingDir, 'lonely.payload'))).toBe(false);
    });

    it('evicts oldest pair first (sorted by oldest mtime across the pair)', () => {
      const home = freshHome();
      writeEntry(home, 'A', 'x'.repeat(500), new Date('2026-05-01T00:00:00Z'));
      writeEntry(home, 'B', 'x'.repeat(500), new Date('2026-05-02T00:00:00Z'));
      writeEntry(home, 'C', 'x'.repeat(500), new Date('2026-05-03T00:00:00Z'));

      const deleted = enforceCapacity(home, 1100);
      // Should evict 'A' (oldest pair) first; both its files appear in the deletion list.
      const paths = digitalTwinPaths(home);
      const deletedA = deleted.filter((p) =>
        p === join(paths.pendingDir, 'A.payload') ||
        p === join(paths.pendingDir, 'A.json'),
      );
      expect(deletedA.length).toBe(2);
    });
  });
});

// Issue #266 F8 — payload-size predicate.
describe('isEntryTooLarge (issue #266 F8)', () => {
  it('returns false when payloadSize is at or below the cap', () => {
    const home = freshHome();
    writeEntry(home, 'small', 'x'.repeat(10));
    const [e] = listPending(home);
    if (!e) throw new Error('expected entry');
    expect(isEntryTooLarge(e, 1024)).toBe(false);
  });

  it('returns true when payloadSize exceeds the cap', () => {
    const home = freshHome();
    writeEntry(home, 'big', 'x'.repeat(2048));
    const [e] = listPending(home);
    if (!e) throw new Error('expected entry');
    expect(isEntryTooLarge(e, 1024)).toBe(true);
  });

  it('defaults to MAX_PAYLOAD_BYTES (100MB) when no override is passed', () => {
    expect(MAX_PAYLOAD_BYTES).toBe(100 * 1024 * 1024);
    const home = freshHome();
    writeEntry(home, 'small', 'x'.repeat(10));
    const [e] = listPending(home);
    if (!e) throw new Error('expected entry');
    expect(isEntryTooLarge(e)).toBe(false);
  });
});
