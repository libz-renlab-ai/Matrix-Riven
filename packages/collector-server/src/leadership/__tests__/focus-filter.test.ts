import { describe, it, expect } from 'vitest';
import {
  parseFocusFromQuery,
  resolveRange,
  applyFocusFilter,
  applyStateFilterStage2,
  isDefaultFilter,
  focusFilterCacheKey,
} from '../focus-filter.js';
import type { ParsedSession, MemberStateBadge } from '../types.js';

// ── fixtures ──────────────────────────────────────────────────────────────────

function mkSession(opts: {
  user: string;
  project: string;
  startMs: number;
}): ParsedSession {
  const startTs = new Date(opts.startMs);
  return {
    envelope: {
      id: 'eid',
      userId: opts.user,
      machineId: 'm',
      sessionId: opts.user + '-' + opts.startMs,
      cwd: '/p/' + opts.project,
      projectName: opts.project,
      capturedAt: startTs.toISOString(),
      rivenVersion: '0',
      consentedAt: null,
    },
    l1RedactionCount: 0,
    messages: [],
    durationMs: 60_000,
    startTs,
    endTs: new Date(startTs.getTime() + 60_000),
    tokens: { input: 100, output: 50, cacheRead: 0, cacheCreation: 0 },
  };
}

// 2026-05-18T12:00:00Z
const NOW = new Date(Date.UTC(2026, 4, 18, 12, 0, 0));

// ── parseFocusFromQuery ──────────────────────────────────────────────────────

describe('parseFocusFromQuery', () => {
  it('empty query → defaults to today only', () => {
    const f = parseFocusFromQuery(new URLSearchParams());
    expect(f.range).toBe('today');
    expect(f.focus).toBeUndefined();
    expect(f.project).toBeUndefined();
    expect(f.state).toBeUndefined();
  });

  it('parses focus / project / range / state together', () => {
    const f = parseFocusFromQuery(
      new URLSearchParams('focus=blake&project=matrix&range=7d&state=stuck'),
    );
    expect(f.focus).toBe('blake');
    expect(f.project).toBe('matrix');
    expect(f.range).toBe('7d');
    expect(f.state).toBe('stuck');
  });

  it('lowercases focus', () => {
    const f = parseFocusFromQuery(new URLSearchParams('focus=BLAKE'));
    expect(f.focus).toBe('blake');
  });

  it('drops invalid range, falls back to today', () => {
    const f = parseFocusFromQuery(new URLSearchParams('range=quarter'));
    expect(f.range).toBe('today');
  });

  it('drops invalid state', () => {
    const f = parseFocusFromQuery(new URLSearchParams('state=hopeful'));
    expect(f.state).toBeUndefined();
  });

  it('range=custom with valid from/to keeps custom + parses dates', () => {
    const f = parseFocusFromQuery(
      new URLSearchParams('range=custom&from=2026-05-01&to=2026-05-10'),
    );
    expect(f.range).toBe('custom');
    expect(f.from?.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(f.to?.toISOString()).toBe('2026-05-10T00:00:00.000Z');
  });

  it('range=custom missing to → falls back to today', () => {
    const f = parseFocusFromQuery(new URLSearchParams('range=custom&from=2026-05-01'));
    expect(f.range).toBe('today');
    expect(f.from).toBeUndefined();
  });

  it('range=custom with from > to → falls back to today', () => {
    const f = parseFocusFromQuery(
      new URLSearchParams('range=custom&from=2026-05-10&to=2026-05-01'),
    );
    expect(f.range).toBe('today');
  });

  it('range=custom with malformed dates → falls back to today', () => {
    const f = parseFocusFromQuery(
      new URLSearchParams('range=custom&from=not-a-date&to=2026-05-10'),
    );
    expect(f.range).toBe('today');
  });

  it('trims whitespace and treats empty strings as undefined', () => {
    const f = parseFocusFromQuery(new URLSearchParams('focus=&project=  &state='));
    expect(f.focus).toBeUndefined();
    expect(f.project).toBeUndefined();
    expect(f.state).toBeUndefined();
  });
});

// ── resolveRange ─────────────────────────────────────────────────────────────

describe('resolveRange', () => {
  // Day boundaries are SERVER-LOCAL (not UTC) so 今日 flips at local midnight.
  // Assertions check the local-midnight invariant (getHours()===0 etc.) rather
  // than absolute UTC strings, so they hold in any server timezone — and they
  // FAIL on a non-UTC host if the impl ever regresses to setUTCHours/Date.UTC.
  it('today returns [local midnight of now, now]', () => {
    const r = resolveRange({ range: 'today' }, NOW);
    const expected = new Date(NOW);
    expected.setHours(0, 0, 0, 0);
    expect(r.start.getTime()).toBe(expected.getTime());
    expect(r.start.getHours()).toBe(0);
    expect(r.start.getMinutes()).toBe(0);
    expect(r.start.getSeconds()).toBe(0);
    expect(r.end).toBe(NOW);
  });

  it('yesterday returns [local -1d midnight, local today midnight)', () => {
    const r = resolveRange({ range: 'yesterday' }, NOW);
    const todayStart = new Date(NOW);
    todayStart.setHours(0, 0, 0, 0);
    expect(r.end.getTime()).toBe(todayStart.getTime());
    expect(r.start.getTime()).toBe(todayStart.getTime() - 24 * 60 * 60 * 1000);
    expect(r.start.getHours()).toBe(0);
  });

  it('7d returns [now-7d, now]', () => {
    const r = resolveRange({ range: '7d' }, NOW);
    expect(NOW.getTime() - r.start.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('custom uses from/to local day boundaries (to extended to end of day)', () => {
    const from = new Date(2026, 4, 1); // local 2026-05-01 00:00
    const to = new Date(2026, 4, 10); // local 2026-05-10 00:00
    const r = resolveRange({ range: 'custom', from, to }, NOW);
    expect(r.start.getTime()).toBe(new Date(2026, 4, 1).getTime());
    expect(r.end.getTime()).toBe(new Date(2026, 4, 11).getTime()); // to + 24h
    expect(r.start.getHours()).toBe(0);
  });
});

// ── applyFocusFilter ─────────────────────────────────────────────────────────

describe('applyFocusFilter', () => {
  const sessions = [
    mkSession({ user: 'blake@x.com', project: 'matrix', startMs: Date.UTC(2026, 4, 18, 10) }),
    mkSession({ user: 'blake@x.com', project: 'team-graph', startMs: Date.UTC(2026, 4, 18, 11) }),
    mkSession({ user: 'alex@x.com', project: 'matrix', startMs: Date.UTC(2026, 4, 18, 9) }),
    mkSession({ user: 'alex@x.com', project: 'matrix', startMs: Date.UTC(2026, 4, 10, 9) }), // 8d ago
  ];

  it('default filter (today) keeps only today sessions', () => {
    const out = applyFocusFilter(sessions, { range: 'today' }, NOW);
    expect(out).toHaveLength(3);
  });

  it('focus filter narrows to one member', () => {
    const out = applyFocusFilter(sessions, { range: '30d', focus: 'blake' }, NOW);
    expect(out).toHaveLength(2);
    expect(out.every((s) => s.envelope.userId === 'blake@x.com')).toBe(true);
  });

  it('project filter narrows to one project (case-insensitive)', () => {
    const out = applyFocusFilter(sessions, { range: '30d', project: 'MATRIX' }, NOW);
    expect(out).toHaveLength(3);
    expect(out.every((s) => s.envelope.projectName === 'matrix')).toBe(true);
  });

  it('focus + project combine (AND)', () => {
    const out = applyFocusFilter(
      sessions,
      { range: '30d', focus: 'blake', project: 'matrix' },
      NOW,
    );
    expect(out).toHaveLength(1);
  });

  it('7d range excludes the 8-day-ago session', () => {
    const out = applyFocusFilter(sessions, { range: '7d' }, NOW);
    expect(out).toHaveLength(3);
  });

  it('30d range includes everything', () => {
    const out = applyFocusFilter(sessions, { range: '30d' }, NOW);
    expect(out).toHaveLength(4);
  });

  it('empty sessions → empty result', () => {
    expect(applyFocusFilter([], { range: '30d', focus: 'blake' }, NOW)).toEqual([]);
  });

  it('does not mutate input', () => {
    const copy = [...sessions];
    applyFocusFilter(sessions, { range: '7d', focus: 'blake' }, NOW);
    expect(sessions).toEqual(copy);
  });
});

// ── applyStateFilterStage2 ────────────────────────────────────────────────────

describe('applyStateFilterStage2', () => {
  const s1 = mkSession({ user: 'a@x', project: 'p', startMs: 1 });
  const s2 = mkSession({ user: 'b@x', project: 'p', startMs: 2 });
  const stateMap = new Map<string, MemberStateBadge>([
    ['a@x', 'stuck'],
    ['b@x', 'active'],
  ]);

  it('undefined state passes through', () => {
    expect(applyStateFilterStage2([s1, s2], stateMap, undefined)).toHaveLength(2);
  });

  it('filters sessions whose owner does not match state', () => {
    const out = applyStateFilterStage2([s1, s2], stateMap, 'stuck');
    expect(out).toHaveLength(1);
    expect(out[0]!.envelope.userId).toBe('a@x');
  });

  it('member missing from stateMap is excluded when state set', () => {
    const out = applyStateFilterStage2([s1, s2], new Map(), 'stuck');
    expect(out).toHaveLength(0);
  });
});

// ── isDefaultFilter + cacheKey ────────────────────────────────────────────────

describe('isDefaultFilter', () => {
  it('default returns true', () => {
    expect(isDefaultFilter({ range: 'today' })).toBe(true);
  });

  it('any active dimension returns false', () => {
    expect(isDefaultFilter({ range: 'today', focus: 'blake' })).toBe(false);
    expect(isDefaultFilter({ range: '7d' })).toBe(false);
    expect(isDefaultFilter({ range: 'today', state: 'stuck' })).toBe(false);
  });
});

describe('focusFilterCacheKey', () => {
  it('default returns empty (preserves baseline cache keys)', () => {
    expect(focusFilterCacheKey({ range: 'today' })).toBe('');
  });

  it('active filter produces stable key', () => {
    const k1 = focusFilterCacheKey({ range: '7d', focus: 'blake', project: 'matrix' });
    const k2 = focusFilterCacheKey({ range: '7d', focus: 'blake', project: 'matrix' });
    expect(k1).toBe(k2);
    expect(k1).toContain('blake');
    expect(k1).toContain('matrix');
    expect(k1).toContain('7d');
  });

  it('different filters produce different keys', () => {
    const k1 = focusFilterCacheKey({ range: '7d', focus: 'blake' });
    const k2 = focusFilterCacheKey({ range: '7d', focus: 'alex' });
    expect(k1).not.toBe(k2);
  });
});
