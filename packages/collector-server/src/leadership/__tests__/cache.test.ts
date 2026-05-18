import { describe, it, expect, vi } from 'vitest';
import { TtlCache } from '../cache.js';

describe('TtlCache', () => {
  it('returns cached value within TTL', () => {
    const now = vi.fn(() => 0);
    const c = new TtlCache<string>(30_000, now);
    c.set('k', 'hello');
    now.mockReturnValue(29_000);
    expect(c.get('k')).toBe('hello');
  });

  it('returns undefined after TTL', () => {
    const now = vi.fn(() => 0);
    const c = new TtlCache<string>(30_000, now);
    c.set('k', 'hello');
    now.mockReturnValue(30_001);
    expect(c.get('k')).toBeUndefined();
  });

  it('overwrite resets TTL', () => {
    const now = vi.fn(() => 0);
    const c = new TtlCache<string>(30_000, now);
    c.set('k', 'a');
    now.mockReturnValue(20_000);
    c.set('k', 'b');
    now.mockReturnValue(40_000);
    expect(c.get('k')).toBe('b');
  });

  it('different keys are independent', () => {
    const c = new TtlCache<string>(30_000);
    c.set('a', '1');
    c.set('b', '2');
    expect(c.get('a')).toBe('1');
    expect(c.get('b')).toBe('2');
  });
});
