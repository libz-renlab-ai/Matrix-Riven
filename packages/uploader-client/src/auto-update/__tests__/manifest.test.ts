import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateManifest,
  readLocalManifest,
  writeLocalManifest,
  shouldUpdate,
} from '../manifest.js';
import type { ClientManifest } from '../types.js';

const VALID: ClientManifest = {
  version: '0.3.1+abc',
  generated_at: '2026-05-19T12:00:00.000Z',
  files: [{ name: 'bin-uploader.cjs', sha256: 'a'.repeat(64), size: 1024 }],
};

describe('validateManifest (client side)', () => {
  it('accepts valid', () => {
    expect(validateManifest(VALID)).not.toBeNull();
  });
  it('rejects unknown bin name', () => {
    expect(validateManifest({ ...VALID, files: [{ name: 'evil.cjs', sha256: 'a'.repeat(64), size: 1 }] })).toBeNull();
  });
  it('rejects bad sha256 length', () => {
    expect(validateManifest({ ...VALID, files: [{ name: 'bin-uploader.cjs', sha256: 'short', size: 1 }] })).toBeNull();
  });
});

describe('readLocalManifest / writeLocalManifest roundtrip', () => {
  it('writes then reads cleanly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'riven-mf-'));
    try {
      const p = join(dir, 'manifest.json');
      writeLocalManifest(p, VALID);
      expect(existsSync(p)).toBe(true);
      const read = readLocalManifest(p);
      expect(read).not.toBeNull();
      expect(read!.version).toBe('0.3.1+abc');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('returns null when file is missing', () => {
    expect(readLocalManifest('/nonexistent/manifest.json')).toBeNull();
  });
  it('returns null when file is corrupt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'riven-mf-'));
    try {
      const p = join(dir, 'manifest.json');
      writeFileSync(p, 'not json', 'utf8');
      expect(readLocalManifest(p)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('shouldUpdate kill switch (operator emergency stop)', () => {
  it('ALLOWS fresh install even when remote.disabled=true (no-local can never downgrade)', () => {
    const killed = { ...VALID, disabled: true, note: 'incident X' };
    const d = shouldUpdate(null, killed);
    expect(d.update).toBe(false);
    if (!d.update) expect(d.reason).toBe('no-local');
  });
  it('refuses to upgrade when remote.disabled=true (even if newer)', () => {
    const local = { ...VALID, version: 'v0', generated_at: '2026-01-01T00:00:00Z' };
    const killed = { ...VALID, version: 'v1', disabled: true };
    const d = shouldUpdate(local, killed);
    expect(d.update).toBe(false);
    if (!d.update) expect(d.reason).toBe('disabled');
  });
  it('proceeds normally when disabled=false', () => {
    const local = { ...VALID, version: 'v0', generated_at: '2026-01-01T00:00:00Z' };
    const remote = { ...VALID, version: 'v1', disabled: false };
    expect(shouldUpdate(local, remote).update).toBe(true);
  });
  it('carries note through to the decision', () => {
    const local = { ...VALID, version: 'v0', generated_at: '2026-01-01T00:00:00Z' };
    const killed = { ...VALID, version: 'v1', disabled: true, note: 'pausing rollout' };
    const d = shouldUpdate(local, killed);
    if (!d.update && d.reason === 'disabled') expect(d.note).toBe('pausing rollout');
  });
});

describe('validateManifest preserves disabled+note', () => {
  it('parses disabled flag', () => {
    const m = validateManifest({ ...VALID, disabled: true });
    expect(m).not.toBeNull();
    expect(m?.disabled).toBe(true);
  });
  it('parses note capped at 256 chars', () => {
    const m = validateManifest({ ...VALID, note: 'x'.repeat(500) });
    expect(m?.note?.length).toBeLessThanOrEqual(256);
  });
  it('rejects garbage in disabled (must be bool)', () => {
    // validator should ignore — note already short-circuits with || strings
    const m = validateManifest({ ...VALID, disabled: 'true' });
    expect(m).not.toBeNull();
    expect(m?.disabled).toBeUndefined();
  });
});

describe('shouldUpdate double-gate', () => {
  it('updates when no local manifest (fresh install)', () => {
    const d = shouldUpdate(null, VALID);
    expect(d.update).toBe(false);
    if (!d.update) expect(d.reason).toBe('no-local');
  });
  it('skips when versions match', () => {
    const d = shouldUpdate(VALID, VALID);
    expect(d.update).toBe(false);
    if (!d.update) expect(d.reason).toBe('same-version');
  });
  it('updates when version differs and remote_ts newer', () => {
    const local = { ...VALID, version: 'v0', generated_at: '2026-05-18T00:00:00.000Z' };
    expect(shouldUpdate(local, VALID).update).toBe(true);
  });
  it('REFUSES when version differs but remote_ts equal (suspicious)', () => {
    const local = { ...VALID, version: 'v0' };
    const d = shouldUpdate(local, VALID);
    expect(d.update).toBe(false);
    if (!d.update) expect(d.reason).toBe('manifest-suspicious');
  });
  it('REFUSES when version differs but remote_ts older (suspicious downgrade)', () => {
    const local = { ...VALID, version: 'v0', generated_at: '2026-06-01T00:00:00.000Z' };
    const d = shouldUpdate(local, VALID);
    expect(d.update).toBe(false);
    if (!d.update) expect(d.reason).toBe('manifest-suspicious');
  });
});
