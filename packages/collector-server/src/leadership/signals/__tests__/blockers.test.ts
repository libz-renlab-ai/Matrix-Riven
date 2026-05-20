import { describe, it, expect } from 'vitest';
import { detectDifficulty, detectBlocker } from '../blockers.js';
import type { ParsedSession, ParsedMessage, ParsedToolUse, ParsedToolResult } from '../../types.js';

function mkSession(opts: {
  start: string;
  cwd?: string;
  messages?: ParsedMessage[];
  contextOverflowMarkers?: number;
}): ParsedSession {
  const startTs = new Date(opts.start);
  const messages = opts.messages ?? [];
  // synthesize OVER_200K markers as user-message text matches
  for (let i = 0; i < (opts.contextOverflowMarkers ?? 0); i++) {
    messages.push({ role: 'user', ts: startTs, text: 'context was OVER_200K reset', toolUses: [], toolResults: [] });
  }
  return {
    envelope: {
      id: 'e', userId: 'u', machineId: 'm', sessionId: 's' + opts.start,
      cwd: opts.cwd ?? '/r/Matrix-Riven',
      projectName: 'Matrix-Riven',
      capturedAt: opts.start, rivenVersion: '0', consentedAt: null,
    },
    l1RedactionCount: 0,
    messages,
    durationMs: 60_000,
    startTs, endTs: new Date(startTs.getTime() + 60_000),
    tokens: { input: 1000, output: 100, cacheRead: 0, cacheCreation: 0 },
  };
}

function fileEditMsg(filePath: string, isError = false): ParsedMessage {
  return {
    role: 'assistant', ts: new Date('2026-05-14T01:00:00Z'),
    text: '',
    toolUses: [{ name: 'Edit', input: { file_path: filePath, old_string: 'x', new_string: 'y' } }],
    toolResults: [],
  };
}
function toolResultMsg(isError: boolean): ParsedMessage {
  return {
    role: 'tool', ts: new Date('2026-05-14T01:00:00Z'),
    text: '',
    toolUses: [],
    toolResults: [{ isError, text: isError ? 'ERROR' : 'ok' }],
  };
}

describe('detectDifficulty', () => {
  it('flags when same file is edited >= 5 times in one session', () => {
    const messages = Array.from({ length: 6 }, () => fileEditMsg('/x/foo.ts'));
    const s = mkSession({ start: '2026-05-14T01:00:00Z', messages });
    const r = detectDifficulty(s);
    expect(r.isDifficult).toBe(true);
    expect(r.hotFiles).toContain('/x/foo.ts');
  });

  it('returns toolFailureRate from session', () => {
    const s = mkSession({
      start: '2026-05-14T01:00:00Z',
      messages: [toolResultMsg(false), toolResultMsg(true), toolResultMsg(true), toolResultMsg(false)],
    });
    const r = detectDifficulty(s);
    expect(r.toolFailureRate).toBeCloseTo(0.5);
  });

  it('does not flag a clean session', () => {
    const s = mkSession({ start: '2026-05-14T01:00:00Z', messages: [fileEditMsg('/x/a.ts')] });
    const r = detectDifficulty(s);
    expect(r.isDifficult).toBe(false);
    expect(r.hotFiles).toHaveLength(0);
  });
});

describe('detectBlocker', () => {
  it('flags when >=3 sessions on same cwd within 24h and zero git commit', () => {
    const sessions = [
      mkSession({ start: '2026-05-14T01:00:00Z', cwd: '/r/X' }),
      mkSession({ start: '2026-05-14T05:00:00Z', cwd: '/r/X' }),
      mkSession({ start: '2026-05-14T09:00:00Z', cwd: '/r/X' }),
    ];
    const r = detectBlocker(sessions, '/r/X', new Date('2026-05-14T12:00:00Z'));
    expect(r.isBlocked).toBe(true);
    expect(r.reasons).toContain('repeat_sessions_no_commit');
  });

  it('does NOT flag when a git commit happened (bash command detected)', () => {
    const commitMsg: ParsedMessage = {
      role: 'assistant', ts: new Date('2026-05-14T02:00:00Z'),
      text: '',
      toolUses: [{ name: 'Bash', input: { command: 'git commit -m "fix"' } }],
      toolResults: [],
    };
    const sessions = [
      mkSession({ start: '2026-05-14T01:00:00Z', cwd: '/r/X', messages: [commitMsg] }),
      mkSession({ start: '2026-05-14T05:00:00Z', cwd: '/r/X' }),
      mkSession({ start: '2026-05-14T09:00:00Z', cwd: '/r/X' }),
    ];
    const r = detectBlocker(sessions, '/r/X', new Date('2026-05-14T12:00:00Z'));
    expect(r.isBlocked).toBe(false);
  });

  it('flags when context overflow markers >= 2', () => {
    const sessions = [mkSession({ start: '2026-05-14T01:00:00Z', cwd: '/r/Y', contextOverflowMarkers: 2 })];
    const r = detectBlocker(sessions, '/r/Y', new Date('2026-05-14T02:00:00Z'));
    expect(r.isBlocked).toBe(true);
    expect(r.reasons).toContain('context_overflow');
  });
});
