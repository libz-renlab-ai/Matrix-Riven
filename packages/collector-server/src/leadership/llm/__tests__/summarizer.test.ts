/**
 * Tests for the tier summarizer orchestrator (L-7).
 *
 * We mock the `runLocalClaude` client and exercise the real `LlmCache` against
 * a per-test temp file. The tests cover the shared pipeline skeleton — cache
 * partition, batched LLM call, JSON parse + validation, redaction, and the
 * cache-only short-circuit — across T1–T5.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Mock the local-claude-client before importing the summarizer.
vi.mock('../local-claude-client.js', () => {
  return { runLocalClaude: vi.fn() };
});

import { runLocalClaude } from '../local-claude-client.js';
import { LlmCache } from '../cache.js';
import {
  summarizeAttention,
  summarizeDailyBrief,
  summarizeMembers,
  summarizeProjects,
  summarizeSessions,
  type SummarizerContext,
} from '../summarizer.js';
import type {
  T1Input,
  T2Input,
  T3Input,
  T4Input,
  T5Input,
} from '../prompts/index.js';

const mockedRun = runLocalClaude as unknown as ReturnType<typeof vi.fn>;

async function makeCache(): Promise<{ cache: LlmCache; dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'llm-summarizer-test-'));
  const file = join(dir, `${randomUUID()}.jsonl`);
  const cache = new LlmCache(file);
  await cache.load();
  return { cache, dir, file };
}

function t1(id: string, overrides: Partial<T1Input> = {}): T1Input {
  return {
    id,
    firstUserPrompt: `what did session ${id} do`,
    changedFiles: [`src/${id}.ts`],
    toolCounts: { edit: 1, bash: 0, read: 1, webFetch: 0 },
    durationMin: 5,
    errors: 0,
    ...overrides,
  };
}

function ctx(cache: LlmCache, overrides: Partial<SummarizerContext> = {}): SummarizerContext {
  return { cache, ...overrides };
}

describe('summarizer', () => {
  let dir: string;
  let cache: LlmCache;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const made = await makeCache();
    dir = made.dir;
    cache = made.cache;
    mockedRun.mockReset();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    warnSpy.mockRestore();
  });

  describe('summarizeSessions (T1)', () => {
    it('returns all cached values without calling the LLM (all-hit short-circuit)', async () => {
      // Pre-populate cache by computing keys via a single dry call:
      // we run the summarizer once with a mock to seed, then reset and verify.
      mockedRun.mockResolvedValueOnce({
        ok: true,
        result: JSON.stringify({
          results: [
            { id: 'a', line: '做了甲' },
            { id: 'b', line: '做了乙' },
          ],
        }),
        costUsd: 0.02,
        durationMs: 1000,
      });
      await summarizeSessions([t1('a'), t1('b')], ctx(cache));
      expect(mockedRun).toHaveBeenCalledTimes(1);

      mockedRun.mockReset();
      const result = await summarizeSessions([t1('a'), t1('b')], ctx(cache));
      expect(mockedRun).not.toHaveBeenCalled();
      expect(result.size).toBe(2);
      expect(result.get('a')).toBe('做了甲');
      expect(result.get('b')).toBe('做了乙');
    });

    it('batches all misses into a single LLM call and caches results', async () => {
      mockedRun.mockResolvedValueOnce({
        ok: true,
        result: JSON.stringify({
          results: [
            { id: 'a', line: '做了甲' },
            { id: 'b', line: '做了乙' },
            { id: 'c', line: '做了丙' },
          ],
        }),
        costUsd: 0.03,
        durationMs: 5000,
      });
      const result = await summarizeSessions([t1('a'), t1('b'), t1('c')], ctx(cache));
      expect(mockedRun).toHaveBeenCalledTimes(1);
      expect(result.size).toBe(3);
      expect(result.get('a')).toBe('做了甲');
      expect(result.get('b')).toBe('做了乙');
      expect(result.get('c')).toBe('做了丙');

      // Verify cached on disk: a fresh cache loads same values.
      const fresh = new LlmCache((cache as unknown as { filePath: string }).filePath);
      await fresh.load();
      expect(fresh.stats().entries).toBe(3);
    });

    it('combines hits and misses — LLM only sees misses', async () => {
      // First call to seed one entry for 'a'.
      mockedRun.mockResolvedValueOnce({
        ok: true,
        result: JSON.stringify({ results: [{ id: 'a', line: '甲已存' }] }),
        costUsd: 0.01,
        durationMs: 500,
      });
      await summarizeSessions([t1('a')], ctx(cache));

      // Second call: request 3, but 'a' is cached. Mock returns only 2.
      mockedRun.mockReset();
      mockedRun.mockResolvedValueOnce({
        ok: true,
        result: JSON.stringify({
          results: [
            { id: 'b', line: '乙' },
            { id: 'c', line: '丙' },
          ],
        }),
        costUsd: 0.02,
        durationMs: 800,
      });
      const result = await summarizeSessions([t1('a'), t1('b'), t1('c')], ctx(cache));
      expect(mockedRun).toHaveBeenCalledTimes(1);
      const call = mockedRun.mock.calls[0]![0] as { userPrompt: string };
      // The batched user prompt must include b and c but not a.
      expect(call.userPrompt).toContain('"id":"b"');
      expect(call.userPrompt).toContain('"id":"c"');
      expect(call.userPrompt).not.toContain('"id":"a"');
      expect(result.size).toBe(3);
      expect(result.get('a')).toBe('甲已存');
      expect(result.get('b')).toBe('乙');
      expect(result.get('c')).toBe('丙');
    });

    it('cacheOnly mode skips the LLM entirely', async () => {
      const result = await summarizeSessions(
        [t1('x'), t1('y')],
        ctx(cache, { cacheOnly: true }),
      );
      expect(mockedRun).not.toHaveBeenCalled();
      expect(result.size).toBe(0);
    });

    it('returns hits-only when LLM call fails (ok:false)', async () => {
      mockedRun.mockResolvedValueOnce({
        ok: false,
        error: 'timeout',
        costUsd: 0,
        durationMs: 60000,
      });
      const result = await summarizeSessions([t1('a'), t1('b')], ctx(cache));
      expect(result.size).toBe(0);
      // Cache must not have been written.
      const fresh = new LlmCache((cache as unknown as { filePath: string }).filePath);
      await fresh.load();
      expect(fresh.stats().entries).toBe(0);
    });

    it('returns hits-only and logs warning on malformed JSON', async () => {
      mockedRun.mockResolvedValueOnce({
        ok: true,
        result: 'not json',
        costUsd: 0.01,
        durationMs: 100,
      });
      const result = await summarizeSessions([t1('a')], ctx(cache));
      expect(result.size).toBe(0);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('skips malformed result rows but keeps valid ones', async () => {
      mockedRun.mockResolvedValueOnce({
        ok: true,
        result: JSON.stringify({
          results: [
            { id: 'a', line: 'x' },
            { id: 'b' },
          ],
        }),
        costUsd: 0.02,
        durationMs: 500,
      });
      const result = await summarizeSessions([t1('a'), t1('b')], ctx(cache));
      expect(result.size).toBe(1);
      expect(result.get('a')).toBe('x');
      expect(result.get('b')).toBeUndefined();
    });

    it('applies redactForLLM to input string fields before sending', async () => {
      mockedRun.mockResolvedValueOnce({
        ok: true,
        result: JSON.stringify({ results: [{ id: 'a', line: 'ok' }] }),
        costUsd: 0.01,
        durationMs: 100,
      });
      await summarizeSessions(
        [
          t1('a', {
            firstUserPrompt: 'email me at a@b.com please',
            changedFiles: ['/Users/alice/foo.ts'],
          }),
        ],
        ctx(cache),
      );
      const call = mockedRun.mock.calls[0]![0] as { userPrompt: string };
      expect(call.userPrompt).toContain('<email>');
      expect(call.userPrompt).not.toContain('a@b.com');
      expect(call.userPrompt).toContain('<path>');
      expect(call.userPrompt).not.toContain('/Users/alice/foo.ts');
    });

    it('produces the same cache key regardless of changedFiles order', async () => {
      // Seed with one ordering.
      mockedRun.mockResolvedValueOnce({
        ok: true,
        result: JSON.stringify({ results: [{ id: 'a', line: 'seeded' }] }),
        costUsd: 0.01,
        durationMs: 100,
      });
      await summarizeSessions(
        [t1('a', { changedFiles: ['x.ts', 'y.ts', 'z.ts'] })],
        ctx(cache),
      );

      // Request again with reordered changedFiles — must hit cache, not call LLM.
      mockedRun.mockReset();
      const result = await summarizeSessions(
        [t1('a', { changedFiles: ['z.ts', 'y.ts', 'x.ts'] })],
        ctx(cache),
      );
      expect(mockedRun).not.toHaveBeenCalled();
      expect(result.get('a')).toBe('seeded');
    });

    it('honours tier1Model override', async () => {
      mockedRun.mockResolvedValueOnce({
        ok: true,
        result: JSON.stringify({ results: [{ id: 'a', line: 'x' }] }),
        costUsd: 0.01,
        durationMs: 100,
      });
      await summarizeSessions([t1('a')], ctx(cache, { tier1Model: 'custom-haiku' }));
      const call = mockedRun.mock.calls[0]![0] as { model: string };
      expect(call.model).toBe('custom-haiku');
    });

    it('passes ctx.timeoutMs through to the client', async () => {
      mockedRun.mockResolvedValueOnce({
        ok: true,
        result: JSON.stringify({ results: [{ id: 'a', line: 'x' }] }),
        costUsd: 0.01,
        durationMs: 100,
      });
      await summarizeSessions([t1('a')], ctx(cache, { timeoutMs: 1234 }));
      const call = mockedRun.mock.calls[0]![0] as { timeoutMs?: number };
      expect(call.timeoutMs).toBe(1234);
    });
  });

  describe('summarizeMembers (T2)', () => {
    it('composes line1\\nline2 into a single cached value', async () => {
      mockedRun.mockResolvedValueOnce({
        ok: true,
        result: JSON.stringify({
          results: [
            { email: 'alice@x.com', line1: '本周聚焦 overview', line2: '已交付 hero 骨架' },
          ],
        }),
        costUsd: 0.02,
        durationMs: 500,
      });
      const members: T2Input[] = [
        {
          email: 'alice@x.com',
          displayName: 'Alice',
          state: 'active',
          topFiles: ['src/foo.ts'],
          sessionDigests: ['做了甲'],
        },
      ];
      const result = await summarizeMembers(members, ctx(cache));
      expect(result.get('alice@x.com')).toBe('本周聚焦 overview\n已交付 hero 骨架');
    });

    it('skips rows missing line1 or line2', async () => {
      mockedRun.mockResolvedValueOnce({
        ok: true,
        result: JSON.stringify({
          results: [
            { email: 'a@x.com', line1: 'one', line2: 'two' },
            { email: 'b@x.com', line1: 'only one' },
          ],
        }),
        costUsd: 0.02,
        durationMs: 500,
      });
      const members: T2Input[] = [
        {
          email: 'a@x.com',
          displayName: 'A',
          state: 'active',
          topFiles: [],
          sessionDigests: [],
        },
        {
          email: 'b@x.com',
          displayName: 'B',
          state: 'idle',
          topFiles: [],
          sessionDigests: [],
        },
      ];
      const result = await summarizeMembers(members, ctx(cache));
      expect(result.size).toBe(1);
      expect(result.get('a@x.com')).toBe('one\ntwo');
    });
  });

  describe('summarizeProjects (T3)', () => {
    it('caches two-line composition keyed by project name', async () => {
      mockedRun.mockResolvedValueOnce({
        ok: true,
        result: JSON.stringify({
          results: [
            {
              project: 'matrix-riven',
              line1: '团队在做 LLM 叙事层',
              line2: '进展 T1 上线 / 待 worker',
            },
          ],
        }),
        costUsd: 0.02,
        durationMs: 500,
      });
      const projects: T3Input[] = [
        {
          project: 'matrix-riven',
          phase: '推进新功能',
          contributors: ['Alice'],
          sessionDigests: ['做了甲'],
          recentCommits: ['feat: x'],
        },
      ];
      const result = await summarizeProjects(projects, ctx(cache));
      expect(result.get('matrix-riven')).toBe(
        '团队在做 LLM 叙事层\n进展 T1 上线 / 待 worker',
      );
    });
  });

  describe('summarizeAttention (T4)', () => {
    it('caches single-line rewrites keyed by refId', async () => {
      mockedRun.mockResolvedValueOnce({
        ok: true,
        result: JSON.stringify({
          results: [{ refId: 'r1', line: 'overview 测试连挂 3 次，建议结对排查' }],
        }),
        costUsd: 0.01,
        durationMs: 300,
      });
      const items: T4Input[] = [
        {
          refId: 'r1',
          kind: 'member',
          displayName: 'Alice',
          signal: 'stuck',
          evidence: ['snapshot 路径不对'],
        },
      ];
      const result = await summarizeAttention(items, ctx(cache));
      expect(result.get('r1')).toBe('overview 测试连挂 3 次，建议结对排查');
    });
  });

  describe('summarizeDailyBrief (T5)', () => {
    const input: T5Input = {
      date: '2026-05-17',
      topHighlights: ['做了甲', '做了乙'],
      attentionRewrites: ['注意 X'],
      topProjects: [{ name: 'matrix-riven', digest: '团队在做 LLM' }],
    };

    it('happy path: calls LLM, returns 3-line array, caches result', async () => {
      mockedRun.mockResolvedValueOnce({
        ok: true,
        result: JSON.stringify({ briefLines: ['甲', '乙', '丙'] }),
        costUsd: 0.05,
        durationMs: 2000,
      });
      const result = await summarizeDailyBrief(input, ctx(cache));
      expect(result).toEqual(['甲', '乙', '丙']);

      // Verify cache contains a single entry whose value is JSON-encoded.
      const fresh = new LlmCache((cache as unknown as { filePath: string }).filePath);
      await fresh.load();
      expect(fresh.stats().entries).toBe(1);
    });

    it('cache hit returns parsed array without calling LLM', async () => {
      // Seed.
      mockedRun.mockResolvedValueOnce({
        ok: true,
        result: JSON.stringify({ briefLines: ['x', 'y', 'z'] }),
        costUsd: 0.05,
        durationMs: 2000,
      });
      await summarizeDailyBrief(input, ctx(cache));

      mockedRun.mockReset();
      const result = await summarizeDailyBrief(input, ctx(cache));
      expect(mockedRun).not.toHaveBeenCalled();
      expect(result).toEqual(['x', 'y', 'z']);
    });

    it('cacheOnly + miss returns []', async () => {
      const result = await summarizeDailyBrief(input, ctx(cache, { cacheOnly: true }));
      expect(mockedRun).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('returns [] on LLM ok:false', async () => {
      mockedRun.mockResolvedValueOnce({
        ok: false,
        error: 'timeout',
        costUsd: 0,
        durationMs: 60000,
      });
      const result = await summarizeDailyBrief(input, ctx(cache));
      expect(result).toEqual([]);
    });

    it('honours tier5Model override', async () => {
      mockedRun.mockResolvedValueOnce({
        ok: true,
        result: JSON.stringify({ briefLines: ['甲', '乙', '丙'] }),
        costUsd: 0.05,
        durationMs: 2000,
      });
      await summarizeDailyBrief(input, ctx(cache, { tier5Model: 'custom-sonnet' }));
      const call = mockedRun.mock.calls[0]![0] as { model: string };
      expect(call.model).toBe('custom-sonnet');
    });

    it('returns [] when LLM returns malformed JSON', async () => {
      mockedRun.mockResolvedValueOnce({
        ok: true,
        result: 'not json',
        costUsd: 0.01,
        durationMs: 100,
      });
      const result = await summarizeDailyBrief(input, ctx(cache));
      expect(result).toEqual([]);
      expect(warnSpy).toHaveBeenCalled();
    });
  });
});
