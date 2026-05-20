import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildReplacePlans,
  applyReplacements,
  rollbackReplacements,
  cleanupOldBackups,
} from '../replace.js';

function setupStage(): string {
  const dir = mkdtempSync(join(tmpdir(), 'riven-replace-'));
  writeFileSync(join(dir, 'bin-uploader.cjs'), 'OLD A', 'utf8');
  writeFileSync(join(dir, 'bin-uploader.cjs.new'), 'NEW A', 'utf8');
  writeFileSync(join(dir, 'bin-session-start.cjs'), 'OLD B', 'utf8');
  writeFileSync(join(dir, 'bin-session-start.cjs.new'), 'NEW B', 'utf8');
  return dir;
}

describe('applyReplacements + rollback', () => {
  it('atomically swaps live with new, leaving .old behind', () => {
    const dir = setupStage();
    try {
      const plans = buildReplacePlans(dir, [
        join(dir, 'bin-uploader.cjs.new'),
        join(dir, 'bin-session-start.cjs.new'),
      ]);
      const r = applyReplacements(plans);
      expect(r.ok).toBe(true);
      expect(readFileSync(join(dir, 'bin-uploader.cjs'), 'utf8')).toBe('NEW A');
      expect(readFileSync(join(dir, 'bin-session-start.cjs'), 'utf8')).toBe('NEW B');
      expect(existsSync(join(dir, 'bin-uploader.cjs.old'))).toBe(true);
      expect(existsSync(join(dir, 'bin-session-start.cjs.old'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('rollback restores live from .old', () => {
    const dir = setupStage();
    try {
      const plans = buildReplacePlans(dir, [join(dir, 'bin-uploader.cjs.new')]);
      const r = applyReplacements(plans);
      expect(r.ok).toBe(true);
      rollbackReplacements(plans);
      expect(readFileSync(join(dir, 'bin-uploader.cjs'), 'utf8')).toBe('OLD A');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('cleanupOldBackups removes .old files', () => {
    const dir = setupStage();
    try {
      const plans = buildReplacePlans(dir, [join(dir, 'bin-uploader.cjs.new')]);
      applyReplacements(plans);
      cleanupOldBackups(plans);
      expect(existsSync(join(dir, 'bin-uploader.cjs.old'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('handles missing live file (first install case)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'riven-replace-'));
    try {
      writeFileSync(join(dir, 'bin-uploader.cjs.new'), 'NEW', 'utf8');
      const plans = buildReplacePlans(dir, [join(dir, 'bin-uploader.cjs.new')]);
      const r = applyReplacements(plans);
      expect(r.ok).toBe(true);
      expect(readFileSync(join(dir, 'bin-uploader.cjs'), 'utf8')).toBe('NEW');
      expect(existsSync(join(dir, 'bin-uploader.cjs.old'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
