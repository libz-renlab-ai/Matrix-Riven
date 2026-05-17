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

import { mkdir, readFile, appendFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { dirname } from 'node:path';

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

  constructor(filePath: string) {
    this.filePath = filePath;
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
    this.loaded = true;
  }

  /** Sync in-mem read. Returns undefined if missing or never loaded. */
  get(key: string): string | undefined {
    return this.mem.get(key)?.value;
  }

  /**
   * Append a new entry to the JSONL file and update the in-mem Map.
   * Serialized via internal write lock to prevent torn writes across
   * overlapping concurrent calls.
   */
  async put(key: string, value: string, costUsd: number): Promise<void> {
    const entry: CacheEntry = { key, value, costUsd, ts: Date.now() };
    const line = JSON.stringify(entry) + '\n';

    // Chain onto the write lock so appends are sequential.
    const prev = this.writeLock;
    this.writeLock = prev
      .catch(() => undefined) // don't let one failure poison the chain
      .then(() => appendFile(this.filePath, line, 'utf8'));
    await this.writeLock;
    this.mem.set(key, entry);
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
