/**
 * `POST /v1/client-update-error` — ingest a single client-side update failure
 * report. Body schema = `ClientUpdateErrorReport`. Each accepted body is
 * appended as one JSON line to `RIVEN_CLIENT_UPDATE_ERRORS_PATH` (default
 * `<RIVEN_COLLECTOR_DIR>/client-update-errors.jsonl`).
 *
 * Append is wrapped in best-effort error handling; ingest never 5xx's on disk
 * failures (we don't want a full disk to break upstream upload pipes).
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ClientUpdateErrorReport } from './types.js';

const VALID_STAGES: ReadonlyArray<ClientUpdateErrorReport['stage']> = [
  'fetch-manifest',
  'download',
  'sha256',
  'rename',
  'probe',
  'daemon-restart',
  'manifest-suspicious',
];

const MAX_FIELD_LEN = 2048;
const MAX_USER_ID_LEN = 256;
const MAX_MACHINE_ID_LEN = 256;
const MAX_VERSION_LEN = 64;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * Validate + normalize an incoming error report. Returns the cleaned object or
 * null. Required fields: machine_id, user_id, stage, error_message, ts.
 * from_version / to_version may be null.
 */
export function sanitizeErrorReport(raw: unknown): ClientUpdateErrorReport | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.machine_id !== 'string' || o.machine_id.length === 0) return null;
  if (typeof o.user_id !== 'string' || o.user_id.length === 0) return null;
  if (typeof o.stage !== 'string' || !VALID_STAGES.includes(o.stage as ClientUpdateErrorReport['stage'])) return null;
  if (typeof o.error_message !== 'string') return null;
  if (typeof o.ts !== 'string' || Number.isNaN(Date.parse(o.ts))) return null;
  let from: string | null = null;
  if (o.from_version === null) from = null;
  else if (typeof o.from_version === 'string') from = truncate(o.from_version, MAX_VERSION_LEN);
  else return null;
  let to: string | null = null;
  if (o.to_version === null) to = null;
  else if (typeof o.to_version === 'string') to = truncate(o.to_version, MAX_VERSION_LEN);
  else return null;
  return {
    machine_id: truncate(o.machine_id, MAX_MACHINE_ID_LEN),
    user_id: truncate(o.user_id, MAX_USER_ID_LEN),
    from_version: from,
    to_version: to,
    stage: o.stage as ClientUpdateErrorReport['stage'],
    error_message: truncate(o.error_message, MAX_FIELD_LEN),
    ts: o.ts,
  };
}

/**
 * Append one validated report to the JSONL store. Best-effort: directory mkdir
 * failure or appendFileSync throw is caught and reported via the return.
 */
export function appendErrorReport(
  filePath: string,
  report: ClientUpdateErrorReport,
): { ok: true } | { ok: false; reason: string } {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
  } catch (err) {
    return { ok: false, reason: `mkdir: ${err instanceof Error ? err.message : String(err)}` };
  }
  try {
    appendFileSync(filePath, JSON.stringify(report) + '\n', 'utf8');
  } catch (err) {
    return { ok: false, reason: `append: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { ok: true };
}
