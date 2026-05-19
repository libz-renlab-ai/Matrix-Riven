/**
 * `GET /v1/client-latest/files/:name` — streams one staged .cjs from
 * `RIVEN_CLIENT_LATEST_DIR`. The :name segment MUST match the fixed whitelist
 * (the same 6 bin names the manifest validator accepts); anything else is 404.
 *
 * Path traversal is blocked structurally — the route handler uses a whitelist
 * lookup, NOT path concat of caller-supplied input.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ServerResponse } from 'node:http';
import { CLIENT_BIN_WHITELIST, type ClientBinName } from './types.js';

function isWhitelistedBin(name: string): name is ClientBinName {
  return (CLIENT_BIN_WHITELIST as readonly string[]).includes(name);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

/**
 * Parse the bin name out of a URL path like `/v1/client-latest/files/bin-uploader.cjs`.
 * Returns null if the segment isn't on the whitelist OR contains any
 * path-traversal characters (defense-in-depth — the whitelist already rejects
 * anything outside the 6 fixed names).
 */
export function extractBinName(urlPath: string): ClientBinName | null {
  const prefix = '/v1/client-latest/files/';
  if (!urlPath.startsWith(prefix)) return null;
  const tail = urlPath.slice(prefix.length);
  // CTO review: decode percent-escapes before traversal check so `%2e%2e/`
  // doesn't bypass the literal `..` filter. decodeURIComponent throws on
  // malformed sequences — treat as not-found.
  let decoded: string;
  try {
    decoded = decodeURIComponent(tail);
  } catch {
    return null;
  }
  if (decoded.includes('/') || decoded.includes('\\') || decoded.includes('..')) return null;
  if (decoded.includes('\0')) return null;
  if (!isWhitelistedBin(decoded)) return null;
  return decoded;
}

export function handleFileRequest(
  res: ServerResponse,
  clientLatestDir: string,
  urlPath: string,
): void {
  const name = extractBinName(urlPath);
  if (name === null) {
    sendJson(res, 404, { error: 'not found' });
    return;
  }
  const file = join(clientLatestDir, name);
  if (!existsSync(file)) {
    sendJson(res, 404, { error: 'file missing — manifest references a file not yet published' });
    return;
  }
  let size = 0;
  try {
    size = statSync(file).size;
  } catch (err) {
    sendJson(res, 500, { error: 'stat failed', detail: err instanceof Error ? err.message : String(err) });
    return;
  }
  res.statusCode = 200;
  res.setHeader('content-type', 'application/octet-stream');
  res.setHeader('content-length', String(size));
  res.on('error', () => {});
  const stream = createReadStream(file);
  stream.on('error', (err) => {
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'read failed', detail: err.message });
      return;
    }
    res.end();
  });
  stream.pipe(res);
}
