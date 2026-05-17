/**
 * T5 — daily leader brief prompt builder.
 *
 * Three Chinese lines (each ≤35 字) composing the hero "brief box" of the
 * dashboard. Uses Sonnet for tone and synthesis quality. Single call per
 * refresh interval (T5 is hourly, not per-cycle).
 */

import type { BuiltPrompt, T5Input } from './types.js';

export const T5_MODEL = 'claude-sonnet-4-6';

const SYSTEM = [
  'You are a senior engineering leader summarizing the team day for a CEO-style dashboard. Write in concise Chinese, no jargon.',
  'Produce EXACTLY three lines that together cover: (1) what shipped or moved, (2) what needs attention, (3) what is next or the morale read.',
  'Each line must be at most 35 Chinese characters. Leader tone: confident, specific, no hedging, no emojis, no markdown.',
  'Output STRICT JSON only: {"briefLines":["<≤35字>","<≤35字>","<≤35字>"]}. No prose around the JSON.',
  'Example: {"briefLines":["overview 仪表盘 LLM 叙事层 T1-T2 已上线","attention 列表 3 条待跟进，多为测试链路问题","明日聚焦 worker 整合与 T5 调优"]}.',
  'Anchor on the supplied highlights, attention rewrites, and top projects; do not invent items outside the input.',
].join('\n');

export function buildT5Prompt(input: T5Input): BuiltPrompt {
  const payload = {
    tier: 'T5',
    rule: 'exactly 3 lines, each ≤35 中文字, leader tone, no jargon; JSON {briefLines:[...]}',
    items: [
      {
        date: input.date,
        topHighlights: input.topHighlights,
        attentionRewrites: input.attentionRewrites,
        topProjects: input.topProjects.slice(0, 3),
      },
    ],
  };
  return {
    system: SYSTEM,
    user: JSON.stringify(payload),
    model: T5_MODEL,
  };
}
