/**
 * Public surface of the client-update subsystem.
 */
export {
  CLIENT_BIN_WHITELIST,
  type ClientBinName,
  type ClientManifest,
  type ClientManifestFile,
  type ClientUpdateErrorReport,
  type ClientUpdateStatus,
} from './types.js';
export { handleManifestRequest, readManifestFromDir, validateManifest } from './manifest-route.js';
export { handleFileRequest, extractBinName } from './file-route.js';
export { sanitizeErrorReport, appendErrorReport } from './error-ingest.js';
export {
  buildClientUpdateStatus,
  errorsFileStat,
  type StatusAggregateInputs,
} from './status-aggregate.js';

import { join } from 'node:path';

/**
 * Resolve the directory holding the published manifest + .cjs files.
 * Default = `<outputDir>/client-latest/`. Env override =
 * `RIVEN_CLIENT_LATEST_DIR` (absolute path).
 */
export function resolveClientLatestDir(outputDir: string): string {
  const env = process.env.RIVEN_CLIENT_LATEST_DIR;
  if (env && env.length > 0) return env;
  return join(outputDir, 'client-latest');
}

/**
 * Resolve the path of the append-only error JSONL.
 * Default = `<outputDir>/client-update-errors.jsonl`. Env override =
 * `RIVEN_CLIENT_UPDATE_ERRORS_PATH`.
 */
export function resolveErrorsJsonlPath(outputDir: string): string {
  const env = process.env.RIVEN_CLIENT_UPDATE_ERRORS_PATH;
  if (env && env.length > 0) return env;
  return join(outputDir, 'client-update-errors.jsonl');
}
