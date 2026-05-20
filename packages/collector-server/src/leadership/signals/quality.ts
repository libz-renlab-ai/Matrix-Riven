import type { ParsedSession } from '../types.js';

/** #10 — overall tool failure rate across the given sessions. */
export function computeToolFailureRate(sessions: ParsedSession[]): number {
  let total = 0;
  let fails = 0;
  for (const s of sessions) {
    for (const m of s.messages) {
      for (const tr of m.toolResults) {
        total++;
        if (tr.isError) fails++;
      }
    }
  }
  return total === 0 ? 0 : fails / total;
}

/** #11 — count of OVER_200K markers across the sessions' user messages. */
const OVERFLOW_PATTERN = /OVER_200K/;
export function countContextOverflow(sessions: ParsedSession[]): number {
  let n = 0;
  for (const s of sessions) {
    for (const m of s.messages) {
      if (m.role === 'user' && OVERFLOW_PATTERN.test(m.text)) n++;
    }
  }
  return n;
}

/** #12 — iteration density: mean user-message count per cwd-grouped "task".
 *  A "task" is a contiguous run of sessions in the same cwd (no break > 8h).
 */
export function computeIterationDensity(sessions: ParsedSession[]): number {
  if (sessions.length === 0) return 0;
  const sorted = [...sessions].sort((a, b) => a.startTs.getTime() - b.startTs.getTime());
  type Group = { cwd: string; lastTs: number; userMsgs: number };
  const groups: Group[] = [];
  const EIGHT_HOURS = 8 * 60 * 60 * 1000;
  for (const s of sorted) {
    const userMsgs = s.messages.filter((m) => m.role === 'user').length;
    const ts = s.startTs.getTime();
    const tail = groups[groups.length - 1];
    if (tail && tail.cwd === s.envelope.cwd && ts - tail.lastTs <= EIGHT_HOURS) {
      tail.userMsgs += userMsgs;
      tail.lastTs = s.endTs.getTime();
    } else {
      groups.push({ cwd: s.envelope.cwd, lastTs: s.endTs.getTime(), userMsgs });
    }
  }
  const totalUserMsgs = groups.reduce((a, g) => a + g.userMsgs, 0);
  return totalUserMsgs / groups.length;
}

/** #13 — prompt length series, mean user-message length per day bucket.
 *  Returns array of {date: 'YYYY-MM-DD', meanLen: number} sorted by date asc.
 */
export function promptLengthSeries(sessions: ParsedSession[]): { date: string; meanLen: number }[] {
  const byDay = new Map<string, { sum: number; count: number }>();
  for (const s of sessions) {
    for (const m of s.messages) {
      if (m.role !== 'user') continue;
      const d = (m.ts ?? s.startTs).toISOString().slice(0, 10);
      const cur = byDay.get(d) ?? { sum: 0, count: 0 };
      cur.sum += m.text.length;
      cur.count += 1;
      byDay.set(d, cur);
    }
  }
  return [...byDay.entries()]
    .map(([date, { sum, count }]) => ({ date, meanLen: count === 0 ? 0 : sum / count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
