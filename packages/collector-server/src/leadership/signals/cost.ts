import type { ParsedSession } from '../types.js';

/**
 * Anthropic public pricing as of 2026-05 in USD per million tokens.
 * Cache-read 10% of input. Cache-creation 25% premium over input.
 */
interface Price { in: number; out: number; cacheRead: number; cacheCreation: number }
const PRICES: Record<string, Price> = {
  opus:   { in: 15,  out: 75, cacheRead: 1.5,  cacheCreation: 18.75 },
  sonnet: { in: 3,   out: 15, cacheRead: 0.3,  cacheCreation: 3.75 },
  haiku:  { in: 0.8, out: 4,  cacheRead: 0.08, cacheCreation: 1.0 },
};

function priceForModel(model: string | undefined): Price {
  if (!model) return PRICES.sonnet!;
  const m = model.toLowerCase();
  if (m.includes('opus')) return PRICES.opus!;
  if (m.includes('haiku')) return PRICES.haiku!;
  return PRICES.sonnet!;
}

/** #16 — total USD cost across sessions. */
export function computeCostUsd(sessions: ParsedSession[]): number {
  let usd = 0;
  for (const s of sessions) {
    const p = priceForModel(s.model);
    usd += (s.tokens.input * p.in) / 1_000_000;
    usd += (s.tokens.output * p.out) / 1_000_000;
    usd += (s.tokens.cacheRead * p.cacheRead) / 1_000_000;
    usd += (s.tokens.cacheCreation * p.cacheCreation) / 1_000_000;
  }
  return Math.round(usd * 100) / 100;
}

/** #17 — model mix: token share by model family. */
export function computeModelMix(sessions: ParsedSession[]): Record<string, number> {
  const totals: Record<string, number> = {};
  let grand = 0;
  for (const s of sessions) {
    const family = !s.model ? 'unknown' :
      s.model.toLowerCase().includes('opus') ? 'opus' :
      s.model.toLowerCase().includes('haiku') ? 'haiku' :
      s.model.toLowerCase().includes('sonnet') ? 'sonnet' : 'other';
    const tokens = s.tokens.input + s.tokens.output;
    totals[family] = (totals[family] ?? 0) + tokens;
    grand += tokens;
  }
  if (grand === 0) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(totals)) out[k] = Math.round((v / grand) * 1000) / 1000;
  return out;
}
