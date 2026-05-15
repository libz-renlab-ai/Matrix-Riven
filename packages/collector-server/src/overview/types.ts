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
