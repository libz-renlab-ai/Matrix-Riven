/**
 * Tests for the shared cache-key helpers (`llm/cache-keys.ts`).
 *
 * These keys are the contract between the worker (which writes by them) and
 * the aggregator's cache-only render path (which reads by them). Drift in
 * either direction silently orphans cache entries, so the assertions below
 * pin both stability (same input → same key) and order-insensitivity for
 * inputs whose array order is incidental (changedFiles for T1, topFiles for
 * T2, contributors for T3).
 */

import { describe, it, expect } from 'vitest';
import {
  t1CacheKey,
  t2CacheKey,
  t3CacheKey,
  t4CacheKey,
  t5CacheKey,
} from '../cache-keys.js';
import type {
  T1Input,
  T2Input,
  T3Input,
  T4Input,
  T5Input,
} from '../prompts/index.js';

const FORMAT = /^t[1-5]:[0-9a-f]{16}$/;

function baseT1(overrides: Partial<T1Input> = {}): T1Input {
  return {
    id: 'sess-1',
    firstUserPrompt: 'fix the bug',
    changedFiles: ['a.ts', 'b.ts'],
    toolCounts: { edit: 1, bash: 2, read: 3, webFetch: 0 },
    durationMin: 5,
    errors: 0,
    ...overrides,
  };
}

function baseT2(overrides: Partial<T2Input> = {}): T2Input {
  return {
    email: 'alice@example.com',
    displayName: 'Alice',
    state: 'active',
    topFiles: ['src/a.ts', 'src/b.ts'],
    sessionDigests: ['did x', 'did y'],
    ...overrides,
  };
}

function baseT3(overrides: Partial<T3Input> = {}): T3Input {
  return {
    project: 'octo/widget',
    phase: '推进新功能',
    contributors: ['alice', 'bob'],
    sessionDigests: ['did x'],
    recentCommits: ['fix: thing'],
    ...overrides,
  };
}

function baseT4(overrides: Partial<T4Input> = {}): T4Input {
  return {
    refId: 'alice@example.com',
    kind: 'member',
    displayName: 'Alice',
    signal: 'stuck',
    evidence: ['卡在 status/page.tsx'],
    ...overrides,
  };
}

function baseT5(overrides: Partial<T5Input> = {}): T5Input {
  return {
    date: '2026-05-17',
    topHighlights: ['shipped foo', 'fixed bar'],
    attentionRewrites: ['alice needs help'],
    topProjects: [{ name: 'octo/widget', digest: 'shipping v1' }],
    ...overrides,
  };
}

describe('cache-keys — format', () => {
  it('every tier returns `t<N>:<16-hex>`', () => {
    expect(t1CacheKey(baseT1())).toMatch(FORMAT);
    expect(t2CacheKey(baseT2())).toMatch(FORMAT);
    expect(t3CacheKey(baseT3())).toMatch(FORMAT);
    expect(t4CacheKey(baseT4())).toMatch(FORMAT);
    expect(t5CacheKey(baseT5())).toMatch(FORMAT);
  });
});

describe('cache-keys — T1 (session digest)', () => {
  it('same input → same key', () => {
    expect(t1CacheKey(baseT1())).toBe(t1CacheKey(baseT1()));
  });

  it('different input → different key', () => {
    expect(t1CacheKey(baseT1())).not.toBe(
      t1CacheKey(baseT1({ id: 'sess-2' })),
    );
    expect(t1CacheKey(baseT1())).not.toBe(
      t1CacheKey(baseT1({ firstUserPrompt: 'different' })),
    );
    expect(t1CacheKey(baseT1())).not.toBe(
      t1CacheKey(baseT1({ durationMin: 99 })),
    );
  });

  it('reordering changedFiles → same key (order-agnostic)', () => {
    const k1 = t1CacheKey(baseT1({ changedFiles: ['a.ts', 'b.ts', 'c.ts'] }));
    const k2 = t1CacheKey(baseT1({ changedFiles: ['c.ts', 'a.ts', 'b.ts'] }));
    expect(k1).toBe(k2);
  });
});

describe('cache-keys — T2 (member week)', () => {
  it('same input → same key', () => {
    expect(t2CacheKey(baseT2())).toBe(t2CacheKey(baseT2()));
  });

  it('different input → different key', () => {
    expect(t2CacheKey(baseT2())).not.toBe(
      t2CacheKey(baseT2({ email: 'bob@example.com' })),
    );
    expect(t2CacheKey(baseT2())).not.toBe(
      t2CacheKey(baseT2({ state: 'needs_help' })),
    );
  });

  it('reordering topFiles → same key (order-agnostic)', () => {
    const k1 = t2CacheKey(baseT2({ topFiles: ['src/a.ts', 'src/b.ts'] }));
    const k2 = t2CacheKey(baseT2({ topFiles: ['src/b.ts', 'src/a.ts'] }));
    expect(k1).toBe(k2);
  });
});

describe('cache-keys — T3 (project week)', () => {
  it('same input → same key', () => {
    expect(t3CacheKey(baseT3())).toBe(t3CacheKey(baseT3()));
  });

  it('different input → different key', () => {
    expect(t3CacheKey(baseT3())).not.toBe(
      t3CacheKey(baseT3({ project: 'octo/other' })),
    );
    expect(t3CacheKey(baseT3())).not.toBe(
      t3CacheKey(baseT3({ phase: '收尾' })),
    );
  });

  it('reordering contributors → same key (order-agnostic)', () => {
    const k1 = t3CacheKey(baseT3({ contributors: ['alice', 'bob', 'carol'] }));
    const k2 = t3CacheKey(baseT3({ contributors: ['carol', 'bob', 'alice'] }));
    expect(k1).toBe(k2);
  });
});

describe('cache-keys — T4 (attention rewrite)', () => {
  it('same input → same key', () => {
    expect(t4CacheKey(baseT4())).toBe(t4CacheKey(baseT4()));
  });

  it('different input → different key', () => {
    expect(t4CacheKey(baseT4())).not.toBe(
      t4CacheKey(baseT4({ refId: 'bob@example.com' })),
    );
    expect(t4CacheKey(baseT4())).not.toBe(
      t4CacheKey(baseT4({ signal: 'risky_action' })),
    );
  });
});

describe('cache-keys — T5 (daily brief)', () => {
  it('same input → same key', () => {
    expect(t5CacheKey(baseT5())).toBe(t5CacheKey(baseT5()));
  });

  it('different input → different key', () => {
    expect(t5CacheKey(baseT5())).not.toBe(
      t5CacheKey(baseT5({ date: '2026-05-18' })),
    );
    expect(t5CacheKey(baseT5())).not.toBe(
      t5CacheKey(baseT5({ topHighlights: ['different'] })),
    );
  });
});
