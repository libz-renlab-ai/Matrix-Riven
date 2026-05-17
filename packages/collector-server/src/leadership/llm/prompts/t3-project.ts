/**
 * T3 — per-project weekly summary prompt builder.
 *
 * Two Chinese lines per project (each ≤25 字). Line1 = what the team is doing,
 * Line2 = progress + outstanding work. Batched: one LLM call covers all
 * projects in a single JSON array response keyed by project name.
 */

import type { BuiltPrompt, T3Input } from './types.js';

export const T3_MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM = [
  'You are a terse Chinese summarizer for an engineering team leadership dashboard.',
  'For each project, write TWO Chinese lines. line1 = "团队在做 X" describing the active work. line2 = "进展 Y / 待 Z" describing what shipped and what is still pending.',
  'Each line must be at most 25 Chinese characters. Be concrete: name the feature, surface area, or subsystem; never just restate the phase label.',
  'Output STRICT JSON only: {"results":[{"project":"<name>","line1":"<≤25字>","line2":"<≤25字>"}]}. No prose, no markdown.',
  'Example item: {"project":"matrix-riven","line1":"团队在做 leadership 仪表盘 LLM 叙事层","line2":"进展 T1-T2 上线 / 待整合 worker"}.',
  'Anchor on the session digests and commit subjects; do not invent work that is not in the input.',
].join('\n');

export function buildT3Prompt(inputs: T3Input[]): BuiltPrompt {
  const payload = {
    tier: 'T3',
    rule: 'line1 "团队在做 X", line2 "进展 Y / 待 Z", each ≤25 中文字; JSON {results:[{project,line1,line2}]}',
    items: inputs.map(x => ({
      project: x.project,
      phase: x.phase,
      contributors: x.contributors,
      sessionDigests: x.sessionDigests,
      recentCommits: x.recentCommits.slice(0, 5),
    })),
  };
  return {
    system: SYSTEM,
    user: `Return STRICT JSON {"results":[{"project","line1","line2"}]} only. No prose. Batch:\n${JSON.stringify(payload)}`,
    model: T3_MODEL,
  };
}
