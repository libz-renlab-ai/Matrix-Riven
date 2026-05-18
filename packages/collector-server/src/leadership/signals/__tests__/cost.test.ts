import { describe, it, expect } from 'vitest';
import { computeCostUsd, computeModelMix } from '../cost.js';
import type { ParsedSession, ParsedMessage } from '../../types.js';

function mkSession(opts: {
  user?: string;
  start?: string;
  cwd?: string;
  messages?: ParsedMessage[];
  l1?: number;
  model?: string;
  tokens?: { input: number; output: number; cacheRead?: number; cacheCreation?: number };
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
      cacheRead: opts.tokens?.cacheRead ?? 0,
      cacheCreation: opts.tokens?.cacheCreation ?? 0,
    },
  };
}

// ─── computeCostUsd ───────────────────────────────────────────────────────

describe('computeCostUsd', () => {
  it('returns 0 for empty sessions', () => {
    expect(computeCostUsd([])).toBe(0);
  });

  it('computes cost for a sonnet session', () => {
    // sonnet: in=$3/M, out=$15/M
    // 1_000_000 input + 100_000 output → $3.00 + $1.50 = $4.50
    const sessions = [
      mkSession({
        model: 'claude-sonnet-4-5',
        tokens: { input: 1_000_000, output: 100_000 },
      }),
    ];
    expect(computeCostUsd(sessions)).toBe(4.5);
  });

  it('computes higher cost for an opus session than sonnet with same tokens', () => {
    // opus: in=$15/M, out=$75/M — 5x more expensive
    const tokens = { input: 100_000, output: 10_000 };
    const sonnet = [mkSession({ model: 'claude-sonnet-4-5', tokens })];
    const opus = [mkSession({ model: 'claude-opus-4-5', tokens })];
    expect(computeCostUsd(opus)).toBeGreaterThan(computeCostUsd(sonnet));
  });

  it('unknown model defaults to sonnet pricing', () => {
    const tokens = { input: 1_000_000, output: 0 };
    const unknown = [mkSession({ model: undefined, tokens })];
    const sonnet = [mkSession({ model: 'claude-sonnet-3-5', tokens })];
    expect(computeCostUsd(unknown)).toBe(computeCostUsd(sonnet));
  });

  it('accumulates cost across multiple sessions', () => {
    const s1 = mkSession({ model: 'claude-haiku-3', tokens: { input: 1_000_000, output: 0 } });
    const s2 = mkSession({ model: 'claude-haiku-3', tokens: { input: 1_000_000, output: 0 } });
    // haiku: in=$0.8/M → 2 sessions * $0.80 = $1.60
    expect(computeCostUsd([s1, s2])).toBe(1.6);
  });

  it('includes cache read and cache creation costs', () => {
    // sonnet: cacheRead=0.3/M, cacheCreation=3.75/M
    // 1M cacheRead + 1M cacheCreation → $0.30 + $3.75 = $4.05
    const sessions = [
      mkSession({
        model: 'claude-sonnet-4-5',
        tokens: { input: 0, output: 0, cacheRead: 1_000_000, cacheCreation: 1_000_000 },
      }),
    ];
    expect(computeCostUsd(sessions)).toBe(4.05);
  });
});

// ─── computeModelMix ──────────────────────────────────────────────────────

describe('computeModelMix', () => {
  it('returns empty object for empty sessions', () => {
    expect(computeModelMix([])).toEqual({});
  });

  it('returns 1.0 for single model family', () => {
    const sessions = [
      mkSession({ model: 'claude-sonnet-4-5', tokens: { input: 500, output: 500 } }),
    ];
    const mix = computeModelMix(sessions);
    expect(mix['sonnet']).toBe(1);
    expect(Object.keys(mix)).toHaveLength(1);
  });

  it('mix shares sum to ~1.0 across families', () => {
    const sessions = [
      mkSession({ model: 'claude-opus-4-5', tokens: { input: 300, output: 200 } }),    // 500 tokens
      mkSession({ model: 'claude-haiku-3', tokens: { input: 200, output: 300 } }),     // 500 tokens
    ];
    const mix = computeModelMix(sessions);
    const total = Object.values(mix).reduce((a, v) => a + v, 0);
    expect(total).toBeCloseTo(1.0, 5);
    expect(mix['opus']).toBeCloseTo(0.5, 5);
    expect(mix['haiku']).toBeCloseTo(0.5, 5);
  });

  it('labels sessions with no model as unknown', () => {
    const sessions = [
      mkSession({ model: undefined, tokens: { input: 100, output: 100 } }),
    ];
    const mix = computeModelMix(sessions);
    expect(mix['unknown']).toBe(1);
  });

  it('handles three model families with correct proportions', () => {
    const sessions = [
      mkSession({ model: 'claude-opus-4-5', tokens: { input: 500, output: 500 } }),    // 1000
      mkSession({ model: 'claude-sonnet-4-5', tokens: { input: 500, output: 500 } }), // 1000
      mkSession({ model: 'claude-haiku-3', tokens: { input: 500, output: 500 } }),    // 1000
    ];
    const mix = computeModelMix(sessions);
    const total = Object.values(mix).reduce((a, v) => a + v, 0);
    // Rounding to 3 decimal places means 3 × 0.333 = 0.999; allow ±0.005
    expect(total).toBeGreaterThan(0.99);
    expect(total).toBeLessThanOrEqual(1.0);
    expect(mix['opus']).toBeCloseTo(1 / 3, 2);
    expect(mix['sonnet']).toBeCloseTo(1 / 3, 2);
    expect(mix['haiku']).toBeCloseTo(1 / 3, 2);
  });
});
