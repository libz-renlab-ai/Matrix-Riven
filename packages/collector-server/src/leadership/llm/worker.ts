/**
 * LLM narrative background worker (L-9).
 *
 * Drives the five summarizer tiers on a fixed interval so the render path
 * (`/api/overview`) only ever reads the cache and never blocks on the LLM.
 *
 * Behaviour at a glance:
 *   - Disabled config (`cfg.enabled === false`) → ticks short-circuit; never
 *     started or `runOnce`'d will do work.
 *   - Budget gate — checked once before the tick and again between tiers; once
 *     `cache.stats().todayCostUsd >= cfg.dailyBudgetUsd`, remaining tiers are
 *     skipped and the tick reports `budget_exceeded`.
 *   - T1→T2→T3→T4 always run (when budget + inputs allow); T5 only fires on
 *     every Nth tick where N = ⌊briefIntervalMs / workerIntervalMs⌋. Counter
 *     starts at 0 so the very first tick runs T5 — this gives a useful brief
 *     on bootstrap warm-up without waiting an hour.
 *   - Overlap guard — if the interval fires while a tick is still running we
 *     log `skip overlap` and return; the in-flight tick continues to
 *     completion. `runOnce()` returns the in-flight promise too, so external
 *     callers never trigger overlapping ticks either.
 *   - Errors are caught at the tick boundary and reported as
 *     `{ok:false, reason:'error'}` so a bad summarizer call never crashes the
 *     interval.
 *
 * See `docs/superpowers/specs/2026-05-17-llm-narrative-design.md` and
 * `docs/superpowers/plans/2026-05-17-llm-narrative.md` (§Wave 3 L-9).
 */

import type { LlmCache } from './cache.js';
import type { LlmConfig } from './config.js';
import {
  summarizeAttention,
  summarizeDailyBrief,
  summarizeMembers,
  summarizeProjects,
  summarizeSessions,
  type SummarizerContext,
} from './summarizer.js';
import type {
  T1Input,
  T2Input,
  T3Input,
  T4Input,
  T5Input,
} from './prompts/index.js';

export interface WorkerInputs {
  sessions: T1Input[];
  /** Pre-built T2 input (empty sessionDigests). Used when `rebuildMembers` is absent. */
  members: T2Input[];
  /** Pre-built T3 input (empty sessionDigests). Used when `rebuildProjects` is absent. */
  projects: T3Input[];
  attention: T4Input[];
  /**
   * Pre-built T5 input from collect-time. Used as a fallback when
   * `rebuildBrief` is not provided so old tests / external callers don't
   * need to wire the callback.
   */
  brief: T5Input;
  /**
   * Optional: rebuild T2 input AFTER T1 has filled the cache. T2's payload
   * includes `sessionDigests` — at collect-time those are empty; the
   * aggregator's render path always reads them populated from the T1 cache,
   * so without this rebuild the worker-write and aggregator-read T2 keys
   * never match.
   */
  rebuildMembers?: (lookup: (key: string) => string | undefined) => T2Input[];
  /** Same shape as `rebuildMembers`, for T3. */
  rebuildProjects?: (lookup: (key: string) => string | undefined) => T3Input[];
  /**
   * Optional: rebuild T5 input after T1/T3/T4 have run and filled the
   * cache. The worker calls this with a `keyLookup(cacheKey)` so the
   * collector can re-resolve T1 digests / T3 narratives / T4 rewrites from
   * the now-filled cache and feed them into the T5 prompt.
   */
  rebuildBrief?: (lookup: (key: string) => string | undefined) => T5Input;
}

export interface WorkerDeps {
  cache: LlmCache;
  cfg: LlmConfig;
  /** Pull fresh data each tick. Returns null when nothing to process. */
  collectInputs: () => Promise<WorkerInputs | null>;
  /** Optional logger; defaults to no-op. */
  log?: (msg: string) => void;
  /** Optional clock; defaults to Date.now. For tests. */
  now?: () => number;
}

export interface TickResult {
  ok: boolean;
  reason?: 'disabled' | 'budget_exceeded' | 'no_inputs' | 'error';
  /** Per-tier counts of cache-misses processed this tick. */
  filled: { t1: number; t2: number; t3: number; t4: number; t5: number };
  costUsd: number;
  durationMs: number;
}

export interface WorkerHandle {
  /** Stop the worker (cancels pending interval; in-flight tick continues). */
  stop: () => void;
  /** Run one tick now; resolves when done. Re-uses any in-flight tick. */
  runOnce: () => Promise<TickResult>;
}

const TICK_TIMEOUT_MS = 60_000;

function zeroFilled(): TickResult['filled'] {
  return { t1: 0, t2: 0, t3: 0, t4: 0, t5: 0 };
}

function disabledResult(now: () => number, started: number): TickResult {
  return {
    ok: false,
    reason: 'disabled',
    filled: zeroFilled(),
    costUsd: 0,
    durationMs: now() - started,
  };
}

export function startWorker(deps: WorkerDeps): WorkerHandle {
  const { cache, cfg, collectInputs } = deps;
  const log = deps.log ?? (() => undefined);
  const now = deps.now ?? Date.now;

  // N = ticks per brief. Floor + max(1, …) so a misconfigured ratio still
  // gives a sane "every tick" cadence rather than NaN/0.
  const briefEveryNTicks = Math.max(
    1,
    Math.floor(cfg.briefIntervalMs / cfg.workerIntervalMs),
  );

  let stopped = false;
  let inFlight: Promise<TickResult> | null = null;
  let tickCounter = 0;

  const baseCtx: Omit<SummarizerContext, 'cache'> = {
    cacheOnly: false,
    tier1Model: cfg.tier1Model,
    tier5Model: cfg.tier5Model,
    timeoutMs: TICK_TIMEOUT_MS,
  };

  async function tickOnce(): Promise<TickResult> {
    const started = now();
    if (stopped || !cfg.enabled) return disabledResult(now, started);

    const costBefore = cache.stats().todayCostUsd;
    if (costBefore >= cfg.dailyBudgetUsd) {
      return {
        ok: false,
        reason: 'budget_exceeded',
        filled: zeroFilled(),
        costUsd: 0,
        durationMs: now() - started,
      };
    }

    let inputs: WorkerInputs | null;
    try {
      inputs = await collectInputs();
    } catch (err) {
      log(`[llm-worker] collectInputs threw: ${errMsg(err)} — treating as error`);
      return {
        ok: false,
        reason: 'error',
        filled: zeroFilled(),
        costUsd: 0,
        durationMs: now() - started,
      };
    }
    if (!inputs) {
      return {
        ok: false,
        reason: 'no_inputs',
        filled: zeroFilled(),
        costUsd: 0,
        durationMs: now() - started,
      };
    }

    const filled = zeroFilled();
    const ctx: SummarizerContext = { cache, ...baseCtx };

    // Helper — run a tier, return whether to keep going. Records filled count
    // as the delta in `cache.stats().entries`. Records budget-skip in the
    // outer scope via `budgetExceeded`.
    let budgetExceeded = false;
    let unexpectedError = false;

    // Stop firing new tiers once we're at 95% of the daily budget so a
    // single batched call (haiku ~$0.02 baseline, sonnet T5 ~$0.10) can't
    // push us materially over the cap. Spec §Cost discipline implies the
    // budget is a HARD cap.
    const budgetCeiling = cfg.dailyBudgetUsd * 0.95;
    const runTier = async (
      label: 't1' | 't2' | 't3' | 't4' | 't5',
      fn: () => Promise<unknown>,
    ): Promise<void> => {
      if (budgetExceeded || unexpectedError) return;
      if (cache.stats().todayCostUsd >= budgetCeiling) {
        budgetExceeded = true;
        return;
      }
      const entriesBefore = cache.stats().entries;
      try {
        await fn();
      } catch (err) {
        log(`[llm-worker] tier ${label} error: ${errMsg(err)}`);
        unexpectedError = true;
        return;
      }
      const entriesAfter = cache.stats().entries;
      filled[label] = Math.max(0, entriesAfter - entriesBefore);
      // Re-check budget after each tier so subsequent tiers know to abort.
      if (cache.stats().todayCostUsd >= budgetCeiling) {
        budgetExceeded = true;
      }
    };

    await runTier('t1', () => summarizeSessions(inputs.sessions, ctx));
    // T2 and T3 inputs include `sessionDigests` that depend on T1 outputs.
    // Rebuild now that T1 has populated the cache so the worker-write keys
    // match what the aggregator's render path will recompute.
    const t2Inputs = inputs.rebuildMembers
      ? inputs.rebuildMembers((k) => cache.get(k))
      : inputs.members;
    const t3Inputs = inputs.rebuildProjects
      ? inputs.rebuildProjects((k) => cache.get(k))
      : inputs.projects;
    await runTier('t2', () => summarizeMembers(t2Inputs, ctx));
    await runTier('t3', () => summarizeProjects(t3Inputs, ctx));
    await runTier('t4', () => summarizeAttention(inputs.attention, ctx));

    // T5 cadence: counter starts at 0 so tick #1 (counter 0) runs T5 — warm
    // up the brief immediately on boot. After this tick increments the
    // counter, ticks 2..N skip until counter wraps back to 0.
    const shouldRunT5 = tickCounter % briefEveryNTicks === 0;
    tickCounter = (tickCounter + 1) % briefEveryNTicks;
    if (shouldRunT5) {
      // Rebuild T5 input now that T1/T3/T4 may have populated the cache.
      // This is what aligns the worker-write key with the aggregator-read
      // key — both sides see the same populated maps. Fall back to the
      // pre-built `inputs.brief` if no rebuild callback was supplied
      // (legacy callers / direct unit tests).
      const briefInput = inputs.rebuildBrief
        ? inputs.rebuildBrief((k) => cache.get(k))
        : inputs.brief;
      await runTier('t5', () => summarizeDailyBrief(briefInput, ctx));
    }

    const costUsd = cache.stats().todayCostUsd - costBefore;
    const durationMs = now() - started;
    if (unexpectedError) {
      return { ok: false, reason: 'error', filled, costUsd, durationMs };
    }
    if (budgetExceeded) {
      return {
        ok: false,
        reason: 'budget_exceeded',
        filled,
        costUsd,
        durationMs,
      };
    }
    return { ok: true, filled, costUsd, durationMs };
  }

  function start(): Promise<TickResult> {
    if (inFlight) return inFlight;
    const p = tickOnce().finally(() => {
      inFlight = null;
    });
    inFlight = p;
    return p;
  }

  const timer: NodeJS.Timeout = setInterval(() => {
    if (stopped) return;
    if (inFlight) {
      log('[llm-worker] skip overlap');
      return;
    }
    // Fire-and-forget; the promise's `.finally` clears `inFlight`. Errors are
    // already caught inside `tickOnce`, but we guard the outer promise too so
    // any future refactor can't crash the interval.
    start().catch((err: unknown) => {
      log(`[llm-worker] unexpected outer throw: ${errMsg(err)}`);
    });
  }, cfg.workerIntervalMs);

  // Don't hold the event loop open if this is the only timer.
  if (typeof timer.unref === 'function') timer.unref();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
    runOnce: () => {
      if (stopped || !cfg.enabled) {
        return Promise.resolve(disabledResult(now, now()));
      }
      return start();
    },
  };
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
