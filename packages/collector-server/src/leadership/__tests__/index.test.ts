import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rebuildIndex, loadIndex, appendIndex, loadIndexSync } from '../index.js';

describe('leadership session index (P-D1)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'idx-test-'));
  });

  it('rebuildIndex scans dir and writes .leadership-index.json', async () => {
    writeFileSync(
      join(dir, 'a.json'),
      JSON.stringify({ sessionId: 'a', captured_at: '2026-05-17T00:00:00Z' }),
    );
    writeFileSync(join(dir, 'b.jsonl'), '{"sessionId":"b","ts":"2026-05-17T01:00:00Z"}\n');
    const idx = await rebuildIndex(dir);
    expect(idx.entries.length).toBe(2);
    const loaded = await loadIndex(dir);
    expect(loaded.entries.length).toBe(2);
  });

  it('loadIndex returns empty if missing', async () => {
    const idx = await loadIndex(dir);
    expect(idx.entries).toEqual([]);
  });

  it('appendIndex is idempotent on sessionId', async () => {
    await rebuildIndex(dir);
    await appendIndex(dir, {
      sessionId: 'c',
      file: 'c.json',
      mtime: 100,
      capturedAt: '2026-05-17T02:00:00Z',
    });
    await appendIndex(dir, {
      sessionId: 'c',
      file: 'c.json',
      mtime: 100,
      capturedAt: '2026-05-17T02:00:00Z',
    });
    const idx = await loadIndex(dir);
    expect(idx.entries.filter((e) => e.sessionId === 'c').length).toBe(1);
  });

  it('loadIndexSync mirrors loadIndex (empty + populated)', async () => {
    expect(loadIndexSync(dir).entries).toEqual([]);
    writeFileSync(
      join(dir, 'a.json'),
      JSON.stringify({ sessionId: 'a', captured_at: '2026-05-17T00:00:00Z' }),
    );
    await rebuildIndex(dir);
    const sync = loadIndexSync(dir);
    expect(sync.entries.length).toBe(1);
    expect(sync.entries[0]!.sessionId).toBe('a');
  });

  it('rebuildIndex skips .leadership-index.json itself', async () => {
    writeFileSync(join(dir, '.leadership-index.json'), '{}');
    writeFileSync(
      join(dir, 'real.json'),
      JSON.stringify({ sessionId: 'real', captured_at: '2026-05-17T00:00:00Z' }),
    );
    const idx = await rebuildIndex(dir);
    expect(idx.entries.length).toBe(1);
    expect(idx.entries[0]!.sessionId).toBe('real');
  });
});
