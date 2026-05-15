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
