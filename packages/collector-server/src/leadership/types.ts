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
}

export interface OverviewSnapshot {
  schemaVersion: 1;
  range: { start: string; end: string; label: string };
  computedAt: string;
  kpis: KpiCards;
  members: MemberSnapshot[];
  projects: ProjectSnapshot[];
  collaboration: CollabHit[];
}

// =====================================================================
// Range / query types
// =====================================================================

export type RangeLabel = 'today' | '24h' | '7d' | '30d' | 'custom';

export interface DateRange {
  start: Date;
  end: Date;
  label: RangeLabel | string;
}
