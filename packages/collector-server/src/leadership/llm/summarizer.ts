/**
 * Tier summarizer orchestrator (L-7).
 *
 * Each `summarize*` function composes the Wave-1 modules — cache, redactor,
 * prompts, local-claude-client — into a single pipeline:
 *
 *   1. Compute a deterministic cache key per input (SHA-1 over canonical JSON).
 *   2. Partition inputs into cache hits vs misses.
 *   3. All-hit (or `cacheOnly`) → return early without an LLM call.
 *   4. Redact PII in miss-input string fields, build the batched prompt.
 *   5. Call `runLocalClaude`. Validate the JSON shape; cache + return valid
 *      rows. Malformed rows are dropped quietly with a single `console.warn`.
 *
 * Two paths are supported by the same code:
 *   - Worker path (`cacheOnly` undefined/false) — does the LLM round-trip and
 *     fills the cache. Run on a background interval.
 *   - Render path (`cacheOnly: true`) — used by the aggregator to attach
 *     `llmText` fields synchronously without ever blocking on the LLM.
 *
 * Errors never throw out of these functions; the worst case is "return the
 * hits we have" so callers can safely fall back to template strings.
 *
 * See `docs/superpowers/specs/2026-05-17-llm-narrative-design.md` and
 * `docs/superpowers/plans/2026-05-17-llm-narrative.md` (§Wave 2 L-7).
 */

import type { LlmCache } from './cache.js';
import { runLocalClaude } from './local-claude-client.js';
import { redactForLLM } from './redact.js';
import {
  buildT1Prompt,
  buildT2Prompt,
  buildT3Prompt,
  buildT4Prompt,
  buildT5Prompt,
  T1_MODEL,
  T2_MODEL,
  T3_MODEL,
  T4_MODEL,
  T5_MODEL,
  type T1Input,
  type T2Input,
  type T3Input,
  type T4Input,
  type T5Input,
} from './prompts/index.js';
import {
  t1CacheKey,
  t2CacheKey,
  t3CacheKey,
  t4CacheKey,
  t5CacheKey,
} from './cache-keys.js';

const DEFAULT_TIMEOUT_MS = 60_000;

export interface SummarizerContext {
  cache: LlmCache;
  /** Skip LLM calls and return cache-only results (used by aggregator render path). Defaults false (worker path). */
  cacheOnly?: boolean;
  /** Model overrides; falls back to T*_MODEL constants. */
  tier1Model?: string;
  tier5Model?: string;
  /** Per-call timeout. Defaults 60000. */
  timeoutMs?: number;
}

// ---- shared parse + warn helpers --------------------------------------------

/**
 * Strip markdown noise around a JSON object. The local `claude -p` CLI often
 * wraps its answer in `​`​`​`json ... `​`​`​` fences plus prose, even when the system
 * prompt asks for raw JSON. We accept (a) a fenced block, otherwise (b) the
 * substring from the first `{` to the last `}`.
 */
function extractJsonBlock(raw: string): string {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) return fence[1].trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return raw.slice(start, end + 1);
  return raw;
}

function parseJsonOrWarn(tier: string, raw: string): unknown {
  try {
    return JSON.parse(extractJsonBlock(raw));
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown';
    console.warn(`[summarizer:${tier}] malformed JSON from LLM: ${reason}`);
    return undefined;
  }
}

function asResultsArray(parsed: unknown): unknown[] | undefined {
  if (parsed === null || typeof parsed !== 'object') return undefined;
  const obj = parsed as { results?: unknown };
  return Array.isArray(obj.results) ? obj.results : undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

// ---- redaction helpers -------------------------------------------------------

function redactT1(x: T1Input): T1Input {
  return {
    id: x.id,
    firstUserPrompt: redactForLLM(x.firstUserPrompt),
    changedFiles: x.changedFiles.map(redactForLLM),
    toolCounts: x.toolCounts,
    durationMin: x.durationMin,
    errors: x.errors,
  };
}

function redactT2(x: T2Input): T2Input {
  return {
    email: x.email,
    displayName: redactForLLM(x.displayName),
    state: x.state,
    topFiles: x.topFiles.map(redactForLLM),
    sessionDigests: x.sessionDigests.map(redactForLLM),
  };
}

function redactT3(x: T3Input): T3Input {
  return {
    project: x.project,
    phase: x.phase,
    contributors: x.contributors.map(redactForLLM),
    sessionDigests: x.sessionDigests.map(redactForLLM),
    recentCommits: x.recentCommits.map(redactForLLM),
  };
}

function redactT4(x: T4Input): T4Input {
  return {
    refId: x.refId,
    kind: x.kind,
    displayName: redactForLLM(x.displayName),
    signal: x.signal,
    evidence: x.evidence.map(redactForLLM),
  };
}

function redactT5(x: T5Input): T5Input {
  return {
    date: x.date,
    topHighlights: x.topHighlights.map(redactForLLM),
    attentionRewrites: x.attentionRewrites.map(redactForLLM),
    topProjects: x.topProjects.map((p) => ({
      name: p.name,
      digest: redactForLLM(p.digest),
    })),
  };
}

// ---- T1 — session digests ----------------------------------------------------

export async function summarizeSessions(
  sessions: T1Input[],
  ctx: SummarizerContext,
): Promise<Map<string, string>> {
  const hits = new Map<string, string>();
  const misses: Array<{ input: T1Input; key: string }> = [];
  for (const s of sessions) {
    const key = t1CacheKey(s);
    const cached = ctx.cache.get(key);
    if (cached !== undefined) {
      hits.set(s.id, cached);
    } else {
      misses.push({ input: s, key });
    }
  }
  if (misses.length === 0 || ctx.cacheOnly) return hits;

  const redactedInputs = misses.map((m) => redactT1(m.input));
  const prompt = buildT1Prompt(redactedInputs);
  const model = ctx.tier1Model ?? T1_MODEL;
  const response = await runLocalClaude({
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    model,
    timeoutMs: ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  if (!response.ok || !response.result) {
    console.warn(`[summarizer:t1] LLM call failed: ${response.error ?? 'unknown'}`);
    return hits;
  }
  const parsed = parseJsonOrWarn('t1', response.result);
  const rows = asResultsArray(parsed);
  if (!rows) {
    if (parsed !== undefined) {
      console.warn(`[summarizer:t1] missing or non-array "results" field`);
    }
    return hits;
  }

  // Index misses by id for O(1) lookup of the cache key.
  const keyById = new Map(misses.map((m) => [m.input.id, m.key]));
  const perItemCost = response.costUsd / Math.max(1, rows.length);
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue;
    const r = row as { id?: unknown; line?: unknown };
    const id = asString(r.id);
    const line = asString(r.line);
    if (!id || !line) continue;
    const key = keyById.get(id);
    if (!key) continue; // result for an id we didn't ask about
    await ctx.cache.put(key, line, perItemCost);
    hits.set(id, line);
  }
  return hits;
}

// ---- T2 — member-week digests -----------------------------------------------

export async function summarizeMembers(
  members: T2Input[],
  ctx: SummarizerContext,
): Promise<Map<string, string>> {
  const hits = new Map<string, string>();
  const misses: Array<{ input: T2Input; key: string }> = [];
  for (const m of members) {
    const key = t2CacheKey(m);
    const cached = ctx.cache.get(key);
    if (cached !== undefined) {
      hits.set(m.email, cached);
    } else {
      misses.push({ input: m, key });
    }
  }
  if (misses.length === 0 || ctx.cacheOnly) return hits;

  const redactedInputs = misses.map((mi) => redactT2(mi.input));
  const prompt = buildT2Prompt(redactedInputs);
  const model = ctx.tier1Model ?? T2_MODEL;
  const response = await runLocalClaude({
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    model,
    timeoutMs: ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  if (!response.ok || !response.result) {
    console.warn(`[summarizer:t2] LLM call failed: ${response.error ?? 'unknown'}`);
    return hits;
  }
  const parsed = parseJsonOrWarn('t2', response.result);
  const rows = asResultsArray(parsed);
  if (!rows) {
    if (parsed !== undefined) {
      console.warn(`[summarizer:t2] missing or non-array "results" field`);
    }
    return hits;
  }

  const keyByEmail = new Map(misses.map((m) => [m.input.email, m.key]));
  const perItemCost = response.costUsd / Math.max(1, rows.length);
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue;
    const r = row as { email?: unknown; line1?: unknown; line2?: unknown };
    const email = asString(r.email);
    const line1 = asString(r.line1);
    const line2 = asString(r.line2);
    if (!email || !line1 || !line2) continue;
    const key = keyByEmail.get(email);
    if (!key) continue;
    const value = `${line1}\n${line2}`;
    await ctx.cache.put(key, value, perItemCost);
    hits.set(email, value);
  }
  return hits;
}

// ---- T3 — project-week digests ----------------------------------------------

export async function summarizeProjects(
  projects: T3Input[],
  ctx: SummarizerContext,
): Promise<Map<string, string>> {
  const hits = new Map<string, string>();
  const misses: Array<{ input: T3Input; key: string }> = [];
  for (const p of projects) {
    const key = t3CacheKey(p);
    const cached = ctx.cache.get(key);
    if (cached !== undefined) {
      hits.set(p.project, cached);
    } else {
      misses.push({ input: p, key });
    }
  }
  if (misses.length === 0 || ctx.cacheOnly) return hits;

  const redactedInputs = misses.map((mi) => redactT3(mi.input));
  const prompt = buildT3Prompt(redactedInputs);
  const model = ctx.tier1Model ?? T3_MODEL;
  const response = await runLocalClaude({
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    model,
    timeoutMs: ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  if (!response.ok || !response.result) {
    console.warn(`[summarizer:t3] LLM call failed: ${response.error ?? 'unknown'}`);
    return hits;
  }
  const parsed = parseJsonOrWarn('t3', response.result);
  const rows = asResultsArray(parsed);
  if (!rows) {
    if (parsed !== undefined) {
      console.warn(`[summarizer:t3] missing or non-array "results" field`);
    }
    return hits;
  }

  const keyByProject = new Map(misses.map((m) => [m.input.project, m.key]));
  const perItemCost = response.costUsd / Math.max(1, rows.length);
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue;
    const r = row as { project?: unknown; line1?: unknown; line2?: unknown };
    const project = asString(r.project);
    const line1 = asString(r.line1);
    const line2 = asString(r.line2);
    if (!project || !line1 || !line2) continue;
    const key = keyByProject.get(project);
    if (!key) continue;
    const value = `${line1}\n${line2}`;
    await ctx.cache.put(key, value, perItemCost);
    hits.set(project, value);
  }
  return hits;
}

// ---- T4 — attention rewrites -------------------------------------------------

export async function summarizeAttention(
  items: T4Input[],
  ctx: SummarizerContext,
): Promise<Map<string, string>> {
  const hits = new Map<string, string>();
  const misses: Array<{ input: T4Input; key: string }> = [];
  for (const it of items) {
    const key = t4CacheKey(it);
    const cached = ctx.cache.get(key);
    if (cached !== undefined) {
      hits.set(it.refId, cached);
    } else {
      misses.push({ input: it, key });
    }
  }
  if (misses.length === 0 || ctx.cacheOnly) return hits;

  const redactedInputs = misses.map((mi) => redactT4(mi.input));
  const prompt = buildT4Prompt(redactedInputs);
  const model = ctx.tier1Model ?? T4_MODEL;
  const response = await runLocalClaude({
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    model,
    timeoutMs: ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  if (!response.ok || !response.result) {
    console.warn(`[summarizer:t4] LLM call failed: ${response.error ?? 'unknown'}`);
    return hits;
  }
  const parsed = parseJsonOrWarn('t4', response.result);
  const rows = asResultsArray(parsed);
  if (!rows) {
    if (parsed !== undefined) {
      console.warn(`[summarizer:t4] missing or non-array "results" field`);
    }
    return hits;
  }

  const keyByRef = new Map(misses.map((m) => [m.input.refId, m.key]));
  const perItemCost = response.costUsd / Math.max(1, rows.length);
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue;
    const r = row as { refId?: unknown; line?: unknown };
    const refId = asString(r.refId);
    const line = asString(r.line);
    if (!refId || !line) continue;
    const key = keyByRef.get(refId);
    if (!key) continue;
    await ctx.cache.put(key, line, perItemCost);
    hits.set(refId, line);
  }
  return hits;
}

// ---- T5 — daily brief --------------------------------------------------------

export async function summarizeDailyBrief(
  input: T5Input,
  ctx: SummarizerContext,
): Promise<string[]> {
  const key = t5CacheKey(input);
  const cached = ctx.cache.get(key);
  if (cached !== undefined) {
    try {
      const arr = JSON.parse(cached);
      if (Array.isArray(arr) && arr.every((x) => typeof x === 'string')) {
        return arr as string[];
      }
    } catch {
      // fall through — treat as miss and overwrite.
    }
  }
  if (ctx.cacheOnly) return [];

  const redacted = redactT5(input);
  const prompt = buildT5Prompt(redacted);
  const model = ctx.tier5Model ?? T5_MODEL;
  const response = await runLocalClaude({
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    model,
    timeoutMs: ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  if (!response.ok || !response.result) {
    console.warn(`[summarizer:t5] LLM call failed: ${response.error ?? 'unknown'}`);
    return [];
  }
  const parsed = parseJsonOrWarn('t5', response.result);
  if (parsed === undefined || parsed === null || typeof parsed !== 'object') {
    return [];
  }
  const obj = parsed as { briefLines?: unknown };
  if (!Array.isArray(obj.briefLines)) {
    console.warn(`[summarizer:t5] missing or non-array "briefLines" field`);
    return [];
  }
  const lines: string[] = [];
  for (const v of obj.briefLines) {
    if (typeof v === 'string' && v.length > 0) lines.push(v);
  }
  if (lines.length === 0) return [];
  await ctx.cache.put(key, JSON.stringify(lines), response.costUsd);
  return lines;
}
