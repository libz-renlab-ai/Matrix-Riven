import type { ParsedSession } from '../types.js';

/**
 * P12 — share of tool calls in this project that are WebSearch+WebFetch
 * (out of total tool calls). Indicates "research density".
 */
export function computeWebResearchShare(sessions: ParsedSession[]): number {
  let web = 0;
  let total = 0;
  for (const s of sessions) {
    for (const m of s.messages) {
      for (const tu of m.toolUses) {
        total++;
        if (tu.name === 'WebSearch' || tu.name === 'WebFetch') web++;
      }
    }
  }
  if (total === 0) return 0;
  return Math.round((web / total) * 1000) / 1000;
}

/**
 * P13 — daily trend: number of sessions per day for the last 7 days
 * ending at `now` (UTC). Returns length-7 array, oldest first.
 */
export function computeTrend7d(sessions: ParsedSession[], now: Date): number[] {
  // Bucket end-exclusive: [now-7d, now-6d), [now-6d, now-5d), ..., [now-1d, now)
  const buckets = new Array(7).fill(0);
  const dayMs = 24 * 60 * 60 * 1000;
  const endMs = now.getTime();
  for (const s of sessions) {
    const t = s.startTs.getTime();
    const offset = Math.floor((endMs - t) / dayMs); // 0 = today (0..1d ago), 1 = yesterday
    if (offset >= 0 && offset < 7) buckets[6 - offset]++; // oldest first
  }
  return buckets;
}

/**
 * P14 — 7×24 heatmap (rows=days, cols=hours) of token volume, local CST (UTC+8).
 * Rows[0] = 7 days ago, rows[6] = today.
 */
export function computeHeatmap7x24(sessions: ParsedSession[], now: Date): number[][] {
  const rows: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const dayMs = 24 * 60 * 60 * 1000;
  const cstOffset = 8 * 60 * 60 * 1000;
  const endMs = now.getTime();
  for (const s of sessions) {
    const cstTime = s.startTs.getTime() + cstOffset;
    const offsetDays = Math.floor((endMs - s.startTs.getTime()) / dayMs);
    if (offsetDays < 0 || offsetDays >= 7) continue;
    const rowIdx = 6 - offsetDays;
    const cstDate = new Date(cstTime);
    const hr = cstDate.getUTCHours();
    const row = rows[rowIdx];
    if (row) row[hr] = (row[hr] ?? 0) + s.tokens.input + s.tokens.output;
  }
  return rows;
}
