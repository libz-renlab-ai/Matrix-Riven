/**
 * Schema A: cc-session payload uploaded to `POST /v1/cc-sessions`.
 *
 * Wire shape (issue #146 F2 — aligned with mock-server.ts validation):
 *
 *   {
 *     "schema_version": 1,
 *     "envelope": { session_id, user_id, machine_id, captured_at, ... },
 *     "transcript": { "compression": "gzip+base64", "content": "<base64 of gzipped jsonl>" }
 *   }
 *
 * Server reads `obj.envelope.session_id` / `obj.envelope.user_id` /
 * `obj.envelope.captured_at` and `obj.transcript.content`. The pre-F2
 * flat shape (`{schema_version, id, user_id, payload, ...}`) was rejected
 * silently; the server returned 200 but only the bytes ever landed (id was
 * randomized + user_id fell back to "unknown"). F2 reshapes the output of
 * buildCcSessionEnvelope so the server's existing readers find what they
 * expect, without changing the server side.
 */
import { gzipSync } from 'node:zlib';

export interface CcSessionMetadata {
  id: string;
  kind: 'cc-session';
  session_id: string;
  cwd: string;
  project_name: string;
  transcript_path: string;
  payload_size: number;
  captured_at: string;
  source: string;
  host: { os: string; arch: string; hostname: string };
  /** Matrix-Riven client version that wrote this queue entry. */
  riven_version: string;
  /**
   * @deprecated Renamed to `riven_version`. Kept readable here so in-flight
   * queue entries written by older (TeamBrain-era) clients still parse —
   * `buildCcSessionEnvelope` falls back to this field when `riven_version`
   * is missing.
   */
  teamagent_version?: string;
  schema_version: 1;
  /**
   * Issue #283 — optional Max-tier quota snapshot persisted alongside the
   * queue entry. When present, the uploader forwards it onto the wire
   * envelope so the collector writes a sibling `quota.json` per user/day.
   * Absent on entries enqueued by the existing single-session Stop tap.
   */
  quota?: CcSessionQuotaBlock;
  /**
   * Issue #266 F7 — ISO timestamp of the first transient/network upload
   * failure. Persisted into the queue metadata file so the 24h
   * dead-letter window survives daemon idle-self-exits. Absent on
   * entries that have never failed.
   */
  first_failed_at?: string;
}

/** Inner envelope block — what mock-server.ts reads under `obj.envelope`. */
export interface CcSessionEnvelopeBlock {
  id: string;
  user_id: string;
  machine_id: string;
  session_id: string;
  cwd: string;
  project_name: string;
  transcript_path: string;
  payload_size: number;
  captured_at: string;
  source: string;
  host: HostInfo;
  /** Matrix-Riven client version that produced this envelope. */
  riven_version: string;
  /** ISO timestamp first persisted into config (audit field). */
  consented_at: string | null;
  /**
   * Bucket 1/2 (A8) — sha256/size/hook-count/plugin-list summary of the user's
   * ~/.claude/settings.json. Specifically excludes raw bytes of token / Bearer /
   * command-string fields. Absent when settings.json doesn't exist.
   */
  settings_digest?: SettingsDigest;
  /**
   * Bucket 1/2 (A8) — content of project-level CLAUDE.md (the project doc CC
   * loads as a system prompt). Capped at 64 KiB. Absent when no CLAUDE.md is
   * found in cwd or any ancestor directory.
   */
  claude_md?: { content: string; size: number };
  /** Bucket 1/2 (F1) — L1 redaction counts grouped by sensitive-kind. */
  l1_redactions_by_kind?: Record<string, number>;
  /** Bucket 1/2 (F5) — L1 redaction counts grouped by transcript location. */
  l1_redactions_by_location?: RedactionLocationCounts;
  /**
   * Bucket 1/2 (C8) — Anthropic OAuth credential expiry from
   * ~/.claude/.credentials.json. Scope strings are NOT sent — only the
   * expires_at ISO timestamp so dashboards can warn before token rotates.
   */
  oauth_expires_at?: string;
}

/** Host environment captured on every envelope. Bucket 1/2 widens this block. */
export interface HostInfo {
  os: string;
  arch: string;
  hostname: string;
  /** Bucket 1/2 (C5). */
  node_version?: string;
  /** Bucket 1/2 (C10). */
  cc_version?: string;
  /** Bucket 1/2 (C5). */
  pnpm_version?: string;
  /** Bucket 1/2 (C5). */
  git_version?: string;
  /** Bucket 1/2 (C7) — IANA timezone, e.g. "Asia/Shanghai". */
  timezone?: string;
  /** Bucket 1/2 (C9) — true if HTTP_PROXY / HTTPS_PROXY is set at hook fire. */
  via_proxy?: boolean;
  /** Bucket 1/2 (C6) — current shell name (basename of $SHELL or %ComSpec%). */
  shell?: string;
}

/** Bucket 1/2 (A8) — settings.json digest shape. */
export interface SettingsDigest {
  /** sha256 of the file bytes (lowercase hex). */
  sha256: string;
  /** File size in bytes. */
  size: number;
  /** Total hook entries across all events. */
  hook_count: number;
  /** Names of plugins listed under `enabledPlugins` (keys, not values). */
  plugins: string[];
}

/** Bucket 1/2 (F5) — where in the transcript the L1 redactor matched. */
export interface RedactionLocationCounts {
  in_user_prompt: number;
  in_assistant_response: number;
  in_tool_use_input: number;
  in_tool_result: number;
}

export interface CcSessionTranscriptBlock {
  compression: 'gzip+base64';
  content: string; // base64(gzip(transcript bytes))
}

/**
 * Issue #283 — Claude Code Max quota snapshot.
 *
 * Sourced from the `anthropic-ratelimit-unified-*` response headers on a
 * 1-token probe to `POST /v1/messages`. The collector writes this block
 * (when present) to `<user>/<date>/quota.json` so the dashboard can render
 * 5h / 7d progress bars per user.
 *
 * `stale: true` means the probe call failed (auth, 429, network) and the
 * payload reflects the last successful cache instead of a live read. The
 * collector still persists stale snapshots so users with a long-broken
 * probe don't silently disappear from the dashboard.
 */
export interface CcSessionQuotaBlock {
  /** e.g. "max" + "default_claude_max_20x" — joined from .credentials.json. */
  subscription_tier: string;
  /** 5-hour rolling window utilization, 0-1 inclusive. */
  five_hour_utilization: number;
  /** 7-day rolling window utilization, 0-1 inclusive. */
  seven_day_utilization: number;
  /** Unix seconds when the 5h window resets. */
  five_hour_reset_at: number;
  /** Unix seconds when the 7d window resets. */
  seven_day_reset_at: number;
  /** ISO timestamp at which the probe was performed. */
  probed_at: string;
  /** True when payload is from a cache fallback (probe failed). */
  stale: boolean;
}

export interface CcSessionEnvelope {
  schema_version: 1;
  envelope: CcSessionEnvelopeBlock;
  transcript: CcSessionTranscriptBlock;
  /** Issue #283 — optional Max-tier quota snapshot piggy-backed on the envelope. */
  quota?: CcSessionQuotaBlock;
  /**
   * M2 (对话上传通道) — number of sensitive fields the uploader's L1 pass
   * scrubbed from this transcript before upload. Absent on pre-M2 envelopes;
   * the collector persists it so a member can see "敏感字段被模糊化次数".
   */
  l1_redaction_count?: number;
}

export interface BuildEnvelopeInput {
  metadata: CcSessionMetadata;
  payloadBytes: Buffer;
  identity: {
    user_id: string;
    machine_id: string;
    /** Issue #146 F9 — audit-trail timestamp of first config persist. */
    consented_at?: string | null;
  };
  /** Issue #283 — optional quota snapshot to attach to the envelope. */
  quota?: CcSessionQuotaBlock;
  /** Bucket 1/2 — environment + privacy-aware metadata attached on every envelope. */
  extras?: EnvelopeExtras;
}

/** Bucket 1/2 — additive envelope fields. All optional; absent fields are omitted. */
export interface EnvelopeExtras {
  hostInfo?: Partial<HostInfo>;
  settingsDigest?: SettingsDigest;
  claudeMd?: { content: string; size: number };
  l1RedactionsByKind?: Record<string, number>;
  l1RedactionsByLocation?: RedactionLocationCounts;
  oauthExpiresAt?: string;
}

export function buildCcSessionEnvelope(input: BuildEnvelopeInput): CcSessionEnvelope {
  const compressed = gzipSync(input.payloadBytes);
  const payloadB64 = compressed.toString('base64');
  const x = input.extras;
  const host: HostInfo = {
    os: input.metadata.host.os,
    arch: input.metadata.host.arch,
    hostname: input.metadata.host.hostname,
    ...(x?.hostInfo ?? {}),
  };
  const envelopeBlock: CcSessionEnvelopeBlock = {
    id: input.metadata.id,
    user_id: input.identity.user_id,
    machine_id: input.identity.machine_id,
    session_id: input.metadata.session_id,
    cwd: input.metadata.cwd,
    project_name: input.metadata.project_name,
    transcript_path: input.metadata.transcript_path,
    payload_size: input.metadata.payload_size,
    captured_at: input.metadata.captured_at,
    source: input.metadata.source,
    host,
    // Prefer the canonical `riven_version`; fall back to the deprecated
    // `teamagent_version` field for in-flight queue entries written by
    // older clients.
    riven_version:
      input.metadata.riven_version ??
      input.metadata.teamagent_version ??
      'unknown',
    consented_at: input.identity.consented_at ?? null,
  };
  if (x?.settingsDigest) envelopeBlock.settings_digest = x.settingsDigest;
  if (x?.claudeMd) envelopeBlock.claude_md = x.claudeMd;
  if (x?.l1RedactionsByKind) envelopeBlock.l1_redactions_by_kind = x.l1RedactionsByKind;
  if (x?.l1RedactionsByLocation) envelopeBlock.l1_redactions_by_location = x.l1RedactionsByLocation;
  if (x?.oauthExpiresAt) envelopeBlock.oauth_expires_at = x.oauthExpiresAt;
  const env: CcSessionEnvelope = {
    schema_version: 1,
    envelope: envelopeBlock,
    transcript: {
      compression: 'gzip+base64',
      content: payloadB64,
    },
  };
  if (input.quota) env.quota = input.quota;
  return env;
}

/** Type guard for parsing metadata read from disk. */
export function isCcSessionMetadata(v: unknown): v is CcSessionMetadata {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    o.kind === 'cc-session' &&
    typeof o.session_id === 'string' &&
    typeof o.cwd === 'string' &&
    typeof o.transcript_path === 'string' &&
    typeof o.captured_at === 'string'
  );
}
