/**
 * T4 — attention-item rewrite prompt builder.
 *
 * Replaces the generic template "需要帮助" / "卡在 X" with a single specific
 * actionable Chinese sentence (≤30 字) per attention item. Batched: one call
 * covers all items, keyed by refId.
 */

import type { BuiltPrompt, T4Input } from './types.js';

export const T4_MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM = [
  'You are a terse Chinese summarizer for an engineering team leadership dashboard.',
  'For each attention item, write ONE specific actionable Chinese sentence of at most 30 Chinese characters. Name the concrete blocker or risk; suggest the lightest next step.',
  'FORBIDDEN: generic phrases like "需要帮助", "请关注一下", "建议跟进", "可能有风险". Be specific or do not write the item.',
  'Output STRICT JSON only: {"results":[{"refId":"<id>","line":"<≤30字>"}]}. No prose, no markdown.',
  'Example item: {"refId":"r1","line":"overview 测试连挂 3 次，建议结对排查 snapshot 路径"}.',
  'Anchor on the evidence snippets; do not invent facts not present in the input.',
].join('\n');

export function buildT4Prompt(inputs: T4Input[]): BuiltPrompt {
  const payload = {
    tier: 'T4',
    rule: 'one specific actionable line ≤30 中文字, no generic phrases; JSON {results:[{refId,line}]}',
    items: inputs.map(x => ({
      refId: x.refId,
      kind: x.kind,
      displayName: x.displayName,
      signal: x.signal,
      evidence: x.evidence.slice(0, 3),
    })),
  };
  return {
    system: SYSTEM,
    user: JSON.stringify(payload),
    model: T4_MODEL,
  };
}
