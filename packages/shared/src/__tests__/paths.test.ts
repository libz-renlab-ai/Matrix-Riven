import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  digitalTwinPaths,
  DEFAULT_PATHS,
  resolveDataRootDir,
  _resetLegacyPathWarning,
} from '../paths.js';

describe('paths', () => {
  describe('digitalTwinPaths()', () => {
    it('uses os.homedir() by default', () => {
      const p = digitalTwinPaths();
      // The default resolves against the real home; either canonical or
      // legacy directory can be reported depending on what exists on this
      // machine. Both are acceptable.
      expect([
        join(homedir(), '.riven'),
        join(homedir(), '.teamagent'),
      ]).toContain(p.dataRootDir);
    });

    it('respects custom base dir (no legacy dir on disk → use .riven)', () => {
      // mkdtemp gives us a guaranteed-empty home, so the legacy fallback path
      // is not exercised here.
      const home = mkdtempSync(join(tmpdir(), 'riven-paths-'));
      try {
        const p = digitalTwinPaths(home);
        expect(p.dataRootDir).toBe(join(home, '.riven'));
        expect(p.digitalTwinDir).toBe(join(home, '.riven', 'digital-twin'));
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    });

    it('configFile is sibling of digitalTwinDir (NOT nested under it)', () => {
      const home = mkdtempSync(join(tmpdir(), 'riven-paths-'));
      try {
        const p = digitalTwinPaths(home);
        expect(p.configFile).toBe(join(home, '.riven', 'digital-twin.json'));
        expect(p.digitalTwinDir).toBe(join(home, '.riven', 'digital-twin'));
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    });

    it('machineIdFile is inside digitalTwinDir', () => {
      const home = mkdtempSync(join(tmpdir(), 'riven-paths-'));
      try {
        const p = digitalTwinPaths(home);
        expect(p.machineIdFile).toBe(join(p.digitalTwinDir, 'machine-id'));
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    });

    it('queue subpaths nest under queue/', () => {
      const home = mkdtempSync(join(tmpdir(), 'riven-paths-'));
      try {
        const p = digitalTwinPaths(home);
        expect(p.queueDir).toBe(join(p.digitalTwinDir, 'queue'));
        expect(p.pendingDir).toBe(join(p.queueDir, 'pending'));
        expect(p.deadLetterDir).toBe(join(p.queueDir, 'dead-letter'));
        expect(p.recordingTempDir).toBe(join(p.queueDir, 'recording_temp'));
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    });

    it('daemonPidFile is at digitalTwinDir/daemon.pid', () => {
      const home = mkdtempSync(join(tmpdir(), 'riven-paths-'));
      try {
        const p = digitalTwinPaths(home);
        expect(p.daemonPidFile).toBe(join(p.digitalTwinDir, 'daemon.pid'));
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    });

    it('lastHourlyScanFile is at digitalTwinDir/last-hourly-scan.txt', () => {
      const home = mkdtempSync(join(tmpdir(), 'riven-paths-'));
      try {
        const p = digitalTwinPaths(home);
        expect(p.lastHourlyScanFile).toBe(
          join(p.digitalTwinDir, 'last-hourly-scan.txt'),
        );
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    });

    it('quotaCacheFile is at digitalTwinDir/quota-cache.json', () => {
      const home = mkdtempSync(join(tmpdir(), 'riven-paths-'));
      try {
        const p = digitalTwinPaths(home);
        expect(p.quotaCacheFile).toBe(join(p.digitalTwinDir, 'quota-cache.json'));
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    });

    it('uploaderLogFile is at digitalTwinDir/uploader.log', () => {
      const home = mkdtempSync(join(tmpdir(), 'riven-paths-'));
      try {
        const p = digitalTwinPaths(home);
        expect(p.uploaderLogFile).toBe(join(p.digitalTwinDir, 'uploader.log'));
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    });
  });

  describe('resolveDataRootDir() — TeamBrain legacy fallback', () => {
    beforeEach(() => {
      _resetLegacyPathWarning();
    });

    it('returns .riven when neither dir exists (fresh install)', () => {
      const r = resolveDataRootDir('/no/such/home', () => false);
      expect(r).toBe(join('/no/such/home', '.riven'));
    });

    it('returns .riven when both exist (canonical wins)', () => {
      const r = resolveDataRootDir('/home/user', () => true);
      expect(r).toBe(join('/home/user', '.riven'));
    });

    it('returns legacy .teamagent when only the legacy dir exists', () => {
      let warned = '';
      const origWrite = process.stderr.write.bind(process.stderr);
      // Capture the one-shot deprecation warning so the assertion isn't
      // tested at "is the global stderr stream touched" granularity.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process.stderr as any).write = (chunk: string) => {
        warned += chunk;
        return true;
      };
      try {
        const r = resolveDataRootDir('/home/user', (p) =>
          p.endsWith('.teamagent'),
        );
        expect(r).toBe(join('/home/user', '.teamagent'));
        expect(warned).toMatch(/DEPRECATED.*\.teamagent/);
      } finally {
        process.stderr.write = origWrite;
      }
    });

    it('falls back via real fs when a legacy ~/.teamagent dir exists and ~/.riven does not', () => {
      const home = mkdtempSync(join(tmpdir(), 'riven-legacy-'));
      try {
        mkdirSync(join(home, '.teamagent'), { recursive: true });
        // Use a no-op stderr to avoid the deprecation noise during this test.
        const origWrite = process.stderr.write.bind(process.stderr);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (process.stderr as any).write = () => true;
        try {
          const p = digitalTwinPaths(home);
          expect(p.dataRootDir).toBe(join(home, '.teamagent'));
          expect(p.configFile).toBe(join(home, '.teamagent', 'digital-twin.json'));
        } finally {
          process.stderr.write = origWrite;
        }
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    });
  });

  describe('DEFAULT_PATHS', () => {
    it('matches digitalTwinPaths() with no args', () => {
      // Note: DEFAULT_PATHS is captured at module-load time; on machines
      // where the legacy dir exists, both this comparison and the live call
      // will report the same legacy path.
      expect(DEFAULT_PATHS).toEqual(digitalTwinPaths());
    });
  });
});
