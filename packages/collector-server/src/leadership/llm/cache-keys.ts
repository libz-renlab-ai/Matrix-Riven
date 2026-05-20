/**
 * Shared cache-key helpers for the LLM narrative tiers.
 *
 * Background: both the worker (`llm/summarizer.ts`) and the aggregator's
 * cache-only render path (`leadership/aggregator.ts → attachLlmFields`) need
 * to compute the SAME key for the SAME input — the worker writes by it, the
 * aggregator reads by it. Previously both modules carried byte-identical
 * copies of `stableStringify` + `t1Key..t5Key`; this module centralises them
 * so the contract can never drift.
 *
 * The bodies below are copied verbatim from the previous `summarizer.ts`
 * implementation so pre-existing on-disk cache entries (written by older
 * servers) remain valid.
 */

import { createHash } from 'node:crypto';
import type {
  T1Input,
  T2Input,
  T3Input,
  T4Input,
  T5Input,
} from './prompts/index.js';

/**
 * Stringify with object keys recursively sorted. Arrays preserve order (item
 * order is semantically meaningful for most of our inputs except where
 * upstream callers don't promise it — e.g. `changedFiles`, where reorder
 * shouldn't bust the cache). For arrays whose order is incidental we sort
 * them at the call site before computing the key.
 */
export function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const parts: string[] = value.map((v) => stableStringify(v));
    return `[${parts.join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts: string[] = keys.map(
      (k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`,
    );
    return `{${parts.join(',')}}`;
  }
  // undefined / function / symbol — treat as null so the key stays stable.
  return 'null';
}

function cacheKey(tier: string, payload: unknown): string {
  const hash = createHash('sha1').update(stableStringify(payload)).digest('hex').slice(0, 16);
  return `${tier}:${hash}`;
}

export function t1CacheKey(x: T1Input): string {
  // `changedFiles` order is incidental — sort so reordering can't bust cache.
  const sortedFiles = [...x.changedFiles].sort();
  return cacheKey('t1', {
    id: x.id,
    firstUserPrompt: x.firstUserPrompt,
    changedFiles: sortedFiles,
    toolCounts: x.toolCounts,
    durationMin: x.durationMin,
    errors: x.errors,
  });
}

export function t2CacheKey(x: T2Input): string {
  return cacheKey('t2', {
    email: x.email,
    displayName: x.displayName,
    state: x.state,
    topFiles: [...x.topFiles].sort(),
    sessionDigests: x.sessionDigests,
  });
}

export function t3CacheKey(x: T3Input): string {
  return cacheKey('t3', {
    project: x.project,
    phase: x.phase,
    contributors: [...x.contributors].sort(),
    sessionDigests: x.sessionDigests,
    recentCommits: x.recentCommits,
  });
}

export function t4CacheKey(x: T4Input): string {
  return cacheKey('t4', {
    refId: x.refId,
    kind: x.kind,
    displayName: x.displayName,
    signal: x.signal,
    evidence: x.evidence,
  });
}

export function t5CacheKey(x: T5Input): string {
  return cacheKey('t5', {
    date: x.date,
    topHighlights: x.topHighlights,
    attentionRewrites: x.attentionRewrites,
    topProjects: x.topProjects,
  });
}
