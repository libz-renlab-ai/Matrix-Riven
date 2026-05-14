import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  claudeCredentialsPath,
  loadOAuthCredentials,
  loadQuotaCache,
  saveQuotaCache,
  markStale,
  type FsReadDeps,
  type FsWriteDeps,
} from '../state.js';
import type { CcSessionQuotaBlock } from '@matrix-riven/shared';

const HOME = '/fake/home';

function sampleQuota(overrides: Partial<CcSessionQuotaBlock> = {}): CcSessionQuotaBlock {
  return {
    subscription_tier: 'max/default_claude_max_20x',
    five_hour_utilization: 0.42,
    seven_day_utilization: 0.13,
    five_hour_reset_at: 1_730_000_000,
    seven_day_reset_at: 1_730_500_000,
    probed_at: '2026-05-11T00:00:00.000Z',
    stale: false,
    ...overrides,
  };
}

describe('claudeCredentialsPath', () => {
  it('returns <home>/.claude/.credentials.json', () => {
    expect(claudeCredentialsPath(HOME)).toBe(join(HOME, '.claude', '.credentials.json'));
  });
});

describe('loadOAuthCredentials', () => {
  it('returns null when the credentials file does not exist', () => {
    const deps: FsReadDeps = {
      existsSync: () => false,
      readFileSync: () => {
        throw new Error('should not be called');
      },
    };
    expect(loadOAuthCredentials(HOME, deps)).toBeNull();
  });

  it('parses a valid credentials file with claudeAiOauth block', () => {
    const expiresAt = 1_730_000_000_000;
    const payload = {
      claudeAiOauth: {
        accessToken: 'sk-ant-oat01-redacted',
        subscriptionType: 'max',
        rateLimitTier: 'default_claude_max_20x',
        expiresAt,
      },
    };
    const deps: FsReadDeps = {
      existsSync: () => true,
      readFileSync: () => JSON.stringify(payload),
    };
    const result = loadOAuthCredentials(HOME, deps);
    expect(result).not.toBeNull();
    expect(result!.accessToken).toBe('sk-ant-oat01-redacted');
    expect(result!.tier).toBe('max/default_claude_max_20x');
    expect(result!.expiresAt).toBe(expiresAt);
  });

  it('returns null when JSON is malformed', () => {
    const deps: FsReadDeps = {
      existsSync: () => true,
      readFileSync: () => 'not json',
    };
    expect(loadOAuthCredentials(HOME, deps)).toBeNull();
  });

  it('returns null when claudeAiOauth block is missing', () => {
    const deps: FsReadDeps = {
      existsSync: () => true,
      readFileSync: () => JSON.stringify({ someOtherKey: { accessToken: 'x' } }),
    };
    expect(loadOAuthCredentials(HOME, deps)).toBeNull();
  });

  it('returns null when accessToken is missing or non-string', () => {
    const depsMissing: FsReadDeps = {
      existsSync: () => true,
      readFileSync: () =>
        JSON.stringify({ claudeAiOauth: { subscriptionType: 'max', rateLimitTier: 'x' } }),
    };
    expect(loadOAuthCredentials(HOME, depsMissing)).toBeNull();

    const depsNonString: FsReadDeps = {
      existsSync: () => true,
      readFileSync: () =>
        JSON.stringify({
          claudeAiOauth: {
            accessToken: 12345,
            subscriptionType: 'max',
            rateLimitTier: 'x',
          },
        }),
    };
    expect(loadOAuthCredentials(HOME, depsNonString)).toBeNull();
  });
});

describe('loadQuotaCache', () => {
  it('returns null when the cache file does not exist', () => {
    const deps: FsReadDeps = {
      existsSync: () => false,
      readFileSync: () => {
        throw new Error('should not be called');
      },
    };
    expect(loadQuotaCache('/no/such/file.json', deps)).toBeNull();
  });

  it('round-trips a valid CcSessionQuotaBlock via saveQuotaCache + loadQuotaCache', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dt-state-'));
    const file = join(dir, 'nested', 'quota-cache.json');
    const quota = sampleQuota();
    saveQuotaCache(file, quota);
    const loaded = loadQuotaCache(file);
    expect(loaded).toEqual(quota);
  });

  it('returns null when JSON parses but shape is wrong', () => {
    const depsEmpty: FsReadDeps = {
      existsSync: () => true,
      readFileSync: () => JSON.stringify({}),
    };
    expect(loadQuotaCache('/x.json', depsEmpty)).toBeNull();

    const depsBadField: FsReadDeps = {
      existsSync: () => true,
      readFileSync: () =>
        JSON.stringify({
          subscription_tier: 'max/x',
          five_hour_utilization: 'not a number',
          seven_day_utilization: 0.1,
          five_hour_reset_at: 1,
          seven_day_reset_at: 2,
          probed_at: 'iso',
          stale: false,
        }),
    };
    expect(loadQuotaCache('/x.json', depsBadField)).toBeNull();
  });

  it('returns null when file content is malformed JSON', () => {
    const deps: FsReadDeps = {
      existsSync: () => true,
      readFileSync: () => '{ not valid json',
    };
    expect(loadQuotaCache('/x.json', deps)).toBeNull();
  });
});

describe('saveQuotaCache', () => {
  it('creates the parent dir and writes JSON (round-trip via real tmp dir)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dt-state-'));
    const file = join(dir, 'a', 'b', 'c', 'quota-cache.json');
    const quota = sampleQuota({ stale: true });
    saveQuotaCache(file, quota);
    const loaded = loadQuotaCache(file);
    expect(loaded).toEqual(quota);
  });

  it('swallows errors when fs throws', () => {
    const deps: FsWriteDeps = {
      mkdirSync: () => {
        /* no-op */
      },
      writeFileSync: () => {
        throw new Error('boom');
      },
    };
    expect(() => saveQuotaCache('/some/path.json', sampleQuota(), deps)).not.toThrow();
  });
});

describe('markStale', () => {
  it('returns a new object with stale=true when input is stale=false', () => {
    const fresh = sampleQuota({ stale: false });
    const result = markStale(fresh);
    expect(result.stale).toBe(true);
    // Original untouched.
    expect(fresh.stale).toBe(false);
  });

  it('returns the input as-is when already stale', () => {
    const already = sampleQuota({ stale: true });
    const result = markStale(already);
    expect(result.stale).toBe(true);
    expect(result).toBe(already);
  });
});
