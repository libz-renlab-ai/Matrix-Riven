#!/usr/bin/env tsx
/**
 * L-13 smoke driver — runs exactly one LLM worker cycle against the frozen
 * real snapshot at `data/teamagent-logs-20260514-190026` and writes a
 * line-by-line evidence report to stdout.
 *
 * Usage:
 *   tsx scripts/smoke-llm-narrative.ts <cache-dir> <collector-dir>
 *
 * Exits 0 if all five tiers produced at least one cache entry, 1 otherwise.
 */
import { mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { LlmCache } from '../packages/collector-server/src/leadership/llm/cache.js';
import { readLlmConfig } from '../packages/collector-server/src/leadership/llm/config.js';
import { startWorker } from '../packages/collector-server/src/leadership/llm/worker.js';
import { collectWorkerInputs } from '../packages/collector-server/src/leadership/llm/inputs.js';

const cacheDir = process.argv[2];
const collectorDir = process.argv[3];
if (!cacheDir || !collectorDir) {
  console.error('usage: tsx scripts/smoke-llm-narrative.ts <cache-dir> <collector-dir>');
  process.exit(2);
}

await mkdir(cacheDir, { recursive: true });
const cacheFile = join(cacheDir, 'v1.jsonl');
const cache = new LlmCache(cacheFile);
await cache.load();

const cfg = readLlmConfig({
  ...process.env,
  LLM_ENABLED: 'true',
  LLM_DAILY_BUDGET_USD: process.env.LLM_DAILY_BUDGET_USD ?? '2',
  // briefInterval ≤ workerInterval so T5 fires on the first tick.
  LLM_WORKER_INTERVAL_MS: '60000',
  LLM_BRIEF_INTERVAL_MS: '60000',
  LLM_CACHE_DIR: cacheDir,
});

console.log(`[smoke] cache: ${cacheFile}`);
console.log(`[smoke] collector: ${collectorDir}`);
console.log(`[smoke] tier1Model=${cfg.tier1Model}  tier5Model=${cfg.tier5Model}`);
console.log(`[smoke] budget=$${cfg.dailyBudgetUsd}`);

const t0 = Date.now();
console.log(`[smoke] collecting inputs from real snapshot…`);
const inputs = await collectWorkerInputs({ collectorDir, now: () => new Date() });
if (!inputs) {
  console.error('[smoke] collectWorkerInputs returned null — no usable data');
  process.exit(1);
}
const SMOKE_T1_MAX = Number(process.env.SMOKE_T1_MAX ?? '30');
if (inputs.sessions.length > SMOKE_T1_MAX) {
  console.log(
    `[smoke] capping T1 from ${inputs.sessions.length} → ${SMOKE_T1_MAX} sessions to keep one batch under the 60s timeout`,
  );
  // Pick the most recent sessions — they're what the leader cares about anyway.
  inputs.sessions = inputs.sessions.slice(-SMOKE_T1_MAX);
}
console.log(
  `[smoke] inputs: t1=${inputs.sessions.length} t2=${inputs.members.length} ` +
    `t3=${inputs.projects.length} t4=${inputs.attention.length}`,
);

const worker = startWorker({
  cache,
  cfg,
  collectInputs: async () => inputs,
  log: (msg) => console.log(`[llm-worker] ${msg}`),
});

console.log(`[smoke] running one tick…`);
const result = await worker.runOnce();
worker.stop();

const dt = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`[smoke] tick done in ${dt}s — ok=${result.ok} reason=${result.reason ?? ''}`);
console.log(
  `[smoke] filled: t1=${result.filled.t1} t2=${result.filled.t2} t3=${result.filled.t3} ` +
    `t4=${result.filled.t4} t5=${result.filled.t5}`,
);
console.log(`[smoke] tick cost: $${result.costUsd.toFixed(4)}`);

interface RawEntry {
  key: string;
  value: string;
  costUsd: number;
  ts: number;
}

const raw = await readFile(cacheFile, 'utf8');
const entries: RawEntry[] = raw
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as RawEntry);
const byTier = new Map<string, RawEntry[]>();
for (const e of entries) {
  const tier = e.key.split(':')[0]!;
  byTier.set(tier, [...(byTier.get(tier) ?? []), e]);
}
const sizeBytes = (await stat(cacheFile)).size;
console.log(`[smoke] cache file: ${sizeBytes} bytes, ${entries.length} entries`);
for (const tier of ['t1', 't2', 't3', 't4', 't5']) {
  const list = byTier.get(tier) ?? [];
  const sample = list[0]?.value?.replace(/\n/g, ' | ').slice(0, 120) ?? '<none>';
  console.log(`[smoke]   ${tier}: ${list.length} entries — sample: ${sample}`);
}

const ok = ['t1', 't2', 't3', 't4', 't5'].every((t) => (byTier.get(t) ?? []).length > 0);
process.exit(ok ? 0 : 1);
