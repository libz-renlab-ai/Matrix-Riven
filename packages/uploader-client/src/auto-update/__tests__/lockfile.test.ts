import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireLock } from '../lockfile.js';

describe('acquireLock', () => {
  it('returns ok=true on a clean path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'riven-lock-'));
    try {
      const p = join(dir, 'lock');
      const r = acquireLock(p);
      expect(r.ok).toBe(true);
      r.holder?.release();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses when a fresh holder owns it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'riven-lock-'));
    try {
      const p = join(dir, 'lock');
      writeFileSync(p, `PID=${process.pid}\nTS=${new Date().toISOString()}\n`, 'utf8');
      const r = acquireLock(p);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('held-fresh');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('strong-arms over a stale (>1h old) lock', () => {
    const dir = mkdtempSync(join(tmpdir(), 'riven-lock-'));
    try {
      const p = join(dir, 'lock');
      const oldTs = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
      writeFileSync(p, `PID=${process.pid}\nTS=${oldTs}\n`, 'utf8');
      const r = acquireLock(p);
      expect(r.ok).toBe(true);
      r.holder?.release();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('strong-arms when the recorded PID is dead', () => {
    const dir = mkdtempSync(join(tmpdir(), 'riven-lock-'));
    try {
      const p = join(dir, 'lock');
      // PID 1 is init/launchd — alive. Use a definitely-dead PID instead.
      writeFileSync(p, `PID=99999999\nTS=${new Date().toISOString()}\n`, 'utf8');
      const r = acquireLock(p);
      expect(r.ok).toBe(true);
      r.holder?.release();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('release() unlinks the lock file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'riven-lock-'));
    try {
      const p = join(dir, 'lock');
      const r = acquireLock(p);
      expect(r.ok).toBe(true);
      expect(existsSync(p)).toBe(true);
      r.holder?.release();
      expect(existsSync(p)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
