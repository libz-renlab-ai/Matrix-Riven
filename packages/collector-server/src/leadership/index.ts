/**
 * P-D1 — On-disk session index for fast cold start.
 *
 * Stored at `<dir>/.leadership-index.json`. Each entry points to a session
 * file (envelope `.json` or raw `.jsonl`). The index lets `scanAllSessions`
 * skip directory enumeration + per-file stat on every poll, and lets the
 * server come up without doing a synchronous full scan on first request.
 *
 * Lifecycle:
 *   - Built once at server start when missing (async, non-blocking).
 *   - Appended after every successful POST /v1/cc-sessions write.
 *   - Consulted first by scanAllSessions; mtime mismatch or missing entry
 *     falls back to the legacy directory-walk path.
 *
 * Robustness:
 *   - Atomic write via `.tmp.<pid>` + rename so partial writes never expose
 *     a corrupt index to the next reader.
 *   - rebuildIndex reads only the first 4 KB of each file for the metadata
 *     parse, so even multi-MB transcripts don't dominate rebuild time.
 *   - All read failures degrade to "no index, fall back" instead of throwing.
 */

import { promises as fs, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Dirent } from 'node:fs';

export interface IndexEntry {
  /** Session id (envelope.session_id, or filename stem as fallback). */
  sessionId: string;
  /** Path to the session file, *relative to the index directory*. */
  file: string;
  /** mtime in milliseconds since epoch — used to detect stale entries. */
  mtime: number;
  /** ISO-8601 capture timestamp from the envelope, or file mtime fallback. */
  capturedAt: string;
}

export interface SessionIndex {
  version: 1;
  builtAt: string;
  entries: IndexEntry[];
}

/** Filename of the on-disk index. Kept here so callers never duplicate it. */
export const INDEX_FILENAME = '.leadership-index.json';

/** Maximum bytes read from each file during rebuild for the first-line parse. */
const FIRSTLINE_PROBE_BYTES = 4096;

/**
 * Load the index from disk. Returns an empty (but well-formed) SessionIndex
 * when the file is missing, unreadable, or has a wrong shape — callers can
 * treat the result as authoritative without further guards.
 */
export async function loadIndex(dir: string): Promise<SessionIndex> {
  try {
    const buf = await fs.readFile(join(dir, INDEX_FILENAME), 'utf-8');
    const parsed = JSON.parse(buf) as Partial<SessionIndex> | null;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      return emptyIndex();
    }
    return {
      version: 1,
      builtAt: typeof parsed.builtAt === 'string' ? parsed.builtAt : new Date().toISOString(),
      entries: parsed.entries.filter(isIndexEntry),
    };
  } catch {
    return emptyIndex();
  }
}

/**
 * Walk `dir` (non-recursively) and rebuild the index from scratch. Skips the
 * index file itself plus any non-`.json` / non-`.jsonl` entries. The result is
 * persisted via an atomic tmp+rename write.
 */
export async function rebuildIndex(dir: string): Promise<SessionIndex> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return emptyIndex();
  }
  const candidates = names.filter(
    (n) => n !== INDEX_FILENAME && (n.endsWith('.json') || n.endsWith('.jsonl')),
  );
  const entries: IndexEntry[] = [];
  for (const name of candidates) {
    const entry = await buildEntry(dir, name);
    if (entry) entries.push(entry);
  }
  const idx: SessionIndex = {
    version: 1,
    builtAt: new Date().toISOString(),
    entries,
  };
  await writeAtomic(dir, idx);
  return idx;
}

/**
 * Synchronous flavour of {@link loadIndex} for hot paths that can't easily
 * become async (notably the legacy sync `scanAllSessions` consumer chain).
 * Same robustness guarantees: empty index on any read / parse failure.
 */
export function loadIndexSync(dir: string): SessionIndex {
  try {
    const buf = readFileSync(join(dir, INDEX_FILENAME), 'utf-8');
    const parsed = JSON.parse(buf) as Partial<SessionIndex> | null;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      return emptyIndex();
    }
    return {
      version: 1,
      builtAt: typeof parsed.builtAt === 'string' ? parsed.builtAt : new Date().toISOString(),
      entries: parsed.entries.filter(isIndexEntry),
    };
  } catch {
    return emptyIndex();
  }
}

/**
 * Append a single entry to the on-disk index. Idempotent on `sessionId` —
 * duplicate appends are silently ignored so the POST handler can call this
 * unconditionally after each write without worrying about retries.
 */
export async function appendIndex(dir: string, entry: IndexEntry): Promise<void> {
  const idx = await loadIndex(dir);
  if (idx.entries.some((e) => e.sessionId === entry.sessionId)) return;
  idx.entries.push(entry);
  idx.builtAt = new Date().toISOString();
  await writeAtomic(dir, idx);
}

/**
 * Walk the collector-server output tree (`<root>/<user>/<date>/`) and rebuild
 * the index for every leaf date directory that doesn't already have one.
 *
 * Used by the server bootstrap to warm the index on first launch without
 * blocking `listen()` (callers fire this from `setImmediate`). Already-indexed
 * leaves are left alone — the per-POST `appendIndex` keeps them current.
 */
export async function rebuildAllIndexes(rootDir: string): Promise<{ leaves: number }> {
  let leaves = 0;
  let userEntries: Dirent[];
  try {
    userEntries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch {
    return { leaves: 0 };
  }
  for (const u of userEntries) {
    if (!u.isDirectory()) continue;
    const userPath = join(rootDir, u.name);
    let dateEntries: Dirent[];
    try {
      dateEntries = await fs.readdir(userPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of dateEntries) {
      if (!d.isDirectory()) continue;
      const leafPath = join(userPath, d.name);
      // Only rebuild when no index exists — skip leaves we've already warmed.
      const existing = await loadIndex(leafPath);
      if (existing.entries.length > 0) continue;
      await rebuildIndex(leafPath);
      leaves += 1;
    }
  }
  return { leaves };
}

// ── internal helpers ──────────────────────────────────────────────────────────

function emptyIndex(): SessionIndex {
  return { version: 1, builtAt: new Date().toISOString(), entries: [] };
}

function isIndexEntry(v: unknown): v is IndexEntry {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.sessionId === 'string' &&
    typeof o.file === 'string' &&
    typeof o.mtime === 'number' &&
    Number.isFinite(o.mtime) &&
    typeof o.capturedAt === 'string'
  );
}

/**
 * Probe a single candidate file and synthesise an IndexEntry. Reads only the
 * first 4 KB to keep rebuild O(files) regardless of average transcript size.
 * Returns null if the file disappears or can't be parsed at all — callers
 * skip and continue (one corrupt file must not abort the whole rebuild).
 */
async function buildEntry(dir: string, name: string): Promise<IndexEntry | null> {
  const full = join(dir, name);
  let fh: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    const st = await fs.stat(full);
    fh = await fs.open(full, 'r');
    const probe = Buffer.alloc(FIRSTLINE_PROBE_BYTES);
    const { bytesRead } = await fh.read(probe, 0, FIRSTLINE_PROBE_BYTES, 0);
    const firstLine =
      probe.toString('utf-8', 0, bytesRead).split('\n')[0] ?? '';
    let meta: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(firstLine);
      if (parsed && typeof parsed === 'object') {
        meta = parsed as Record<string, unknown>;
      }
    } catch {
      // First line wasn't parseable JSON — keep meta empty and fall back to
      // filename-stem / mtime defaults below.
    }
    const envBlock = meta.envelope as Record<string, unknown> | undefined;
    const sessionId =
      pickString(meta.sessionId) ??
      pickString(meta.session_id) ??
      pickString(envBlock?.session_id) ??
      pickString(envBlock?.sessionId) ??
      name.replace(/\.(json|jsonl)$/, '');
    const capturedAt =
      pickString(meta.captured_at) ??
      pickString(meta.capturedAt) ??
      pickString(meta.ts) ??
      pickString(envBlock?.captured_at) ??
      new Date(st.mtimeMs).toISOString();
    return {
      sessionId,
      file: name,
      mtime: st.mtimeMs,
      capturedAt,
    };
  } catch {
    return null;
  } finally {
    if (fh) {
      try {
        await fh.close();
      } catch {
        /* best-effort */
      }
    }
  }
}

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Write the index to `<dir>/.leadership-index.json` via tmp + rename. POSIX
 * guarantees rename is atomic within a filesystem; on Windows we fall back to
 * unlink-and-rename when the target already exists.
 */
async function writeAtomic(dir: string, idx: SessionIndex): Promise<void> {
  const target = join(dir, INDEX_FILENAME);
  const tmp = join(
    dir,
    `${INDEX_FILENAME}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`,
  );
  await fs.writeFile(tmp, JSON.stringify(idx));
  try {
    await fs.rename(tmp, target);
  } catch {
    // Windows: rename can fail if target exists. Fall back to unlink + rename.
    try {
      await fs.unlink(target);
    } catch {
      /* target may not exist */
    }
    await fs.rename(tmp, target);
  }
}
