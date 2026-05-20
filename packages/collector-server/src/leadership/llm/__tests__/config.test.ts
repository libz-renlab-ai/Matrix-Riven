import { describe, it, expect } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { readLlmConfig } from '../config.js';

const DEFAULTS = {
  enabled: false,
  dailyBudgetUsd: 5,
  tier1Model: 'claude-haiku-4-5-20251001',
  tier5Model: 'claude-sonnet-4-6',
  cacheDir: path.join(os.homedir(), '.matrix-riven', 'llm-cache'),
  workerIntervalMs: 5 * 60 * 1000,
  briefIntervalMs: 60 * 60 * 1000,
};

describe('readLlmConfig', () => {
  it('empty env → all defaults; enabled is false', () => {
    const cfg = readLlmConfig({});
    expect(cfg).toEqual(DEFAULTS);
    expect(cfg.enabled).toBe(false);
  });

  describe('LLM_ENABLED parsing', () => {
    const truthy = ['true', '1', 'yes', 'TRUE', 'YES', 'True', 'Yes'];
    for (const v of truthy) {
      it(`"${v}" → enabled true`, () => {
        expect(readLlmConfig({ LLM_ENABLED: v }).enabled).toBe(true);
      });
    }

    const falsy = ['0', 'false', 'no', 'garbage', '', 'truthy'];
    for (const v of falsy) {
      it(`"${v}" → enabled false`, () => {
        expect(readLlmConfig({ LLM_ENABLED: v }).enabled).toBe(false);
      });
    }

    it('undefined → enabled false', () => {
      expect(readLlmConfig({}).enabled).toBe(false);
    });
  });

  describe('LLM_DAILY_BUDGET_USD parsing', () => {
    it('valid number "12.5" → 12.5', () => {
      expect(readLlmConfig({ LLM_DAILY_BUDGET_USD: '12.5' }).dailyBudgetUsd).toBe(12.5);
    });

    it('"abc" → default 5', () => {
      expect(readLlmConfig({ LLM_DAILY_BUDGET_USD: 'abc' }).dailyBudgetUsd).toBe(5);
    });

    it('"-3" → default 5', () => {
      expect(readLlmConfig({ LLM_DAILY_BUDGET_USD: '-3' }).dailyBudgetUsd).toBe(5);
    });

    it('"0" → default 5 (must be > 0)', () => {
      expect(readLlmConfig({ LLM_DAILY_BUDGET_USD: '0' }).dailyBudgetUsd).toBe(5);
    });
  });

  describe('model overrides', () => {
    it('LLM_TIER1_MODEL=claude-haiku-x → exact string', () => {
      expect(readLlmConfig({ LLM_TIER1_MODEL: 'claude-haiku-x' }).tier1Model).toBe(
        'claude-haiku-x',
      );
    });

    it('LLM_TIER5_MODEL=claude-sonnet-99 → exact string', () => {
      expect(readLlmConfig({ LLM_TIER5_MODEL: 'claude-sonnet-99' }).tier5Model).toBe(
        'claude-sonnet-99',
      );
    });

    it('empty-string model env → default (treat as unset)', () => {
      const cfg = readLlmConfig({ LLM_TIER1_MODEL: '' });
      expect(cfg.tier1Model).toBe(DEFAULTS.tier1Model);
    });
  });

  describe('LLM_CACHE_DIR', () => {
    it('"/tmp/foo" → exact string', () => {
      expect(readLlmConfig({ LLM_CACHE_DIR: '/tmp/foo' }).cacheDir).toBe('/tmp/foo');
    });

    it('unset → homedir/.matrix-riven/llm-cache', () => {
      expect(readLlmConfig({}).cacheDir).toBe(
        path.join(os.homedir(), '.matrix-riven', 'llm-cache'),
      );
    });
  });

  describe('interval overrides', () => {
    it('LLM_WORKER_INTERVAL_MS=30000 → 30000', () => {
      expect(readLlmConfig({ LLM_WORKER_INTERVAL_MS: '30000' }).workerIntervalMs).toBe(30000);
    });

    it('LLM_BRIEF_INTERVAL_MS=120000 → 120000', () => {
      expect(readLlmConfig({ LLM_BRIEF_INTERVAL_MS: '120000' }).briefIntervalMs).toBe(120000);
    });

    it('LLM_WORKER_INTERVAL_MS=abc → default', () => {
      expect(readLlmConfig({ LLM_WORKER_INTERVAL_MS: 'abc' }).workerIntervalMs).toBe(
        DEFAULTS.workerIntervalMs,
      );
    });

    it('LLM_WORKER_INTERVAL_MS=-1 → default', () => {
      expect(readLlmConfig({ LLM_WORKER_INTERVAL_MS: '-1' }).workerIntervalMs).toBe(
        DEFAULTS.workerIntervalMs,
      );
    });

    it('LLM_BRIEF_INTERVAL_MS=0 → default', () => {
      expect(readLlmConfig({ LLM_BRIEF_INTERVAL_MS: '0' }).briefIntervalMs).toBe(
        DEFAULTS.briefIntervalMs,
      );
    });
  });

  it('combined env overrides compose correctly', () => {
    const cfg = readLlmConfig({
      LLM_ENABLED: 'yes',
      LLM_DAILY_BUDGET_USD: '2.5',
      LLM_TIER1_MODEL: 'h-x',
      LLM_TIER5_MODEL: 's-y',
      LLM_CACHE_DIR: '/var/cache/llm',
      LLM_WORKER_INTERVAL_MS: '1000',
      LLM_BRIEF_INTERVAL_MS: '2000',
    });
    expect(cfg).toEqual({
      enabled: true,
      dailyBudgetUsd: 2.5,
      tier1Model: 'h-x',
      tier5Model: 's-y',
      cacheDir: '/var/cache/llm',
      workerIntervalMs: 1000,
      briefIntervalMs: 2000,
    });
  });
});
