import { describe, it, expect } from 'vitest';
import {
  computeToolFailureRate,
  countContextOverflow,
  computeIterationDensity,
  promptLengthSeries,
} from '../quality.js';
import type { ParsedSession, ParsedMessage } from '../../types.js';

function mkSession(opts: {
  user?: string;
  start?: string;
  cwd?: string;
  messages?: ParsedMessage[];
  l1?: number;
  model?: string;
  tokens?: { input: number; output: number };
}): ParsedSession {
  const start = new Date(opts.start ?? '2026-05-14T01:00:00Z');
  return {
    envelope: {
      id: 'e',
      userId: opts.user ?? 'u@x',
      machineId: 'm',
      sessionId: 's',
      cwd: opts.cwd ?? '/r/Matrix-Riven',
      projectName: 'Matrix-Riven',
      capturedAt: start.toISOString(),
      rivenVersion: '0',
      consentedAt: null,
    },
    l1RedactionCount: opts.l1 ?? 0,
    messages: opts.messages ?? [],
    durationMs: 60_000,
    startTs: start,
    endTs: new Date(start.getTime() + 60_000),
    model: opts.model,
    tokens: {
      input: opts.tokens?.input ?? 0,
      output: opts.tokens?.output ?? 0,
      cacheRead: 0,
      cacheCreation: 0,
    },
  };
}

function mkMsg(
  role: 'user' | 'assistant' | 'tool',
  text: string,
  opts: {
    toolResults?: { isError: boolean }[];
    ts?: Date;
  } = {},
): ParsedMessage {
  return {
    role,
    text,
    toolUses: [],
    toolResults: (opts.toolResults ?? []).map((tr) => ({
      isError: tr.isError,
      text: '',
    })),
    ts: opts.ts,
  };
}

// ─── computeToolFailureRate ────────────────────────────────────────────────

describe('computeToolFailureRate', () => {
  it('returns 0 when there are no tool results', () => {
    const sessions = [mkSession({})];
    expect(computeToolFailureRate(sessions)).toBe(0);
  });

  it('returns 0.5 when 2 errors out of 4 tool results', () => {
    const messages = [
      mkMsg('tool', '', {
        toolResults: [{ isError: true }, { isError: false }, { isError: true }, { isError: false }],
      }),
    ];
    const sessions = [mkSession({ messages })];
    expect(computeToolFailureRate(sessions)).toBe(0.5);
  });

  it('returns 1.0 when all tool results are errors', () => {
    const messages = [
      mkMsg('tool', '', { toolResults: [{ isError: true }, { isError: true }] }),
    ];
    const sessions = [mkSession({ messages })];
    expect(computeToolFailureRate(sessions)).toBe(1.0);
  });

  it('accumulates across multiple sessions', () => {
    const s1 = mkSession({
      messages: [mkMsg('tool', '', { toolResults: [{ isError: true }] })],
    });
    const s2 = mkSession({
      messages: [mkMsg('tool', '', { toolResults: [{ isError: false }] })],
    });
    expect(computeToolFailureRate([s1, s2])).toBe(0.5);
  });
});

// ─── countContextOverflow ─────────────────────────────────────────────────

describe('countContextOverflow', () => {
  it('returns 0 when no messages contain OVER_200K', () => {
    const sessions = [mkSession({ messages: [mkMsg('user', 'hello world')] })];
    expect(countContextOverflow(sessions)).toBe(0);
  });

  it('counts user messages containing OVER_200K marker', () => {
    const messages = [
      mkMsg('user', 'some OVER_200K truncated text'),
      mkMsg('assistant', 'response OVER_200K'),
      mkMsg('user', 'another OVER_200K message'),
    ];
    const sessions = [mkSession({ messages })];
    // Only user messages count, so 2
    expect(countContextOverflow(sessions)).toBe(2);
  });

  it('accumulates across multiple sessions', () => {
    const s1 = mkSession({ messages: [mkMsg('user', 'OVER_200K text')] });
    const s2 = mkSession({ messages: [mkMsg('user', 'OVER_200K content')] });
    expect(countContextOverflow([s1, s2])).toBe(2);
  });
});

// ─── computeIterationDensity ──────────────────────────────────────────────

describe('computeIterationDensity', () => {
  it('returns 0 for empty sessions', () => {
    expect(computeIterationDensity([])).toBe(0);
  });

  it('returns user-message count when all sessions form one group', () => {
    const messages = [
      mkMsg('user', 'msg 1'),
      mkMsg('assistant', 'resp 1'),
      mkMsg('user', 'msg 2'),
      mkMsg('assistant', 'resp 2'),
      mkMsg('user', 'msg 3'),
      mkMsg('user', 'msg 4'),
      mkMsg('user', 'msg 5'),
    ];
    // 1 group with 5 user messages → density = 5.0
    const sessions = [mkSession({ messages, cwd: '/r/project' })];
    expect(computeIterationDensity(sessions)).toBe(5);
  });

  it('groups sessions within 8h by same cwd', () => {
    // Two sessions in same cwd within 8h → one group of 3 user msgs
    const s1 = mkSession({
      start: '2026-05-14T01:00:00Z',
      cwd: '/r/A',
      messages: [mkMsg('user', 'u1'), mkMsg('user', 'u2')],
    });
    const s2 = mkSession({
      start: '2026-05-14T05:00:00Z',
      cwd: '/r/A',
      messages: [mkMsg('user', 'u3')],
    });
    expect(computeIterationDensity([s1, s2])).toBe(3);
  });

  it('creates separate groups for different cwds', () => {
    // Two sessions in different cwds → 2 groups of 2 user msgs each → density = 2
    const s1 = mkSession({
      start: '2026-05-14T01:00:00Z',
      cwd: '/r/A',
      messages: [mkMsg('user', 'u1'), mkMsg('user', 'u2')],
    });
    const s2 = mkSession({
      start: '2026-05-14T02:00:00Z',
      cwd: '/r/B',
      messages: [mkMsg('user', 'u3'), mkMsg('user', 'u4')],
    });
    expect(computeIterationDensity([s1, s2])).toBe(2);
  });
});

// ─── promptLengthSeries ───────────────────────────────────────────────────

describe('promptLengthSeries', () => {
  it('returns empty array for no sessions', () => {
    expect(promptLengthSeries([])).toEqual([]);
  });

  it('computes daily mean of user message lengths', () => {
    const day = '2026-05-14';
    const ts = new Date(`${day}T02:00:00Z`);
    const messages = [
      mkMsg('user', 'hello', { ts }),     // len 5
      mkMsg('user', 'world!!', { ts }),   // len 7
      mkMsg('assistant', 'ignored long text goes here', { ts }),
    ];
    const sessions = [mkSession({ messages })];
    const result = promptLengthSeries(sessions);
    expect(result).toHaveLength(1);
    expect(result[0]!.date).toBe(day);
    expect(result[0]!.meanLen).toBe(6); // (5 + 7) / 2
  });

  it('returns results sorted by date ascending', () => {
    const t1 = new Date('2026-05-13T02:00:00Z');
    const t2 = new Date('2026-05-15T02:00:00Z');
    const s1 = mkSession({ messages: [mkMsg('user', 'abc', { ts: t1 })] });
    const s2 = mkSession({ messages: [mkMsg('user', 'de', { ts: t2 })] });
    const result = promptLengthSeries([s2, s1]);
    expect(result[0]!.date).toBe('2026-05-13');
    expect(result[1]!.date).toBe('2026-05-15');
  });
});
