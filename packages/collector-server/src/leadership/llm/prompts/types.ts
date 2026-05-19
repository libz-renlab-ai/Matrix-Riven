/**
 * Shared input/output types for the five LLM narrative prompt tiers.
 *
 * All inputs are assumed to have already been redacted by L-3 (`redactForLLM`)
 * by the caller. The prompt builders themselves perform no further redaction —
 * they only structure the payload, model selection, and JSON-output contract.
 *
 * Tier overview:
 *   T1 — per-session digest (1 line, ≤18 中文字)
 *   T2 — per-member weekly summary (2 lines, ≤22 中文字 each)
 *   T3 — per-project weekly summary (2 lines, ≤25 中文字 each)
 *   T4 — attention-item rewrite   (1 actionable line, ≤30 中文字)
 *   T5 — daily leader brief        (3 lines, ≤35 中文字 each)
 */

/** Output of any prompt builder. */
export interface BuiltPrompt {
  /** English system prompt: role, JSON contract, char-count caps, one example. */
  system: string;
  /** User prompt — compact JSON-stringified `{tier, items}` payload. */
  user: string;
  /** Model id used for this call (caller may override). */
  model: string;
}

/** T1 — one session worth of signals. */
export interface T1Input {
  /** Session id (becomes the result's `id`). */
  id: string;
  /** First ~200 chars of the first non-tool user message. */
  firstUserPrompt: string;
  /** Up to 3 changed file paths (already short / redacted). */
  changedFiles: string[];
  /** Counts per tool kind over the session. */
  toolCounts: { edit: number; bash: number; read: number; webFetch: number };
  /** Session duration in minutes. */
  durationMin: number;
  /** Tool failure count over the session. */
  errors: number;
}

/** T2 — one member's week. */
export interface T2Input {
  /** Stable id — the result is keyed by this email. */
  email: string;
  /** Display name (already redacted upstream if needed). */
  displayName: string;
  /** Coarse weekly state badge. */
  state: 'needs_help' | 'stuck' | 'high_output' | 'active' | 'idle' | 'off';
  /** Up to 5 top-touched files this week. */
  topFiles: string[];
  /** This week's T1 lines for this member (already cached). */
  sessionDigests: string[];
}

/** T3 — one project's week. */
export interface T3Input {
  /** Project key — `owner/repo` or local folder name. */
  project: string;
  /** Narrative phase label (e.g. "推进新功能"). */
  phase: string;
  /** Contributing members' display names. */
  contributors: string[];
  /** This week's T1 lines scoped to this project. */
  sessionDigests: string[];
  /** Up to 5 recent commit subjects (already redacted). */
  recentCommits: string[];
}

/** T4 — one attention item that needs a sharper rewrite. */
export interface T4Input {
  /** Stable ref id — the result is keyed by this. */
  refId: string;
  /** Whether this attention item refers to a member or a project. */
  kind: 'member' | 'project';
  /** Display name shown to the leader. */
  displayName: string;
  /** Signal classification e.g. "stuck", "risky_action". */
  signal: string;
  /** 1–3 redacted evidence snippets. */
  evidence: string[];
}

/** T5 — daily leader brief input. */
export interface T5Input {
  /** ISO date string like "2026-05-17". */
  date: string;
  /** T1 digests for the top ~5 highlights of the day. */
  topHighlights: string[];
  /** T4 outputs (attention rewrites) — already concise. */
  attentionRewrites: string[];
  /** T3 outputs for the top ~3 projects of the day. */
  topProjects: { name: string; digest: string }[];
}
