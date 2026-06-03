import { describe, it, expect } from 'vitest';
import { buildTimeAxis } from '../index.js';
import type { ParsedSession } from '../../types.js';

function mkSession(startTs: Date): ParsedSession {
  return {
    envelope: {
      id: 'i', userId: 'u@x', machineId: 'm', sessionId: 's', cwd: '',
      projectName: 'p', capturedAt: startTs.toISOString(), rivenVersion: '0', consentedAt: null,
    },
    l1RedactionCount: 0,
    messages: [],
    durationMs: 0,
    startTs,
    endTs: startTs,
    tokens: { input: 100, output: 50, cacheRead: 0, cacheCreation: 0 },
  };
}

describe('buildTimeAxis (server-local week boundary)', () => {
  it('returns 12 weeks in ascending week order', () => {
    const weeks = buildTimeAxis([], new Date('2026-06-10T12:00:00Z'));
    expect(weeks).toHaveLength(12);
    for (let i = 1; i < weeks.length; i++) {
      expect(weeks[i]!.weekStart > weeks[i - 1]!.weekStart).toBe(true);
    }
  });

  it('buckets a Monday-early-morning session into the LOCAL week, not the UTC one', () => {
    const now = new Date('2026-06-10T12:00:00Z');
    // Recompute the latest local Monday 00:00 exactly as a local-tz impl must.
    const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const daysSinceMon = (todayLocal.getDay() + 6) % 7;
    const thisMon = new Date(todayLocal.getTime() - daysSinceMon * 86400000);
    // A session at LOCAL Monday 02:00 of the latest week. On a UTC+8 host this
    // instant is the prior Sunday 18:00 UTC, so a UTC-week impl files it in the
    // previous week; a local-week impl keeps it in the latest week.
    const sess = mkSession(new Date(thisMon.getTime() + 2 * 3600000));
    const weeks = buildTimeAxis([sess], now);

    expect(weeks[11]!.sessions).toBe(1); // latest (local) week contains it
    expect(weeks.slice(0, 11).reduce((a, w) => a + w.sessions, 0)).toBe(0);

    // weekStart label is the session's LOCAL calendar Monday, not the UTC date.
    const localLabel = `${thisMon.getFullYear()}-${String(thisMon.getMonth() + 1).padStart(2, '0')}-${String(thisMon.getDate()).padStart(2, '0')}`;
    expect(weeks[11]!.weekStart).toBe(localLabel);
  });
});
