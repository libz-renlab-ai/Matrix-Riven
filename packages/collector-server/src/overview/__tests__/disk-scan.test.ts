import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanForOverview } from '../disk-scan.js';
import type { CcStatusSnapshot } from '@matrix-riven/shared';

let outputDir: string;

beforeEach(() => {
  outputDir = mkdtempSync(join(tmpdir(), 'riven-overview-scan-'));
});

afterEach(() => {
  rmSync(outputDir, { recursive: true, force: true });
});

function writeCcStatusJsonl(user: string, date: string, sid: string, lines: Array<Partial<CcStatusSnapshot>>): void {
  const dir = join(outputDir, user, date);
  mkdirSync(dir, { recursive: true });
  const content = lines
    .map((l) => JSON.stringify({
      schema_version: 1, session_id: sid, user_id: user,
      ts: '2026-05-15T10:00:00.000Z', event: 'user_prompt_submit',
      ...l,
    }))
    .join('\n') + '\n';
  writeFileSync(join(dir, `${sid}.cc-status.jsonl`), content);
}

function writeRedactionMeta(user: string, date: string, sid: string, l1: number, l2: number = 0): void {
  const dir = join(outputDir, user, date);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${sid}.meta.json`),
    JSON.stringify({ l1_redaction_count: l1, l2_redaction_count: l2 }),
  );
}

describe('scanForOverview', () => {
  it('empty outputDir → empty raw structure', () => {
    const raw = scanForOverview(outputDir, '2026-05-15');
    expect(raw.allSnapshots).toEqual([]);
    expect(raw.latestPerSession.size).toBe(0);
    expect(raw.redactionsPerSession.size).toBe(0);
  });

  it('one user, one session, three snapshots: latest = max(ts)', () => {
    writeCcStatusJsonl('alice@x', '2026-05-15', 's1', [
      { ts: '2026-05-15T10:00:00.000Z', cost_usd: 1 },
      { ts: '2026-05-15T11:00:00.000Z', cost_usd: 2 },
      { ts: '2026-05-15T10:30:00.000Z', cost_usd: 1.5 },
    ]);
    const raw = scanForOverview(outputDir, '2026-05-15');
    expect(raw.allSnapshots).toHaveLength(3);
    expect(raw.latestPerSession.get('s1')?.cost_usd).toBe(2);
  });

  it('skips malformed JSON lines without dropping the rest of the file', () => {
    const dir = join(outputDir, 'alice@x', '2026-05-15');
    mkdirSync(dir, { recursive: true });
    const good = JSON.stringify({
      schema_version: 1, session_id: 's1', user_id: 'alice@x',
      ts: '2026-05-15T10:00:00.000Z', event: 'user_prompt_submit',
    });
    writeFileSync(join(dir, 's1.cc-status.jsonl'), `${good}\n{not valid json\n${good}\n`);
    const raw = scanForOverview(outputDir, '2026-05-15');
    expect(raw.allSnapshots).toHaveLength(2);
    expect(raw.latestPerSession.has('s1')).toBe(true);
  });

  it('reads l1_redaction_count from .meta.json sidecar; missing sidecar → not in map', () => {
    writeCcStatusJsonl('alice@x', '2026-05-15', 's1', [{ ts: '2026-05-15T10:00:00.000Z' }]);
    writeCcStatusJsonl('alice@x', '2026-05-15', 's2', [{ ts: '2026-05-15T10:00:00.000Z' }]);
    writeRedactionMeta('alice@x', '2026-05-15', 's1', 4, 1);  // l1=4, l2=1 — only l1 counted
    const raw = scanForOverview(outputDir, '2026-05-15');
    expect(raw.redactionsPerSession.get('s1')).toBe(4);
    expect(raw.redactionsPerSession.has('s2')).toBe(false);
  });

  it('ignores files for other dates', () => {
    writeCcStatusJsonl('alice@x', '2026-05-15', 's1', [{ ts: '2026-05-15T10:00:00.000Z' }]);
    writeCcStatusJsonl('alice@x', '2026-05-14', 's2', [{ ts: '2026-05-14T10:00:00.000Z' }]);
    const raw = scanForOverview(outputDir, '2026-05-15');
    expect(raw.latestPerSession.has('s1')).toBe(true);
    expect(raw.latestPerSession.has('s2')).toBe(false);
  });

  it('multiple users + multiple sessions aggregate correctly', () => {
    writeCcStatusJsonl('a@x', '2026-05-15', 's1', [{ ts: '2026-05-15T10:00:00.000Z' }]);
    writeCcStatusJsonl('a@x', '2026-05-15', 's2', [{ ts: '2026-05-15T10:00:00.000Z' }]);
    writeCcStatusJsonl('b@x', '2026-05-15', 's3', [{ ts: '2026-05-15T10:00:00.000Z' }]);
    const raw = scanForOverview(outputDir, '2026-05-15');
    expect(raw.latestPerSession.size).toBe(3);
  });
});
