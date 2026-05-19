/**
 * Tests for the LLM narrative background worker (L-9).
 *
 * The worker drives the summarizer at a fixed interval, gates on the daily
 * budget, runs T5 only on every Nth tick, and never blocks the render path.
 * We mock `runLocalClaude` so no real CLI spawns, use a real `LlmCache` on a
 * tmp file, and lean on `vi.useFakeTimers` for the interval / overlap tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Mock the local-claude-client before importing summarizer / worker.
vi.mock('../local-claude-client.js', () => {
  return { runLocalClaude: vi.fn() };
});

import { runLocalClaude } from '../local-claude-client.js';
import { LlmCache } from '../cache.js';
import { startWorker, type WorkerInputs } from '../worker.js';
import type { LlmConfig } from '../config.js';
import type {
  T1Input,
  T2Input,
  T3Input,
  T4Input,
  T5Input,
} from '../prompts/index.js';

const mockedRun = runLocalClaude as unknown as ReturnType<typeof vi.fn>;

async function makeCache(): Promise<{ cache: LlmCache; dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'llm-worker-test-'));
  const file = join(dir, `${randomUUID()}.jsonl`);
  const cache = new LlmCache(file);
  await cache.load();
  return { cache, dir, file };
}

function baseCfg(overrides: Partial<LlmConfig> = {}): LlmConfig {
  return {
    enabled: true,
    dailyBudgetUsd: 5,
    tier1Model: 'haiku-test',
    tier5Model: 'sonnet-test',
    cacheDir: '/tmp/unused',
    workerIntervalMs: 1000,
    briefIntervalMs: 3000,
    ...overrides,
  };
}

function sampleInputs(): WorkerInputs {
  const sessions: T1Input[] = [
    {
      id: 's1',
      firstUserPrompt: 'fix overview tab',
      changedFiles: ['src/overview.ts'],
      toolCounts: { edit: 1, bash: 0, read: 1, webFetch: 0 },
      durationMin: 5,
      errors: 0,
    },
    {
      id: 's2',
      firstUserPrompt: 'add LLM worker',
      changedFiles: ['src/worker.ts'],
      toolCounts: { edit: 2, bash: 1, read: 0, webFetch: 0 },
      durationMin: 12,
      errors: 0,
    },
  ];
  const members: T2Input[] = [
    {
      email: 'alice@x.com',
      displayName: 'Alice',
      state: 'active',
      topFiles: ['src/overview.ts'],
      sessionDigests: ['做了甲'],
    },
  ];
  const projects: T3Input[] = [
    {
      project: 'matrix-riven',
      phase: '推进新功能',
      contributors: ['Alice'],
      sessionDigests: ['做了甲'],
      recentCommits: ['feat: overview'],
    },
  ];
  const attention: T4Input[] = [
    {
      refId: 'r1',
      kind: 'member',
      displayName: 'Alice',
      signal: 'stuck',
      evidence: ['snapshot 路径不对'],
    },
  ];
  const brief: T5Input = {
    date: '2026-05-17',
    topHighlights: ['做了甲', '做了乙'],
    attentionRewrites: ['注意 X'],
    topProjects: [{ name: 'matrix-riven', digest: '团队在做 LLM' }],
  };
  return { sessions, members, projects, attention, brief };
}

interface MockResponses {
  t1?: { results: Array<{ id: string; line: string }> };
  t2?: { results: Array<{ email: string; line1: string; line2: string }> };
  t3?: { results: Array<{ project: string; line1: string; line2: string }> };
  t4?: { results: Array<{ refId: string; line: string }> };
  t5?: { briefLines: string[] };
}

/**
 * Wire the mocked `runLocalClaude` to dispatch by `model` value or by call
 * order. We use call order because the summarizer calls always set model =
 * cfg.tier1Model for T1-T4 and cfg.tier5Model for T5, so we can detect T5 by
 * model name while ordering T1-T4 by call sequence.
 */
function wireMockResponses(cfg: LlmConfig, responses: MockResponses, costPerCall = 0.01): void {
  const t1to4: Array<{ results: unknown[] }> = [];
  if (responses.t1) t1to4.push(responses.t1);
  if (responses.t2) t1to4.push(responses.t2);
  if (responses.t3) t1to4.push(responses.t3);
  if (responses.t4) t1to4.push(responses.t4);
  let i = 0;
  mockedRun.mockImplementation(async (req: { model: string }) => {
    if (req.model === cfg.tier5Model) {
      return {
        ok: true,
        result: JSON.stringify(responses.t5 ?? { briefLines: [] }),
        costUsd: costPerCall,
        durationMs: 100,
      };
    }
    const payload = t1to4[i++] ?? { results: [] };
    return {
      ok: true,
      result: JSON.stringify(payload),
      costUsd: costPerCall,
      durationMs: 100,
    };
  });
}

describe('worker', () => {
  let dir: string;
  let cache: LlmCache;
  let logSpy: ReturnType<typeof vi.fn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const made = await makeCache();
    dir = made.dir;
    cache = made.cache;
    mockedRun.mockReset();
    logSpy = vi.fn();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
    warnSpy.mockRestore();
  });

  it('disabled cfg: runOnce short-circuits, no LLM call', async () => {
    const cfg = baseCfg({ enabled: false });
    const handle = startWorker({
      cache,
      cfg,
      collectInputs: async () => sampleInputs(),
      log: logSpy,
    });
    const tick = await handle.runOnce();
    expect(tick.ok).toBe(false);
    expect(tick.reason).toBe('disabled');
    expect(tick.filled).toEqual({ t1: 0, t2: 0, t3: 0, t4: 0, t5: 0 });
    expect(mockedRun).not.toHaveBeenCalled();
    handle.stop();
  });

  it('null inputs: returns no_inputs without calling LLM', async () => {
    const cfg = baseCfg();
    const handle = startWorker({
      cache,
      cfg,
      collectInputs: async () => null,
      log: logSpy,
    });
    const tick = await handle.runOnce();
    expect(tick.ok).toBe(false);
    expect(tick.reason).toBe('no_inputs');
    expect(mockedRun).not.toHaveBeenCalled();
    handle.stop();
  });

  it('happy path: fills T1-T4 and tier-5 on first tick (counter starts at 0)', async () => {
    const cfg = baseCfg();
    wireMockResponses(cfg, {
      t1: {
        results: [
          { id: 's1', line: '改 overview' },
          { id: 's2', line: '加 worker' },
        ],
      },
      t2: {
        results: [
          { email: 'alice@x.com', line1: '本周聚焦 overview', line2: '已交付 hero 骨架' },
        ],
      },
      t3: {
        results: [
          {
            project: 'matrix-riven',
            line1: '团队在做 LLM 叙事层',
            line2: '进展 T1 上线 / 待 worker',
          },
        ],
      },
      t4: { results: [{ refId: 'r1', line: 'overview 卡住，建议结对排查' }] },
      t5: { briefLines: ['甲', '乙', '丙'] },
    });
    const handle = startWorker({
      cache,
      cfg,
      collectInputs: async () => sampleInputs(),
      log: logSpy,
    });
    const tick = await handle.runOnce();
    expect(tick.ok).toBe(true);
    expect(tick.filled.t1).toBe(2);
    expect(tick.filled.t2).toBe(1);
    expect(tick.filled.t3).toBe(1);
    expect(tick.filled.t4).toBe(1);
    expect(tick.filled.t5).toBe(1);
    expect(tick.costUsd).toBeGreaterThan(0);
    // T1, T2, T3, T4, T5 = 5 LLM calls.
    expect(mockedRun).toHaveBeenCalledTimes(5);
    expect(cache.stats().entries).toBeGreaterThanOrEqual(5);
    handle.stop();
  });

  it('brief cadence: T5 runs on tick 1, then skipped tick 2, then again on tick N+1', async () => {
    // briefIntervalMs / workerIntervalMs = 3 / 1 = 3 → N = 3.
    // Counter starts at 0, increments after each tick. T5 runs when counter % N == 0.
    // So ticks 1, 4, 7… run T5; ticks 2, 3, 5, 6… skip T5.
    const cfg = baseCfg({ workerIntervalMs: 1000, briefIntervalMs: 3000 });
    let callIdx = 0;
    mockedRun.mockImplementation(async (req: { model: string }) => {
      callIdx++;
      if (req.model === cfg.tier5Model) {
        return {
          ok: true,
          result: JSON.stringify({ briefLines: [`brief-${callIdx}`, 'b', 'c'] }),
          costUsd: 0.01,
          durationMs: 50,
        };
      }
      // T1-T4: return empty results so we don't pile up cache entries.
      return {
        ok: true,
        result: JSON.stringify({ results: [] }),
        costUsd: 0.001,
        durationMs: 50,
      };
    });

    // Use fresh distinct inputs across ticks so the T5 cache key differs each
    // time — otherwise tick 1's T5 result would short-circuit cache hits on
    // later T5-eligible ticks.
    let dateCounter = 0;
    const handle = startWorker({
      cache,
      cfg,
      collectInputs: async () => {
        dateCounter++;
        const inputs = sampleInputs();
        inputs.brief = { ...inputs.brief, date: `2026-05-${10 + dateCounter}` };
        return inputs;
      },
      log: logSpy,
    });

    const tick1 = await handle.runOnce();
    expect(tick1.ok).toBe(true);
    expect(tick1.filled.t5).toBe(1); // tick 1 runs T5

    const tick2 = await handle.runOnce();
    expect(tick2.ok).toBe(true);
    expect(tick2.filled.t5).toBe(0); // tick 2 skips T5

    const tick3 = await handle.runOnce();
    expect(tick3.ok).toBe(true);
    expect(tick3.filled.t5).toBe(0); // tick 3 skips T5

    const tick4 = await handle.runOnce();
    expect(tick4.ok).toBe(true);
    expect(tick4.filled.t5).toBe(1); // tick 4 runs T5 again
    handle.stop();
  });

  it('budget exceeded before tick: returns budget_exceeded, no LLM call', async () => {
    // Seed cache with cost > budget.
    await cache.put('seed1', 'x', 4.0);
    await cache.put('seed2', 'y', 2.0);
    const cfg = baseCfg({ dailyBudgetUsd: 5 });
    const handle = startWorker({
      cache,
      cfg,
      collectInputs: async () => sampleInputs(),
      log: logSpy,
    });
    const tick = await handle.runOnce();
    expect(tick.ok).toBe(false);
    expect(tick.reason).toBe('budget_exceeded');
    expect(mockedRun).not.toHaveBeenCalled();
    handle.stop();
  });

  it('budget exceeded mid-tick: T3/T4/T5 skipped after T2 pushes over budget', async () => {
    const cfg = baseCfg({ dailyBudgetUsd: 1 });
    // T1 cheap (0.1), T2 expensive (1.5) pushes over budget = 1.6 > 1.
    // T3/T4/T5 must be skipped.
    let callIdx = 0;
    mockedRun.mockImplementation(async () => {
      callIdx++;
      if (callIdx === 1) {
        // T1
        return {
          ok: true,
          result: JSON.stringify({
            results: [
              { id: 's1', line: 'a' },
              { id: 's2', line: 'b' },
            ],
          }),
          costUsd: 0.1,
          durationMs: 50,
        };
      }
      if (callIdx === 2) {
        // T2 — push over budget.
        return {
          ok: true,
          result: JSON.stringify({
            results: [
              { email: 'alice@x.com', line1: 'x', line2: 'y' },
            ],
          }),
          costUsd: 1.5,
          durationMs: 50,
        };
      }
      // Should never reach T3.
      throw new Error('T3+ should be skipped after budget exceeded');
    });

    const handle = startWorker({
      cache,
      cfg,
      collectInputs: async () => sampleInputs(),
      log: logSpy,
    });
    const tick = await handle.runOnce();
    expect(tick.ok).toBe(false);
    expect(tick.reason).toBe('budget_exceeded');
    expect(tick.filled.t1).toBe(2);
    expect(tick.filled.t2).toBe(1);
    expect(tick.filled.t3).toBe(0);
    expect(tick.filled.t4).toBe(0);
    expect(tick.filled.t5).toBe(0);
    expect(mockedRun).toHaveBeenCalledTimes(2);
    handle.stop();
  });

  it('interval overlap: second tick fired while first in-flight is skipped', async () => {
    vi.useFakeTimers();
    const cfg = baseCfg({ workerIntervalMs: 1000, briefIntervalMs: 1000 });

    // Make the first LLM call slow via a controllable promise.
    let releaseFirst: (() => void) | undefined;
    const firstSlow = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let callCount = 0;
    mockedRun.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        await firstSlow;
      }
      return {
        ok: true,
        result: JSON.stringify({ results: [] }),
        costUsd: 0.001,
        durationMs: 50,
      };
    });

    const handle = startWorker({
      cache,
      cfg,
      collectInputs: async () => sampleInputs(),
      log: logSpy,
    });

    // Advance time to fire the interval twice; first tick is still in-flight,
    // so the second should skip with a log.
    await vi.advanceTimersByTimeAsync(1000); // fires tick 1 (in-flight)
    await vi.advanceTimersByTimeAsync(1000); // fires tick 2 (should skip)

    // Now release tick 1 and let it finish.
    releaseFirst!();
    // Pump microtasks to allow tick 1 to complete.
    await vi.advanceTimersByTimeAsync(0);

    // Tick 2 should have logged "skip overlap" but not started its own LLM run.
    const skipLogged = logSpy.mock.calls.some((c) =>
      String(c[0] ?? '').includes('skip overlap'),
    );
    expect(skipLogged).toBe(true);

    handle.stop();
    vi.useRealTimers();
  });

  it('stop() halts interval and subsequent runOnce returns disabled-like result', async () => {
    vi.useFakeTimers();
    const cfg = baseCfg({ workerIntervalMs: 1000, briefIntervalMs: 1000 });
    mockedRun.mockResolvedValue({
      ok: true,
      result: JSON.stringify({ results: [] }),
      costUsd: 0.001,
      durationMs: 10,
    });
    const handle = startWorker({
      cache,
      cfg,
      collectInputs: async () => sampleInputs(),
      log: logSpy,
    });
    handle.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockedRun).not.toHaveBeenCalled();
    const tick = await handle.runOnce();
    expect(tick.ok).toBe(false);
    expect(tick.reason).toBe('disabled');
    vi.useRealTimers();
  });

  it('summarizer throw: returns error, never crashes, cache state intact', async () => {
    const cfg = baseCfg();
    let callIdx = 0;
    mockedRun.mockImplementation(async () => {
      callIdx++;
      if (callIdx === 1) {
        // T1 succeeds normally.
        return {
          ok: true,
          result: JSON.stringify({
            results: [{ id: 's1', line: 'ok' }],
          }),
          costUsd: 0.01,
          durationMs: 50,
        };
      }
      // T2 throws — should be caught by worker.
      throw new Error('boom from runLocalClaude');
    });

    const entriesBefore = cache.stats().entries;
    const handle = startWorker({
      cache,
      cfg,
      collectInputs: async () => sampleInputs(),
      log: logSpy,
    });
    const tick = await handle.runOnce();
    expect(tick.ok).toBe(false);
    expect(tick.reason).toBe('error');
    // Worker logged the error.
    const errorLogged = logSpy.mock.calls.some((c) =>
      String(c[0] ?? '').includes('error'),
    );
    expect(errorLogged).toBe(true);
    // T1 had already written to cache before the throw; that's fine — cache
    // entries went up but didn't get corrupted.
    expect(cache.stats().entries).toBeGreaterThanOrEqual(entriesBefore);
    handle.stop();
  });
});
