/**
 * Types for the client auto-update subsystem.
 *
 * Server holds the latest set of staged .cjs bins under
 * `RIVEN_CLIENT_LATEST_DIR` (default `<RIVEN_COLLECTOR_DIR>/client-latest/`).
 * `manifest.json` enumerates them with sha256 + size; clients GET the manifest
 * and individual files. Failed updates POST a structured error to
 * `/v1/client-update-error`, appended to `client-update-errors.jsonl`.
 *
 * See `docs/superpowers/specs/2026-05-19-client-auto-update-design.md`.
 */

/** Whitelisted bin names — both the server file-route and the manifest validator gate on this. */
export const CLIENT_BIN_WHITELIST = [
  'bin-digital-twin-tap.cjs',
  'bin-session-start.cjs',
  'bin-user-prompt-submit.cjs',
  'bin-uploader.cjs',
  'bin-digital-twin.cjs',
  'bin-auto-updater.cjs',
] as const;
export type ClientBinName = (typeof CLIENT_BIN_WHITELIST)[number];

export interface ClientManifestFile {
  name: ClientBinName;
  sha256: string;
  size: number;
}

export interface ClientManifest {
  /** Opaque version string. Client treats as equality-only; operator chooses format (typically `${pkg.version}+${git-sha}`). */
  version: string;
  /** ISO timestamp the manifest was generated. Client uses this as the second gate against version-string typo. */
  generated_at: string;
  files: ClientManifestFile[];
}

/** Body of `POST /v1/client-update-error`. */
export interface ClientUpdateErrorReport {
  machine_id: string;
  user_id: string;
  /** Local manifest.version before this update attempt; null on first install. */
  from_version: string | null;
  /** Remote manifest.version this attempt was targeting; null if manifest fetch failed. */
  to_version: string | null;
  /** Which phase failed. */
  stage:
    | 'fetch-manifest'
    | 'download'
    | 'sha256'
    | 'rename'
    | 'probe'
    | 'daemon-restart'
    | 'manifest-suspicious';
  error_message: string;
  ts: string;
}

/** Shape returned by `GET /api/client-update-status` for the dashboard. */
export interface ClientUpdateStatus {
  manifest: ClientManifest | null;
  distribution: Array<{
    client_version: string;
    user_count: number;
    users: string[];
  }>;
  errors: {
    total_24h: number;
    by_stage_24h: Record<string, number>;
    recent: ClientUpdateErrorReport[];
  };
}
