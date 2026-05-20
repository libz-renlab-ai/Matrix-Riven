/**
 * T1 — per-session digest prompt builder.
 *
 * One verb-led Chinese sentence (≤18 字) summarizing what the session did.
 * Batched: one LLM call summarizes up to N sessions in a single JSON array
 * response keyed by session id.
 */

import type { BuiltPrompt, T1Input } from './types.js';

/** Model used for T1 calls; caller may override per-call. */
export const T1_MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM = [
  'You are a terse Chinese summarizer for an engineering team leadership dashboard.',
  'For each coding session in the input, write ONE verb-led Chinese sentence of at most 18 Chinese characters that captures the concrete work done.',
  'Use the changed files and tool counts as ground truth; do not invent intent beyond the evidence.',
  'Output STRICT JSON only: {"results":[{"id":"<sessionId>","line":"<≤18字>"}]}. No prose, no markdown, no trailing comments.',
  'Example item: {"id":"s1","line":"修 status/page.tsx TS 报错"}.',
  'Do not hedge ("可能/也许"); do not echo file paths verbatim if they exceed the budget.',
].join('\n');

export function buildT1Prompt(inputs: T1Input[]): BuiltPrompt {
  const payload = {
    tier: 'T1',
    rule: 'each line ≤18 中文字, verb-led, return JSON {results:[{id,line}]}',
    items: inputs.map(x => ({
      id: x.id,
      firstUserPrompt: x.firstUserPrompt.slice(0, 200),
      changedFiles: x.changedFiles.slice(0, 3),
      toolCounts: x.toolCounts,
      durationMin: x.durationMin,
      errors: x.errors,
    })),
  };
  return {
    system: SYSTEM,
    user: `Return STRICT JSON {"results":[{"id","line"}]} only. No prose. Batch:\n${JSON.stringify(payload)}`,
    model: T1_MODEL,
  };
}
