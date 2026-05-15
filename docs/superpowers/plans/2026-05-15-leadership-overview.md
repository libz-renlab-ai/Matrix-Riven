# Leadership Overview Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/api/overview?date=YYYY-MM-DD` endpoint + Overview tab to the dashboard so leadership can see team cost/productivity/projects/quality aggregations using already-uploaded cc-status + transcript data. Client packages remain unchanged.

**Architecture:** Pure-function aggregators in `packages/collector-server/src/overview/` consume a `RawSnapshots` shape produced by an on-demand disk-scan over `<RIVEN_COLLECTOR_DIR>/<user>/<date>/<sid>.cc-status.jsonl` + sidecar `.l1_redaction_count.json`. A single new route in `mock-server.ts` orchestrates scan + aggregate. The dashboard HTML adds a Tab switcher and a 2×2 panel grid.

**Tech Stack:** TypeScript / Node 22 / Vitest / pnpm workspaces. No new runtime deps. Existing tools: `CcStatusSnapshot` from `@matrix-riven/shared`, `tsup` ESM build, `safeUserId` / `dateStamp` from shared cc-status.

**Reference spec:** [`docs/superpowers/specs/2026-05-15-leadership-overview-design.md`](../specs/2026-05-15-leadership-overview-design.md)

---

## File Structure

**New files:**
- `packages/collector-server/src/overview/types.ts` — TS interfaces for `RawSnapshots` and `OverviewResponse` (cost/productivity/projects/quality blocks)
- `packages/collector-server/src/overview/aggregator.ts` — Pure functions: `aggregateCost`, `aggregateProductivity`, `aggregateProjects`, `aggregateQuality`, `buildOverview` orchestrator
- `packages/collector-server/src/overview/disk-scan.ts` — `scanForOverview(outputDir, date)` reads `<user>/<date>/` files, parses cc-status JSONL, reads `.l1_redaction_count.json` sidecars
- `packages/collector-server/src/overview/__tests__/aggregator.test.ts` — ~20 fixture-driven test cases
- `packages/collector-server/src/overview/__tests__/disk-scan.test.ts` — ~5 tmpdir-driven test cases

**Modified files:**
- `packages/collector-server/src/mock-server.ts` — add `if (path === '/api/overview') { ... }` branch in GET handler
- `packages/collector-server/src/__tests__/mock-server.test.ts` — append ~5 cases for the new route
- `packages/collector-server/src/dashboard-html.ts` — add Tab nav + Overview tab content (~200 lines of HTML+JS+CSS)
- `packages/collector-server/src/__tests__/dashboard-html.test.ts` — append ~3 hook-string assertions
- `README.md` — append a small section documenting the Overview tab

---

## Pre-flight checks

Before starting Task 1, verify the workspace is clean and tests pass on `main`:

```bash
git status                          # working tree should be clean
pnpm install                        # ensure dependencies
pnpm -r typecheck                   # expect: all packages Done
pnpm test                           # expect: 461 tests passed
pnpm -r build                       # expect: all packages Build success
```

If any of those fail, stop and resolve before touching the plan.

---

## Task 1: Define types (foundation)

**Files:**
- Create: `packages/collector-server/src/overview/types.ts`

- [ ] **Step 1: Create `types.ts` with all interfaces**

Write to `packages/collector-server/src/overview/types.ts`:

```typescript
import type { CcStatusSnapshot } from '@matrix-riven/shared';

/**
 * Output of disk-scan, input to aggregator. Three projections of the same
 * cc-status data — kept separate so each aggregator picks the cheapest view:
 *   - allSnapshots:        every snapshot, for model-distribution counting
 *   - latestPerSession:    one row per session, for cumulative-field sums
 *   - redactionsPerSession: L1 PII redaction counts from <sid>.l1_redaction_count.json
 */
export interface RawSnapshots {
  allSnapshots: CcStatusSnapshot[];
  latestPerSession: Map<string, CcStatusSnapshot>;
  redactionsPerSession: Map<string, number>;
}

/** Top-level response of GET /api/overview. */
export interface OverviewResponse {
  date: string;
  generated_at: string;
  cost: CostBlock;
  productivity: ProductivityBlock;
  projects: ProjectsBlock;
  quality: QualityBlock;
}

// ────────────────────────────── Cost ──────────────────────────────

export interface CostBlock {
  team_total_usd: number;
  per_user: CostPerUser[];
  quota_per_user: QuotaPerUser[];
  model_distribution: ModelDistribution[];
}

export interface CostPerUser {
  user_id: string;
  cost_usd: number;
}

export interface QuotaPerUser {
  user_id: string;
  subscription_tier?: string;
  five_hour_utilization?: number;
  seven_day_utilization?: number;
  five_hour_reset_at?: number;
  seven_day_reset_at?: number;
  stale: boolean;
}

export interface ModelDistribution {
  model: string;
  snapshot_count: number;
  pct: number;
}

// ────────────────────────────── Productivity ──────────────────────────────

export interface ProductivityBlock {
  per_user: ProductivityPerUser[];
}

export interface ProductivityPerUser {
  user_id: string;
  turn_count: number;
  tool_calls_total: number;
  tool_calls_failed: number;
  session_count: number;
  avg_session_minutes: number;
  over_200k_count: number;
}

// ────────────────────────────── Projects ──────────────────────────────

export interface ProjectsBlock {
  top_cwd: TopCwd[];
  top_git_branch: TopGitBranch[];
  user_cwd_matrix: UserCwdEntry[];
}

export interface TopCwd {
  cwd_basename: string;
  session_count: number;
  total_minutes: number;
}

export interface TopGitBranch {
  git_branch: string;
  session_count: number;
}

export interface UserCwdEntry {
  user_id: string;
  cwd_basename: string;
  session_count: number;
}

// ────────────────────────────── Quality ──────────────────────────────

export interface QualityBlock {
  team_total_redactions: number;
  redactions_per_user: RedactionPerUser[];
  tool_failures_per_user: ToolFailurePerUser[];
  out_of_control_sessions: OutOfControlSession[];
}

export interface RedactionPerUser {
  user_id: string;
  redaction_count: number;
}

export interface ToolFailurePerUser {
  user_id: string;
  tool_calls_failed: number;
}

export interface OutOfControlSession {
  user_id: string;
  session_id: string;
  reason: 'OVER_200K';
  ts: string;
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm --filter @matrix-riven/collector-server typecheck`
Expected: `Done` (no TS errors)

- [ ] **Step 3: Commit**

```bash
git add packages/collector-server/src/overview/types.ts
git commit -m "feat(overview): TS interfaces for RawSnapshots and OverviewResponse"
```

---

## Task 2: aggregateCost (TDD)

**Files:**
- Create: `packages/collector-server/src/overview/__tests__/aggregator.test.ts`
- Create: `packages/collector-server/src/overview/aggregator.ts`

- [ ] **Step 1: Write the first failing test (empty input)**

Create `packages/collector-server/src/overview/__tests__/aggregator.test.ts`:

```typescript
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
});
```

- [ ] **Step 2: Run the test (expect to fail)**

Run: `pnpm --filter @matrix-riven/collector-server vitest run overview/__tests__/aggregator.test.ts 2>&1 | tail -20`
Expected: FAIL with `Cannot find module '../aggregator.js'` or similar (the file doesn't exist yet).

- [ ] **Step 3: Create minimal `aggregator.ts` to pass empty case**

Create `packages/collector-server/src/overview/aggregator.ts`:

```typescript
import type { CcStatusSnapshot } from '@matrix-riven/shared';
import type {
  CostBlock,
  RawSnapshots,
} from './types.js';

export function aggregateCost(raw: RawSnapshots): CostBlock {
  return {
    team_total_usd: 0,
    per_user: [],
    quota_per_user: [],
    model_distribution: [],
  };
}
```

- [ ] **Step 4: Run the test (expect to pass)**

Run: `pnpm --filter @matrix-riven/collector-server vitest run overview/__tests__/aggregator.test.ts 2>&1 | tail -10`
Expected: PASS (1 test).

- [ ] **Step 5: Add 4 more failing tests covering real data**

Append to `aggregator.test.ts` (still inside the same `describe('aggregateCost')` block, before its closing `});`):

```typescript
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
    // Two sessions for alice, alice's later one has stale quota.
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
```

- [ ] **Step 6: Run tests (expect failures)**

Run: `pnpm --filter @matrix-riven/collector-server vitest run overview/__tests__/aggregator.test.ts 2>&1 | tail -20`
Expected: 4 new tests fail. Empty-input test still passes.

- [ ] **Step 7: Implement the full `aggregateCost`**

Replace the body of `aggregateCost` in `aggregator.ts`. Final file content:

```typescript
import type { CcStatusSnapshot } from '@matrix-riven/shared';
import type {
  CostBlock,
  CostPerUser,
  ModelDistribution,
  QuotaPerUser,
  RawSnapshots,
} from './types.js';

export function aggregateCost(raw: RawSnapshots): CostBlock {
  const sessionsByUser = groupSessionsByUser(raw.latestPerSession);

  // per_user: sum cost_usd of each user's latest-per-session snapshots, sorted DESC.
  const perUser: CostPerUser[] = [];
  for (const [user_id, snaps] of sessionsByUser) {
    const cost_usd = sumOpt(snaps.map((s) => s.cost_usd));
    perUser.push({ user_id, cost_usd });
  }
  perUser.sort((a, b) => b.cost_usd - a.cost_usd);
  const team_total_usd = perUser.reduce((acc, u) => acc + u.cost_usd, 0);

  // quota_per_user: per user, take the snapshot with the most recent ts that carries quota fields.
  const quota_per_user: QuotaPerUser[] = [];
  for (const [user_id, snaps] of sessionsByUser) {
    const latest = pickLatestByTs(snaps);
    if (!latest) continue;
    quota_per_user.push({
      user_id,
      subscription_tier: latest.subscription_tier,
      five_hour_utilization: latest.five_hour_utilization,
      seven_day_utilization: latest.seven_day_utilization,
      five_hour_reset_at: latest.five_hour_reset_at,
      seven_day_reset_at: latest.seven_day_reset_at,
      stale: latest.quota_stale === true,
    });
  }
  quota_per_user.sort((a, b) => a.user_id.localeCompare(b.user_id));

  // model_distribution: count over allSnapshots, sorted DESC by count.
  const model_distribution = computeModelDistribution(raw.allSnapshots);

  return { team_total_usd, per_user: perUser, quota_per_user, model_distribution };
}

// ────────────────────────────── shared helpers (used by other aggregators too) ──────────────────────────────

export function groupSessionsByUser(
  latestPerSession: Map<string, CcStatusSnapshot>,
): Map<string, CcStatusSnapshot[]> {
  const out = new Map<string, CcStatusSnapshot[]>();
  for (const s of latestPerSession.values()) {
    const list = out.get(s.user_id);
    if (list) list.push(s);
    else out.set(s.user_id, [s]);
  }
  return out;
}

export function sumOpt(values: Array<number | undefined>): number {
  let acc = 0;
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) acc += v;
  }
  return acc;
}

export function pickLatestByTs(
  snaps: readonly CcStatusSnapshot[],
): CcStatusSnapshot | null {
  if (snaps.length === 0) return null;
  let best = snaps[0]!;
  for (const s of snaps) {
    if (s.ts > best.ts) best = s;
  }
  return best;
}

function computeModelDistribution(all: readonly CcStatusSnapshot[]): ModelDistribution[] {
  const counts = new Map<string, number>();
  for (const s of all) {
    const m = s.model;
    if (typeof m !== 'string' || m.length === 0) continue;
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
  const out: ModelDistribution[] = [];
  for (const [model, snapshot_count] of counts) {
    out.push({ model, snapshot_count, pct: total === 0 ? 0 : snapshot_count / total });
  }
  out.sort((a, b) => b.snapshot_count - a.snapshot_count);
  return out;
}
```

- [ ] **Step 8: Run tests (expect all pass)**

Run: `pnpm --filter @matrix-riven/collector-server vitest run overview/__tests__/aggregator.test.ts 2>&1 | tail -10`
Expected: 5 tests pass (1 empty + 4 data).

- [ ] **Step 9: Commit**

```bash
git add packages/collector-server/src/overview/aggregator.ts \
         packages/collector-server/src/overview/__tests__/aggregator.test.ts
git commit -m "feat(overview): aggregateCost + shared helpers"
```

---

## Task 3: aggregateProductivity (TDD)

**Files:**
- Modify: `packages/collector-server/src/overview/aggregator.ts`
- Modify: `packages/collector-server/src/overview/__tests__/aggregator.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `aggregator.test.ts` (after the `describe('aggregateCost', ...)` block):

```typescript
import { aggregateProductivity } from '../aggregator.js';

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
});
```

- [ ] **Step 2: Run tests (expect failures)**

Run: `pnpm --filter @matrix-riven/collector-server vitest run overview/__tests__/aggregator.test.ts 2>&1 | tail -10`
Expected: 6 productivity tests fail (no aggregateProductivity export yet).

- [ ] **Step 3: Implement `aggregateProductivity`**

Append to `aggregator.ts` (after `aggregateCost` and shared helpers):

```typescript
import type { ProductivityBlock, ProductivityPerUser } from './types.js';

export function aggregateProductivity(raw: RawSnapshots): ProductivityBlock {
  const sessionsByUser = groupSessionsByUser(raw.latestPerSession);

  // Pre-compute "session_ids with any OVER_200K" from allSnapshots so we
  // count without needing to re-scan inside the user loop.
  const over200kSessions = new Set<string>();
  for (const s of raw.allSnapshots) {
    if (s.session_health === 'OVER_200K') over200kSessions.add(s.session_id);
  }

  const per_user: ProductivityPerUser[] = [];
  for (const [user_id, snaps] of sessionsByUser) {
    const turn_count = sumOpt(snaps.map((s) => s.turn_count));
    const tool_calls_total = sumOpt(snaps.map((s) => s.tool_calls_total));
    const tool_calls_failed = sumOpt(snaps.map((s) => s.tool_calls_failed));
    const session_count = snaps.length;
    const avg_session_minutes = averageMinutes(snaps);
    const over_200k_count = snaps.reduce(
      (acc, s) => acc + (over200kSessions.has(s.session_id) ? 1 : 0),
      0,
    );
    per_user.push({
      user_id,
      turn_count,
      tool_calls_total,
      tool_calls_failed,
      session_count,
      avg_session_minutes,
      over_200k_count,
    });
  }
  per_user.sort((a, b) => b.turn_count - a.turn_count);
  return { per_user };
}

function averageMinutes(snaps: readonly CcStatusSnapshot[]): number {
  const durations: number[] = [];
  for (const s of snaps) {
    if (!s.session_started_at) continue;
    const start = Date.parse(s.session_started_at);
    const end = Date.parse(s.ts);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    durations.push((end - start) / 1000 / 60);
  }
  if (durations.length === 0) return 0;
  const total = durations.reduce((a, b) => a + b, 0);
  return Math.round((total / durations.length) * 10) / 10;
}
```

- [ ] **Step 4: Run tests (expect pass)**

Run: `pnpm --filter @matrix-riven/collector-server vitest run overview/__tests__/aggregator.test.ts 2>&1 | tail -10`
Expected: 11 tests pass (5 cost + 6 productivity).

- [ ] **Step 5: Commit**

```bash
git add packages/collector-server/src/overview/aggregator.ts \
         packages/collector-server/src/overview/__tests__/aggregator.test.ts
git commit -m "feat(overview): aggregateProductivity"
```

---

## Task 4: aggregateProjects (TDD)

**Files:**
- Modify: `packages/collector-server/src/overview/aggregator.ts`
- Modify: `packages/collector-server/src/overview/__tests__/aggregator.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `aggregator.test.ts`:

```typescript
import { aggregateProjects } from '../aggregator.js';

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
```

- [ ] **Step 2: Run tests (expect failures)**

Run: `pnpm --filter @matrix-riven/collector-server vitest run overview/__tests__/aggregator.test.ts 2>&1 | tail -10`
Expected: 6 projects tests fail.

- [ ] **Step 3: Implement `aggregateProjects`**

Append to `aggregator.ts`:

```typescript
import { basename } from 'node:path';
import type {
  ProjectsBlock,
  TopCwd,
  TopGitBranch,
  UserCwdEntry,
} from './types.js';

export function aggregateProjects(raw: RawSnapshots): ProjectsBlock {
  // ── top_cwd: aggregate session count + total minutes per cwd_basename ──
  const cwdAcc = new Map<string, { session_count: number; total_minutes: number }>();
  for (const s of raw.latestPerSession.values()) {
    if (typeof s.cwd !== 'string' || s.cwd.length === 0) continue;
    const key = basename(s.cwd);
    const minutes = sessionMinutes(s);
    const cur = cwdAcc.get(key);
    if (cur) {
      cur.session_count += 1;
      cur.total_minutes += minutes;
    } else {
      cwdAcc.set(key, { session_count: 1, total_minutes: minutes });
    }
  }
  const top_cwd: TopCwd[] = Array.from(cwdAcc, ([cwd_basename, agg]) => ({
    cwd_basename,
    session_count: agg.session_count,
    total_minutes: Math.round(agg.total_minutes),
  }))
    .sort((a, b) => b.session_count - a.session_count)
    .slice(0, 10);

  // ── top_git_branch ──
  const branchAcc = new Map<string, number>();
  for (const s of raw.latestPerSession.values()) {
    if (typeof s.git_branch !== 'string' || s.git_branch.length === 0) continue;
    branchAcc.set(s.git_branch, (branchAcc.get(s.git_branch) ?? 0) + 1);
  }
  const top_git_branch: TopGitBranch[] = Array.from(branchAcc, ([git_branch, session_count]) => ({
    git_branch,
    session_count,
  }))
    .sort((a, b) => b.session_count - a.session_count)
    .slice(0, 10);

  // ── user_cwd_matrix ──
  // Two-level Map avoids key-encoding fragility. Replace the entire
  // user_cwd_matrix block (from `const matrixAcc` to the user_cwd_matrix.sort
  // call) with the following — keep the rest of aggregateProjects unchanged:
  //
  //   const matrixAcc = new Map<string, Map<string, number>>();
  //   for (const s of raw.latestPerSession.values()) {
  //     if (typeof s.cwd !== 'string' || s.cwd.length === 0) continue;
  //     const bn = basename(s.cwd);
  //     let byCwd = matrixAcc.get(s.user_id);
  //     if (!byCwd) {
  //       byCwd = new Map();
  //       matrixAcc.set(s.user_id, byCwd);
  //     }
  //     byCwd.set(bn, (byCwd.get(bn) ?? 0) + 1);
  //   }
  //   const user_cwd_matrix: UserCwdEntry[] = [];
  //   for (const [user_id, byCwd] of matrixAcc) {
  //     for (const [cwd_basename, session_count] of byCwd) {
  //       user_cwd_matrix.push({ user_id, cwd_basename, session_count });
  //     }
  //   }
  //
  // (The flat-key snippet shown below is the original draft; replace with the
  // above to avoid storing emails inside a string-encoded key.)
  const matrixAcc = new Map<string, number>();  // flat-key draft — see above\0${cwd_basename}`
  for (const s of raw.latestPerSession.values()) {
    if (typeof s.cwd !== 'string' || s.cwd.length === 0) continue;
    const key = `${s.user_id} ${basename(s.cwd)}`;
    matrixAcc.set(key, (matrixAcc.get(key) ?? 0) + 1);
  }
  const user_cwd_matrix: UserCwdEntry[] = [];
  for (const [key, session_count] of matrixAcc) {
    const [user_id, cwd_basename] = key.split(' ');
    user_cwd_matrix.push({ user_id: user_id!, cwd_basename: cwd_basename!, session_count });
  }
  user_cwd_matrix.sort((a, b) =>
    a.user_id.localeCompare(b.user_id) || b.session_count - a.session_count,
  );

  return { top_cwd, top_git_branch, user_cwd_matrix };
}

function sessionMinutes(s: CcStatusSnapshot): number {
  if (!s.session_started_at) return 0;
  const start = Date.parse(s.session_started_at);
  const end = Date.parse(s.ts);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return (end - start) / 1000 / 60;
}
```

- [ ] **Step 4: Run tests (expect pass)**

Run: `pnpm --filter @matrix-riven/collector-server vitest run overview/__tests__/aggregator.test.ts 2>&1 | tail -10`
Expected: 17 tests pass (5 + 6 + 6).

- [ ] **Step 5: Commit**

```bash
git add packages/collector-server/src/overview/aggregator.ts \
         packages/collector-server/src/overview/__tests__/aggregator.test.ts
git commit -m "feat(overview): aggregateProjects with top-10 cap"
```

---

## Task 5: aggregateQuality (TDD)

**Files:**
- Modify: `packages/collector-server/src/overview/aggregator.ts`
- Modify: `packages/collector-server/src/overview/__tests__/aggregator.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `aggregator.test.ts`:

```typescript
import { aggregateQuality } from '../aggregator.js';

describe('aggregateQuality', () => {
  it('empty → all zeros / empty arrays', () => {
    const out = aggregateQuality(emptyRaw());
    expect(out.team_total_redactions).toBe(0);
    expect(out.redactions_per_user).toEqual([]);
    expect(out.tool_failures_per_user).toEqual([]);
    expect(out.out_of_control_sessions).toEqual([]);
  });

  it('sums redactions across sessions per user; per_user sorted DESC', () => {
    const raw = emptyRaw();
    raw.latestPerSession.set('s1', snap({ session_id: 's1', user_id: 'a@x' }));
    raw.latestPerSession.set('s2', snap({ session_id: 's2', user_id: 'a@x' }));
    raw.latestPerSession.set('s3', snap({ session_id: 's3', user_id: 'b@x' }));
    raw.redactionsPerSession.set('s1', 2);
    raw.redactionsPerSession.set('s2', 3);
    raw.redactionsPerSession.set('s3', 1);
    const out = aggregateQuality(raw);
    expect(out.team_total_redactions).toBe(6);
    expect(out.redactions_per_user).toEqual([
      { user_id: 'a@x', redaction_count: 5 },
      { user_id: 'b@x', redaction_count: 1 },
    ]);
  });

  it('tool_failures_per_user takes latest snapshot per session, sums per user, sorted DESC', () => {
    const raw = emptyRaw();
    raw.latestPerSession.set('s1', snap({ session_id: 's1', user_id: 'a@x', tool_calls_failed: 4 }));
    raw.latestPerSession.set('s2', snap({ session_id: 's2', user_id: 'a@x', tool_calls_failed: 1 }));
    raw.latestPerSession.set('s3', snap({ session_id: 's3', user_id: 'b@x', tool_calls_failed: 10 }));
    const out = aggregateQuality(raw);
    expect(out.tool_failures_per_user).toEqual([
      { user_id: 'b@x', tool_calls_failed: 10 },
      { user_id: 'a@x', tool_calls_failed: 5 },
    ]);
  });

  it('out_of_control_sessions lists each session that had ANY OVER_200K snapshot, with that ts', () => {
    const raw = emptyRaw();
    raw.allSnapshots = [
      snap({ session_id: 's1', user_id: 'a@x', session_health: 'OK', ts: '2026-05-15T10:00:00.000Z' }),
      snap({ session_id: 's1', user_id: 'a@x', session_health: 'OVER_200K', ts: '2026-05-15T10:05:00.000Z' }),
      snap({ session_id: 's2', user_id: 'b@x', session_health: 'OVER_200K', ts: '2026-05-15T11:00:00.000Z' }),
    ];
    const out = aggregateQuality(raw);
    expect(out.out_of_control_sessions).toEqual([
      { user_id: 'a@x', session_id: 's1', reason: 'OVER_200K', ts: '2026-05-15T10:05:00.000Z' },
      { user_id: 'b@x', session_id: 's2', reason: 'OVER_200K', ts: '2026-05-15T11:00:00.000Z' },
    ]);
  });

  it('users with no redactions excluded from redactions_per_user', () => {
    const raw = emptyRaw();
    raw.latestPerSession.set('s1', snap({ session_id: 's1', user_id: 'a@x' }));
    raw.latestPerSession.set('s2', snap({ session_id: 's2', user_id: 'b@x' }));
    raw.redactionsPerSession.set('s1', 0);
    raw.redactionsPerSession.set('s2', 3);
    const out = aggregateQuality(raw);
    expect(out.redactions_per_user).toEqual([
      { user_id: 'b@x', redaction_count: 3 },
    ]);
    expect(out.team_total_redactions).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests (expect failures)**

Run: `pnpm --filter @matrix-riven/collector-server vitest run overview/__tests__/aggregator.test.ts 2>&1 | tail -10`
Expected: 5 quality tests fail.

- [ ] **Step 3: Implement `aggregateQuality`**

Append to `aggregator.ts`:

```typescript
import type {
  OutOfControlSession,
  QualityBlock,
  RedactionPerUser,
  ToolFailurePerUser,
} from './types.js';

export function aggregateQuality(raw: RawSnapshots): QualityBlock {
  // ── redactions per user (sum across sessions, drop zeros, sort DESC) ──
  const redByUser = new Map<string, number>();
  let team_total_redactions = 0;
  for (const [session_id, count] of raw.redactionsPerSession) {
    if (!Number.isFinite(count) || count <= 0) continue;
    const sess = raw.latestPerSession.get(session_id);
    if (!sess) continue;  // orphan sidecar — skip
    redByUser.set(sess.user_id, (redByUser.get(sess.user_id) ?? 0) + count);
    team_total_redactions += count;
  }
  const redactions_per_user: RedactionPerUser[] = Array.from(redByUser, ([user_id, redaction_count]) => ({
    user_id,
    redaction_count,
  })).sort((a, b) => b.redaction_count - a.redaction_count);

  // ── tool_failures_per_user ──
  const failByUser = new Map<string, number>();
  for (const s of raw.latestPerSession.values()) {
    const f = s.tool_calls_failed ?? 0;
    if (f === 0) continue;
    failByUser.set(s.user_id, (failByUser.get(s.user_id) ?? 0) + f);
  }
  const tool_failures_per_user: ToolFailurePerUser[] = Array.from(failByUser, ([user_id, tool_calls_failed]) => ({
    user_id,
    tool_calls_failed,
  })).sort((a, b) => b.tool_calls_failed - a.tool_calls_failed);

  // ── out_of_control_sessions: first OVER_200K snapshot per session ──
  const firstOver = new Map<string, CcStatusSnapshot>();
  for (const s of raw.allSnapshots) {
    if (s.session_health !== 'OVER_200K') continue;
    const prev = firstOver.get(s.session_id);
    if (!prev || s.ts < prev.ts) firstOver.set(s.session_id, s);
  }
  const out_of_control_sessions: OutOfControlSession[] = Array.from(firstOver.values())
    .map((s) => ({
      user_id: s.user_id,
      session_id: s.session_id,
      reason: 'OVER_200K' as const,
      ts: s.ts,
    }))
    .sort((a, b) => a.ts.localeCompare(b.ts));

  return {
    team_total_redactions,
    redactions_per_user,
    tool_failures_per_user,
    out_of_control_sessions,
  };
}
```

- [ ] **Step 4: Run tests (expect pass)**

Run: `pnpm --filter @matrix-riven/collector-server vitest run overview/__tests__/aggregator.test.ts 2>&1 | tail -10`
Expected: 22 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/collector-server/src/overview/aggregator.ts \
         packages/collector-server/src/overview/__tests__/aggregator.test.ts
git commit -m "feat(overview): aggregateQuality"
```

---

## Task 6: buildOverview orchestrator (TDD)

**Files:**
- Modify: `packages/collector-server/src/overview/aggregator.ts`
- Modify: `packages/collector-server/src/overview/__tests__/aggregator.test.ts`

- [ ] **Step 1: Add failing test**

Append to `aggregator.test.ts`:

```typescript
import { buildOverview } from '../aggregator.js';

describe('buildOverview', () => {
  it('returns top-level shape with date, generated_at, and all four blocks', () => {
    const raw = emptyRaw();
    raw.latestPerSession.set('s1', snap({ session_id: 's1', user_id: 'a@x', cost_usd: 1, turn_count: 5 }));
    const out = buildOverview(raw, '2026-05-15');
    expect(out.date).toBe('2026-05-15');
    expect(typeof out.generated_at).toBe('string');
    expect(Number.isFinite(Date.parse(out.generated_at))).toBe(true);
    expect(out.cost.team_total_usd).toBe(1);
    expect(out.productivity.per_user).toHaveLength(1);
    expect(out.projects.top_cwd).toEqual([]);  // no cwd in this snapshot
    expect(out.quality.team_total_redactions).toBe(0);
  });

  it('empty input returns structurally-complete response with zero/empty values', () => {
    const out = buildOverview(emptyRaw(), '2026-05-15');
    expect(out).toEqual({
      date: '2026-05-15',
      generated_at: expect.any(String),
      cost: { team_total_usd: 0, per_user: [], quota_per_user: [], model_distribution: [] },
      productivity: { per_user: [] },
      projects: { top_cwd: [], top_git_branch: [], user_cwd_matrix: [] },
      quality: { team_total_redactions: 0, redactions_per_user: [], tool_failures_per_user: [], out_of_control_sessions: [] },
    });
  });
});
```

- [ ] **Step 2: Run tests (expect failures)**

Run: `pnpm --filter @matrix-riven/collector-server vitest run overview/__tests__/aggregator.test.ts 2>&1 | tail -10`
Expected: 2 buildOverview tests fail.

- [ ] **Step 3: Implement `buildOverview`**

Append to `aggregator.ts`:

```typescript
import type { OverviewResponse } from './types.js';

export function buildOverview(raw: RawSnapshots, date: string): OverviewResponse {
  return {
    date,
    generated_at: new Date().toISOString(),
    cost: aggregateCost(raw),
    productivity: aggregateProductivity(raw),
    projects: aggregateProjects(raw),
    quality: aggregateQuality(raw),
  };
}
```

- [ ] **Step 4: Run tests + full collector-server suite**

Run: `pnpm --filter @matrix-riven/collector-server test 2>&1 | tail -10`
Expected: 24 overview tests pass; all pre-existing collector-server tests still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/collector-server/src/overview/aggregator.ts \
         packages/collector-server/src/overview/__tests__/aggregator.test.ts
git commit -m "feat(overview): buildOverview orchestrator"
```

---

## Task 7: disk-scan with tmpdir tests

**Files:**
- Create: `packages/collector-server/src/overview/disk-scan.ts`
- Create: `packages/collector-server/src/overview/__tests__/disk-scan.test.ts`

- [ ] **Step 1: Write disk-scan tests first**

Create `packages/collector-server/src/overview/__tests__/disk-scan.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanForOverview } from '../disk-scan.js';
import type { CcStatusSnapshot } from '@matrix-riven/shared';

let outputDir: string;

beforeEach(() => {
  outputDir = mkdtempSync(join(tmpdir(), 'riven-overview-scan-'));
});

afterEach(() => {
  rmSync(outputDir, { recursive: true, force: true });
});

function writeCcStatusJsonl(user: string, date: string, sid: string, lines: Array<Partial<CcStatusSnapshot>>): void {
  const dir = join(outputDir, user, date);
  mkdirSync(dir, { recursive: true });
  const content = lines
    .map((l) => JSON.stringify({
      schema_version: 1, session_id: sid, user_id: user,
      ts: '2026-05-15T10:00:00.000Z', event: 'user_prompt_submit',
      ...l,
    }))
    .join('\n') + '\n';
  writeFileSync(join(dir, `${sid}.cc-status.jsonl`), content);
}

function writeRedactionSidecar(user: string, date: string, sid: string, count: number): void {
  const dir = join(outputDir, user, date);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sid}.l1_redaction_count.json`), JSON.stringify({ count }));
}

describe('scanForOverview', () => {
  it('empty outputDir → empty raw structure', () => {
    const raw = scanForOverview(outputDir, '2026-05-15');
    expect(raw.allSnapshots).toEqual([]);
    expect(raw.latestPerSession.size).toBe(0);
    expect(raw.redactionsPerSession.size).toBe(0);
  });

  it('one user, one session, three snapshots: latest = max(ts)', () => {
    writeCcStatusJsonl('alice@x', '2026-05-15', 's1', [
      { ts: '2026-05-15T10:00:00.000Z', cost_usd: 1 },
      { ts: '2026-05-15T11:00:00.000Z', cost_usd: 2 },
      { ts: '2026-05-15T10:30:00.000Z', cost_usd: 1.5 },
    ]);
    const raw = scanForOverview(outputDir, '2026-05-15');
    expect(raw.allSnapshots).toHaveLength(3);
    expect(raw.latestPerSession.get('s1')?.cost_usd).toBe(2);
  });

  it('skips malformed JSON lines without dropping the rest of the file', () => {
    const dir = join(outputDir, 'alice@x', '2026-05-15');
    mkdirSync(dir, { recursive: true });
    const good = JSON.stringify({
      schema_version: 1, session_id: 's1', user_id: 'alice@x',
      ts: '2026-05-15T10:00:00.000Z', event: 'user_prompt_submit',
    });
    writeFileSync(join(dir, 's1.cc-status.jsonl'), `${good}\n{not valid json\n${good}\n`);
    const raw = scanForOverview(outputDir, '2026-05-15');
    expect(raw.allSnapshots).toHaveLength(2);
    expect(raw.latestPerSession.has('s1')).toBe(true);
  });

  it('reads redaction sidecar; missing sidecar → not in map', () => {
    writeCcStatusJsonl('alice@x', '2026-05-15', 's1', [{ ts: '2026-05-15T10:00:00.000Z' }]);
    writeCcStatusJsonl('alice@x', '2026-05-15', 's2', [{ ts: '2026-05-15T10:00:00.000Z' }]);
    writeRedactionSidecar('alice@x', '2026-05-15', 's1', 4);
    const raw = scanForOverview(outputDir, '2026-05-15');
    expect(raw.redactionsPerSession.get('s1')).toBe(4);
    expect(raw.redactionsPerSession.has('s2')).toBe(false);
  });

  it('ignores files for other dates', () => {
    writeCcStatusJsonl('alice@x', '2026-05-15', 's1', [{ ts: '2026-05-15T10:00:00.000Z' }]);
    writeCcStatusJsonl('alice@x', '2026-05-14', 's2', [{ ts: '2026-05-14T10:00:00.000Z' }]);
    const raw = scanForOverview(outputDir, '2026-05-15');
    expect(raw.latestPerSession.has('s1')).toBe(true);
    expect(raw.latestPerSession.has('s2')).toBe(false);
  });

  it('multiple users + multiple sessions aggregate correctly', () => {
    writeCcStatusJsonl('a@x', '2026-05-15', 's1', [{ ts: '2026-05-15T10:00:00.000Z' }]);
    writeCcStatusJsonl('a@x', '2026-05-15', 's2', [{ ts: '2026-05-15T10:00:00.000Z' }]);
    writeCcStatusJsonl('b@x', '2026-05-15', 's3', [{ ts: '2026-05-15T10:00:00.000Z' }]);
    const raw = scanForOverview(outputDir, '2026-05-15');
    expect(raw.latestPerSession.size).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests (expect failures)**

Run: `pnpm --filter @matrix-riven/collector-server vitest run overview/__tests__/disk-scan.test.ts 2>&1 | tail -10`
Expected: 6 tests fail (file doesn't exist).

- [ ] **Step 3: Implement `disk-scan.ts`**

Create `packages/collector-server/src/overview/disk-scan.ts`:

```typescript
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { CcStatusSnapshot } from '@matrix-riven/shared';
import type { RawSnapshots } from './types.js';

const CC_STATUS_SUFFIX = '.cc-status.jsonl';
const REDACTION_SUFFIX = '.l1_redaction_count.json';

/**
 * Walk `<outputDir>/<user>/<date>/` and pull out every cc-status snapshot
 * plus every l1_redaction_count sidecar. Pure I/O, no aggregation. Bad rows /
 * unreadable directories degrade gracefully (skip + stderr line). Never
 * throws — the caller's HTTP handler must stay 200-able even when one user's
 * data is corrupt.
 */
export function scanForOverview(outputDir: string, date: string): RawSnapshots {
  const allSnapshots: CcStatusSnapshot[] = [];
  const latestPerSession = new Map<string, CcStatusSnapshot>();
  const redactionsPerSession = new Map<string, number>();

  let userDirs: string[];
  try {
    userDirs = readdirSync(outputDir);
  } catch {
    return { allSnapshots, latestPerSession, redactionsPerSession };
  }

  for (const user of userDirs) {
    const dayDir = join(outputDir, user, date);
    if (!existsSync(dayDir)) continue;
    let files: string[];
    try {
      files = readdirSync(dayDir);
    } catch (err) {
      process.stderr.write(`[overview] skipping ${dayDir}: ${String(err)}\n`);
      continue;
    }
    for (const file of files) {
      const abs = join(dayDir, file);
      if (file.endsWith(CC_STATUS_SUFFIX)) {
        readCcStatusFile(abs, allSnapshots, latestPerSession);
      } else if (file.endsWith(REDACTION_SUFFIX)) {
        readRedactionSidecar(abs, file, redactionsPerSession);
      }
    }
  }
  return { allSnapshots, latestPerSession, redactionsPerSession };
}

function readCcStatusFile(
  path: string,
  allSnapshots: CcStatusSnapshot[],
  latestPerSession: Map<string, CcStatusSnapshot>,
): void {
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch (err) {
    process.stderr.write(`[overview] cannot read ${path}: ${String(err)}\n`);
    return;
  }
  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;  // bad JSON — skip this line, keep going
    }
    if (!isCcStatusSnapshot(parsed)) continue;
    allSnapshots.push(parsed);
    const prev = latestPerSession.get(parsed.session_id);
    if (!prev || parsed.ts > prev.ts) {
      latestPerSession.set(parsed.session_id, parsed);
    }
  }
}

function readRedactionSidecar(
  path: string,
  filename: string,
  redactionsPerSession: Map<string, number>,
): void {
  const sid = filename.slice(0, -REDACTION_SUFFIX.length);
  if (sid.length === 0) return;
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (typeof parsed !== 'object' || parsed === null) return;
  const count = (parsed as { count?: unknown }).count;
  if (typeof count === 'number' && Number.isFinite(count) && count >= 0) {
    redactionsPerSession.set(sid, count);
  }
}

function isCcStatusSnapshot(v: unknown): v is CcStatusSnapshot {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.session_id === 'string' &&
    typeof o.user_id === 'string' &&
    typeof o.ts === 'string' &&
    typeof o.event === 'string'
  );
}
```

- [ ] **Step 4: Run tests (expect pass)**

Run: `pnpm --filter @matrix-riven/collector-server vitest run overview/__tests__/disk-scan.test.ts 2>&1 | tail -10`
Expected: 6 disk-scan tests pass.

- [ ] **Step 5: Run full collector-server test suite (no regressions)**

Run: `pnpm --filter @matrix-riven/collector-server test 2>&1 | tail -10`
Expected: all tests pass (24 overview + 6 disk-scan + pre-existing).

- [ ] **Step 6: Commit**

```bash
git add packages/collector-server/src/overview/disk-scan.ts \
         packages/collector-server/src/overview/__tests__/disk-scan.test.ts
git commit -m "feat(overview): disk-scan with tmpdir tests"
```

---

## Task 8: /api/overview route

**Files:**
- Modify: `packages/collector-server/src/mock-server.ts`
- Modify: `packages/collector-server/src/__tests__/mock-server.test.ts`

- [ ] **Step 1: Locate the GET handler in `mock-server.ts`**

Run: `grep -n "if (path === '/api/" packages/collector-server/src/mock-server.ts`
Find the section that contains the existing `/api/users`, `/api/dates`, etc. The new `/api/overview` branch goes alongside them.

- [ ] **Step 2: Write failing route tests in mock-server.test.ts**

Append to `packages/collector-server/src/__tests__/mock-server.test.ts` (above the file's closing parenthesis if any):

```typescript
describe('GET /api/overview', () => {
  it('returns 200 + valid OverviewResponse shape for an empty server', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'overview-route-'));
    const h = await startMockServer({ port: 0, host: '127.0.0.1', outputDir });
    try {
      const resp = await fetch(`${h.url}/api/overview?date=2026-05-15`);
      expect(resp.status).toBe(200);
      const body = await resp.json() as Record<string, unknown>;
      expect(body.date).toBe('2026-05-15');
      expect(typeof body.generated_at).toBe('string');
      expect(body.cost).toBeDefined();
      expect(body.productivity).toBeDefined();
      expect(body.projects).toBeDefined();
      expect(body.quality).toBeDefined();
    } finally {
      await h.close();
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('returns 400 on invalid date format', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'overview-route-'));
    const h = await startMockServer({ port: 0, host: '127.0.0.1', outputDir });
    try {
      const resp = await fetch(`${h.url}/api/overview?date=not-a-date`);
      expect(resp.status).toBe(400);
    } finally {
      await h.close();
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('defaults date= to today when omitted', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'overview-route-'));
    const h = await startMockServer({ port: 0, host: '127.0.0.1', outputDir });
    try {
      const resp = await fetch(`${h.url}/api/overview`);
      expect(resp.status).toBe(200);
      const body = await resp.json() as { date: string };
      expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    } finally {
      await h.close();
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('aggregates real data into per_user list', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'overview-route-'));
    const dayDir = join(outputDir, 'alice@x', '2026-05-15');
    mkdirSync(dayDir, { recursive: true });
    writeFileSync(
      join(dayDir, 's1.cc-status.jsonl'),
      JSON.stringify({
        schema_version: 1, session_id: 's1', user_id: 'alice@x',
        ts: '2026-05-15T10:00:00.000Z', event: 'user_prompt_submit',
        cost_usd: 7.5, turn_count: 12,
      }) + '\n',
    );
    const h = await startMockServer({ port: 0, host: '127.0.0.1', outputDir });
    try {
      const resp = await fetch(`${h.url}/api/overview?date=2026-05-15`);
      const body = await resp.json() as {
        cost: { team_total_usd: number; per_user: Array<{ user_id: string; cost_usd: number }> };
        productivity: { per_user: Array<{ user_id: string; turn_count: number }> };
      };
      expect(body.cost.team_total_usd).toBeCloseTo(7.5, 5);
      expect(body.cost.per_user).toEqual([{ user_id: 'alice@x', cost_usd: 7.5 }]);
      expect(body.productivity.per_user[0]?.turn_count).toBe(12);
    } finally {
      await h.close();
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
```

Imports the test file needs (add to existing imports at top if missing):

```typescript
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
```

- [ ] **Step 3: Run tests (expect failures)**

Run: `pnpm --filter @matrix-riven/collector-server vitest run __tests__/mock-server.test.ts 2>&1 | tail -20`
Expected: 4 new overview tests fail with 404 or 400 because route doesn't exist.

- [ ] **Step 4: Add the route handler in `mock-server.ts`**

In `mock-server.ts`, add a new import near the top:

```typescript
import { scanForOverview } from './overview/disk-scan.js';
import { buildOverview } from './overview/aggregator.js';
```

Find the existing GET handler `if (path === '/api/users') { ... }` and add this branch immediately above or below it (e.g., right after the `/api/quota` branch):

```typescript
  if (path === '/v1/cc-sessions') { /* (existing — leave) */ }
  // ... etc ...
  if (path === '/api/overview') {
    const dateParam = url.searchParams.get('date') ?? defaultDateString(now);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      respondJson(res, 400, { error: 'invalid date format', expected: 'YYYY-MM-DD' });
      return;
    }
    let raw;
    try {
      raw = scanForOverview(outputDir, dateParam);
    } catch (err) {
      respondJson(res, 500, { error: 'scan failed', detail: String(err) });
      return;
    }
    const overview = buildOverview(raw, dateParam);
    respondJson(res, 200, overview);
    return;
  }
```

Also add a small helper near the bottom of `mock-server.ts` (alongside other private helpers) if not already present:

```typescript
function defaultDateString(now: () => Date): string {
  const d = now();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
```

> The existing `dateStamp` helper from `@matrix-riven/shared` already does this — if it's already imported in `mock-server.ts`, prefer reusing it: `const dateParam = url.searchParams.get('date') ?? dateStamp('', now());` (check the existing signature first; do whichever matches the file's conventions).

`respondJson` is a helper that should already exist in the file — search for `application/json` to find existing JSON response patterns and follow that style.

- [ ] **Step 5: Run tests (expect pass)**

Run: `pnpm --filter @matrix-riven/collector-server vitest run __tests__/mock-server.test.ts 2>&1 | tail -20`
Expected: 4 overview route tests pass.

- [ ] **Step 6: Full collector-server test suite**

Run: `pnpm --filter @matrix-riven/collector-server test 2>&1 | tail -10`
Expected: all tests pass.

- [ ] **Step 7: Smoke test against a running server**

```bash
# In a separate terminal:
TMP_DIR=/tmp/riven-overview-smoke
rm -rf "$TMP_DIR" && mkdir -p "$TMP_DIR"
PORT=18484 HOST=127.0.0.1 RIVEN_COLLECTOR_DIR="$TMP_DIR" \
  node packages/collector-server/dist/bin-prod-server.cjs &
sleep 1
curl -sS "http://127.0.0.1:18484/api/overview?date=2026-05-15" | head -c 500
echo
kill %1
```

Expected: a JSON response with `"date":"2026-05-15"`, `"cost":{...}`, etc. (all empty arrays because tmp dir has no data).

Note: needs `pnpm -r build` first if `dist/bin-prod-server.cjs` is out of date.

- [ ] **Step 8: Commit**

```bash
git add packages/collector-server/src/mock-server.ts \
         packages/collector-server/src/__tests__/mock-server.test.ts
git commit -m "feat(overview): mount GET /api/overview route"
```

---

## Task 9: Dashboard Overview tab UI

**Files:**
- Modify: `packages/collector-server/src/dashboard-html.ts`
- Modify: `packages/collector-server/src/__tests__/dashboard-html.test.ts`

> **Heads-up:** `dashboard-html.ts` is a single TS string literal containing HTML + CSS + JS. Edits go inside that template. Keep the existing Browse tab content untouched — only add Tab nav + Overview tab content.

- [ ] **Step 1: Add string-hook assertions to dashboard-html.test.ts**

Append to `packages/collector-server/src/__tests__/dashboard-html.test.ts`:

```typescript
describe('Overview tab hooks', () => {
  it('contains tab nav buttons for Browse and Overview', () => {
    expect(DASHBOARD_HTML).toMatch(/id=["']tab-btn-browse["']/);
    expect(DASHBOARD_HTML).toMatch(/id=["']tab-btn-overview["']/);
  });

  it('contains the Overview tab container and the 4 panel containers', () => {
    expect(DASHBOARD_HTML).toMatch(/id=["']tab-overview["']/);
    expect(DASHBOARD_HTML).toMatch(/id=["']panel-cost["']/);
    expect(DASHBOARD_HTML).toMatch(/id=["']panel-productivity["']/);
    expect(DASHBOARD_HTML).toMatch(/id=["']panel-projects["']/);
    expect(DASHBOARD_HTML).toMatch(/id=["']panel-quality["']/);
  });

  it('contains a fetch call to /api/overview', () => {
    expect(DASHBOARD_HTML).toContain('/api/overview');
  });

  it('defines an activateTab function', () => {
    expect(DASHBOARD_HTML).toContain('activateTab');
  });
});
```

- [ ] **Step 2: Run tests (expect failures)**

Run: `pnpm --filter @matrix-riven/collector-server vitest run __tests__/dashboard-html.test.ts 2>&1 | tail -10`
Expected: 4 new tests fail.

- [ ] **Step 3: Open `dashboard-html.ts` and inspect current structure**

Run: `head -50 packages/collector-server/src/dashboard-html.ts`
Confirm: the file exports `DASHBOARD_HTML` (a TS template literal). Note where `<header>`, `<body>`, and `<script>` open / close.

- [ ] **Step 4: Add Tab nav in `<header>`, gate existing content into `id="tab-browse"`, add `id="tab-overview"`**

In `dashboard-html.ts`, locate `<header>` and modify it from (something like):

```html
<header>
  <h1>Riven Collector</h1>
  <span class="ts" id="ts"></span>
  <button id="refresh">Refresh</button>
</header>
```

to:

```html
<header>
  <h1>Riven Collector</h1>
  <nav class="tab-nav">
    <button id="tab-btn-browse" class="tab-btn active" onclick="activateTab('browse')">Browse</button>
    <button id="tab-btn-overview" class="tab-btn" onclick="activateTab('overview')">Overview</button>
  </nav>
  <span class="ts" id="ts"></span>
  <button id="refresh">Refresh</button>
</header>
```

Wrap the **existing** `<div class="grid">...</div>` + `<div class="preview">...</div>` in a single new wrapper:

```html
<section id="tab-browse" class="tab-content">
  <!-- existing grid + preview unchanged -->
  <div class="grid">...</div>
  <div class="preview">...</div>
</section>
```

After that closing `</section>`, add the Overview tab content (initially hidden):

```html
<section id="tab-overview" class="tab-content" hidden>
  <div class="overview-grid">
    <article class="panel" id="panel-cost">
      <h2>💰 Cost</h2>
      <div class="panel-body"><div class="empty">loading…</div></div>
    </article>
    <article class="panel" id="panel-productivity">
      <h2>⚡ Productivity</h2>
      <div class="panel-body"><div class="empty">loading…</div></div>
    </article>
    <article class="panel" id="panel-projects">
      <h2>📦 Projects</h2>
      <div class="panel-body"><div class="empty">loading…</div></div>
    </article>
    <article class="panel" id="panel-quality">
      <h2>⚠️ Quality</h2>
      <div class="panel-body"><div class="empty">loading…</div></div>
    </article>
  </div>
</section>
```

- [ ] **Step 5: Add CSS for tabs + overview grid**

Find the existing `<style>` block. Append:

```css
.tab-nav { display: inline-flex; gap: 4px; margin-left: 16px; }
.tab-btn {
  background: transparent; border: 1px solid #d1d5db; color: #374151;
  padding: 4px 12px; border-radius: 4px; cursor: pointer; font: inherit;
}
.tab-btn.active { background: #2563eb; color: white; border-color: #2563eb; }
.tab-content[hidden] { display: none; }
.overview-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 16px;
}
.panel {
  background: white; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px;
}
.panel h2 { margin: 0 0 8px; font-size: 14px; }
.panel-body { font-size: 12px; }
.panel-body .row {
  display: grid; grid-template-columns: 1fr auto;
  align-items: center; gap: 6px; padding: 2px 0;
}
.panel-body .row .bar {
  background: #dbeafe; height: 12px; border-radius: 2px;
  grid-column: 1 / -1;
}
.panel-body .row.clickable { cursor: pointer; }
.panel-body .row.clickable:hover { background: #f3f4f6; }
.big-number { font-size: 28px; font-weight: 600; padding: 4px 0; }
.muted { color: #6b7280; font-size: 11px; }
```

- [ ] **Step 6: Add JS for Tab switching + Overview loader**

Find the existing `<script>` block (after the existing code, before `</script>`). Add:

```javascript
  function activateTab(name) {
    var browseSec = $('tab-browse'), overviewSec = $('tab-overview');
    var browseBtn = $('tab-btn-browse'), overviewBtn = $('tab-btn-overview');
    if (name === 'overview') {
      browseSec.setAttribute('hidden', '');
      overviewSec.removeAttribute('hidden');
      browseBtn.classList.remove('active');
      overviewBtn.classList.add('active');
      loadOverview();
    } else {
      overviewSec.setAttribute('hidden', '');
      browseSec.removeAttribute('hidden');
      overviewBtn.classList.remove('active');
      browseBtn.classList.add('active');
    }
  }
  // Expose for inline onclick handlers.
  window.activateTab = activateTab;

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function loadOverview() {
    fetch('/api/overview?date=' + encodeURIComponent(todayStr()))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        renderCost(d.cost);
        renderProductivity(d.productivity);
        renderProjects(d.projects);
        renderQuality(d.quality);
        setTs();
      })
      .catch(function (e) {
        var msg = '<div class="err">overview load failed: ' + escHtml(e.message) + '</div>';
        ['panel-cost', 'panel-productivity', 'panel-projects', 'panel-quality'].forEach(function (id) {
          $(id).querySelector('.panel-body').innerHTML = msg;
        });
      });
  }

  function renderBar(label, value, max, suffix) {
    var pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
    return '<div class="row clickable" data-user="' + escHtml(label) + '">' +
      '<span>' + escHtml(label) + '</span>' +
      '<span>' + escHtml(value.toFixed ? value.toFixed(2) : value) + (suffix || '') + '</span>' +
      '<div class="bar" style="width:' + pct + '%"></div>' +
    '</div>';
  }

  function renderCost(c) {
    var body = $('panel-cost').querySelector('.panel-body');
    if (!c || c.per_user.length === 0) { body.innerHTML = '<div class="empty">No data</div>'; return; }
    var maxCost = c.per_user[0].cost_usd || 1;
    var html = '<div class="big-number">$' + (c.team_total_usd || 0).toFixed(2) + '</div>' +
      '<div class="muted">today team total</div>';
    c.per_user.forEach(function (u) { html += renderBar(u.user_id, u.cost_usd, maxCost, ' USD'); });
    if (c.model_distribution && c.model_distribution.length) {
      html += '<div class="muted" style="margin-top:8px">model usage:</div>';
      c.model_distribution.forEach(function (m) {
        html += '<div class="row"><span>' + escHtml(m.model) + '</span><span>' +
          (m.pct * 100).toFixed(0) + '%</span></div>';
      });
    }
    body.innerHTML = html;
    wireDrillDown(body);
  }

  function renderProductivity(p) {
    var body = $('panel-productivity').querySelector('.panel-body');
    if (!p || p.per_user.length === 0) { body.innerHTML = '<div class="empty">No data</div>'; return; }
    var maxTurn = p.per_user[0].turn_count || 1;
    var html = '';
    p.per_user.forEach(function (u) {
      var failRate = u.tool_calls_total > 0
        ? '(fail ' + ((u.tool_calls_failed / u.tool_calls_total) * 100).toFixed(0) + '%)'
        : '';
      html += '<div class="row clickable" data-user="' + escHtml(u.user_id) + '">' +
        '<span>' + escHtml(u.user_id) + '</span>' +
        '<span>' + u.turn_count + ' turns ' + failRate + '</span>' +
        '<div class="bar" style="width:' + ((u.turn_count / maxTurn) * 100) + '%"></div>' +
        '</div>';
    });
    body.innerHTML = html;
    wireDrillDown(body);
  }

  function renderProjects(p) {
    var body = $('panel-projects').querySelector('.panel-body');
    if (!p || p.top_cwd.length === 0) { body.innerHTML = '<div class="empty">No data</div>'; return; }
    var html = '<div class="muted">top projects today:</div>';
    var maxSess = p.top_cwd[0].session_count || 1;
    p.top_cwd.forEach(function (c) {
      html += '<div class="row"><span>' + escHtml(c.cwd_basename) + '</span>' +
        '<span>' + c.session_count + ' sess</span>' +
        '<div class="bar" style="width:' + ((c.session_count / maxSess) * 100) + '%"></div></div>';
    });
    if (p.top_git_branch && p.top_git_branch.length) {
      html += '<div class="muted" style="margin-top:8px">top branches:</div>';
      p.top_git_branch.slice(0, 5).forEach(function (b) {
        html += '<div class="row"><span>' + escHtml(b.git_branch) + '</span>' +
          '<span>' + b.session_count + '</span></div>';
      });
    }
    body.innerHTML = html;
  }

  function renderQuality(q) {
    var body = $('panel-quality').querySelector('.panel-body');
    var html = '<div class="big-number">' + (q.team_total_redactions || 0) + '</div>' +
      '<div class="muted">L1 sensitive-field redactions today</div>';
    if (q.redactions_per_user.length === 0 && q.tool_failures_per_user.length === 0 && q.out_of_control_sessions.length === 0) {
      body.innerHTML = html + '<div class="empty">No alerts</div>';
      return;
    }
    if (q.redactions_per_user.length) {
      html += '<div class="muted" style="margin-top:8px">redactions per user:</div>';
      q.redactions_per_user.forEach(function (r) {
        html += '<div class="row clickable" data-user="' + escHtml(r.user_id) + '">' +
          '<span>' + escHtml(r.user_id) + '</span>' +
          '<span>' + r.redaction_count + '</span></div>';
      });
    }
    if (q.tool_failures_per_user.length) {
      html += '<div class="muted" style="margin-top:8px">tool failures:</div>';
      q.tool_failures_per_user.forEach(function (t) {
        html += '<div class="row clickable" data-user="' + escHtml(t.user_id) + '">' +
          '<span>' + escHtml(t.user_id) + '</span>' +
          '<span>' + t.tool_calls_failed + '</span></div>';
      });
    }
    if (q.out_of_control_sessions.length) {
      html += '<div class="muted" style="margin-top:8px">OVER_200K sessions:</div>';
      q.out_of_control_sessions.forEach(function (o) {
        html += '<div class="row clickable" data-user="' + escHtml(o.user_id) + '">' +
          '<span>' + escHtml(o.user_id) + ' / ' + escHtml(o.session_id) + '</span>' +
          '<span class="muted">' + escHtml(o.ts) + '</span></div>';
      });
    }
    body.innerHTML = html;
    wireDrillDown(body);
  }

  function wireDrillDown(container) {
    Array.prototype.forEach.call(container.querySelectorAll('.row.clickable'), function (row) {
      row.onclick = function () {
        var u = row.getAttribute('data-user');
        if (!u) return;
        activateTab('browse');
        // Reuse the existing user-selection flow: simulate a click on the
        // matching user in the Browse list. selectUser() lives below.
        var match = Array.prototype.filter.call($('users').querySelectorAll('li'), function (li) {
          return li.textContent === u;
        })[0];
        if (match) match.click();
      };
    });
  }
```

- [ ] **Step 7: Run all dashboard tests (expect pass)**

Run: `pnpm --filter @matrix-riven/collector-server vitest run __tests__/dashboard-html.test.ts 2>&1 | tail -10`
Expected: all dashboard tests pass (pre-existing + 4 new Overview hook tests).

- [ ] **Step 8: Full collector-server test suite**

Run: `pnpm --filter @matrix-riven/collector-server test 2>&1 | tail -10`
Expected: all tests pass.

- [ ] **Step 9: Browser smoke test**

```bash
# Terminal 1: start server in repo root
pnpm -r build
PORT=18484 HOST=127.0.0.1 RIVEN_COLLECTOR_DIR=/c/tmp/riven-overview-ui \
  node packages/collector-server/dist/bin-prod-server.cjs &

# Terminal 2: load some data
SMOKE_HOME=/c/tmp/riven-overview-client
rm -rf "$SMOKE_HOME"; mkdir -p "$SMOKE_HOME"
cp "$USERPROFILE/.gitconfig" "$SMOKE_HOME/.gitconfig"
RIVEN_HOME="$SMOKE_HOME" HOME="$SMOKE_HOME" USERPROFILE="$SMOKE_HOME" \
  node scripts/install-client.mjs
# Manually edit $SMOKE_HOME/.riven/digital-twin.json to point endpoint at http://127.0.0.1:18484
RIVEN_HOME="$SMOKE_HOME" HOME="$SMOKE_HOME" USERPROFILE="$SMOKE_HOME" \
  node "$SMOKE_HOME/.riven/digital-twin/bin-digital-twin.cjs" inject-mock
RIVEN_HOME="$SMOKE_HOME" HOME="$SMOKE_HOME" USERPROFILE="$SMOKE_HOME" \
  node "$SMOKE_HOME/.riven/digital-twin/bin-uploader.cjs"

# Open http://127.0.0.1:18484 in a browser:
# - Should default to Browse tab (existing UI unchanged)
# - Click Overview button — 4 panels load
# - Click a user row in any panel — should switch to Browse + select that user
```

Expected: Overview tab renders 4 panels with the smoke-test user's data; drill-down works.

- [ ] **Step 10: Commit**

```bash
git add packages/collector-server/src/dashboard-html.ts \
         packages/collector-server/src/__tests__/dashboard-html.test.ts
git commit -m "feat(overview): dashboard Overview tab UI"
```

---

## Task 10: README documentation + final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Append README section**

Add a new section to `README.md` right before the `## 设计文档` section:

```markdown
---

## Overview tab（领导视图）

Dashboard 默认开在 Browse tab——transcript 文件浏览，跟以前一样。

切到 **Overview tab** 看团队聚合视图（单日）：

- 💰 **Cost** — 今日团队总花费 + 每人花费排行 + Max 额度状态 + 模型选用分布
- ⚡ **Productivity** — 每人 turn 数 / tool 失败率 / 平均会话时长 / OVER_200K 次数
- 📦 **Projects** — 团队在哪些项目（cwd）/ 分支上花时间最多
- ⚠️ **Quality** — 敏感字段被脱敏次数 / tool 失败热点 / 失控会话

任意 panel 里点用户名 → 跳回 Browse tab + 自动选中该用户，看会话原文。

数据 API：`GET /api/overview?date=YYYY-MM-DD`（默认今天）。返回 JSON 见 [`docs/superpowers/specs/2026-05-15-leadership-overview-design.md`](docs/superpowers/specs/2026-05-15-leadership-overview-design.md) §5.3。
```

- [ ] **Step 2: Verify all tests still pass + build**

```bash
pnpm -r typecheck
pnpm test
pnpm -r build
```

Expected: all green. Test count should be 461 (baseline) + 24 (aggregator) + 6 (disk-scan) + 4 (route) + 4 (dashboard) = **~499**.

- [ ] **Step 3: Final end-to-end manual verification against the company server**

Same flow as Task 9 Step 9, but **point the client at the real server `192.168.22.88:8080`** (the default endpoint in config — no patching needed). Open `http://192.168.22.88:8080/` in a browser, click Overview, verify 4 panels render with today's real data.

> If this fails, do NOT push. Roll back, debug, retry. Production server should stay correct.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README section for Overview tab"
```

- [ ] **Step 5: Push the branch and fast-forward main**

```bash
# Push the worktree branch first
git push origin worktree-jolly-strolling-shell

# Fast-forward main via -C (since main is checked out elsewhere)
git -C C:/Users/tianhaoxuan/Matrix-Riven merge --ff-only worktree-jolly-strolling-shell
git -C C:/Users/tianhaoxuan/Matrix-Riven push origin main
```

Expected: origin/main moves from `460ade3` (the spec commit) to the latest implementation commit.

---

## Acceptance criteria (final check)

- [ ] `pnpm -r typecheck` green across all three packages
- [ ] `pnpm test` green; new test count delta ~+38
- [ ] `pnpm -r build` green; `bin-prod-server.cjs` still self-contained
- [ ] `curl http://192.168.22.88:8080/api/overview?date=$(date +%Y-%m-%d)` returns JSON matching the design doc §5.3 shape
- [ ] Browser at `http://192.168.22.88:8080/` defaults to Browse tab (backward compatible)
- [ ] Clicking Overview tab loads + renders 4 panels with today's real team data
- [ ] Clicking a user row in any Overview panel switches to Browse tab and selects that user

All 10 tasks committed atomically; if you want to squash to the 5-commit structure mentioned in the spec §9, run `git rebase -i HEAD~10` and combine task commits 1+2+3+4+5+6 → "Phase 1 server-side aggregator", keep task 7 / 8 / 9 / 10 as separate commits.
