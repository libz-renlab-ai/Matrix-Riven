/**
 * Process-local TTL cache. Used by the leadership aggregator so that
 * many polling clients refreshing every 30s only trigger one disk-scan
 * per window. Not concurrent-safe across processes; collector-server
 * is a single Node process so that's fine.
 *
 * 2026-05-19 QA-5 ops P1: now also enforces a max-entries cap with
 * insertion-order eviction (FIFO, approximates LRU for the dashboard
 * workload where polling clients revisit the same keys). Without the
 * cap, attacker-controlled query strings (`?focus=u1`, `?focus=u2`,
 * …) on routes like `/api/overview` could grow the Map unboundedly,
 * since the cache key includes user-supplied filter values. Cap
 * defaults to 1024 entries — plenty for the documented "5–40 team"
 * scale where the working set is members × projects × range buckets
 * (worst case ~40 × 20 × 6 ≈ 4800, but real polling concentrates on
 * the default range so the working set is closer to ~200).
 */
export class TtlCache<T> {
  private store = new Map<string, { value: T; expiresAt: number }>();
  private readonly maxEntries: number;

  constructor(
    private readonly ttlMs: number,
    nowOrOpts?: (() => number) | { maxEntries?: number; now?: () => number },
    legacyOpts?: { maxEntries?: number },
  ) {
    // Backwards-compatible signature:
    //   new TtlCache(ttl)
    //   new TtlCache(ttl, now)                            ← legacy (3 tests, mock-server.ts)
    //   new TtlCache(ttl, { maxEntries, now })            ← new
    if (typeof nowOrOpts === 'function') {
      this.now = nowOrOpts;
      this.maxEntries = legacyOpts?.maxEntries ?? 1024;
    } else if (nowOrOpts && typeof nowOrOpts === 'object') {
      this.now = nowOrOpts.now ?? (() => Date.now());
      this.maxEntries = nowOrOpts.maxEntries ?? 1024;
    } else {
      this.now = () => Date.now();
      this.maxEntries = 1024;
    }
  }

  private readonly now: () => number;

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (this.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    // Re-set should preserve "most recent" position — delete then add.
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });
    // FIFO eviction once over capacity. Map.keys() yields insertion
    // order, so the first key is the oldest — drop it.
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
