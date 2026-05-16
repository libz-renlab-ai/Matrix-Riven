import { describe, it, expect } from 'vitest';
import type { ParsedSession, ParsedMessage } from '../../types.js';
import { projectEta } from '../signals/project-eta.js';

function mk(opts: {
  start: string; user?: string; cwd?: string; messages?: ParsedMessage[];
}): ParsedSession {
  const s = new Date(opts.start);
  return {
    envelope: { id: 'e', userId: opts.user ?? 'u@x', machineId: 'm', sessionId: 's' + opts.start, cwd: opts.cwd ?? '/p/X', projectName: 'X', capturedAt: opts.start, rivenVersion: '0', consentedAt: null },
    l1RedactionCount: 0, messages: opts.messages ?? [], durationMs: 60_000,
    startTs: s, endTs: new Date(s.getTime() + 60_000),
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
  };
}
function bashMsg(cmd: string, ts: string): ParsedMessage {
  return { role: 'assistant', ts: new Date(ts), text: '', toolUses: [{ name: 'Bash', input: { command: cmd } }], toolResults: [] };
}

const NOW = new Date('2024-06-15T12:00:00Z');

// Helper: date N days before NOW
function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
}

describe('projectEta', () => {
  it('returns etaDays=null when there are 0 milestones in 14 days', () => {
    const sessions = [mk({ start: daysAgo(1) })];
    const result = projectEta(sessions, NOW);
    expect(result.etaDays).toBeNull();
    expect(result.confidence).toBe('low');
  });

  it('returns etaDays=null when there is exactly 1 milestone in 14 days (below MIN_MILESTONES)', () => {
    const sessions = [mk({ start: daysAgo(1), messages: [bashMsg('git commit -m "one"', daysAgo(1))] })];
    const result = projectEta(sessions, NOW);
    expect(result.etaDays).toBeNull();
    expect(result.confidence).toBe('low');
  });

  it('returns etaDays=14 for 4 milestones spread evenly across 14 days', () => {
    const sessions = [
      mk({ start: daysAgo(2), messages: [bashMsg('git commit -m "a"', daysAgo(2))] }),
      mk({ start: daysAgo(5), messages: [bashMsg('git commit -m "b"', daysAgo(5))] }),
      mk({ start: daysAgo(9), messages: [bashMsg('git commit -m "c"', daysAgo(9))] }),
      mk({ start: daysAgo(12), messages: [bashMsg('git commit -m "d"', daysAgo(12))] }),
    ];
    const result = projectEta(sessions, NOW);
    expect(result.etaDays).toBe(14);
    expect(result.confidence).toBe('low');
  });

  it('ignores milestones older than 14 days', () => {
    // 1 milestone within window + 5 milestones outside → still only 1 → null
    const withinWindow = mk({ start: daysAgo(5), messages: [bashMsg('git commit -m "x"', daysAgo(5))] });
    const outsideWindow = [15, 18, 20, 22, 25].map((d) =>
      mk({ start: daysAgo(d), messages: [bashMsg('git commit -m "old"', daysAgo(d))] })
    );
    const result = projectEta([withinWindow, ...outsideWindow], NOW);
    expect(result.etaDays).toBeNull();
  });

  it('counts git push as a milestone', () => {
    const sessions = [
      mk({ start: daysAgo(1), messages: [bashMsg('git push origin main', daysAgo(1))] }),
      mk({ start: daysAgo(3), messages: [bashMsg('git push', daysAgo(3))] }),
    ];
    const result = projectEta(sessions, NOW);
    expect(result.etaDays).not.toBeNull();
    expect(result.etaDays).toBe(14);
  });

  it('counts gh pr create as a milestone', () => {
    const sessions = [
      mk({ start: daysAgo(2), messages: [bashMsg('gh pr create --title "feat: x"', daysAgo(2))] }),
      mk({ start: daysAgo(4), messages: [bashMsg('gh pr create --title "fix: y"', daysAgo(4))] }),
    ];
    const result = projectEta(sessions, NOW);
    expect(result.etaDays).not.toBeNull();
    expect(result.confidence).toBe('low');
  });

  it('counts milestones from multiple sessions combined', () => {
    // 2 sessions each with 1 git commit → total 2 milestones → should return etaDays = 14
    const sessions = [
      mk({ start: daysAgo(1), messages: [bashMsg('git commit -m "a"', daysAgo(1))] }),
      mk({ start: daysAgo(3), messages: [bashMsg('git commit -m "b"', daysAgo(3))] }),
    ];
    const result = projectEta(sessions, NOW);
    expect(result.etaDays).toBe(14);
  });
});
