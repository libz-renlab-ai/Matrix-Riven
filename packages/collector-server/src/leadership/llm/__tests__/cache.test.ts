import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, appendFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LlmCache } from '../cache.js';

async function makeTmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'llm-cache-test-'));
}

describe('LlmCache', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTmpDir();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it('loads cleanly when file is missing and reports zero entries', async () => {
    const file = join(dir, 'nested', 'sub', `${randomUUID()}.jsonl`);
    const c = new LlmCache(file);
    await c.load();
    expect(c.stats().entries).toBe(0);
    expect(c.stats().bytes).toBe(0);
    expect(c.stats().todayCostUsd).toBe(0);
    // Parent dir should now exist.
    const st = await stat(join(dir, 'nested', 'sub'));
    expect(st.isDirectory()).toBe(true);
  });

  it('round-trips put/get within the same instance', async () => {
    const file = join(dir, `${randomUUID()}.jsonl`);
    const c = new LlmCache(file);
    await c.load();
    await c.put('k1', 'hello', 0.001);
    expect(c.get('k1')).toBe('hello');
    expect(c.stats().entries).toBe(1);
  });

  it('persists across instances via load()', async () => {
    const file = join(dir, `${randomUUID()}.jsonl`);
    const a = new LlmCache(file);
    await a.load();
    await a.put('k', 'v', 0.002);

    const b = new LlmCache(file);
    await b.load();
    expect(b.get('k')).toBe('v');
    expect(b.stats().entries).toBe(1);
  });

  it('compacts duplicate keys with last-write-wins on load', async () => {
    const file = join(dir, `${randomUUID()}.jsonl`);
    const a = new LlmCache(file);
    await a.load();
    await a.put('dup', 'first', 0.001);
    await a.put('dup', 'second', 0.002);
    await a.put('dup', 'third', 0.003);

    const b = new LlmCache(file);
    await b.load();
    expect(b.get('dup')).toBe('third');
    expect(b.stats().entries).toBe(1);
  });

  it('handles 10 concurrent puts without torn writes', async () => {
    const file = join(dir, `${randomUUID()}.jsonl`);
    const a = new LlmCache(file);
    await a.load();

    const N = 10;
    const longValue = 'x'.repeat(500); // big-ish payload to encourage interleave
    await Promise.all(
      Array.from({ length: N }, (_, i) => a.put(`k${i}`, `${longValue}-${i}`, 0.0001)),
    );

    const b = new LlmCache(file);
    await b.load();
    expect(b.stats().entries).toBe(N);
    for (let i = 0; i < N; i++) {
      expect(b.get(`k${i}`)).toBe(`${longValue}-${i}`);
    }
  });

  it('sums today\'s costs in todayCostUsd, excluding earlier days', async () => {
    const file = join(dir, `${randomUUID()}.jsonl`);

    // Build a file manually with two entries from yesterday and two from today.
    const now = new Date('2026-05-17T15:00:00');
    const yesterday = new Date('2026-05-16T10:00:00');

    const lines = [
      JSON.stringify({ key: 'old1', value: 'a', costUsd: 0.5, ts: yesterday.getTime() }),
      JSON.stringify({ key: 'old2', value: 'b', costUsd: 0.25, ts: yesterday.getTime() }),
      JSON.stringify({ key: 'new1', value: 'c', costUsd: 0.1, ts: now.getTime() }),
      JSON.stringify({ key: 'new2', value: 'd', costUsd: 0.2, ts: now.getTime() }),
      '',
    ].join('\n');
    await writeFile(file, lines, 'utf8');

    vi.useFakeTimers();
    vi.setSystemTime(now);

    const c = new LlmCache(file);
    await c.load();
    const s = c.stats();
    expect(s.entries).toBe(4);
    expect(s.todayCostUsd).toBeCloseTo(0.3, 10);
  });

  it('tolerates corrupted lines and preserves parseable entries', async () => {
    const file = join(dir, `${randomUUID()}.jsonl`);
    const lines = [
      JSON.stringify({ key: 'a', value: '1', costUsd: 0.01, ts: Date.now() }),
      '{not valid json',
      'totally garbage line',
      JSON.stringify({ key: 'b', value: '2', costUsd: 0.02, ts: Date.now() }),
      '', // trailing blank
      JSON.stringify({ key: 'c', value: '3', costUsd: 0.03, ts: Date.now() }),
      '',
    ].join('\n');
    await writeFile(file, lines, 'utf8');

    const c = new LlmCache(file);
    await c.load();
    expect(c.stats().entries).toBe(3);
    expect(c.get('a')).toBe('1');
    expect(c.get('b')).toBe('2');
    expect(c.get('c')).toBe('3');
  });

  it('stats().bytes reflects on-disk file size', async () => {
    const file = join(dir, `${randomUUID()}.jsonl`);
    const c = new LlmCache(file);
    await c.load();
    await c.put('k', 'v', 0.0);
    const fileStat = await stat(file);
    expect(c.stats().bytes).toBe(fileStat.size);
    expect(c.stats().bytes).toBeGreaterThan(0);
  });

  it('evicts oldest entries when size crosses maxBytes', async () => {
    const file = join(dir, `${randomUUID()}.jsonl`);
    // Tiny cap so 3 entries push the file over and force eviction.
    const c = new LlmCache(file, { maxBytes: 500, evictTargetBytes: 250 });
    await c.load();
    // Deterministic ts ordering — `Date.now()` ties on fast machines.
    let t = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(t);
    await c.put('a', 'x'.repeat(150), 0.0);
    vi.setSystemTime((t += 1000));
    await c.put('b', 'x'.repeat(150), 0.0);
    vi.setSystemTime((t += 1000));
    // This one triggers the eviction.
    await c.put('c', 'x'.repeat(150), 0.0);

    // 'a' is the oldest — must be gone. 'b' may also be evicted depending on
    // exact size math; 'c' (most recent) must survive.
    expect(c.get('c')).toBe('x'.repeat(150));
    expect(c.get('a')).toBeUndefined();
    // File size stays under the cap after the rewrite.
    const sz = (await stat(file)).size;
    expect(sz).toBeLessThanOrEqual(500);
    // In-mem and on-disk agree (compaction wrote out the live entries).
    const raw = await readFile(file, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    expect(lines.length).toBe(c.stats().entries);
  });

  it('reload after eviction sees the compacted view', async () => {
    const file = join(dir, `${randomUUID()}.jsonl`);
    const a = new LlmCache(file, { maxBytes: 500, evictTargetBytes: 250 });
    await a.load();
    let t = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(t);
    await a.put('old', 'x'.repeat(150), 0.0);
    vi.setSystemTime((t += 1000));
    await a.put('mid', 'x'.repeat(150), 0.0);
    vi.setSystemTime((t += 1000));
    await a.put('new', 'x'.repeat(150), 0.0);

    // Reopen — the on-disk file should already be compacted.
    const b = new LlmCache(file, { maxBytes: 500, evictTargetBytes: 250 });
    await b.load();
    expect(b.get('old')).toBeUndefined();
    expect(b.get('new')).toBe('x'.repeat(150));
    expect(b.stats().bytes).toBe(a.stats().bytes);
  });

  it('appends a newline-terminated JSON line per put', async () => {
    const file = join(dir, `${randomUUID()}.jsonl`);
    const c = new LlmCache(file);
    await c.load();
    await c.put('alpha', 'one', 0.01);
    await c.put('beta', 'two', 0.02);

    const raw = await readFile(file, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    const lines = raw.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    const e0 = JSON.parse(lines[0]!);
    const e1 = JSON.parse(lines[1]!);
    expect(e0.key).toBe('alpha');
    expect(e0.value).toBe('one');
    expect(e0.costUsd).toBe(0.01);
    expect(typeof e0.ts).toBe('number');
    expect(e1.key).toBe('beta');
  });
});
