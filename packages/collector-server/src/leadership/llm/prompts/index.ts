/**
 * Barrel export for the five LLM narrative prompt tiers (T1–T5).
 *
 * Each tier exports its `buildT*Prompt` function alongside a `T*_MODEL`
 * constant so the summarizer can read the default model without importing the
 * builder. Caller may always override the model per-call.
 */

export type {
  BuiltPrompt,
  T1Input,
  T2Input,
  T3Input,
  T4Input,
  T5Input,
} from './types.js';

export { buildT1Prompt, T1_MODEL } from './t1-session.js';
export { buildT2Prompt, T2_MODEL } from './t2-member.js';
export { buildT3Prompt, T3_MODEL } from './t3-project.js';
export { buildT4Prompt, T4_MODEL } from './t4-attention.js';
export { buildT5Prompt, T5_MODEL } from './t5-brief.js';
