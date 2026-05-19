/**
 * `GET /v1/client-latest/manifest` — serves the latest manifest.json from
 * `RIVEN_CLIENT_LATEST_DIR`.
 *
 * Read-on-demand: no in-memory cache, no fs.watch. Manifest publish on the
 * operator side is supposed to write all .cjs files first, then atomic-rename
 * `manifest.json` into place last. With read-on-demand we never serve a
 * manifest that points at files we don't have — half-written state simply
 * surfaces as 404 (file not yet visible) or 503 (parse failure).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CLIENT_BIN_WHITELIST, type ClientManifest, type ClientManifestFile } from './types.js';

const MANIFEST_NAME = 'manifest.json';

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

/**
 * Validate parsed manifest JSON against the schema. Returns the typed value or
 * null. Rejects unknown bin names so a manifest can't smuggle a file outside
 * the whitelist into a download URL.
 */
export function validateManifest(raw: unknown): ClientManifest | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.version !== 'string' || o.version.length === 0 || o.version.length > 256) return null;
  if (typeof o.generated_at !== 'string') return null;
  if (Number.isNaN(Date.parse(o.generated_at))) return null;
  if (!Array.isArray(o.files)) return null;
  const files: ClientManifestFile[] = [];
  for (const f of o.files) {
    if (typeof f !== 'object' || f === null) return null;
    const ff = f as Record<string, unknown>;
    if (
      typeof ff.name !== 'string' ||
      !(CLIENT_BIN_WHITELIST as readonly string[]).includes(ff.name)
    ) {
      return null;
    }
    if (typeof ff.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(ff.sha256)) return null;
    if (typeof ff.size !== 'number' || !Number.isFinite(ff.size) || ff.size < 0 || ff.size > 100 * 1024 * 1024) return null;
    files.push({
      name: ff.name as ClientManifestFile['name'],
      sha256: ff.sha256,
      size: ff.size,
    });
  }
  // Round-3 review fix: preserve UNKNOWN top-level fields too. Otherwise a
  // future-added field (e.g. `rollout`, `schema_version`) signed by
  // publish-client would be dropped here, and the client would recompute
  // hmac without it and reject every manifest fleet-wide. The price of this
  // pass-through is that we trust operator-published fields; mitigation:
  // we still validate the *known* fields strictly, and clients sha256-verify
  // every binary referenced — so an attacker rewriting the file route is
  // still blocked. Cap object size defensively.
  const result: Record<string, unknown> = {
    ...o,
    files,
  };
  result.version = o.version;
  result.generated_at = o.generated_at;
  if (typeof o.disabled !== 'boolean') delete result.disabled;
  if (typeof o.note === 'string' && o.note.length > 0) {
    result.note = (o.note as string).slice(0, 256);
  } else {
    delete result.note;
  }
  // hmac_sha256 must be hex64; drop garbage values.
  if (typeof o.hmac_sha256 === 'string' && /^[0-9a-f]{64}$/.test(o.hmac_sha256)) {
    result.hmac_sha256 = o.hmac_sha256;
  } else {
    delete result.hmac_sha256;
  }
  return result as ClientManifest & { hmac_sha256?: string };
}

export function readManifestFromDir(dir: string): ClientManifest | { status: 404 } | { status: 503; detail: string } {
  const path = join(dir, MANIFEST_NAME);
  if (!existsSync(path)) return { status: 404 };
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    return { status: 503, detail: err instanceof Error ? err.message : String(err) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { status: 503, detail: `manifest.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  const m = validateManifest(parsed);
  if (m === null) return { status: 503, detail: 'manifest.json failed schema validation' };
  return m;
}

export function handleManifestRequest(
  _req: IncomingMessage,
  res: ServerResponse,
  clientLatestDir: string,
): void {
  const result = readManifestFromDir(clientLatestDir);
  if ('status' in result) {
    if (result.status === 404) {
      send(res, 404, { error: 'no manifest published' });
      return;
    }
    send(res, 503, { error: 'manifest unreadable', detail: result.detail });
    return;
  }
  send(res, 200, result);
}
