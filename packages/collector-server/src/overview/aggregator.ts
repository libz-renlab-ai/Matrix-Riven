import { basename } from 'node:path';
import type { CcStatusSnapshot } from '@matrix-riven/shared';
import type {
  CostBlock,
  CostPerUser,
  ModelDistribution,
  OutOfControlSession,
  OverviewResponse,
  ProductivityBlock,
  ProductivityPerUser,
  ProjectsBlock,
  QualityBlock,
  QuotaPerUser,
  RawSnapshots,
  RedactionPerUser,
  ToolFailurePerUser,
  TopCwd,
  TopGitBranch,
  UserCwdEntry,
} from './types.js';

export function aggregateCost(raw: RawSnapshots): CostBlock {
  const sessionsByUser = groupSessionsByUser(raw.latestPerSession);

  // per_user: sum cost_usd of each user's latest-per-session snapshots, sorted DESC.
  const perUser: CostPerUser[] = [];
  for (const [user_id, snaps] of sessionsByUser) {
    const cost_usd = sumOpt(snaps.map((s) => s.cost_usd));
    perUser.push({ user_id, cost_usd });
  }
  perUser.sort(
    (a, b) =>
      b.cost_usd - a.cost_usd || a.user_id.localeCompare(b.user_id),
  );
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

// ────────────────────────────── aggregateProductivity ──────────────────────────────

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
  per_user.sort(
    (a, b) =>
      b.turn_count - a.turn_count || a.user_id.localeCompare(b.user_id),
  );
  return { per_user };
}

/**
 * Average duration in minutes across sessions that carry a valid
 * `session_started_at`. Sessions missing that field are excluded from BOTH
 * numerator and denominator — the returned value is "average of measurable
 * sessions", not "average of all sessions". A caller building a label like
 * "avg X min over N sessions" should pair this with `session_count` only when
 * every session has a `session_started_at`; otherwise prefer "avg X min
 * (some sessions un-measured)".
 */
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

// ────────────────────────────── aggregateProjects ──────────────────────────────

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
    .sort((a, b) => b.session_count - a.session_count || a.cwd_basename.localeCompare(b.cwd_basename))
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
    .sort((a, b) => b.session_count - a.session_count || a.git_branch.localeCompare(b.git_branch))
    .slice(0, 10);

  // ── user_cwd_matrix: two-level Map avoids key-encoding fragility ──
  // user_id → cwd_basename → count
  const matrixAcc = new Map<string, Map<string, number>>();
  for (const s of raw.latestPerSession.values()) {
    if (typeof s.cwd !== 'string' || s.cwd.length === 0) continue;
    const bn = basename(s.cwd);
    let byCwd = matrixAcc.get(s.user_id);
    if (!byCwd) {
      byCwd = new Map();
      matrixAcc.set(s.user_id, byCwd);
    }
    byCwd.set(bn, (byCwd.get(bn) ?? 0) + 1);
  }
  const user_cwd_matrix: UserCwdEntry[] = [];
  for (const [user_id, byCwd] of matrixAcc) {
    for (const [cwd_basename, session_count] of byCwd) {
      user_cwd_matrix.push({ user_id, cwd_basename, session_count });
    }
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

// ────────────────────────────── aggregateQuality ──────────────────────────────

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
  })).sort((a, b) => b.redaction_count - a.redaction_count || a.user_id.localeCompare(b.user_id));

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
  })).sort((a, b) => b.tool_calls_failed - a.tool_calls_failed || a.user_id.localeCompare(b.user_id));

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

// ────────────────────────────── buildOverview ──────────────────────────────

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
