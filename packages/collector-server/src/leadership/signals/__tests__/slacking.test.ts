import { describe, it, expect } from 'vitest';
import { detectLowActivity } from '../slacking.js';
import type { ParsedSession } from '../../types.js';

function mk(start: string, tokens: number, cwd: string): ParsedSession {
  const s = new Date(start);
  return {
    envelope: { id: 'e', userId: 'u', machineId: 'm', sessionId: start, cwd, projectName: cwd.split('/').pop()!, capturedAt: start, rivenVersion: '0', consentedAt: null },
    l1RedactionCount: 0,
    messages: [],
    durationMs: 60_000,
    startTs: s, endTs: new Date(s.getTime() + 60_000),
    tokens: { input: tokens, output: 0, cacheRead: 0, cacheCreation: 0 },
  };
}

describe('detectLowActivity', () => {
  it('flags when 7d tokens < 0.3 × team median and no work-hour activity', () => {
    const memberSessions = [mk('2026-05-14T22:00:00Z', 100, '/sandbox/playground')];
    const teamMedian = 10000;
    const r = detectLowActivity(memberSessions, teamMedian, { mainProjects: ['Matrix-Riven'] });
    expect(r.isLow).toBe(true);
    expect(r.reasons).toContain('low_tokens');
    expect(r.reasons).toContain('non_main_project_only');
  });

  it('does not flag a low-token member who works in main project', () => {
    const memberSessions = [mk('2026-05-14T10:00:00Z', 100, '/repo/Matrix-Riven')];
    const r = detectLowActivity(memberSessions, 10000, { mainProjects: ['Matrix-Riven'] });
    expect(r.isLow).toBe(false);
  });
});
