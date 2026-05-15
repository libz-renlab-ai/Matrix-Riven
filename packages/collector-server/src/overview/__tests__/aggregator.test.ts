import { describe, it, expect } from 'vitest';
import type { CcStatusSnapshot } from '@matrix-riven/shared';
import { aggregateCost, aggregateProductivity, aggregateProjects } from '../aggregator.js';
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

  it('on tied cost_usd, falls back to user_id ascending', () => {
    const raw = emptyRaw();
    raw.latestPerSession.set('s1', snap({ session_id: 's1', user_id: 'zoe@x', cost_usd: 2 }));
    raw.latestPerSession.set('s2', snap({ session_id: 's2', user_id: 'alice@x', cost_usd: 2 }));
    const out = aggregateCost(raw);
    expect(out.per_user.map((u) => u.user_id)).toEqual(['alice@x', 'zoe@x']);
  });
});

// ────────────────────────────── aggregateProductivity ──────────────────────────────

describe('aggregateProductivity', () => {
  it('empty → empty per_user', () => {
    const out = aggregateProductivity(emptyRaw());
    expect(out.per_user).toEqual([]);
  });

  it('single user, single session: cumulative fields read from latest snapshot', () => {
    const raw = emptyRaw();
    raw.latestPerSession.set('s1', snap({
      session_id: 's1', user_id: 'alice@x',
      turn_count: 12, tool_calls_total: 30, tool_calls_failed: 2,
      session_started_at: '2026-05-15T10:00:00.000Z',
      ts: '2026-05-15T10:30:00.000Z',
    }));
    const out = aggregateProductivity(raw);
    expect(out.per_user).toEqual([
      {
        user_id: 'alice@x',
        turn_count: 12,
        tool_calls_total: 30,
        tool_calls_failed: 2,
        session_count: 1,
        avg_session_minutes: 30,
        over_200k_count: 0,
      },
    ]);
  });

  it('multi user sorted by turn_count DESC', () => {
    const raw = emptyRaw();
    raw.latestPerSession.set('s1', snap({ session_id: 's1', user_id: 'alice@x', turn_count: 5 }));
    raw.latestPerSession.set('s2', snap({ session_id: 's2', user_id: 'bob@x', turn_count: 12 }));
    const out = aggregateProductivity(raw);
    expect(out.per_user.map((u) => u.user_id)).toEqual(['bob@x', 'alice@x']);
  });

  it('over_200k_count counts sessions where ANY snapshot is OVER_200K (uses allSnapshots)', () => {
    const raw = emptyRaw();
    raw.latestPerSession.set('s1', snap({ session_id: 's1', user_id: 'alice@x' }));
    raw.latestPerSession.set('s2', snap({ session_id: 's2', user_id: 'alice@x' }));
    raw.allSnapshots = [
      snap({ session_id: 's1', user_id: 'alice@x', session_health: 'OK' }),
      snap({ session_id: 's1', user_id: 'alice@x', session_health: 'OVER_200K' }),
      snap({ session_id: 's2', user_id: 'alice@x', session_health: 'OK' }),
    ];
    const out = aggregateProductivity(raw);
    expect(out.per_user[0]!.over_200k_count).toBe(1);
  });

  it('avg_session_minutes: averaged across sessions with valid started_at', () => {
    const raw = emptyRaw();
    raw.latestPerSession.set('s1', snap({
      session_id: 's1', user_id: 'alice@x',
      session_started_at: '2026-05-15T10:00:00.000Z',
      ts: '2026-05-15T10:20:00.000Z',  // 20 min
    }));
    raw.latestPerSession.set('s2', snap({
      session_id: 's2', user_id: 'alice@x',
      session_started_at: '2026-05-15T11:00:00.000Z',
      ts: '2026-05-15T12:00:00.000Z',  // 60 min
    }));
    const out = aggregateProductivity(raw);
    expect(out.per_user[0]!.avg_session_minutes).toBe(40);
  });

  it('missing cumulative fields counted as 0; avg_session_minutes = 0 when no started_at', () => {
    const raw = emptyRaw();
    raw.latestPerSession.set('s1', snap({ session_id: 's1', user_id: 'alice@x' }));
    const out = aggregateProductivity(raw);
    expect(out.per_user[0]).toEqual({
      user_id: 'alice@x',
      turn_count: 0,
      tool_calls_total: 0,
      tool_calls_failed: 0,
      session_count: 1,
      avg_session_minutes: 0,
      over_200k_count: 0,
    });
  });

  it('on tied turn_count, falls back to user_id ascending', () => {
    const raw = emptyRaw();
    raw.latestPerSession.set('s1', snap({ session_id: 's1', user_id: 'zoe@x', turn_count: 5 }));
    raw.latestPerSession.set('s2', snap({ session_id: 's2', user_id: 'alice@x', turn_count: 5 }));
    const out = aggregateProductivity(raw);
    expect(out.per_user.map((u) => u.user_id)).toEqual(['alice@x', 'zoe@x']);
  });
});

// ────────────────────────────── aggregateProjects ──────────────────────────────

describe('aggregateProjects', () => {
  it('empty → empty arrays', () => {
    const out = aggregateProjects(emptyRaw());
    expect(out.top_cwd).toEqual([]);
    expect(out.top_git_branch).toEqual([]);
    expect(out.user_cwd_matrix).toEqual([]);
  });

  it('top_cwd uses basename(cwd), aggregates session_count and total_minutes', () => {
    const raw = emptyRaw();
    raw.latestPerSession.set('s1', snap({
      session_id: 's1', user_id: 'a@x', cwd: '/home/a/projA',
      session_started_at: '2026-05-15T10:00:00.000Z',
      ts: '2026-05-15T10:30:00.000Z',  // 30 min
    }));
    raw.latestPerSession.set('s2', snap({
      session_id: 's2', user_id: 'b@x', cwd: '/home/b/projA',
      session_started_at: '2026-05-15T11:00:00.000Z',
      ts: '2026-05-15T11:20:00.000Z',  // 20 min
    }));
    raw.latestPerSession.set('s3', snap({
      session_id: 's3', user_id: 'a@x', cwd: '/Z/projB',
    }));
    const out = aggregateProjects(raw);
    expect(out.top_cwd).toEqual([
      { cwd_basename: 'projA', session_count: 2, total_minutes: 50 },
      { cwd_basename: 'projB', session_count: 1, total_minutes: 0 },
    ]);
  });

  it('top_git_branch sorted DESC by session_count', () => {
    const raw = emptyRaw();
    raw.latestPerSession.set('s1', snap({ session_id: 's1', git_branch: 'main' }));
    raw.latestPerSession.set('s2', snap({ session_id: 's2', git_branch: 'main' }));
    raw.latestPerSession.set('s3', snap({ session_id: 's3', git_branch: 'feature/x' }));
    const out = aggregateProjects(raw);
    expect(out.top_git_branch).toEqual([
      { git_branch: 'main', session_count: 2 },
      { git_branch: 'feature/x', session_count: 1 },
    ]);
  });

  it('user_cwd_matrix groups (user, cwd) pairs', () => {
    const raw = emptyRaw();
    raw.latestPerSession.set('s1', snap({ session_id: 's1', user_id: 'a@x', cwd: '/p/A' }));
    raw.latestPerSession.set('s2', snap({ session_id: 's2', user_id: 'a@x', cwd: '/p/A' }));
    raw.latestPerSession.set('s3', snap({ session_id: 's3', user_id: 'a@x', cwd: '/p/B' }));
    raw.latestPerSession.set('s4', snap({ session_id: 's4', user_id: 'b@x', cwd: '/p/A' }));
    const out = aggregateProjects(raw);
    expect(out.user_cwd_matrix).toEqual(expect.arrayContaining([
      { user_id: 'a@x', cwd_basename: 'A', session_count: 2 },
      { user_id: 'a@x', cwd_basename: 'B', session_count: 1 },
      { user_id: 'b@x', cwd_basename: 'A', session_count: 1 },
    ]));
    expect(out.user_cwd_matrix).toHaveLength(3);
  });

  it('snapshots without cwd skipped from cwd/matrix; without git_branch skipped from branch', () => {
    const raw = emptyRaw();
    raw.latestPerSession.set('s1', snap({ session_id: 's1', user_id: 'a@x' }));
    raw.latestPerSession.set('s2', snap({ session_id: 's2', user_id: 'a@x', cwd: '/p/A' }));
    const out = aggregateProjects(raw);
    expect(out.top_cwd).toEqual([{ cwd_basename: 'A', session_count: 1, total_minutes: 0 }]);
    expect(out.top_git_branch).toEqual([]);
    expect(out.user_cwd_matrix).toEqual([{ user_id: 'a@x', cwd_basename: 'A', session_count: 1 }]);
  });

  it('top_cwd and top_git_branch capped at 10 entries', () => {
    const raw = emptyRaw();
    for (let i = 0; i < 15; i++) {
      raw.latestPerSession.set(`s${i}`, snap({
        session_id: `s${i}`,
        cwd: `/p/proj${i}`,
        git_branch: `branch-${i}`,
      }));
    }
    const out = aggregateProjects(raw);
    expect(out.top_cwd).toHaveLength(10);
    expect(out.top_git_branch).toHaveLength(10);
  });
});
