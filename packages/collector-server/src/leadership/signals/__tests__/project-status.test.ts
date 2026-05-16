import { describe, it, expect } from 'vitest';
import type { ParsedSession, ParsedMessage } from '../../types.js';
import { classifyProject, getRecentFiles } from '../signals/project-status.js';

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
function editMsg(file: string, ts: string): ParsedMessage {
  return { role: 'assistant', ts: new Date(ts), text: '', toolUses: [{ name: 'Edit', input: { file_path: file, old_string: 'a', new_string: 'b' } }], toolResults: [] };
}

const NOW = new Date('2024-06-15T12:00:00Z');

// Helper: date N days before NOW
function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
}

describe('classifyProject', () => {
  it('returns active when 5 or more sessions are within the last 7 days', () => {
    const sessions = [0, 1, 2, 3, 4].map((i) => mk({ start: daysAgo(i) }));
    expect(classifyProject(sessions, NOW)).toBe('active');
  });

  it('returns maintaining when 1 to 4 sessions are within the last 7 days', () => {
    const sessions = [mk({ start: daysAgo(1) }), mk({ start: daysAgo(3) })];
    expect(classifyProject(sessions, NOW)).toBe('maintaining');
  });

  it('returns maintaining for exactly 1 recent session', () => {
    const sessions = [mk({ start: daysAgo(2) })];
    expect(classifyProject(sessions, NOW)).toBe('maintaining');
  });

  it('returns dormant when no sessions are within the last 7 days', () => {
    const sessions = [mk({ start: daysAgo(10) }), mk({ start: daysAgo(20) })];
    expect(classifyProject(sessions, NOW)).toBe('dormant');
  });

  it('returns dormant when sessions array is empty', () => {
    expect(classifyProject([], NOW)).toBe('dormant');
  });

  it('returns revived when project was dormant 8-14 days ago but has 5+ sessions in last 7 days', () => {
    // 5 recent sessions + old sessions that were 8-14 days ago (not in prior window)
    const recentSessions = [0, 1, 2, 3, 4].map((i) => mk({ start: daysAgo(i) }));
    // Old sessions: beyond 14 days, so prior window (7-14 days) is empty → revived
    const oldSessions = [mk({ start: daysAgo(20) }), mk({ start: daysAgo(25) })];
    const sessions = [...recentSessions, ...oldSessions];
    expect(classifyProject(sessions, NOW)).toBe('revived');
  });

  it('returns active (not revived) when there were sessions in the 7-14 day window', () => {
    const recentSessions = [0, 1, 2, 3, 4].map((i) => mk({ start: daysAgo(i) }));
    // Session in the prior 7-day window (8-14 days ago)
    const priorSessions = [mk({ start: daysAgo(10) })];
    const sessions = [...recentSessions, ...priorSessions];
    expect(classifyProject(sessions, NOW)).toBe('active');
  });

  it('returns active (not revived) when there are no older sessions at all', () => {
    // 5 recent sessions, no older sessions — not revived (nothing to revive from)
    const sessions = [0, 1, 2, 3, 4].map((i) => mk({ start: daysAgo(i) }));
    expect(classifyProject(sessions, NOW)).toBe('active');
  });
});

describe('getRecentFiles', () => {
  it('returns distinct files touched via Edit across sessions', () => {
    const sessions = [
      mk({ start: daysAgo(1), messages: [editMsg('/src/a.ts', daysAgo(1)), editMsg('/src/b.ts', daysAgo(1))] }),
      mk({ start: daysAgo(2), messages: [editMsg('/src/a.ts', daysAgo(2)), editMsg('/src/c.ts', daysAgo(2))] }),
    ];
    const files = getRecentFiles(sessions);
    expect(files).toEqual(['/src/a.ts', '/src/b.ts', '/src/c.ts']);
  });

  it('returns empty array when no file-touching tool uses exist', () => {
    const sessions = [mk({ start: daysAgo(1) })];
    expect(getRecentFiles(sessions)).toEqual([]);
  });

  it('deduplicates files that appear in multiple sessions', () => {
    const sessions = [
      mk({ start: daysAgo(1), messages: [editMsg('/src/x.ts', daysAgo(1))] }),
      mk({ start: daysAgo(2), messages: [editMsg('/src/x.ts', daysAgo(2))] }),
    ];
    const files = getRecentFiles(sessions);
    expect(files).toEqual(['/src/x.ts']);
  });

  it('collects files from Write and Read tool uses as well', () => {
    const sessions = [
      mk({
        start: daysAgo(1),
        messages: [
          {
            role: 'assistant',
            ts: new Date(daysAgo(1)),
            text: '',
            toolUses: [
              { name: 'Write', input: { file_path: '/out/generated.ts' } },
              { name: 'Read', input: { file_path: '/src/config.ts' } },
            ],
            toolResults: [],
          },
        ],
      }),
    ];
    const files = getRecentFiles(sessions);
    expect(files).toContain('/out/generated.ts');
    expect(files).toContain('/src/config.ts');
  });
});
