/**
 * T2 — per-member weekly summary prompt builder.
 *
 * Two Chinese lines per member (each ≤22 字). Line1 = focus, Line2 = status.
 * Batched: one LLM call covers all members in a single JSON array response
 * keyed by email.
 */

import type { BuiltPrompt, T2Input } from './types.js';

export const T2_MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM = [
  'You are a terse Chinese summarizer for an engineering team leadership dashboard.',
  'For each member, write TWO Chinese lines. line1 = "本周聚焦 X" describing what they worked on. line2 = "卡在/已收尾/已交付 Y" describing their current state.',
  'Each line must be at most 22 Chinese characters. Lead with a concrete object (file, feature, area); never just restate the state badge.',
  'Output STRICT JSON only: {"results":[{"email":"<email>","line1":"<≤22字>","line2":"<≤22字>"}]}. No prose, no markdown.',
  'Example item: {"email":"alice@x.com","line1":"本周聚焦 overview 仪表盘 UI","line2":"已交付 hero 与 KPI 卡片骨架"}.',
  'Pick verbs that match the state (needs_help/stuck → "卡在"; high_output/active → "推进/已交付"; idle/off → "本周节奏放缓").',
].join('\n');

export function buildT2Prompt(inputs: T2Input[]): BuiltPrompt {
  const payload = {
    tier: 'T2',
    rule: 'line1 "本周聚焦 X", line2 "卡在/已收尾/已交付 Y", each ≤22 中文字; JSON {results:[{email,line1,line2}]}',
    items: inputs.map(x => ({
      email: x.email,
      displayName: x.displayName,
      state: x.state,
      topFiles: x.topFiles.slice(0, 5),
      sessionDigests: x.sessionDigests,
    })),
  };
  return {
    system: SYSTEM,
    user: JSON.stringify(payload),
    model: T2_MODEL,
  };
}
