import { describe, it, expect } from 'vitest';
import {
  backoffMs,
  shouldDeadLetter,
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
  DEAD_LETTER_AFTER_MS,
} from '../backoff.js';

describe('backoffMs', () => {
  it('returns 0 for failures < 1', () => {
    expect(backoffMs(0)).toBe(0);
    expect(backoffMs(-1)).toBe(0);
  });

  it('first failure returns base (30s)', () => {
    expect(backoffMs(1)).toBe(BASE_BACKOFF_MS);
    expect(backoffMs(1)).toBe(30_000);
  });

  it('doubles each failure: 30s, 60s, 120s, 240s', () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(3)).toBe(120_000);
    expect(backoffMs(4)).toBe(240_000);
  });

  it('caps at MAX_BACKOFF_MS (24h)', () => {
    expect(backoffMs(20)).toBe(MAX_BACKOFF_MS);
    expect(backoffMs(100)).toBe(MAX_BACKOFF_MS);
  });

  it('does not overflow', () => {
    const result = backoffMs(1000);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBe(MAX_BACKOFF_MS);
  });
});

describe('shouldDeadLetter', () => {
  it('returns false for an entry that has not failed yet (firstFailedAt = null)', () => {
    expect(shouldDeadLetter(null, new Date('2026-05-11T00:00:00Z'))).toBe(false);
  });

  it('returns false within the 24h window', () => {
    const firstFailedAt = '2026-05-10T00:00:00Z';
    expect(shouldDeadLetter(firstFailedAt, new Date('2026-05-10T00:00:00Z'))).toBe(false);
    expect(shouldDeadLetter(firstFailedAt, new Date('2026-05-10T12:00:00Z'))).toBe(false);
    expect(shouldDeadLetter(firstFailedAt, new Date('2026-05-10T23:59:59Z'))).toBe(false);
  });

  it('returns true at or beyond 24h since first failure', () => {
    const firstFailedAt = '2026-05-10T00:00:00Z';
    expect(shouldDeadLetter(firstFailedAt, new Date('2026-05-11T00:00:00Z'))).toBe(true);
    expect(shouldDeadLetter(firstFailedAt, new Date('2026-05-12T00:00:00Z'))).toBe(true);
  });

  it('returns false when firstFailedAt is unparseable', () => {
    expect(shouldDeadLetter('not-a-date', new Date('2026-05-11T00:00:00Z'))).toBe(false);
  });

  it('DEAD_LETTER_AFTER_MS is exactly 24h', () => {
    expect(DEAD_LETTER_AFTER_MS).toBe(24 * 60 * 60 * 1000);
  });
});
