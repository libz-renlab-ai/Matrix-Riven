import { describe, it, expect } from 'vitest';
import type { CcStatusSnapshot } from '@matrix-riven/shared';
import { aggregateCost } from '../aggregator.js';
import type { RawSnapshots } from '../types.js';

// ────────────────────────────── fixture helpers ──────────────────────────────

function snap(overrides: Partial<CcStatusSnapshot> = {}): CcStatusSnapshot {
  return {
    schema_version: 1,
    session_id: 'sess-1',
    user_id: 'alice@x',
    ts: '2026-05-15T10:00:00.000Z',
    event: 'user_prompt_submit',
    ...overrides,
  };
}

function emptyRaw(): RawSnapshots {
  return {
    allSnapshots: [],
    latestPerSession: new Map(),
    redactionsPerSession: new Map(),
  };
}

// ────────────────────────────── aggregateCost ──────────────────────────────

describe('aggregateCost', () => {
  it('empty input → all zeros, empty arrays', () => {
    const out = aggregateCost(emptyRaw());
    expect(out.team_total_usd).toBe(0);
    expect(out.per_user).toEqual([]);
    expect(out.quota_per_user).toEqual([]);
    expect(out.model_distribution).toEqual([]);
  });

  it('sums team_total_usd from latest cc-status per session', () => {
    const raw = emptyRaw();
    raw.latestPerSession.set('s1', snap({ session_id: 's1', user_id: 'alice@x', cost_usd: 1.2 }));
    raw.latestPerSession.set('s2', snap({ session_id: 's2', user_id: 'alice@x', cost_usd: 3.4 }));
    raw.latestPerSession.set('s3', snap({ session_id: 's3', user_id: 'bob@x', cost_usd: 0.5 }));
    const out = aggregateCost(raw);
    expect(out.team_total_usd).toBeCloseTo(5.1, 5);
  });

  it('per_user sorted by cost_usd DESC', () => {
    const raw = emptyRaw();
    raw.latestPerSession.set('s1', snap({ session_id: 's1', user_id: 'alice@x', cost_usd: 2 }));
    raw.latestPerSession.set('s2', snap({ session_id: 's2', user_id: 'bob@x', cost_usd: 5 }));
    raw.latestPerSession.set('s3', snap({ session_id: 's3', user_id: 'carol@x', cost_usd: 1 }));
    const out = aggregateCost(raw);
    expect(out.per_user).toEqual([
      { user_id: 'bob@x', cost_usd: 5 },
      { user_id: 'alice@x', cost_usd: 2 },
      { user_id: 'carol@x', cost_usd: 1 },
    ]);
  });

  it('quota_per_user takes the latest snapshot per user (by ts)', () => {
    const raw = emptyRaw();
    raw.latestPerSession.set('s1', snap({
      session_id: 's1', user_id: 'alice@x',
      ts: '2026-05-15T08:00:00.000Z',
      subscription_tier: 'max20x', five_hour_utilization: 0.4, seven_day_utilization: 0.1,
      five_hour_reset_at: 1000, seven_day_reset_at: 2000, quota_stale: false,
    }));
    raw.latestPerSession.set('s2', snap({
      session_id: 's2', user_id: 'alice@x',
      ts: '2026-05-15T12:00:00.000Z',
      subscription_tier: 'max20x', five_hour_utilization: 0.8, seven_day_utilization: 0.3,
      five_hour_reset_at: 1500, seven_day_reset_at: 2500, quota_stale: true,
    }));
    const out = aggregateCost(raw);
    expect(out.quota_per_user).toEqual([
      {
        user_id: 'alice@x',
        subscription_tier: 'max20x',
        five_hour_utilization: 0.8,
        seven_day_utilization: 0.3,
        five_hour_reset_at: 1500,
        seven_day_reset_at: 2500,
        stale: true,
      },
    ]);
  });

  it('model_distribution counts every snapshot, pct sums to 1.0', () => {
    const raw = emptyRaw();
    raw.allSnapshots = [
      snap({ model: 'claude-opus-4-7' }),
      snap({ model: 'claude-opus-4-7' }),
      snap({ model: 'claude-sonnet-4-6' }),
      snap({ model: 'claude-haiku-4-5' }),
    ];
    const out = aggregateCost(raw);
    expect(out.model_distribution).toEqual([
      { model: 'claude-opus-4-7', snapshot_count: 2, pct: 0.5 },
      { model: 'claude-sonnet-4-6', snapshot_count: 1, pct: 0.25 },
      { model: 'claude-haiku-4-5', snapshot_count: 1, pct: 0.25 },
    ]);
    const totalPct = out.model_distribution.reduce((a, m) => a + m.pct, 0);
    expect(totalPct).toBeCloseTo(1, 5);
  });

  it('missing cost_usd counted as 0', () => {
    const raw = emptyRaw();
    raw.latestPerSession.set('s1', snap({ session_id: 's1', user_id: 'alice@x' }));
    raw.latestPerSession.set('s2', snap({ session_id: 's2', user_id: 'alice@x', cost_usd: 2 }));
    const out = aggregateCost(raw);
    expect(out.team_total_usd).toBe(2);
    expect(out.per_user).toEqual([{ user_id: 'alice@x', cost_usd: 2 }]);
  });
});
