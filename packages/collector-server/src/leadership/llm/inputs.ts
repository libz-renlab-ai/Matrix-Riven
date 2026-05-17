/**
 * Worker input collector (L-11 follow-up).
 *
 * Bridges the disk → snapshot → T1..T5 inputs pipeline so the LLM narrative
 * worker can call one async function each tick and receive a fully packed
 * `WorkerInputs` payload. Pulls fresh sessions, builds the overview snapshot
 * via the aggregator's exported helpers, then maps each surface to its
 * tier-specific input shape using the SAME builders the aggregator's
 * cache-only render path uses. Reusing those builders is non-negotiable —
 * worker and aggregator MUST construct identical inputs so their cache
 * keys collide and the worker's writes hydrate the aggregator's reads.
 *
 * Returns `null` when there's nothing to summarise (no sessions in range, or
 * the snapshot produced zero members AND zero projects) so the worker can
 * short-circuit the tick with `reason: 'no_inputs'`.
 *
 * No LLM is called from here — this module just packages inputs.
 */

import type { WorkerInputs } from './worker.js';
import type { ParsedSession, DateRange } from '../types.js';
import { scanAllSessions, resolveProjectIdentity } from '../transcript-loader.js';
import {
  buildOverviewSnapshot,
  buildT1InputFromSession,
  buildT2InputForMember,
  buildT3InputForProject,
  buildT4InputForAttention,
  buildT5InputFromSnapshot,
} from '../aggregator.js';
import type { T1Input, T2Input, T3Input, T4Input } from './prompts/index.js';
import {
  t1CacheKey,
  t2CacheKey,
  t3CacheKey,
  t4CacheKey,
} from './cache-keys.js';

export interface CollectInputsDeps {
  /** Same directory the leadership routes scan — sessions are loaded relative to here. */
  collectorDir: string;
  /** Clock for the "now" point passed to the aggregator. */
  now: () => Date;
  /** ISO YYYY-MM-DD for the T5 cache key. Defaults to `now().toISOString().slice(0,10)`. */
  todayKey?: () => string;
}

/**
 * Default window matches the aggregator's standard `/api/overview` view —
 * trailing 7 days ending at `now`. Sessions whose `startTs` falls outside
 * are dropped by the aggregator's own range filter.
 */
const DEFAULT_WINDOW_DAYS = 7;

function defaultTodayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export async function collectWorkerInputs(
  deps: CollectInputsDeps,
): Promise<WorkerInputs | null> {
  const now = deps.now();
  const range: DateRange = {
    start: new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000),
    end: now,
    label: `${DEFAULT_WINDOW_DAYS}d`,
  };

  // `scanAllSessions` is the same loader the aggregator uses by default.
  // Pass the date window so we don't enumerate every leaf under collectorDir
  // — the inner `scanLeafDir` short-circuits on the date string comparison.
  const fromDate = range.start.toISOString().slice(0, 10);
  const toDate = range.end.toISOString().slice(0, 10);
  const sessions = scanAllSessions(deps.collectorDir, { fromDate, toDate });
  if (sessions.length === 0) return null;

  // Build the snapshot via the public aggregator entry. We pass the same
  // sessions back in (test-seam path) so the inner disk-scan doesn't repeat
  // the work we already did above.
  const snap = buildOverviewSnapshot({
    collectorDir: deps.collectorDir,
    range,
    now,
    sessions,
  });

  // Filter sessions to the snapshot's actual range — `buildOverviewSnapshot`
  // applies an inclusive `[range.start, range.end]` window internally; mirror
  // it here so the T1 list aligns with what the aggregator computed.
  const inRange = sessions.filter(
    (s) => s.startTs >= range.start && s.startTs <= range.end,
  );

  if (inRange.length === 0 && snap.members.length === 0 && snap.projects.length === 0) {
    return null;
  }

  // --- T1: every session in range ---------------------------------------------
  const t1Inputs: T1Input[] = [];
  const sessionsByEmail = new Map<string, ParsedSession[]>();
  const sessionsByProject = new Map<string, ParsedSession[]>();
  // sessionsMap: sessionId → digest. Empty at first; the worker writes T1
  // outputs to the cache (not this map). T2/T3 input builders read from it,
  // so they see empty digests until the next tick — that matches the
  // aggregator's render path which also sees empty digests on cold cache.
  const sessionsMap = new Map<string, string>();
  for (const s of inRange) {
    const t1 = buildT1InputFromSession(s);
    if (t1) t1Inputs.push(t1);

    // Group by user-email and project for the T2/T3 builders below.
    const email = s.envelope.userId;
    if (email) {
      const arr = sessionsByEmail.get(email) ?? [];
      arr.push(s);
      sessionsByEmail.set(email, arr);
    }
    const proj = resolveProjectIdentity(s.envelope);
    if (proj) {
      const arr = sessionsByProject.get(proj) ?? [];
      arr.push(s);
      sessionsByProject.set(proj, arr);
    }
  }

  // --- T2: one input per snapshot member --------------------------------------
  // Eager version uses empty sessionDigests; the `rebuildMembers` callback
  // below produces a populated version the worker can use after T1 fills.
  const t2Inputs: T2Input[] = [];
  for (const m of snap.members) {
    if (!m.email) continue;
    const memSessions = sessionsByEmail.get(m.email) ?? [];
    const t2 = buildT2InputForMember(m, memSessions, sessionsMap);
    if (t2) t2Inputs.push(t2);
  }

  // --- T3: one input per snapshot project -------------------------------------
  const t3Inputs: T3Input[] = [];
  for (const p of snap.projects) {
    if (!p.name) continue;
    const psess = sessionsByProject.get(p.name) ?? [];
    const t3 = buildT3InputForProject(p, psess, sessionsMap);
    if (t3) t3Inputs.push(t3);
  }

  // Hydrate a sessions→digest map from the cache, then re-run buildT2/T3 with
  // it. Same builders as the aggregator's render path, so the cache keys
  // collide exactly. Returns the rebuilt input list.
  const rebuildSessionsMap = (lookup: (key: string) => string | undefined): Map<string, string> => {
    const m = new Map<string, string>();
    for (const t1 of t1Inputs) {
      const v = lookup(t1CacheKey(t1));
      if (v !== undefined) m.set(t1.id, v);
    }
    return m;
  };
  const rebuildMembers = (lookup: (key: string) => string | undefined): T2Input[] => {
    const sm = rebuildSessionsMap(lookup);
    const out: T2Input[] = [];
    for (const m of snap.members) {
      if (!m.email) continue;
      const memSessions = sessionsByEmail.get(m.email) ?? [];
      const t2 = buildT2InputForMember(m, memSessions, sm);
      if (t2) out.push(t2);
    }
    return out;
  };
  const rebuildProjects = (lookup: (key: string) => string | undefined): T3Input[] => {
    const sm = rebuildSessionsMap(lookup);
    const out: T3Input[] = [];
    for (const p of snap.projects) {
      if (!p.name) continue;
      const psess = sessionsByProject.get(p.name) ?? [];
      const t3 = buildT3InputForProject(p, psess, sm);
      if (t3) out.push(t3);
    }
    return out;
  };

  // --- T4: one input per attention item ---------------------------------------
  const t4Inputs: T4Input[] = [];
  for (const it of snap.attention) {
    const t4 = buildT4InputForAttention(it);
    if (t4) t4Inputs.push(t4);
  }

  // --- T5: one daily-brief input ----------------------------------------------
  // Two paths:
  //   - `brief` (eager): built now with empty maps + `[]`, so a worker that
  //     doesn't use `rebuildBrief` (and the in-process unit tests) still get
  //     a serviceable T5 input without a second pass.
  //   - `rebuildBrief` (lazy): called by the worker AFTER T1/T3/T4 have
  //     filled the cache. The callback re-reads each tier's outputs via the
  //     supplied `lookup(key)` and rebuilds the T5 input with populated
  //     `sessionsMap` / `projectsMap` / `attentionRewrites`. This is what
  //     keeps the worker-write cache key aligned with the aggregator-read
  //     key — both sides see the same populated state.
  const todayKey = deps.todayKey ? deps.todayKey() : defaultTodayKey(now);
  const eagerBrief = buildT5InputFromSnapshot(
    snap,
    sessionsByProject,
    sessionsMap,
    new Map<string, string>(),
    [],
    todayKey,
  );

  const rebuildBrief = (lookup: (key: string) => string | undefined) => {
    const sessions = rebuildSessionsMap(lookup);
    // T3 was rebuilt with the populated sessionsMap above; use those
    // rebuilt inputs to recompute the T3 cache keys for projectsMap lookups.
    const projects = new Map<string, string>();
    for (const t3 of rebuildProjects(lookup)) {
      const v = lookup(t3CacheKey(t3));
      if (v !== undefined) projects.set(t3.project, v);
    }
    const attentionRewrites: string[] = [];
    for (const t4 of t4Inputs) {
      const v = lookup(t4CacheKey(t4));
      if (v !== undefined) attentionRewrites.push(v);
    }
    // `t2CacheKey` import isn't strictly needed for T5 (T5 doesn't read T2
    // narratives), but it's imported above for symmetry with the other
    // tiers — silence the lint warning by referencing it once.
    void t2CacheKey;
    return buildT5InputFromSnapshot(
      snap,
      sessionsByProject,
      sessions,
      projects,
      attentionRewrites,
      todayKey,
    );
  };

  return {
    sessions: t1Inputs,
    members: t2Inputs,
    projects: t3Inputs,
    attention: t4Inputs,
    brief: eagerBrief,
    rebuildMembers,
    rebuildProjects,
    rebuildBrief,
  };
}
