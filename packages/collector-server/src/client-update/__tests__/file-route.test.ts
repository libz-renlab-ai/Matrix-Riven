import { describe, it, expect } from 'vitest';
import { extractBinName } from '../file-route.js';

describe('extractBinName (whitelist + traversal defense)', () => {
  it('returns the bin name for a whitelisted file', () => {
    expect(extractBinName('/v1/client-latest/files/bin-uploader.cjs')).toBe('bin-uploader.cjs');
    expect(extractBinName('/v1/client-latest/files/bin-auto-updater.cjs')).toBe('bin-auto-updater.cjs');
  });
  it('rejects unknown bin names (404 surface)', () => {
    expect(extractBinName('/v1/client-latest/files/evil.cjs')).toBeNull();
    expect(extractBinName('/v1/client-latest/files/bin-uploader.cjs.bak')).toBeNull();
  });
  it('rejects path traversal attempts', () => {
    expect(extractBinName('/v1/client-latest/files/../etc/passwd')).toBeNull();
    expect(extractBinName('/v1/client-latest/files/a/b')).toBeNull();
    expect(extractBinName('/v1/client-latest/files/..')).toBeNull();
  });
  it('rejects URL-encoded traversal', () => {
    expect(extractBinName('/v1/client-latest/files/%2e%2e/etc/passwd')).toBeNull();
  });
  it('rejects paths without prefix', () => {
    expect(extractBinName('/foo')).toBeNull();
    expect(extractBinName('')).toBeNull();
  });
});
