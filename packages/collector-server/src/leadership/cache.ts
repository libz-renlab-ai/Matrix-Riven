/**
 * Process-local TTL cache. Used by the leadership aggregator so that
 * many polling clients refreshing every 30s only trigger one disk-scan
 * per window. Not concurrent-safe across processes; collector-server
 * is a single Node process so that's fine.
 */
export class TtlCache<T> {
  private store = new Map<string, { value: T; expiresAt: number }>();
  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

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
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  clear(): void {
    this.store.clear();
  }
}
