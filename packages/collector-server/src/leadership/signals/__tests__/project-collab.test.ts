import { describe, it, expect } from 'vitest';
import type { ParsedSession, ParsedMessage } from '../../types.js';
import { computeContributors, hasBusFactorWarning, computeCollabDensity } from '../project-collab.js';

function mkSession(opts: { user?: string; cwd?: string; messages?: ParsedMessage[]; start?: string }): ParsedSession {
  const s = new Date(opts.start ?? '2026-05-14T01:00:00Z');
  return {
    envelope: { id: 'e', userId: opts.user ?? 'u@x', machineId: 'm', sessionId: 's', cwd: opts.cwd ?? '/p/X', projectName: 'X', capturedAt: s.toISOString(), rivenVersion: '0', consentedAt: null },
    l1RedactionCount: 0, messages: opts.messages ?? [], durationMs: 60_000,
    startTs: s, endTs: new Date(s.getTime() + 60_000),
    tokens: { input: 1000, output: 100, cacheRead: 0, cacheCreation: 0 },
  };
}
function editMsg(file: string): ParsedMessage {
  return { role: 'assistant', ts: new Date('2026-05-14T01:00:00Z'), text: '',
    toolUses: [{ name: 'Edit', input: { file_path: file, old_string: 'a', new_string: 'b' } }], toolResults: [] };
}
function userText(text: string): ParsedMessage {
  return { role: 'user', ts: new Date('2026-05-14T01:00:00Z'), text, toolUses: [], toolResults: [] };
}
function bashCmd(cmd: string): ParsedMessage {
  return { role: 'assistant', ts: new Date('2026-05-14T01:00:00Z'), text: '',
    toolUses: [{ name: 'Bash', input: { command: cmd } }], toolResults: [] };
}
function toolFail(): ParsedMessage {
  return { role: 'tool', ts: new Date('2026-05-14T01:00:00Z'), text: '',
    toolUses: [], toolResults: [{ isError: true, text: 'err' }] };
}

describe('computeContributors', () => {
  it('sorts contributors by sharePct descending', () => {
    // a: 800 tokens, b: 200 tokens => a is 80%, b is 20%
    const sessions = [
      mkSession({ user: 'a@x', start: '2026-05-14T01:00:00Z' }),  // 1100 tokens each (input 1000 + output 100)
      mkSession({ user: 'a@x', start: '2026-05-14T02:00:00Z' }),
      mkSession({ user: 'a@x', start: '2026-05-14T03:00:00Z' }),
      mkSession({ user: 'b@x', start: '2026-05-14T04:00:00Z' }),
    ];
    const contributors = computeContributors(sessions);
    expect(contributors[0]!.email).toBe('a@x');
    expect(contributors[1]!.email).toBe('b@x');
    expect(contributors[0]!.sharePct).toBeGreaterThan(contributors[1]!.sharePct);
  });

  it('returns empty array when no sessions', () => {
    expect(computeContributors([])).toEqual([]);
  });

  it('computes share summing to approximately 1', () => {
    const sessions = [
      mkSession({ user: 'a@x' }),
      mkSession({ user: 'b@x' }),
      mkSession({ user: 'c@x' }),
    ];
    const contributors = computeContributors(sessions);
    const total = contributors.reduce((s, c) => s + c.sharePct, 0);
    expect(total).toBeCloseTo(1, 2);
  });
});

describe('hasBusFactorWarning', () => {
  it('returns true when top contributor owns > 70% of tokens', () => {
    // 3 sessions for a@x, 1 for b@x => a gets 75%
    const sessions = [
      mkSession({ user: 'a@x', start: '2026-05-14T01:00:00Z' }),
      mkSession({ user: 'a@x', start: '2026-05-14T02:00:00Z' }),
      mkSession({ user: 'a@x', start: '2026-05-14T03:00:00Z' }),
      mkSession({ user: 'b@x', start: '2026-05-14T04:00:00Z' }),
    ];
    const contributors = computeContributors(sessions);
    expect(hasBusFactorWarning(contributors)).toBe(true);
  });

  it('returns false when contributors are equal (50/50)', () => {
    const sessions = [
      mkSession({ user: 'a@x', start: '2026-05-14T01:00:00Z' }),
      mkSession({ user: 'b@x', start: '2026-05-14T02:00:00Z' }),
    ];
    const contributors = computeContributors(sessions);
    expect(hasBusFactorWarning(contributors)).toBe(false);
  });

  it('returns false when contributors array is empty', () => {
    expect(hasBusFactorWarning([])).toBe(false);
  });

  it('returns false for a one-person project (post-2026-05-17 calibration)', () => {
    // Solo project — owner has 100% by definition but there is no second
    // contributor to lose, so this is not a bus-factor risk.
    expect(hasBusFactorWarning([{ email: 'solo@x.com', sharePct: 1.0 }])).toBe(false);
  });
});

describe('computeCollabDensity', () => {
  it('returns 0 when no sessions', () => {
    expect(computeCollabDensity([])).toBe(0);
  });

  it('returns 0 when no file edits', () => {
    const sessions = [mkSession({ user: 'a@x', messages: [userText('hello')] })];
    expect(computeCollabDensity(sessions)).toBe(0);
  });

  it('computes density as 0.5 when 2 of 4 files are shared by >=2 users', () => {
    // a edits file1, file2, file3, file4
    // b edits file3, file4 (shared)
    const sessA = mkSession({ user: 'a@x', messages: [
      editMsg('/p/file1.ts'),
      editMsg('/p/file2.ts'),
      editMsg('/p/file3.ts'),
      editMsg('/p/file4.ts'),
    ]});
    const sessB = mkSession({ user: 'b@x', messages: [
      editMsg('/p/file3.ts'),
      editMsg('/p/file4.ts'),
    ]});
    const density = computeCollabDensity([sessA, sessB]);
    expect(density).toBe(0.5);
  });

  it('returns 1.0 when all files are touched by multiple users', () => {
    const sessA = mkSession({ user: 'a@x', messages: [editMsg('/p/app.ts')] });
    const sessB = mkSession({ user: 'b@x', messages: [editMsg('/p/app.ts')] });
    expect(computeCollabDensity([sessA, sessB])).toBe(1);
  });

  it('returns 0 when only one user edits files', () => {
    const sessions = [mkSession({ user: 'a@x', messages: [
      editMsg('/p/file1.ts'),
      editMsg('/p/file2.ts'),
    ]})];
    expect(computeCollabDensity(sessions)).toBe(0);
  });
});
