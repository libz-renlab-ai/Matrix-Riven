import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildClientUpdateStatus } from '../status-aggregate.js';

function setupRoot(): string {
  return mkdtempSync(join(tmpdir(), 'riven-status-'));
}

function writeCcStatus(
  outputDir: string,
  user: string,
  date: string,
  session: string,
  client_version: string,
  ts = '2026-05-19T12:00:00.000Z',
): void {
  const dir = join(outputDir, user, date);
  mkdirSync(dir, { recursive: true });
  const snap = {
    schema_version: 1,
    session_id: session,
    user_id: user,
    ts,
    event: 'Status',
    client_version,
  };
  writeFileSync(join(dir, `${session}.cc-status.jsonl`), JSON.stringify(snap) + '\n', 'utf8');
}

describe('buildClientUpdateStatus', () => {
  it('returns null manifest when none published', () => {
    const root = setupRoot();
    try {
      const s = buildClientUpdateStatus({
        clientLatestDir: join(root, 'client-latest'),
        errorsJsonlPath: join(root, 'errors.jsonl'),
        outputDir: join(root, 'output'),
        now: new Date('2026-05-19T13:00:00.000Z'),
      });
      expect(s.manifest).toBeNull();
      expect(s.distribution).toEqual([]);
      expect(s.errors.total_24h).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns manifest when published', () => {
    const root = setupRoot();
    try {
      const clientLatest = join(root, 'client-latest');
      mkdirSync(clientLatest, { recursive: true });
      writeFileSync(
        join(clientLatest, 'manifest.json'),
        JSON.stringify({
          version: '0.3.1+abc',
          generated_at: '2026-05-19T10:00:00.000Z',
          files: [{ name: 'bin-uploader.cjs', sha256: 'a'.repeat(64), size: 1024 }],
        }),
        'utf8',
      );
      const s = buildClientUpdateStatus({
        clientLatestDir: clientLatest,
        errorsJsonlPath: join(root, 'errors.jsonl'),
        outputDir: join(root, 'output'),
        now: new Date('2026-05-19T13:00:00.000Z'),
      });
      expect(s.manifest?.version).toBe('0.3.1+abc');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('aggregates client_version distribution from cc-status', () => {
    const root = setupRoot();
    const outputDir = join(root, 'output');
    try {
      writeCcStatus(outputDir, 'alice', '2026-05-19', 'sess1', '0.3.1+abc');
      writeCcStatus(outputDir, 'bob', '2026-05-19', 'sess2', '0.3.1+abc');
      writeCcStatus(outputDir, 'carol', '2026-05-19', 'sess3', '0.3.0+old');
      writeCcStatus(outputDir, 'dave', '2026-05-19', 'sess4', 'unknown');
      const s = buildClientUpdateStatus({
        clientLatestDir: join(root, 'client-latest'),
        errorsJsonlPath: join(root, 'errors.jsonl'),
        outputDir,
        now: new Date('2026-05-19T13:00:00.000Z'),
      });
      expect(s.distribution.length).toBe(3);
      const bucket = s.distribution.find((d) => d.client_version === '0.3.1+abc');
      expect(bucket?.user_count).toBe(2);
      expect(bucket?.users.sort()).toEqual(['alice', 'bob']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('counts errors within 24h window and groups by stage', () => {
    const root = setupRoot();
    try {
      const errFile = join(root, 'errors.jsonl');
      const now = new Date('2026-05-19T13:00:00.000Z').getTime();
      const lines = [
        // 1h ago — in window
        {
          machine_id: 'm1',
          user_id: 'alice',
          from_version: 'a',
          to_version: 'b',
          stage: 'download',
          error_message: 'e',
          ts: new Date(now - 1 * 3600 * 1000).toISOString(),
        },
        // 25h ago — out of window
        {
          machine_id: 'm2',
          user_id: 'bob',
          from_version: 'a',
          to_version: 'b',
          stage: 'sha256',
          error_message: 'e',
          ts: new Date(now - 25 * 3600 * 1000).toISOString(),
        },
        // 2h ago — in window, same stage as first
        {
          machine_id: 'm3',
          user_id: 'carol',
          from_version: 'a',
          to_version: 'b',
          stage: 'download',
          error_message: 'e',
          ts: new Date(now - 2 * 3600 * 1000).toISOString(),
        },
      ];
      for (const l of lines) appendFileSync(errFile, JSON.stringify(l) + '\n', 'utf8');
      const s = buildClientUpdateStatus({
        clientLatestDir: join(root, 'client-latest'),
        errorsJsonlPath: errFile,
        outputDir: join(root, 'output'),
        now: new Date('2026-05-19T13:00:00.000Z'),
      });
      expect(s.errors.total_24h).toBe(2);
      expect(s.errors.by_stage_24h.download).toBe(2);
      expect(s.errors.by_stage_24h.sha256).toBeUndefined();
      expect(s.errors.recent.length).toBe(3); // recent includes all; window only filters total/by_stage
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips malformed lines in errors JSONL silently', () => {
    const root = setupRoot();
    try {
      const errFile = join(root, 'errors.jsonl');
      const valid = {
        machine_id: 'm1',
        user_id: 'alice',
        from_version: null,
        to_version: null,
        stage: 'download',
        error_message: 'e',
        ts: '2026-05-19T12:00:00.000Z',
      };
      writeFileSync(errFile, [JSON.stringify(valid), 'not json {garbage', JSON.stringify(valid)].join('\n') + '\n', 'utf8');
      const s = buildClientUpdateStatus({
        clientLatestDir: join(root, 'client-latest'),
        errorsJsonlPath: errFile,
        outputDir: join(root, 'output'),
        now: new Date('2026-05-19T13:00:00.000Z'),
      });
      expect(s.errors.recent.length).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
