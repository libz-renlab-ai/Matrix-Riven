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
 * Stable JSON serialization for signing.
 *
 * Round-2 review fix: round 1 used a fixed whitelist of fields, which meant
 * any future field added to the manifest would not be signed. Now we sign
 * EVERY top-level key (alphabetically sorted) EXCEPT `hmac_sha256` itself,
 * and inside `files[]` we also sort+serialize known sub-keys deterministically.
 * Any future-added field automatically gets covered by the signature.
 */
function sortedKeys(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).filter((k) => k !== 'hmac_sha256').sort();
}

function canonicalize(m: ClientManifest): string {
  const o = m as unknown as Record<string, unknown>;
  const copy: Record<string, unknown> = {};
  for (const k of sortedKeys(o)) {
    const v = o[k];
    if (v === undefined) continue;
    if (k === 'files' && Array.isArray(v)) {
      // Deterministic file serialization: sort by name then list known fields
      // in fixed order. New file-level fields must be added here AND the
      // schema_version bumped (which is itself signed because we sort all keys).
      const files = [...(v as Array<Record<string, unknown>>)].sort((a, b) =>
        String(a.name).localeCompare(String(b.name)),
      );
      copy.files = files.map((f) => {
        const out: Record<string, unknown> = {};
        for (const fk of Object.keys(f).sort()) {
          out[fk] = f[fk];
        }
        return out;
      });
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
