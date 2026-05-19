import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { computeHmac, verifyManifestHmac } from '../hmac.js';
import type { ClientManifest } from '../types.js';

const MANIFEST: ClientManifest = {
  version: '0.3.1+abc1234',
  generated_at: '2026-05-19T12:00:00.000Z',
  files: [
    { name: 'bin-uploader.cjs', sha256: 'a'.repeat(64), size: 1024 },
  ],
};

const SECRET = 'super-secret-key';

describe('computeHmac', () => {
  it('produces stable output across calls', () => {
    expect(computeHmac(SECRET, MANIFEST)).toBe(computeHmac(SECRET, MANIFEST));
  });
  it('produces different output for different secrets', () => {
    expect(computeHmac(SECRET, MANIFEST)).not.toBe(computeHmac('other-secret', MANIFEST));
  });
  it('produces different output for different content', () => {
    const m2 = { ...MANIFEST, version: '0.3.2+def' };
    expect(computeHmac(SECRET, MANIFEST)).not.toBe(computeHmac(SECRET, m2));
  });
  it('ignores undefined optional fields (kept stable)', () => {
    const m3: ClientManifest = { ...MANIFEST };
    delete (m3 as Partial<ClientManifest>).disabled;
    expect(computeHmac(SECRET, m3)).toBe(computeHmac(SECRET, MANIFEST));
  });
  it('includes disabled flag when present', () => {
    const m4: ClientManifest = { ...MANIFEST, disabled: true };
    expect(computeHmac(SECRET, MANIFEST)).not.toBe(computeHmac(SECRET, m4));
  });
});

describe('verifyManifestHmac', () => {
  beforeEach(() => {
    delete process.env.RIVEN_CLIENT_MANIFEST_SECRET;
  });
  afterEach(() => {
    delete process.env.RIVEN_CLIENT_MANIFEST_SECRET;
  });

  it('skips when env unset (backward-compat)', () => {
    const r = verifyManifestHmac({ ...MANIFEST });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mode).toBe('skipped');
  });
  it('accepts a correctly-signed manifest', () => {
    process.env.RIVEN_CLIENT_MANIFEST_SECRET = SECRET;
    const hmac = computeHmac(SECRET, MANIFEST);
    const r = verifyManifestHmac({ ...MANIFEST, hmac_sha256: hmac });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mode).toBe('verified');
  });
  it('rejects missing hmac when env set', () => {
    process.env.RIVEN_CLIENT_MANIFEST_SECRET = SECRET;
    const r = verifyManifestHmac({ ...MANIFEST });
    expect(r.ok).toBe(false);
  });
  it('rejects mismatched hmac', () => {
    process.env.RIVEN_CLIENT_MANIFEST_SECRET = SECRET;
    const r = verifyManifestHmac({ ...MANIFEST, hmac_sha256: 'b'.repeat(64) });
    expect(r.ok).toBe(false);
  });
  it('rejects malformed hmac (not 64 hex)', () => {
    process.env.RIVEN_CLIENT_MANIFEST_SECRET = SECRET;
    const r = verifyManifestHmac({ ...MANIFEST, hmac_sha256: 'short' });
    expect(r.ok).toBe(false);
  });
  it('rejects when secret differs (cross-tenant defense)', () => {
    process.env.RIVEN_CLIENT_MANIFEST_SECRET = 'tenant-A';
    const hmac = computeHmac('tenant-B', MANIFEST);
    const r = verifyManifestHmac({ ...MANIFEST, hmac_sha256: hmac });
    expect(r.ok).toBe(false);
  });
});
