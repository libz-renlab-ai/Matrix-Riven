/**
 * Optional HMAC-SHA256 manifest signing.
 *
 * Threat model: an attacker with write access to `RIVEN_CLIENT_LATEST_DIR`
 * (compromised collector host, malicious operator, file-system race) gets RCE
 * on every developer machine without signing. With HMAC, they also need the
 * shared secret to forge a manifest clients will accept.
 *
 * Secret distribution: `RIVEN_CLIENT_MANIFEST_SECRET` env var. Set on:
 *   - The publish machine (where scripts/publish-client.mjs runs)
 *   - Every developer machine (in their shell env or login script)
 *
 * Backward compatibility: if env unset on EITHER side, the check is skipped
 * (logged as `warn: hmac-unset`) — same behavior as v0.3.0 pre-signing. This
 * lets teams roll out signing gradually without bricking existing clients.
 *
 * Canonical form: HMAC is computed over the manifest JSON with the `hmac_sha256`
 * field stripped (otherwise computing it would change what gets signed).
 */
import { createHmac } from 'node:crypto';
import type { ClientManifest } from './types.js';

const ENV_SECRET = 'RIVEN_CLIENT_MANIFEST_SECRET';

/**
 * Stable JSON serialization for signing: sorted keys, no whitespace, hmac_sha256
 * field stripped if present. Both sides MUST produce identical bytes.
 */
function canonicalize(m: ClientManifest): string {
  const copy: Record<string, unknown> = {};
  // Iterate in fixed order for determinism. Don't include hmac_sha256.
  const ordered: Array<keyof ClientManifest | 'hmac_sha256'> = [
    'version',
    'generated_at',
    'disabled',
    'note',
    'files',
  ];
  for (const k of ordered) {
    const v = (m as unknown as Record<string, unknown>)[k];
    if (v === undefined) continue;
    if (k === 'files' && Array.isArray(v)) {
      copy.files = (v as Array<Record<string, unknown>>).map((f) => ({
        name: f.name,
        sha256: f.sha256,
        size: f.size,
      }));
    } else {
      copy[k] = v;
    }
  }
  return JSON.stringify(copy);
}

export function computeHmac(secret: string, manifest: ClientManifest): string {
  return createHmac('sha256', secret).update(canonicalize(manifest), 'utf8').digest('hex');
}

export type HmacVerificationResult =
  | { ok: true; mode: 'verified' }
  | { ok: true; mode: 'skipped'; reason: string }
  | { ok: false; reason: string };

/**
 * Verify the manifest's `hmac_sha256` field. If env secret is unset, return
 * `skipped` (warn-and-continue). If env is set but manifest lacks the field,
 * return `failed`. If both present, compare.
 */
export function verifyManifestHmac(
  manifest: ClientManifest & { hmac_sha256?: unknown },
): HmacVerificationResult {
  const secret = process.env[ENV_SECRET];
  if (!secret || secret.length === 0) {
    return { ok: true, mode: 'skipped', reason: `${ENV_SECRET} unset` };
  }
  const provided = manifest.hmac_sha256;
  if (typeof provided !== 'string' || !/^[0-9a-f]{64}$/.test(provided)) {
    return { ok: false, reason: 'manifest lacks valid hmac_sha256 field but client requires it' };
  }
  const expected = computeHmac(secret, manifest as ClientManifest);
  // Constant-time compare
  if (provided.length !== expected.length) {
    return { ok: false, reason: 'hmac length mismatch' };
  }
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) {
    return { ok: false, reason: 'hmac mismatch — manifest may have been tampered with' };
  }
  return { ok: true, mode: 'verified' };
}
