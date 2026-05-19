// packages/collector-server/src/leadership/types.ts

/**
 * Parsed shape of one cc-session envelope-on-disk, with the gzipped+base64
 * transcript decoded back into a JSONL message stream. Pure data — no I/O.
 * Built once per session by transcript-loader.ts and consumed by every
 * signal computer in leadership/signals/.
 */
export interface ParsedSession {
  envelope: ParsedEnvelope;
  l1RedactionCount: number;
  messages: ParsedMessage[];
  /** First-message ts → last-message ts, in ms. 0 if undecidable. */
  durationMs: number;
  /** First message ts. Falls back to envelope.captured_at on parse trouble. */
  startTs: Date;
  /** Last message ts. */
  endTs: Date;
  /** First non-null model seen in messages (proxy for "the model used"). */
  model?: string;
  tokens: { input: number; output: number; cacheRead: number; cacheCreation: number };
}

export interface ParsedEnvelope {
  id: string;
  userId: string;
  machineId: string;
  sessionId: string;
  cwd: string;
  projectName: string;          // populated; falls back to cwd-last-segment if envelope.project_name empty
  capturedAt: string;
  rivenVersion: string;
  consentedAt: string | null;
  /**
   * GitHub remote, normalized as `owner/repo`. Populated either by future
   * plugin (envelope.git_remote field) or by scanning the transcript for
   * github.com URLs at parse time. Propagated across same-tree sessions in
   * `scanAllSessions` so non-git sessions inherit a sibling's remote. Falls
   * back to undefined when no remote is detectable.
   */
  gitRemote?: string;
}

export type ParsedMessageRole = 'user' | 'assistant' | 'tool';

export interface ParsedMessage {
  role: ParsedMessageRole;
  ts?: Date;
  /** Plain text content (user/assistant). Empty string when only tool-use. */
  text: string;
  /** Tool calls the assistant invoked in this message. */
  toolUses: ParsedToolUse[];
  /** Tool results returned (role === 'tool' OR embedded inside a user message). */
  toolResults: ParsedToolResult[];
  /** Token usage on this message, if reported by the API response. */
  tokens?: { input?: number; output?: number; cacheRead?: number; cacheCreation?: number };
  /** Model id, if reported. */
  model?: string;
}

export interface ParsedToolUse {
  name: string;            // 'Bash', 'Edit', 'Read', 'WebSearch', etc.
  input: Record<string, unknown>;
}

export interface ParsedToolResult {
  toolUseId?: string;
  isError: boolean;
  /** Concatenated text content. May be very large; signals should sample, not iterate fully when avoidable. */
  text: string;
}

// =====================================================================
// Signal output shapes — what aggregator.ts assembles for HTTP responses
// =====================================================================

export type SignalLevel = 'strong' | 'medium' | 'weak';
export type MemberStateBadge = 'active' | 'quiet' | 'stuck' | 'needs_help' | 'low_activity';
export type ProjectState = 'active' | 'maintaining' | 'dormant' | 'revived';
export type ProjectPhase = 'implement' | 'debug' | 'refactor' | 'test' | 'docs' | 'plan' | 'mixed';

export interface MemberSnapshot {
  email: string;
  displayName: string;           // email local-part
  stateBadge: MemberStateBadge;
  today: { sessions: number; tokens: number; estMinutes: number; costUsd: number };
  trend7d: number[];             // length 7, oldest first; sessions per day
  deltaVs7dAvgPct: number;       // (-1, +∞)
  warnings: string[];            // short strings shown next to the avatar
  topProject?: string;           // most-active project today; undefined if none
  /** ISO timestamp of the member's most-recent session.startTs, if any. */
  lastSessionAt?: string;
  /** Tool failure rate over the range (0–1). Used for needs_help line2. */
  toolFailureRate?: number;
  /** Number of risky actions detected in the range. */
  riskyActionCount?: number;
  /** Iteration density over the range (used for stuck line2). */
  iterationDensity?: number;
  /** Mean prompt length over the range (used for stuck line2). */
  meanPromptLen?: number;
  /** Optional because LLM is opt-in / may cache-miss; consumed by views/_overview-fragments.ts + views/_slideover.html.ts. */
  /** Two-line LLM-authored weekly digest (sentences joined by '\n'). Optional;
   * absent when LLM disabled or cache miss. */
  llmWeekly?: string;
  // Detail-page-only fields below; aggregator includes them for /api/members/:id
  detail?: MemberDetail;
}

export interface MemberDetail {
  toolFailureRate: number;
  overContext200kCount: number;
  iterationDensity: number;      // mean user-msgs per "task"
  riskyActions: RiskyAction[];
  collaborators: CollaboratorHit[];
  modelMix: Record<string, number>; // model → token share
  webResearchCount: number;
  sessions: SessionSummary[];
  heatmap7x24: number[][];       // 7 rows × 24 cols; tokens
  topFiles: { path: string; edits: number }[];
  /** Focus metrics — distinct cwds today + mean session length. */
  focus: { distinctCwdsToday: number; avgSessionMinutes: number };
  /** Daily mean user-prompt length over the range (oldest-first). */
  promptLengthSeries: { date: string; meanLen: number }[];
  /** New file extensions explored in the range vs the 7-day-prior window. */
  newSurfaceCount: number;
}

export interface RiskyAction {
  ts: string;
  sessionId: string;
  pattern: 'rm -rf' | 'force push' | 'reset --hard' | 'drop table' | 'other';
  snippet: string;
}

export interface CollaboratorHit {
  withEmail: string;
  sharedFiles: string[];
}

export interface SessionSummary {
  sessionId: string;
  capturedAt: string;
  projectName: string;
  totalTokens: number;
  /** First user prompt, truncated to 200 chars (the L1-privacy preview). */
  firstPromptPreview: string;
  firstPromptFull: string;       // included so the UI can do client-side expand without another fetch
  /**
   * All user prompts in the session (P-A3). Each carries a 200-char preview +
   * full text so the UI can render an expand-all list with per-prompt full
   * toggles. Ordered chronologically (oldest first).
   */
  allPrompts: { ts: string; preview: string; full: string }[];
}

export interface ProjectSnapshot {
  name: string;
  state: ProjectState;
  contributors: { email: string; sharePct: number }[];
  busFactorWarning: boolean;     // top contributor share > 0.7
  trend7d: number[];             // 7 entries, sessions per day
  phaseGuess: ProjectPhase;
  healthScore: number;           // 0-10
  etaDays: number | null;        // null = insufficient data
  etaConfidence: 'low';          // always 'low' per spec
  /** Fraction of contributors who had ≥1 session in the last 24h (0–1). */
  activeTodayPct: number;
  /** Count of contributors who had ≥1 session in the last 24h. */
  activeTodayCount: number;
  /**
   * Most-recently edited file in the range, with author + timestamp. Set by
   * the aggregator for Overview's project narrative ("最近: api/x.ts (hrdai
   * · 2h 前)"). Absent when no Edit/Write/MultiEdit tool fired across the
   * project's sessions; the renderer falls back to a short "暂无最近编辑"
   * line in that case.
   */
  lastTouch?: { filePath: string; by: string; ts: string };
  /** Optional because LLM is opt-in / may cache-miss; consumed by views/_overview-fragments.ts project narrative + views/_slideover.html.ts. */
  /** Two-line LLM-authored weekly project digest. Optional. */
  llmWeekly?: string;
  detail?: ProjectDetail;
}

export interface ProjectDetail {
  todayFiles: string[];
  weekFiles: string[];
  extensionMix: Record<string, number>;
  testRatio: number;             // edits to test files / edits to source
  milestones: Milestone[];
  webResearchShare: number;
  heatmap7x24: number[][];
  recentFiles: { path: string; touches: number }[];
  /** 0–1 — fraction of edited files touched by ≥ 2 contributors. */
  collabDensity: number;
  /**
   * Recent filtered user prompts across all sessions touching this project,
   * newest first. System-injected prompts (slash commands, skill auto-loads,
   * <system-reminder>, etc.) are excluded — these are real questions people
   * asked about the project. Capped server-side; UI renders ~6.
   */
  recentPrompts: { ts: string; by: string; preview: string }[];
}

export interface Milestone {
  ts: string;
  type: 'commit' | 'push' | 'pr' | 'release' | 'tag';
  by: string;                    // member email
  detail: string;                // e.g., command snippet
}

export interface CollabHit {
  filePath: string;
  members: string[];
  lastTouched: string;
}

export interface KpiCards {
  teamActivity: { value: number; deltaVsAvg: number };
  attention: { value: number; deltaToday: number; breakdown: { stuck: number; needsHelp: number; riskyAction: number } };
  projects: { active: number; maintaining: number; dormant: number };
  /** Team-wide rhythm: today vs 7-day-prior daily average (token-based). */
  pace: { rhythmDelta: number; label: '升' | '稳' | '缓' };
  /** Members whose deltaVs7dAvgPct > 0.2 today, plus their mean delta %. */
  highOutput: { count: number; avgDeltaPct: number };
  /** Total USD cost across members for today (sum of member.today.costUsd). */
  todayCostUsd: number;
}

export interface AttentionItem {
  kind: 'member' | 'project';
  refId: string;                // email (member) or project name
  displayName: string;
  initials: string;             // 2 chars for avatar
  tag: string;                  // pill text, e.g., '闲置 11h'
  tagSeverity: 'urgent' | 'normal' | 'calm';
  line2: string;                // descriptive sentence; may contain inline <span class="mono">
  time: string;                 // 'HH:MM' or arrow glyph
  severity: number;             // 0-10 for sort desc
  /** Optional because LLM is opt-in / may cache-miss; consumed by views/_overview-fragments.ts attention list to replace the generic line2 template. */
  /** One-line LLM rewrite that replaces the generic `line2` template when
   * present. Optional. */
  llmRewrite?: string;
}

export interface OverviewSnapshot {
  schemaVersion: 1;
  range: { start: string; end: string; label: string };
  computedAt: string;
  kpis: KpiCards;
  members: MemberSnapshot[];
  projects: ProjectSnapshot[];
  collaboration: CollabHit[];
  attention: AttentionItem[];
  /**
   * Recent-week key events across all projects (B-main "本周关键进展"). At
   * most ~10 entries, newest first. Source: ProjectDetail.milestones from
   * each project filtered to the trailing 7-day window.
   */
  highlights: HighlightEvent[];
  /**
   * Present when the freshest in-range session is more than ~1 day old
   * relative to `computedAt`. Renderer surfaces this as a banner so the
   * leader knows "today" KPIs are relative to a stale capture rather than
   * live data. Absent when data is fresh (≤ 1 day old).
   */
  staleness?: { ageDays: number; lastActivityAt: string };
  /** Optional because T5 is opt-in / may cache-miss; consumed by views/_overview-fragments.ts to render a briefBox between hero and KPIs. */
  /** Three-line leader daily brief (T5). Rendered as a briefBox between the
   * hero greeting and the KPI row. Optional. */
  llmBrief?: string[];
  /**
   * Phase 3-A. Filter that was applied to derive the KPIs / attention /
   * highlights / collaboration on this snapshot. `members` and `projects`
   * remain the full team set — the view reads this filter to dim non-
   * matching entries (per spec §3.2 #4). Absent when no filter was applied
   * (preserves pre-3A wire schema for unfiltered traffic).
   */
  appliedFilter?: FocusFilter;
}

/**
 * Team-wide editorial event for the "本周关键进展" section (B-main). Built
 * by aggregating each project's milestones within the trailing 7 days and
 * normalising the author email to its local-part so the renderer doesn't
 * have to know about email shapes.
 */
export interface HighlightEvent {
  ts: string;
  type: 'commit' | 'push' | 'pr' | 'release' | 'tag' | 'risky';
  by: string;       // local-part of the author email
  project: string;
  detail: string;   // short description; aggregator-controlled, safe HTML when escaped
  /** Optional because T1 is opt-in / may cache-miss; consumed by views/_overview-fragments.ts highlight list to replace the raw command in `detail` when rendered. */
  /** One-line LLM rewrite of this event for display. Replaces the raw `detail`
   * field in renders when present. Optional. */
  llmDigest?: string;
}

// =====================================================================
// Range / query types
// =====================================================================

export type RangeLabel = 'today' | 'yesterday' | '24h' | '7d' | '30d' | 'custom';

export interface DateRange {
  start: Date;
  end: Date;
  label: RangeLabel | string;
}

// =====================================================================
// Phase 3-A · Focus filter
// =====================================================================

/**
 * Pinned at brainstorm `551-1779116287`. Filter applied at the aggregator
 * before signal computation, so all downstream signal computers stay
 * filter-agnostic. URL query is the source of truth (no localStorage);
 * each chip is single-select; `state` requires a two-stage filter pass
 * inside the aggregator (compute member states on focus+project+range
 * filtered sessions, then drop members whose state ≠ filter.state, then
 * drop their sessions from downstream signal inputs).
 *
 * MemberStateBadge values that `state` can take match `MemberStateBadge`
 * defined earlier in this file: 'active' | 'quiet' | 'stuck' |
 * 'needs_help' | 'low_activity'.
 */
export interface FocusFilter {
  /** Member email local-part (e.g. "blake"). Matched against userId's local-part. */
  focus?: string;
  /** Project name (cwd-derived or git-remote). Exact match, case-insensitive. */
  project?: string;
  /** Time range. `custom` reads `from` and `to`. */
  range: RangeLabel;
  /** When range='custom', UTC day boundaries (inclusive). */
  from?: Date;
  to?: Date;
  /** Member state badge filter. Two-stage pass — see comment above. */
  state?: MemberStateBadge;
}

/**
 * Default filter when no query params are present. `range: 'today'`
 * preserves the dashboard's pre-3A behaviour byte-for-byte so adding
 * the filter is a zero-regression change at the empty-filter call site.
 */
export const DEFAULT_FOCUS_FILTER: FocusFilter = { range: 'today' };

/** Helper — true when filter equals the default (no active dimensions). */
export function isDefaultFocusFilter(f: FocusFilter): boolean {
  return !f.focus && !f.project && !f.state && f.range === 'today' && !f.from && !f.to;
}

// =====================================================================
// Phase 3-B · Activity flow
// =====================================================================

/** All event types surfaced on the Activity tab. Strings match icons in views. */
export type ActivityEventType =
  | 'session'    // AI session captured
  | 'commit'     // git commit milestone (extracted from bash)
  | 'push'       // git push
  | 'pr_open'
  | 'pr_merged'
  | 'release'
  | 'tag';

export interface ActivityEvent {
  ts: string;                        // ISO timestamp
  type: ActivityEventType;
  by: string;                        // member email (full or local-part — view normalises)
  project: string;                   // project name
  summary: string;                   // one-line summary (prompt preview / commit msg / etc.)
  detail?: {
    sessionId?: string;
    tokens?: number;
    durationMs?: number;
    promptFull?: string;
    commitSha?: string;
    githubUrl?: string;
  };
}

export interface ActivityFeedSnapshot {
  schemaVersion: 1;
  range: { start: string; end: string; label: string };
  events: ActivityEvent[];           // time-descending
  hasMore: boolean;
  nextCursor?: string;               // ISO timestamp; pass as ?before=
  computedAt: string;
  appliedFilter?: FocusFilter;
}

// =====================================================================
// Phase 3-D · Insights
// =====================================================================

export interface InsightsHealthScore {
  value: number;                       // 0..100
  deltaVsLastWeek: number;
  breakdown: {
    stuckRate: number;                 // 0..100 sub-score
    rhythm: number;
    output: number;
    risk: number;
  };
  history30d: number[];                // 30 entries, oldest first
}

export interface InsightsAnomaly {
  member: string;                      // local-part
  signal: string;                      // e.g. "weekly_tokens"
  direction: 'up' | 'down';
  magnitudeRatio: number;              // e.g. 2.3 = 2.3x team baseline
  narrative?: string;                  // LLM-filled when available
}

export interface InsightsRecommendation {
  id: string;
  severity: 'info' | 'warn' | 'critical';
  headline: string;
  body: string;
  triggers: string[];
}

export interface InsightsTimeWeek {
  weekStart: string;                   // ISO date
  tokens: number;
  sessions: number;
  commits: number;
}

export interface InsightsPersonRow {
  email: string;
  displayName: string;
  metrics: {
    tokens: number;
    sessions: number;
    costUsd: number;
    projectsTouched: number;
    riskyActions: number;
  };
}

export interface InsightsProjectRow {
  name: string;
  metrics: {
    contributors: number;
    sessions: number;
    healthScore: number;
    etaDays: number | null;
  };
}

export interface InsightsSnapshot {
  schemaVersion: 1;
  computedAt: string;
  range: { start: string; end: string; label: string };
  healthScore: InsightsHealthScore;
  recommendations: InsightsRecommendation[];
  anomalies: InsightsAnomaly[];
  axes: {
    time: { weeks: InsightsTimeWeek[]; narrative?: string };
    people: { rows: InsightsPersonRow[]; narrative?: string };
    projects: { rows: InsightsProjectRow[]; narrative?: string };
  };
  appliedFilter?: FocusFilter;
}
