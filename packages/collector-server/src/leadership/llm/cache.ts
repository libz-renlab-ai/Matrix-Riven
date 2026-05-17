/**
 * Disk-backed JSONL cache for LLM tier outputs.
 *
 * Layout: one JSON object per line — {key, value, costUsd, ts}. File is append-
 * only at runtime; `load()` compacts duplicates with last-write-wins into an
 * in-memory Map for sync reads. Lines that fail to parse are silently skipped
 * so a single corrupted append never poisons the whole cache. Concurrent
 * `put()` calls are serialized through an internal Promise chain so file writes
 * never interleave (Node's `fs.appendFile` is not atomic across overlapping
 * calls on all platforms).
 *
 * Used by the LLM narrative layer (T1–T5 summaries) — see
 * `docs/superpowers/specs/2026-05-17-llm-narrative-design.md`.
 */

import { mkdir, readFile, appendFile, writeFile, rename } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Soft on-disk cap for the JSONL cache file. When `put()` would push the file
 * past this size we drop oldest-ts entries until usage is back under
 * `EVICTION_TARGET_BYTES`, then rewrite the file from the in-mem Map so the
 * file size matches what's actually live. Per spec §Cache file
 * (`docs/superpowers/specs/2026-05-17-llm-narrative-design.md`).
 */
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB
const EVICTION_TARGET_BYTES = Math.floor(MAX_BYTES * 0.8); // shrink to 40 MB to avoid thrashing

export interface CacheEntry {
  key: string;
  value: string;
  costUsd: number;
  ts: number;
}

export interface CacheStats {
  entries: number;
  bytes: number;
  todayCostUsd: number;
}

export class LlmCache {
  private readonly filePath: string;
  private readonly mem = new Map<string, CacheEntry>();
  private writeLock: Promise<void> = Promise.resolve();
  private loaded = false;
  /** Running estimate of the file size in bytes. Initialised in `load()` and updated incrementally in `put()`. */
  private fileSizeBytes = 0;
  /** Optional override for the eviction cap — used by tests so a 50MB ceiling doesn't make every assertion 50MB long. */
  private readonly maxBytes: number;
  /** Optional override for the post-eviction target size; mirrors `maxBytes`. */
  private readonly evictTargetBytes: number;

  constructor(filePath: string, opts: { maxBytes?: number; evictTargetBytes?: number } = {}) {
    this.filePath = filePath;
    this.maxBytes = opts.maxBytes ?? MAX_BYTES;
    this.evictTargetBytes = opts.evictTargetBytes ?? Math.floor(this.maxBytes * 0.8);
  }

  /** Read JSONL file into in-mem Map. Missing file → empty. */
  async load(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    this.mem.clear();
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (err: unknown) {
      if (isENOENT(err)) {
        this.loaded = true;
        this.fileSizeBytes = 0;
        return;
      }
      throw err;
    }
    for (const line of raw.split('\n')) {
      if (line.length === 0) continue;
      const entry = tryParseEntry(line);
      if (entry) {
        this.mem.set(entry.key, entry); // last-write-wins
      }
    }
    this.fileSizeBytes = Buffer.byteLength(raw, 'utf8');
    this.loaded = true;
  }

  /** Sync in-mem read. Returns undefined if missing or never loaded. */
  get(key: string): string | undefined {
    return this.mem.get(key)?.value;
  }

  /**
   * Iterate the live cache keys (for ops endpoints / per-tier counts).
   * Returns a snapshot array so callers can read while puts happen.
   */
  keys(): string[] {
    return [...this.mem.keys()];
  }

  /**
   * Append a new entry to the JSONL file and update the in-mem Map.
   * Serialized via internal write lock to prevent torn writes across
   * overlapping concurrent calls.
   *
   * When the appended line would push the file past the 50 MB soft cap, we
   * evict oldest-`ts` entries from the in-mem Map until usage is back under
   * `evictTargetBytes` and rewrite the file atomically. This is a coarse
   * approximation of LRU using write-time rather than read-time, but the
   * cache is keyed by content-hash so a "freshly written" entry is also
   * "most relevant" — re-evicting it would just round-trip the cost.
   */
  async put(key: string, value: string, costUsd: number): Promise<void> {
    const entry: CacheEntry = { key, value, costUsd, ts: Date.now() };
    const line = JSON.stringify(entry) + '\n';
    const lineBytes = Buffer.byteLength(line, 'utf8');

    // Chain onto the write lock so appends + evictions are sequential.
    const prev = this.writeLock;
    this.writeLock = prev
      .catch(() => undefined) // don't let one failure poison the chain
      .then(async () => {
        // Update the Map first so eviction sees the new entry as a candidate
        // for "most recent" and won't immediately drop it.
        this.mem.set(key, entry);
        if (this.fileSizeBytes + lineBytes <= this.maxBytes) {
          await appendFile(this.filePath, line, 'utf8');
          this.fileSizeBytes += lineBytes;
          return;
        }
        // Over the cap — evict oldest entries down to evictTargetBytes, then
        // rewrite the file from the in-mem Map. The new entry is included in
        // the rewrite, so no separate append is needed.
        await this.evictAndCompact();
      });
    await this.writeLock;
  }

  /**
   * Drop oldest-`ts` entries from the in-mem Map until the projected file
   * size is under `evictTargetBytes`, then rewrite the JSONL file atomically
   * (write to `<file>.tmp`, then rename) so the on-disk view never appears
   * truncated mid-eviction.
   */
  private async evictAndCompact(): Promise<void> {
    const all = [...this.mem.values()].sort((a, b) => a.ts - b.ts);
    // Compute serialized size per entry so we can shrink toward the target.
    const sizes = all.map((e) => Buffer.byteLength(JSON.stringify(e) + '\n', 'utf8'));
    let total = sizes.reduce((sum, n) => sum + n, 0);
    let dropIdx = 0;
    while (total > this.evictTargetBytes && dropIdx < all.length - 1) {
      total -= sizes[dropIdx]!;
      this.mem.delete(all[dropIdx]!.key);
      dropIdx++;
    }
    const kept = all.slice(dropIdx);
    const body = kept.map((e) => JSON.stringify(e)).join('\n') + (kept.length > 0 ? '\n' : '');
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, body, 'utf8');
    await rename(tmp, this.filePath);
    this.fileSizeBytes = Buffer.byteLength(body, 'utf8');
  }

  /**
   * Snapshot: entry count, on-disk file size, and today's accumulated cost.
   * `todayCostUsd` sums entries whose `ts` falls in the local calendar day
   * containing the current wall clock.
   */
  stats(): CacheStats {
    const entries = this.mem.size;
    const bytes = safeStatSize(this.filePath);
    const { startMs, endMs } = todayBoundsLocal(new Date());
    let todayCostUsd = 0;
    for (const e of this.mem.values()) {
      if (e.ts >= startMs && e.ts < endMs) {
        todayCostUsd += e.costUsd;
      }
    }
    return { entries, bytes, todayCostUsd };
  }
}

function isENOENT(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'ENOENT'
  );
}

function tryParseEntry(line: string): CacheEntry | undefined {
  try {
    const obj = JSON.parse(line) as unknown;
    if (
      typeof obj === 'object' &&
      obj !== null &&
      typeof (obj as CacheEntry).key === 'string' &&
      typeof (obj as CacheEntry).value === 'string' &&
      typeof (obj as CacheEntry).costUsd === 'number' &&
      typeof (obj as CacheEntry).ts === 'number'
    ) {
      const e = obj as CacheEntry;
      return { key: e.key, value: e.value, costUsd: e.costUsd, ts: e.ts };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function todayBoundsLocal(now: Date): { startMs: number; endMs: number } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

/**
 * `stats()` is sync but the file size needs `fs.stat`. We use the sync version
 * to keep the surface ergonomic — the file is local and small (≤50MB cap).
 * Missing file → 0 bytes.
 */
function safeStatSize(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch (err) {
    if (isENOENT(err)) return 0;
    throw err;
  }
}
