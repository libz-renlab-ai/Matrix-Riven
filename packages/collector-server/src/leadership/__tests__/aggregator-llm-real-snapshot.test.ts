/**
 * L-12 — LLM real-snapshot validation.
 *
 * Pins the contract that the aggregator's cache-only render path attaches
 * `llm*` fields to the right entities when (and only when) the LLM cache
 * contains a matching key — exercised against the frozen Phase-1 snapshot at
 * `D:/0jingtong/Matrix-Riven/data/teamagent-logs-20260514-190026`.
 *
 *   1. Empty cache → all `llm*` fields are `undefined` (template fallback).
 *   2. Seed T1 keys for every session → at least one `highlight.llmDigest`
 *      lands and is the seeded line.
 *   3. Seed T2 keys for every member → every member's `llmWeekly` is the
 *      seeded `\n`-joined two-line string.
 *   4. Seed T3 keys for every project → every project's `llmWeekly` lands.
 *
 * `it.skipIf` keeps CI / fresh checkouts green when the snapshot is absent.
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  buildOverviewSnapshot,
  buildT1InputFromSession,
  buildT2InputForMember,
  buildT3InputForProject,
} from '../aggregator.js';
import { scanAllSessions, __resetParsedCacheForTests, resolveProjectIdentity } from '../transcript-loader.js';
import { LlmCache } from '../llm/cache.js';
import { t1CacheKey, t2CacheKey, t3CacheKey } from '../llm/cache-keys.js';
import type { DateRange, ParsedSession } from '../types.js';

const REAL_DIR = 'D:/0jingtong/Matrix-Riven/data/teamagent-logs-20260514-190026';
const SNAPSHOT_AVAILABLE = existsSync(REAL_DIR);

const NOW = new Date('2026-05-17T12:00:00Z');
const RANGE: DateRange = {
  start: new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000),
  end: NOW,
  label: '7d',
};
const TODAY = '2026-05-17';

async function makeTempCache(): Promise<{ cache: LlmCache; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'llm-real-snap-'));
  const cache = new LlmCache(join(dir, `${randomUUID()}.jsonl`));
  await cache.load();
  return { cache, dir };
}

function inRangeOnly(sessions: ParsedSession[]): ParsedSession[] {
  return sessions.filter((s) => s.startTs >= RANGE.start && s.startTs <= RANGE.end);
}

describe('aggregator LLM enrichment against real snapshot (L-12)', () => {
  it.skipIf(!SNAPSHOT_AVAILABLE)('empty llmCache leaves every llm* field undefined', async () => {
    __resetParsedCacheForTests();
    const sessions = scanAllSessions(REAL_DIR);
    const { cache, dir } = await makeTempCache();
    try {
      const snap = buildOverviewSnapshot({
        sessions,
        range: RANGE,
        now: NOW,
        collectorDir: REAL_DIR,
        llmCache: cache,
        today: TODAY,
      });
      for (const m of snap.members) expect(m.llmWeekly).toBeUndefined();
      for (const p of snap.projects) expect(p.llmWeekly).toBeUndefined();
      for (const a of snap.attention) expect(a.llmRewrite).toBeUndefined();
      for (const h of snap.highlights) expect(h.llmDigest).toBeUndefined();
      expect(snap.llmBrief).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!SNAPSHOT_AVAILABLE)('seeded T1 keys make at least one highlight.llmDigest land', async () => {
    __resetParsedCacheForTests();
    const sessions = scanAllSessions(REAL_DIR);
    const { cache, dir } = await makeTempCache();
    try {
      // Seed a synthetic T1 digest for every session in range. Aggregator's
      // T1 packer (`buildT1InputFromSession`) is shared with the worker's
      // input collector, so the key it recomputes during render-path lookup
      // matches what we put here.
      let seeded = 0;
      for (const s of inRangeOnly(sessions)) {
        const t1 = buildT1InputFromSession(s);
        if (!t1) continue;
        await cache.put(t1CacheKey(t1), `digest:${t1.id.slice(0, 8)}`, 0);
        seeded++;
      }
      expect(seeded).toBeGreaterThan(0);

      const snap = buildOverviewSnapshot({
        sessions,
        range: RANGE,
        now: NOW,
        collectorDir: REAL_DIR,
        llmCache: cache,
        today: TODAY,
      });

      // Highlights with a resolved session inside the project's session bucket
      // pick up `llmDigest`. Not every highlight has a matching session (the
      // milestone extractor can attribute commits to projects that lost their
      // exact session under noise filtering), so a soft floor is the right
      // shape — we just need the wiring to work for at least one row.
      const withDigest = snap.highlights.filter((h) => typeof h.llmDigest === 'string');
      expect(withDigest.length).toBeGreaterThan(0);
      for (const h of withDigest) {
        expect(h.llmDigest!).toMatch(/^digest:/);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!SNAPSHOT_AVAILABLE)('seeded T2 keys populate member.llmWeekly across all members', async () => {
    __resetParsedCacheForTests();
    const sessions = scanAllSessions(REAL_DIR);
    const { cache, dir } = await makeTempCache();
    try {
      // Peek the snapshot once with no cache to recover the aggregator's
      // exact member set + per-member session bucket.
      const peek = buildOverviewSnapshot({
        sessions,
        range: RANGE,
        now: NOW,
        collectorDir: REAL_DIR,
      });

      const inRange = inRangeOnly(sessions);
      const emptySessionsMap = new Map<string, string>(); // no T1 hits seeded
      let seeded = 0;
      for (const m of peek.members) {
        if (!m.email) continue;
        const memSessions = inRange.filter((s) => s.envelope.userId === m.email);
        const t2 = buildT2InputForMember(m, memSessions, emptySessionsMap);
        if (!t2) continue;
        await cache.put(t2CacheKey(t2), `周报-${t2.email}\n第二行`, 0);
        seeded++;
      }
      expect(seeded).toBeGreaterThan(0);

      const snap = buildOverviewSnapshot({
        sessions,
        range: RANGE,
        now: NOW,
        collectorDir: REAL_DIR,
        llmCache: cache,
        today: TODAY,
      });

      // Every member with an email should now carry the two-line llmWeekly
      // we seeded — the cache key on both ends is the same exported helper.
      const withLlm = snap.members.filter((m) => typeof m.llmWeekly === 'string');
      expect(withLlm.length).toBe(snap.members.filter((m) => !!m.email).length);
      for (const m of withLlm) {
        expect(m.llmWeekly!.split('\n')).toHaveLength(2);
        expect(m.llmWeekly!).toContain(`周报-${m.email}`);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!SNAPSHOT_AVAILABLE)('seeded T3 keys populate project.llmWeekly across all projects', async () => {
    __resetParsedCacheForTests();
    const sessions = scanAllSessions(REAL_DIR);
    const { cache, dir } = await makeTempCache();
    try {
      const peek = buildOverviewSnapshot({
        sessions,
        range: RANGE,
        now: NOW,
        collectorDir: REAL_DIR,
      });

      // Reproduce aggregator's byProject grouping: in-range sessions keyed by
      // `resolveProjectIdentity(envelope)`. We then look up each peeked
      // project's name in this map. Names that don't appear (project list is
      // post-filtered by noise / allow-list) are simply skipped — they won't
      // be queried by the render path either.
      const inRange = inRangeOnly(sessions);
      const byProject = new Map<string, ParsedSession[]>();
      for (const s of inRange) {
        const key = resolveProjectIdentity(s.envelope);
        const bucket = byProject.get(key) ?? [];
        bucket.push(s);
        byProject.set(key, bucket);
      }

      const emptySessionsMap = new Map<string, string>();
      let seeded = 0;
      for (const p of peek.projects) {
        if (!p.name) continue;
        const psess = byProject.get(p.name) ?? [];
        const t3 = buildT3InputForProject(p, psess, emptySessionsMap);
        if (!t3) continue;
        await cache.put(t3CacheKey(t3), `项目-${t3.project}\n收尾中`, 0);
        seeded++;
      }
      expect(seeded).toBeGreaterThan(0);

      const snap = buildOverviewSnapshot({
        sessions,
        range: RANGE,
        now: NOW,
        collectorDir: REAL_DIR,
        llmCache: cache,
        today: TODAY,
      });

      const withLlm = snap.projects.filter((p) => typeof p.llmWeekly === 'string');
      expect(withLlm.length).toBe(snap.projects.filter((p) => !!p.name).length);
      for (const p of withLlm) {
        expect(p.llmWeekly!.split('\n')).toHaveLength(2);
        expect(p.llmWeekly!).toContain(`项目-${p.name}`);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
