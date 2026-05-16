import { describe, it, expect } from 'vitest';
import type { ParsedSession, ParsedMessage } from '../../types.js';
import {
  computeWebResearchShare,
  computeTrend7d,
  computeHeatmap7x24,
} from '../project-rhythm.js';

function mkSession(opts: {
  start?: string;
  messages?: ParsedMessage[];
  tokens?: { input: number; output: number };
}): ParsedSession {
  const s = new Date(opts.start ?? '2026-05-14T01:00:00Z');
  const tok = opts.tokens ?? { input: 100, output: 50 };
  return {
    envelope: {
      id: 'e', userId: 'u@x', machineId: 'm', sessionId: 's',
      cwd: '/p/X', projectName: 'X',
      capturedAt: s.toISOString(), rivenVersion: '0', consentedAt: null,
    },
    l1RedactionCount: 0,
    messages: opts.messages ?? [],
    durationMs: 60_000,
    startTs: s,
    endTs: new Date(s.getTime() + 60_000),
    tokens: { input: tok.input, output: tok.output, cacheRead: 0, cacheCreation: 0 },
  };
}

function toolMsg(names: string[]): ParsedMessage {
  return {
    role: 'assistant',
    ts: new Date('2026-05-14T01:00:00Z'),
    text: '',
    toolUses: names.map(n => ({ name: n, input: {} })),
    toolResults: [],
  };
}

// ─── P12: computeWebResearchShare ────────────────────────────────────────────

describe('computeWebResearchShare', () => {
  it('returns 0 when there are no sessions', () => {
    expect(computeWebResearchShare([])).toBe(0);
  });

  it('returns 0 when there are no tool calls', () => {
    const sessions = [mkSession({ messages: [] })];
    expect(computeWebResearchShare(sessions)).toBe(0);
  });

  it('returns 0.25 when 3 web calls out of 12 total', () => {
    // 9 Bash + 3 WebSearch = 12 total, 3 web => 0.25
    const sessions = [
      mkSession({
        messages: [
          toolMsg(['Bash', 'Bash', 'Bash', 'WebSearch']),
          toolMsg(['Bash', 'Bash', 'Bash', 'WebSearch']),
          toolMsg(['Bash', 'Bash', 'Bash', 'WebSearch']),
        ],
      }),
    ];
    expect(computeWebResearchShare(sessions)).toBe(0.25);
  });

  it('counts both WebSearch and WebFetch as web calls', () => {
    const sessions = [
      mkSession({
        messages: [
          toolMsg(['WebSearch', 'WebFetch', 'Bash', 'Bash']),
        ],
      }),
    ];
    // 2 web out of 4 => 0.5
    expect(computeWebResearchShare(sessions)).toBe(0.5);
  });

  it('returns 1 when all calls are web calls', () => {
    const sessions = [
      mkSession({ messages: [toolMsg(['WebSearch', 'WebFetch'])] }),
    ];
    expect(computeWebResearchShare(sessions)).toBe(1);
  });
});

// ─── P13: computeTrend7d ──────────────────────────────────────────────────────

describe('computeTrend7d', () => {
  it('returns a length-7 array of zeros when no sessions', () => {
    const now = new Date('2026-05-14T12:00:00Z');
    const result = computeTrend7d([], now);
    expect(result).toHaveLength(7);
    expect(result.every(v => v === 0)).toBe(true);
  });

  it('correctly positions sessions on 3 distinct days (oldest first)', () => {
    const now = new Date('2026-05-14T23:00:00Z');
    // 0 days ago (today): index 6
    const s0 = mkSession({ start: '2026-05-14T10:00:00Z' });
    // 1 day ago: index 5
    const s1a = mkSession({ start: '2026-05-13T10:00:00Z' });
    const s1b = mkSession({ start: '2026-05-13T15:00:00Z' });
    // 4 days ago: index 2
    const s4 = mkSession({ start: '2026-05-10T10:00:00Z' });

    const result = computeTrend7d([s0, s1a, s1b, s4], now);

    expect(result).toHaveLength(7);
    expect(result[6]).toBe(1); // today
    expect(result[5]).toBe(2); // yesterday × 2
    expect(result[2]).toBe(1); // 4 days ago
    // other buckets empty
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(0);
    expect(result[3]).toBe(0);
    expect(result[4]).toBe(0);
  });

  it('excludes sessions outside the 7-day window', () => {
    const now = new Date('2026-05-14T23:00:00Z');
    // 7 days ago exactly = offset 7 → excluded
    const old = mkSession({ start: '2026-05-07T10:00:00Z' });
    // 8 days ago → also excluded
    const older = mkSession({ start: '2026-05-06T10:00:00Z' });
    // 6 days ago (offset 6) → index 0 (included)
    const edge = mkSession({ start: '2026-05-08T10:00:00Z' });

    const result = computeTrend7d([old, older, edge], now);
    expect(result).toHaveLength(7);
    // old & older excluded
    const sum = result.reduce((a, b) => a + b, 0);
    expect(sum).toBe(1);
    expect(result[0]).toBe(1); // 6 days ago → oldest bucket
  });
});

// ─── P14: computeHeatmap7x24 ─────────────────────────────────────────────────

describe('computeHeatmap7x24', () => {
  it('returns 7 rows × 24 columns filled with zeros when no sessions', () => {
    const now = new Date('2026-05-14T23:00:00Z');
    const result = computeHeatmap7x24([], now);
    expect(result).toHaveLength(7);
    result.forEach(row => expect(row).toHaveLength(24));
    result.forEach(row => row.forEach(v => expect(v).toBe(0)));
  });

  it('places session tokens at correct CST hour (UTC+8)', () => {
    // 2026-05-14T01:00:00Z = 09:00 CST (UTC+8)
    const now = new Date('2026-05-14T23:00:00Z');
    const session = mkSession({
      start: '2026-05-14T01:00:00Z',
      tokens: { input: 300, output: 200 },
    });
    const result = computeHeatmap7x24([session], now);
    expect(result).toHaveLength(7);
    result.forEach(row => expect(row).toHaveLength(24));
    // offset = floor((now - start) / dayMs) = floor(22h / 24h) = 0  => row 6
    expect(result[6]?.[9]).toBe(500); // 300 input + 200 output
  });

  it('accumulates tokens from multiple sessions in same cell', () => {
    const now = new Date('2026-05-14T23:00:00Z');
    const s1 = mkSession({ start: '2026-05-14T01:00:00Z', tokens: { input: 100, output: 50 } });
    const s2 = mkSession({ start: '2026-05-14T01:30:00Z', tokens: { input: 200, output: 100 } });
    const result = computeHeatmap7x24([s1, s2], now);
    // both at 2026-05-14T01:xx:00Z = 09:xx CST => same cell [6][9]
    expect(result[6]?.[9]).toBe(450);
  });

  it('excludes sessions outside the 7-day window', () => {
    const now = new Date('2026-05-14T23:00:00Z');
    // 8 days ago → offset 8 → excluded
    const old = mkSession({ start: '2026-05-06T01:00:00Z', tokens: { input: 9999, output: 9999 } });
    const result = computeHeatmap7x24([old], now);
    const total = result.flat().reduce((a, b) => a + b, 0);
    expect(total).toBe(0);
  });
});
