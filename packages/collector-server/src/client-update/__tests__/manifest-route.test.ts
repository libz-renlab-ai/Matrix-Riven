import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readManifestFromDir, validateManifest } from '../manifest-route.js';

function setupDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'riven-client-update-'));
  mkdirSync(dir, { recursive: true });
  return dir;
}

const VALID_MANIFEST = {
  version: '0.3.1+abc1234',
  generated_at: '2026-05-19T12:00:00.000Z',
  files: [
    {
      name: 'bin-uploader.cjs',
      sha256: 'a'.repeat(64),
      size: 1024,
    },
  ],
};

describe('validateManifest', () => {
  it('accepts a well-formed manifest', () => {
    expect(validateManifest(VALID_MANIFEST)).not.toBeNull();
  });
  it('rejects unknown bin names (path-traversal defense)', () => {
    const bad = { ...VALID_MANIFEST, files: [{ name: '../../etc/passwd', sha256: 'a'.repeat(64), size: 1 }] };
    expect(validateManifest(bad)).toBeNull();
  });
  it('rejects bad sha256 (not 64 hex)', () => {
    const bad = { ...VALID_MANIFEST, files: [{ name: 'bin-uploader.cjs', sha256: 'short', size: 1 }] };
    expect(validateManifest(bad)).toBeNull();
  });
  it('rejects non-finite size', () => {
    const bad = { ...VALID_MANIFEST, files: [{ name: 'bin-uploader.cjs', sha256: 'a'.repeat(64), size: Number.POSITIVE_INFINITY }] };
    expect(validateManifest(bad)).toBeNull();
  });
  it('rejects oversized size (>100MB)', () => {
    const bad = { ...VALID_MANIFEST, files: [{ name: 'bin-uploader.cjs', sha256: 'a'.repeat(64), size: 200 * 1024 * 1024 }] };
    expect(validateManifest(bad)).toBeNull();
  });
  it('rejects missing version', () => {
    expect(validateManifest({ ...VALID_MANIFEST, version: undefined })).toBeNull();
  });
  it('rejects malformed generated_at', () => {
    expect(validateManifest({ ...VALID_MANIFEST, generated_at: 'not a date' })).toBeNull();
  });
  it('rejects non-array files', () => {
    expect(validateManifest({ ...VALID_MANIFEST, files: 'notarray' })).toBeNull();
  });
});

describe('readManifestFromDir', () => {
  it('returns 404 when manifest.json is absent', () => {
    const dir = setupDir();
    try {
      const r = readManifestFromDir(dir);
      expect('status' in r && r.status === 404).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('returns 503 when manifest.json is malformed JSON', () => {
    const dir = setupDir();
    try {
      writeFileSync(join(dir, 'manifest.json'), 'not json', 'utf8');
      const r = readManifestFromDir(dir);
      expect('status' in r && r.status === 503).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('returns 503 when manifest fails schema (e.g. unknown bin)', () => {
    const dir = setupDir();
    try {
      writeFileSync(
        join(dir, 'manifest.json'),
        JSON.stringify({
          version: 'x',
          generated_at: '2026-05-19T12:00:00.000Z',
          files: [{ name: 'evil.cjs', sha256: 'a'.repeat(64), size: 1 }],
        }),
        'utf8',
      );
      const r = readManifestFromDir(dir);
      expect('status' in r && r.status === 503).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('returns the parsed manifest on success', () => {
    const dir = setupDir();
    try {
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify(VALID_MANIFEST), 'utf8');
      const r = readManifestFromDir(dir);
      expect('status' in r).toBe(false);
      if (!('status' in r)) {
        expect(r.version).toBe('0.3.1+abc1234');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
