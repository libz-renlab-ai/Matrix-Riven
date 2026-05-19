import { describe, it, expect } from 'vitest';
import { computeActivity, computeFocus, computeRhythmDelta } from '../activity.js';
import type { ParsedSession } from '../../types.js';

function mkSession(opts: { start: string; end: string; tokens?: number; cwd?: string }): ParsedSession {
  const startTs = new Date(opts.start);
  const endTs = new Date(opts.end);
  return {
    envelope: {
      id: 'e', userId: 'u', machineId: 'm', sessionId: 's' + opts.start,
      cwd: opts.cwd ?? '/x/Matrix-Riven',
      projectName: 'Matrix-Riven',
      capturedAt: opts.start,
      rivenVersion: '0.1', consentedAt: null,
    },
    l1RedactionCount: 0,
    messages: [],
    durationMs: endTs.getTime() - startTs.getTime(),
    startTs, endTs,
    tokens: { input: opts.tokens ?? 1000, output: 0, cacheRead: 0, cacheCreation: 0 },
  };
}

describe('computeActivity', () => {
  it('sums sessions/tokens and estimates minutes', () => {
    const sessions = [
      mkSession({ start: '2026-05-14T01:00:00Z', end: '2026-05-14T01:30:00Z', tokens: 2000 }),
      mkSession({ start: '2026-05-14T03:00:00Z', end: '2026-05-14T03:10:00Z', tokens: 500 }),
    ];
    const a = computeActivity(sessions);
    expect(a.sessions).toBe(2);
    expect(a.tokens).toBe(2500);
    expect(a.estMinutes).toBe(40);
  });

  it('truncates intra-session idle gaps at 30 min', () => {
    const s = mkSession({ start: '2026-05-14T00:00:00Z', end: '2026-05-14T03:00:00Z' });
    const a = computeActivity([s]);
    expect(a.estMinutes).toBeLessThanOrEqual(30);
  });
});

describe('computeFocus', () => {
  it('counts distinct cwds per day', () => {
    const sessions = [
      mkSession({ start: '2026-05-14T01:00:00Z', end: '2026-05-14T01:30:00Z', cwd: '/p/A' }),
      mkSession({ start: '2026-05-14T02:00:00Z', end: '2026-05-14T02:30:00Z', cwd: '/p/B' }),
      mkSession({ start: '2026-05-14T03:00:00Z', end: '2026-05-14T03:30:00Z', cwd: '/p/A' }),
    ];
    const f = computeFocus(sessions);
    expect(f.distinctCwdsToday).toBe(2);
    expect(f.avgSessionMinutes).toBe(30);
  });
});

describe('computeRhythmDelta', () => {
  it('returns positive delta when today exceeds 7d avg', () => {
    const today = [mkSession({ start: '2026-05-14T01:00:00Z', end: '2026-05-14T01:30:00Z', tokens: 10000 })];
    const past7 = [mkSession({ start: '2026-05-10T01:00:00Z', end: '2026-05-10T01:30:00Z', tokens: 1000 })];
    const d = computeRhythmDelta(today, past7);
    expect(d).toBeGreaterThan(0);
  });

  it('returns 0 when past7 has no data', () => {
    const today = [mkSession({ start: '2026-05-14T01:00:00Z', end: '2026-05-14T01:30:00Z', tokens: 5000 })];
    expect(computeRhythmDelta(today, [])).toBe(0);
  });
});
