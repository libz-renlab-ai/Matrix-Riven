import type { ParsedSession } from '../types.js';

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const MIN_MILESTONES = 2;

export interface EtaResult {
  etaDays: number | null;
  confidence: 'low';
}

/**
 * P3 — project ETA projection.
 *
 * Heuristic per spec §2.2 row 3: count "milestone events" (git commits + PRs)
 * in the past 14 days from `now`. If < MIN_MILESTONES, return null (insufficient data).
 * Otherwise project linearly: assume the target is "double the current commit count",
 * and estimate days at current rate. confidence is always 'low' (UI must flag).
 */
export function projectEta(sessions: ParsedSession[], now: Date): EtaResult {
  const windowStart = new Date(now.getTime() - FOURTEEN_DAYS_MS);
  let milestones = 0;
  for (const s of sessions) {
    if (s.startTs < windowStart || s.startTs > now) continue;
    for (const m of s.messages) {
      for (const tu of m.toolUses) {
        if (tu.name !== 'Bash') continue;
        const cmd = typeof tu.input.command === 'string' ? tu.input.command : '';
        if (/\bgit\s+commit\b|\bgit\s+push\b|\bgh\s+pr\s+create\b/i.test(cmd)) milestones++;
      }
    }
  }
  if (milestones < MIN_MILESTONES) return { etaDays: null, confidence: 'low' };
  // Linear projection: if N milestones in 14 days, "double" target is reached in another 14 days
  // (1 milestone-period). Floor at 1 day for stability.
  const ratePerDay = milestones / 14;
  const etaDays = Math.max(1, Math.round(milestones / ratePerDay));
  return { etaDays, confidence: 'low' };
}
