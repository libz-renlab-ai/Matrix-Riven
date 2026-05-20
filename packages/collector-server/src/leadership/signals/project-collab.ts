import type { ParsedSession } from '../types.js';

const BUS_FACTOR_THRESHOLD = 0.7;
const FILE_EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

export interface Contributor { email: string; sharePct: number }

/** P4 — contributors with share-of-tokens; sorted desc. */
export function computeContributors(sessions: ParsedSession[]): Contributor[] {
  const totals = new Map<string, number>();
  let grand = 0;
  for (const s of sessions) {
    const t = s.tokens.input + s.tokens.output;
    totals.set(s.envelope.userId, (totals.get(s.envelope.userId) ?? 0) + t);
    grand += t;
  }
  if (grand === 0) return [];
  const out: Contributor[] = [];
  for (const [email, tk] of totals.entries()) {
    out.push({ email, sharePct: Math.round((tk / grand) * 1000) / 1000 });
  }
  out.sort((a, b) => b.sharePct - a.sharePct);
  return out;
}

/**
 * P4 — bus-factor warning when the top contributor owns more than
 * `BUS_FACTOR_THRESHOLD` of tokens.
 *
 * Calibration (2026-05-17 data-trust rebuild): a one-person project is NOT a
 * bus-factor risk — it's a solo project, by definition. Require ≥ 2
 * contributors before the warning can fire so the 77/79-flagged regression
 * we saw on the real snapshot collapses to a meaningful subset.
 */
export function hasBusFactorWarning(contributors: Contributor[]): boolean {
  if (contributors.length < 2) return false;
  return contributors[0]!.sharePct > BUS_FACTOR_THRESHOLD;
}

/** P5 — collaboration density: distinct files touched by ≥2 users / total distinct files. */
export function computeCollabDensity(sessions: ParsedSession[]): number {
  const fileUsers = new Map<string, Set<string>>();
  for (const s of sessions) {
    for (const m of s.messages) {
      for (const tu of m.toolUses) {
        if (!FILE_EDIT_TOOLS.has(tu.name)) continue;
        const fp = typeof tu.input.file_path === 'string' ? tu.input.file_path : undefined;
        if (!fp) continue;
        const set = fileUsers.get(fp) ?? new Set<string>();
        set.add(s.envelope.userId);
        fileUsers.set(fp, set);
      }
    }
  }
  if (fileUsers.size === 0) return 0;
  let shared = 0;
  for (const set of fileUsers.values()) if (set.size >= 2) shared++;
  return Math.round((shared / fileUsers.size) * 1000) / 1000;
}
