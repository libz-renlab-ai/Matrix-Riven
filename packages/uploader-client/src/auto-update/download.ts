/**
 * HTTP GET each manifest file into `<stageDir>/<name>.new`, computing sha256
 * incrementally. On hash mismatch or any IO/HTTP error, the .new file is
 * unlinked.
 *
 * `fetch` is used (Node 22.5+ has it built-in). Streaming via ReadableStream
 * so a multi-MB bundle doesn't have to live in memory.
 */
import { createHash } from 'node:crypto';
import { createWriteStream, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { ClientManifestFile } from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export interface DownloadResult {
  ok: boolean;
  reason?: 'http' | 'sha256' | 'io' | 'aborted';
  detail?: string;
  /** Absolute path to the .new file (only when ok=true). */
  newPath?: string;
}

export async function downloadOneFile(
  baseUrl: string,
  stageDir: string,
  file: ClientManifestFile,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<DownloadResult> {
  const newPath = join(stageDir, `${file.name}.new`);
  const url = `${baseUrl.replace(/\/$/, '')}/v1/client-latest/files/${file.name}`;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, reason: 'http', detail: err instanceof Error ? err.message : String(err) };
  }
  clearTimeout(timer);
  if (!response.ok) {
    return { ok: false, reason: 'http', detail: `HTTP ${response.status}` };
  }
  if (!response.body) {
    return { ok: false, reason: 'http', detail: 'empty body' };
  }
  const hash = createHash('sha256');
  let bytes = 0;
  const fileStream = createWriteStream(newPath);
  try {
    const reader = response.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        hash.update(value);
        bytes += value.length;
        if (bytes > file.size + 1024) {
          // Hard guard: server returned more bytes than manifest declared.
          // Stop early to avoid runaway downloads. Sha will fail anyway.
          break;
        }
        const okWrite = fileStream.write(value);
        if (!okWrite) {
          await new Promise<void>((resolve) => fileStream.once('drain', () => resolve()));
        }
      }
    }
  } catch (err) {
    fileStream.destroy();
    try {
      unlinkSync(newPath);
    } catch {}
    return { ok: false, reason: 'io', detail: err instanceof Error ? err.message : String(err) };
  }
  // Round-3 review fix: an end() failure (disk full, fd closed mid-write,
  // Windows AV scan) used to be swallowed — sha256 would still compute over
  // already-hashed bytes and pass, leaving a TRUNCATED .new file. Now treat
  // end() failure as an IO error and unlink the partial.
  let endErr: NodeJS.ErrnoException | null = null;
  await new Promise<void>((resolve) => {
    fileStream.end((err: NodeJS.ErrnoException | null) => {
      endErr = err ?? null;
      resolve();
    });
  });
  if (endErr) {
    try { unlinkSync(newPath); } catch {}
    return {
      ok: false,
      reason: 'io',
      detail: `stream end failed: ${(endErr as NodeJS.ErrnoException).message ?? String(endErr)}`,
    };
  }
  const digest = hash.digest('hex');
  if (digest !== file.sha256) {
    try {
      unlinkSync(newPath);
    } catch {}
    return {
      ok: false,
      reason: 'sha256',
      detail: `expected ${file.sha256} got ${digest} (${bytes} bytes)`,
    };
  }
  return { ok: true, newPath };
}

/**
 * Download every file in the manifest. On the first failure, cleans up all
 * `.new` files already written. Returns the .new paths on success so the
 * caller can rename them atomically.
 */
export async function downloadAllFiles(
  baseUrl: string,
  stageDir: string,
  files: ClientManifestFile[],
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<{ ok: true; newPaths: string[] } | { ok: false; failed: ClientManifestFile; result: DownloadResult }> {
  const written: string[] = [];
  for (const f of files) {
    const r = await downloadOneFile(baseUrl, stageDir, f, opts);
    if (!r.ok || !r.newPath) {
      // Cleanup
      for (const p of written) {
        try {
          unlinkSync(p);
        } catch {}
      }
      return { ok: false, failed: f, result: r };
    }
    written.push(r.newPath);
  }
  return { ok: true, newPaths: written };
}
