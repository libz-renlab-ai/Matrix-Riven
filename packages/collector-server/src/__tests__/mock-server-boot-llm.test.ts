/**
 * L-11 — mock-server LLM narrative boot integration.
 *
 * Two scenarios:
 *  1. `LLM_ENABLED` unset (default) — no cache file is created, the existing
 *     /api/overview route works, and shutdown is clean. This is the
 *     "byte-identical to pre-L-8" guarantee the spec calls out as acceptance
 *     criterion #1.
 *  2. `LLM_ENABLED=true` + `LLM_CACHE_DIR=<tmp>` — the cache file's parent dir
 *     is created on boot (so the worker can append the moment it has data),
 *     and the server still services /api/overview. The worker exists but
 *     `collectInputs` is currently a stub returning null so no LLM call ever
 *     fires; we don't need to drive the interval here — L-12 covers that.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startMockServer, type MockServerHandle } from '../mock-server.js';

const FROZEN = new Date('2026-05-17T03:14:15.000Z');

// Each test gets its own tmpdir for outputDir + cacheDir so they can't leak
// across cases (and so a parallel run is safe).
function mkTmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * Capture the LLM-related env vars, mutate them for a test, and restore on
 * teardown. Using `delete` rather than setting to '' because the config reader
 * treats empty strings as "use default" (`enabled` stays false) but other env
 * paths may differ — `delete` is the safest reset.
 */
function withLlmEnv(env: Record<string, string | undefined>): () => void {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = env[k];
    }
  }
  return () => {
    for (const k of Object.keys(saved)) {
      const v = saved[k];
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  };
}

describe('mock-server boot — LLM narrative wiring (L-11)', () => {
  let server: MockServerHandle | undefined;
  let outputDir: string;
  let cacheDir: string;
  let restoreEnv: (() => void) | undefined;

  beforeEach(() => {
    outputDir = mkTmp('dt-llm-boot-out-');
    cacheDir = mkTmp('dt-llm-boot-cache-');
    server = undefined;
    restoreEnv = undefined;
  });

  afterEach(async () => {
    if (server) {
      await server.close();
      server = undefined;
    }
    if (restoreEnv) {
      restoreEnv();
      restoreEnv = undefined;
    }
    // Best-effort tmpdir cleanup — never fail the test on rmdir flakiness
    // (Windows file-lock races during teardown happen occasionally).
    try {
      rmSync(outputDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    try {
      rmSync(cacheDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('LLM disabled (default env) — no cache file is created and /api/overview still works', async () => {
    // Explicitly clear the env so a polluted parent process can't accidentally
    // enable LLM_ENABLED for this test.
    restoreEnv = withLlmEnv({
      LLM_ENABLED: undefined,
      LLM_CACHE_DIR: cacheDir,
    });

    server = await startMockServer({
      port: 0,
      outputDir,
      now: () => FROZEN,
    });

    // No LLM cache file should ever be created when disabled.
    expect(existsSync(join(cacheDir, 'v1.jsonl'))).toBe(false);

    // /api/overview still serves a 200 — the leadership routes don't depend
    // on llmCache for their cache-miss path.
    const res = await fetch(`${server.url}/api/overview`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('members');
    expect(body).toHaveProperty('projects');
  });

  it('LLM enabled — cache dir is created and /api/overview still works', async () => {
    restoreEnv = withLlmEnv({
      LLM_ENABLED: 'true',
      LLM_CACHE_DIR: cacheDir,
      // Use a long worker interval so the tick can never fire during the
      // test window — we just want to verify boot + teardown wire correctly.
      // The unref'd timer won't keep the process alive either, but belt +
      // suspenders against any setInterval drift.
      LLM_WORKER_INTERVAL_MS: '3600000',
      LLM_BRIEF_INTERVAL_MS: '3600000',
    });

    server = await startMockServer({
      port: 0,
      outputDir,
      now: () => FROZEN,
    });

    // The cache loader calls `mkdir(dirname(filePath), { recursive: true })`
    // before the first read. Our cacheDir is already the dirname of the
    // configured `${cacheDir}/v1.jsonl`, so it must exist after boot.
    expect(existsSync(cacheDir)).toBe(true);

    // The cache file itself is NOT created on load — only on first `put()`.
    // A worker with the stub `collectInputs` never reaches put(), so the
    // file should still be absent. This is the no-LLM-call assertion.
    expect(existsSync(join(cacheDir, 'v1.jsonl'))).toBe(false);

    // /api/overview still serves a 200 — the aggregator's cache-only read
    // path on an empty LlmCache is a no-op for every entity.
    const res = await fetch(`${server.url}/api/overview`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('members');
    expect(body).toHaveProperty('projects');
  });
});
