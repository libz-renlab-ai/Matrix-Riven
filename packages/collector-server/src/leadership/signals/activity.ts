import type { ParsedSession } from '../types.js';

const MAX_GAP_MS = 30 * 60 * 1000;

export function computeActivity(sessions: ParsedSession[]): {
  sessions: number;
  tokens: number;
  estMinutes: number;
} {
  let tokens = 0;
  let ms = 0;
  for (const s of sessions) {
    tokens += s.tokens.input + s.tokens.output;
    ms += Math.min(s.durationMs, MAX_GAP_MS);
  }
  return { sessions: sessions.length, tokens, estMinutes: Math.round(ms / 60_000) };
}

export function computeFocus(sessions: ParsedSession[]): {
  distinctCwdsToday: number;
  avgSessionMinutes: number;
} {
  const cwds = new Set(sessions.map((s) => s.envelope.cwd));
  const totalMin = sessions.reduce((acc, s) => acc + Math.min(s.durationMs, MAX_GAP_MS) / 60_000, 0);
  const avg = sessions.length === 0 ? 0 : Math.round(totalMin / sessions.length);
  return { distinctCwdsToday: cwds.size, avgSessionMinutes: avg };
}

export function computeRhythmDelta(today: ParsedSession[], past7: ParsedSession[]): number {
  const todayTok = today.reduce((a, s) => a + s.tokens.input + s.tokens.output, 0);
  if (past7.length === 0) return 0;
  const pastTok = past7.reduce((a, s) => a + s.tokens.input + s.tokens.output, 0);
  const dailyAvg = pastTok / 7;
  if (dailyAvg === 0) return todayTok > 0 ? 1 : 0;
  return (todayTok - dailyAvg) / dailyAvg;
}
