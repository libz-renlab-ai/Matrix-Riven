import { describe, it, expect } from 'vitest';
import { parseRange } from '../routes.js';

// PR4: 今日 must follow the server's LOCAL timezone, not UTC. These assertions
// check the local-midnight invariant (getHours()===0 etc.) so they hold in any
// server timezone — and FAIL on a non-UTC host (e.g. the UTC+8 team's machine)
// if the impl ever regresses to setUTCHours().
describe('parseRange today boundary (server-local timezone)', () => {
  const NOW = new Date(Date.UTC(2026, 5, 3, 4, 0, 0)); // 2026-06-03T04:00:00Z

  it('range=today starts at server-local midnight, not UTC', () => {
    const r = parseRange('today', NOW);
    expect(r).not.toBeNull();
    const expected = new Date(NOW);
    expected.setHours(0, 0, 0, 0);
    expect(r!.start.getTime()).toBe(expected.getTime());
    expect(r!.start.getHours()).toBe(0);
    expect(r!.start.getMinutes()).toBe(0);
    expect(r!.start.getSeconds()).toBe(0);
    expect(r!.end.getTime()).toBe(NOW.getTime());
    expect(r!.label).toBe('today');
  });

  it('rolling ranges (24h/7d/30d) are unaffected', () => {
    expect(parseRange('24h', NOW)!.start.getTime()).toBe(NOW.getTime() - 24 * 3600 * 1000);
    expect(parseRange('7d', NOW)!.start.getTime()).toBe(NOW.getTime() - 7 * 24 * 3600 * 1000);
    expect(parseRange('30d', NOW)!.start.getTime()).toBe(NOW.getTime() - 30 * 24 * 3600 * 1000);
  });

  it('defaults to 7d and rejects an invalid range', () => {
    expect(parseRange(undefined, NOW)!.label).toBe('7d');
    expect(parseRange('decade', NOW)).toBeNull();
  });
});
