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

  // --- T4: one input per attention item ---------------------------------------
  const t4Inputs: T4Input[] = [];
  for (const it of snap.attention) {
    const t4 = buildT4InputForAttention(it);
    if (t4) t4Inputs.push(t4);
  }

  // --- T5: one daily-brief input ----------------------------------------------
  // Pass empty projectsMap + attentionRewrites because the worker hasn't run
  // T2/T3/T4 yet on the first cycle. After the cache fills, the aggregator's
  // render-path constructs T5 with the same empty maps too (it reads from
  // cache, not from a live worker state), so the key alignment holds.
  const todayKey = deps.todayKey ? deps.todayKey() : defaultTodayKey(now);
  const briefInput = buildT5InputFromSnapshot(
    snap,
    sessionsByProject,
    sessionsMap,
    new Map<string, string>(),
    [],
    todayKey,
  );

  return {
    sessions: t1Inputs,
    members: t2Inputs,
    projects: t3Inputs,
    attention: t4Inputs,
    brief: briefInput,
  };
}
