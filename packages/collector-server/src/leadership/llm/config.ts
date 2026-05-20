/**
 * LLM narrative layer config reader.
 *
 * Pure function — caller passes the env map in (typically `process.env`).
 * Returns a fully-defaulted `LlmConfig`. Invalid numeric envs (NaN, <= 0)
 * fall back to defaults so a typo in deploy config never crashes the worker.
 * See `docs/superpowers/specs/2026-05-17-llm-narrative-design.md`.
 */

import * as os from 'node:os';
import * as path from 'node:path';

export interface LlmConfig {
  enabled: boolean;
  dailyBudgetUsd: number;
  tier1Model: string;
  tier5Model: string;
  cacheDir: string;
  workerIntervalMs: number;
  briefIntervalMs: number;
}

const DEFAULT_TIER1_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_TIER5_MODEL = 'claude-sonnet-4-6';
const DEFAULT_DAILY_BUDGET_USD = 5;
const DEFAULT_WORKER_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_BRIEF_INTERVAL_MS = 60 * 60 * 1000;

function parseBool(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const v = raw.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function parseString(raw: string | undefined, fallback: string): string {
  if (raw === undefined || raw === '') return fallback;
  return raw;
}

export function readLlmConfig(env: NodeJS.ProcessEnv): LlmConfig {
  return {
    enabled: parseBool(env.LLM_ENABLED),
    dailyBudgetUsd: parsePositiveNumber(env.LLM_DAILY_BUDGET_USD, DEFAULT_DAILY_BUDGET_USD),
    tier1Model: parseString(env.LLM_TIER1_MODEL, DEFAULT_TIER1_MODEL),
    tier5Model: parseString(env.LLM_TIER5_MODEL, DEFAULT_TIER5_MODEL),
    cacheDir: parseString(env.LLM_CACHE_DIR, path.join(os.homedir(), '.matrix-riven', 'llm-cache')),
    workerIntervalMs: parsePositiveNumber(
      env.LLM_WORKER_INTERVAL_MS,
      DEFAULT_WORKER_INTERVAL_MS,
    ),
    briefIntervalMs: parsePositiveNumber(env.LLM_BRIEF_INTERVAL_MS, DEFAULT_BRIEF_INTERVAL_MS),
  };
}
