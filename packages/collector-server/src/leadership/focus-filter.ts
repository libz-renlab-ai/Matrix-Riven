// Phase 3-A · Focus filter parser + applier.
//
// The filter is applied at the aggregator before signal computation so
// downstream signal computers stay filter-agnostic. State filtering needs
// per-member state badges and therefore runs in a second pass inside the
// aggregator (see `applyStateFilterStage2`).

import type { FocusFilter, ParsedSession, MemberStateBadge, RangeLabel } from './types.js';
import { DEFAULT_FOCUS_FILTER } from './types.js';

const VALID_RANGES = new Set<RangeLabel>(['today', 'yesterday', '24h', '7d', '30d', 'custom']);
const VALID_STATES = new Set<MemberStateBadge>([
  'active',
  'quiet',
  'stuck',
  'needs_help',
  'low_activity',
]);

/**
 * Parse `URLSearchParams` into a `FocusFilter`. Invalid values are silently
 * dropped — the dashboard never 4xxs on a bad query. Missing values fall
 * back to `DEFAULT_FOCUS_FILTER`.
 */
export function parseFocusFromQuery(query: URLSearchParams): FocusFilter {
  const out: FocusFilter = { range: 'today' };

  const focus = trimToUndef(query.get('focus'));
  if (focus) out.focus = focus.toLowerCase();

  const project = trimToUndef(query.get('project'));
  if (project) out.project = project;

  const rangeRaw = trimToUndef(query.get('range'));
  if (rangeRaw && VALID_RANGES.has(rangeRaw as RangeLabel)) {
    out.range = rangeRaw as RangeLabel;
  }

  if (out.range === 'custom') {
    const from = parseISODateOrNull(query.get('from'));
    const to = parseISODateOrNull(query.get('to'));
    if (from && to && from <= to) {
      out.from = from;
      out.to = to;
    } else {
      // Invalid custom range — fall back to 'today' so we still render
      // *something* sensible. Stderr a single warning for ops.
      out.range = 'today';
    }
  }

  const stateRaw = trimToUndef(query.get('state'));
  if (stateRaw && VALID_STATES.has(stateRaw as MemberStateBadge)) {
    out.state = stateRaw as MemberStateBadge;
  }

  return out;
}

/**
 * Convert a `FocusFilter`'s `range` into concrete start/end Dates. Day
 * boundaries (today / yesterday / custom) use the server's LOCAL timezone so
 * 今日 flips at local midnight, not UTC. `now` is injected for testability.
 *
 *  today      → [local 00:00 of now's day, now]
 *  yesterday  → [local 00:00 of now-1d, local 00:00 of now]
 *  24h        → [now - 24h, now]
 *  7d         → [now - 7d, now]
 *  30d        → [now - 30d, now]
 *  custom     → [from local 00:00, to + 24h local 00:00)   (inclusive both ends, "to" extends to end of day)
 */
export function resolveRange(filter: FocusFilter, now: Date): { start: Date; end: Date } {
  switch (filter.range) {
    case 'today': {
      const start = localDayStart(now);
      return { start, end: now };
    }
    case 'yesterday': {
      const todayStart = localDayStart(now);
      const start = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
      return { start, end: todayStart };
    }
    case '24h':
      return { start: new Date(now.getTime() - 24 * 60 * 60 * 1000), end: now };
    case '7d':
      return { start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), end: now };
    case '30d':
      return { start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), end: now };
    case 'custom': {
      if (!filter.from || !filter.to) return { start: localDayStart(now), end: now };
      const start = localDayStart(filter.from);
      const end = new Date(localDayStart(filter.to).getTime() + 24 * 60 * 60 * 1000);
      return { start, end };
    }
  }
}

/**
 * Apply `focus`, `project`, `range` dimensions to a list of sessions.
 * `state` is NOT applied here — see `applyStateFilterStage2`.
 *
 * Always returns a NEW array; never mutates input.
 */
export function applyFocusFilter(
  sessions: ParsedSession[],
  filter: FocusFilter,
  now: Date,
): ParsedSession[] {
  if (sessions.length === 0) return [];
  const { start, end } = resolveRange(filter, now);
  const focus = filter.focus?.toLowerCase();
  const project = filter.project?.toLowerCase();

  const out: ParsedSession[] = [];
  for (const s of sessions) {
    // Range
    if (s.startTs < start || s.startTs > end) continue;
    // Focus — match userId local-part
    if (focus) {
      const local = localPart(s.envelope.userId).toLowerCase();
      if (local !== focus) continue;
    }
    // Project — exact case-insensitive
    if (project) {
      if (s.envelope.projectName.toLowerCase() !== project) continue;
    }
    out.push(s);
  }
  return out;
}

/**
 * Stage-2 state filter. Called by the aggregator after member state badges
 * are computed on the stage-1 filtered set. Returns the subset of sessions
 * whose owner's stateBadge matches `state`.
 */
export function applyStateFilterStage2(
  sessions: ParsedSession[],
  memberStateByEmail: Map<string, MemberStateBadge>,
  state: MemberStateBadge | undefined,
): ParsedSession[] {
  if (!state) return sessions;
  return sessions.filter((s) => memberStateByEmail.get(s.envelope.userId) === state);
}

/** True when filter has no active dimension — used to skip cache-key salting. */
export function isDefaultFilter(f: FocusFilter): boolean {
  return (
    !f.focus &&
    !f.project &&
    !f.state &&
    f.range === DEFAULT_FOCUS_FILTER.range &&
    !f.from &&
    !f.to
  );
}

/**
 * Build a cache-key fragment for a filter. Empty when filter is default
 * (so the existing range-only cache key stays byte-identical for unfiltered
 * traffic and we don't blow up the cache footprint).
 */
export function focusFilterCacheKey(f: FocusFilter): string {
  if (isDefaultFilter(f)) return '';
  const parts = [
    f.focus ?? '',
    f.project ?? '',
    f.range,
    f.from ? f.from.toISOString().slice(0, 10) : '',
    f.to ? f.to.toISOString().slice(0, 10) : '',
    f.state ?? '',
  ];
  return '|f:' + parts.join('|');
}

// ── helpers ──────────────────────────────────────────────────────────────────

function localDayStart(d: Date): Date {
  // Server-local midnight (not UTC). The dashboard's 今日 / 昨日 windows follow
  // the collector host's timezone, so a UTC+8 team sees the day flip at local
  // 00:00 instead of 08:00. On a UTC host this equals UTC midnight.
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function trimToUndef(v: string | null): string | undefined {
  if (v == null) return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

function parseISODateOrNull(s: string | null): Date | null {
  const t = trimToUndef(s);
  if (!t) return null;
  // Accept YYYY-MM-DD or full ISO. Anything else → null.
  if (!/^\d{4}-\d{2}-\d{2}(T|$)/.test(t)) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

function localPart(email: string): string {
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}
