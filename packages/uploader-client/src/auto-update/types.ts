/**
 * Types for the auto-update subsystem (client side).
 *
 * Server has its own copy under collector-server/src/client-update/types.ts;
 * we deliberately don't import from there to keep the client bundle from
 * pulling server-only deps. The shapes must stay in sync — both are derived
 * from the spec at docs/superpowers/specs/2026-05-19-client-auto-update-design.md.
 */

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
  version: string;
  generated_at: string;
  files: ClientManifestFile[];
}

export type UpdateStage =
  | 'fetch-manifest'
  | 'download'
  | 'sha256'
  | 'rename'
  | 'probe'
  | 'daemon-restart'
  | 'manifest-suspicious';

export interface UpdateErrorReport {
  machine_id: string;
  user_id: string;
  from_version: string | null;
  to_version: string | null;
  stage: UpdateStage;
  error_message: string;
  ts: string;
}
