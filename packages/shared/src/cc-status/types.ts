/**
 * CC runtime status snapshot.
 *
 * A single point-in-time picture of one Claude Code instance: model, context
 * usage, cost, rolling token windows, session health, quota utilization, and a
 * few output-volume aggregates. Pushed to `POST /v1/cc-status` and served back
 * (latest / history) over `GET /api/cc-status*` so downstream projects can pull
 * "what is this teammate's CC doing right now" without screen-scraping a
 * statusline.
 *
 * Wire shape (`POST /v1/cc-status` body):
 *
 *   { ...CcStatusSnapshot }   // a flat JSON object, NOT gzipped, NOT enveloped
 *
 * The transport is deliberately lighter than `/v1/cc-sessions` (which keeps
 * uploading gzipped transcript JSONL). A dropped cc-status snapshot is fine;
 * the next hook re-pushes.
 */

/** Bump when the snapshot shape changes in a non-additive way. */
export const CC_STATUS_SCHEMA_VERSION = 1 as const;

export type CcSessionHealth = 'OK' | 'OVER_200K';

/** Bucket 1/2 — user decision recorded by the PreToolUse hook. */
export type UserDecision = 'allow' | 'deny' | 'approve_session' | 'auto_allow';

/** Bucket 1/2 — what triggered a Claude Code compact event. */
export type CompactTrigger = 'auto' | 'manual';

/**
 * One status snapshot. Only `schema_version`, `session_id`, `user_id`, `ts`
 * and `event` are required; every other field is best-effort and omitted when
 * the source data isn't available (e.g. quota probe never ran, transcript not
 * yet flushed, `cost`/`model` missing from the CC stdin payload). Consumers
 * must treat missing fields as "unknown", not "zero".
 */
export interface CcStatusSnapshot {
  schema_version: typeof CC_STATUS_SCHEMA_VERSION;
  /** Claude Code session id — the per-session join key. */
  session_id: string;
  /** digital-twin identity user_id — the per-user join key (matches transcripts/quota). */
  user_id: string;
  /** ISO-8601 timestamp this snapshot was produced (client clock). */
  ts: string;
  /** Which CC hook produced this snapshot ("Status" for the statusline, "Stop", "PreToolUse", ...). */
  event: string;

  // ---- identity / location ----
  /** Optional human-friendly name; clients fall back to user_id when unset. */
  display_name?: string;
  /** Disambiguates one person on two machines. */
  machine_id?: string;
  /** Working directory of the CC session. */
  cwd?: string;
  /** Current git branch of `cwd`, if it's a repo. */
  git_branch?: string;

  // ---- model + context (from CC stdin / transcript) ----
  model?: string;
  /** input + cache_creation + cache_read tokens of the latest assistant turn. */
  context_tokens?: number;
  /** context_tokens / 200000 (can exceed 1). */
  context_pct?: number;
  session_health?: CcSessionHealth;
  /** total cost in USD reported by CC for this session. */
  cost_usd?: number;
  /** sum of assistant turn tokens in the last 5 hours (rolling). */
  tokens_5h?: number;
  /** sum of assistant turn tokens in the last 7 days (rolling). */
  tokens_7d?: number;

  // ---- quota (from <dataRootDir>/digital-twin/quota-cache.json) ----
  subscription_tier?: string;
  five_hour_utilization?: number;
  seven_day_utilization?: number;
  five_hour_reset_at?: number;
  seven_day_reset_at?: number;
  /** true when the quota figures came from a stale cache (probe failed). */
  quota_stale?: boolean;

  // ---- output volume (one transcript scan) ----
  turn_count?: number;
  tool_calls_total?: number;
  tool_calls_failed?: number;
  files_touched?: number;
  /** ISO timestamp of the first transcript line for this session. */
  session_started_at?: string;

  // ---- client version (auto-update, 2026-05-19) ----
  /**
   * Riven client manifest version, e.g. "0.3.1+abc1234". Reported on every
   * cc-status push so the Updates dashboard can show "who's on which version".
   * Older clients (pre-auto-update) omit this; receivers treat missing as
   * "unknown". Capped at 64 chars via STRING_FIELD_CAP.
   */
  client_version?: string;

  // ---- raw prompt evidence (issue #308, grill §3) ----
  /**
   * Raw user prompt text captured at UserPromptSubmit. Privacy-sensitive:
   * since bucket 1 the default behavior **emits** raw_prompt unless the user
   * explicitly opts out with `RIVEN_REALTIME_RAW_PROMPT=0`. Legacy negative
   * env vars (`TEAMAGENT_REALTIME_RAW_PROMPT=0`) also opt out. Other event
   * kinds (session_start / stop / session_end / status) leave this unset.
   */
  raw_prompt?: string;

  // ---- bucket 1/2 additions — per-event fields populated by new hook bins ----

  /** event=pre_tool_use — name of the tool about to fire (Bash / Edit / Write / ...). */
  tool_name?: string;
  /** event=pre_tool_use — sha256 of the tool_input. Raw input is NOT sent (may contain code/paths/secrets). */
  tool_input_digest?: string;
  /** event=pre_tool_use — what the user did with the permission prompt. */
  user_decision?: UserDecision;
  /** event=pre_tool_use — whether the tool fires with dangerouslyDisableSandbox. */
  sandbox_disabled?: boolean;

  /** event=pre_compact — auto-triggered or user-initiated compact. */
  compact_trigger?: CompactTrigger;

  /** event=session_end — total session wall-clock duration in ms. */
  session_duration_ms?: number;
  /** event=session_end / stop — the last stop_reason CC reported. */
  stop_reason?: string;

  // ---- bucket 1/2 additions — cross-event fields ----

  /** Slash command name when the prompt starts with `/`. */
  slash_command?: string;
  /** Length of the user prompt in characters (independent of raw_prompt emit). */
  prompt_length?: number;
  /** True when the prompt contains a triple-backtick fence. */
  prompt_has_code_block?: boolean;
  /** True when this is the user's first prompt in this session. */
  prompt_is_first_in_session?: boolean;
  /** Count of suspicious "ignore previous instructions"-style patterns matched in the prompt. */
  prompt_injection_signals?: number;

  /** 1-min loadavg / cpu_count, [0..1+]. Sampled at hook fire time. */
  cpu_pct?: number;
  /** Used physical memory in MB at hook fire time. */
  mem_used_mb?: number;
  /** Total physical memory in MB at hook fire time. */
  mem_total_mb?: number;
  /** How many local Riven daemons are currently alive (proxy for concurrent CC sessions). */
  concurrent_cc_count?: number;
  /** ~/.claude/projects total size in MB. Sampled at SessionStart, cached for 1h. */
  claude_dir_size_mb?: number;
  /** Latency of the most recent Anthropic quota probe (ms). */
  anthropic_api_latency_ms?: number;

  /** Distinct hosts (no path/query) seen in WebFetch tool_use this session. */
  web_fetch_hosts?: string[];
}

/**
 * What `GET /api/cc-status*` returns: the stored snapshot plus a freshness
 * marker computed at query time (`now - ts`, floored at 0). Snapshots older
 * than the client's push cadence will have a large `stale_seconds`.
 */
export interface CcStatusQueryRow extends CcStatusSnapshot {
  stale_seconds: number;
}
