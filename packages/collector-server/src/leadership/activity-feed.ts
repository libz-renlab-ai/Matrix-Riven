// Phase 3-B · Activity feed builder.
//
// Flatten the corpus of sessions + milestones into a unified time-descending
// event stream for the /activity tab. The focus filter (Phase 3-A) is applied
// before milestone extraction so an active filter narrows both the session
// and milestone halves uniformly.

import type {
  ParsedSession,
  ActivityEvent,
  ActivityFeedSnapshot,
  FocusFilter,
  DateRange,
} from './types.js';
import { applyFocusFilter } from './focus-filter.js';
import { extractMilestones } from './signals/project-health.js';
import { scanAllSessions, resolveProjectIdentity } from './transcript-loader.js';
import { redactForLLM } from './llm/redact.js';

export interface BuildActivityFeedInput {
  collectorDir: string;
  range: DateRange;
  filter?: FocusFilter;
  now: Date;
  /** Test seam — inject sessions instead of disk scan. */
  sessions?: ParsedSession[];
  /** Pagination — only events strictly older than this timestamp. */
  beforeTs?: Date;
  /** Page size. Default 100, max 500. */
  limit?: number;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * Build a time-descending feed of session and milestone events for the
 * Activity tab. The same focus filter the user clicked at the top of the
 * page narrows both halves uniformly so the stream stays coherent.
 */
export function buildActivityFeed(input: BuildActivityFeedInput): ActivityFeedSnapshot {
  const limit = Math.min(Math.max(1, input.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const allSessions = input.sessions ?? scanAllSessions(input.collectorDir);

  // Range slice — same semantics as buildOverviewSnapshot.
  let scoped = allSessions.filter(
    (s) => s.startTs >= input.range.start && s.startTs <= input.range.end,
  );

  // Focus filter (focus / project / range applied; state requires member context
  // which Activity doesn't carry — skip state at this layer, log a warning).
  if (input.filter) {
    scoped = applyFocusFilter(scoped, input.filter, input.now);
    if (input.filter.state) {
      // Activity can't apply state without an aggregator-style state pass.
      // Silently drop it — fall back to focus + project + range only.
    }
  }

  const events: ActivityEvent[] = [];

  // Session events — one per ParsedSession.
  for (const s of scoped) {
    const firstUserMessage = s.messages.find(
      (m) => m.role === 'user' && m.text.trim().length > 0 && !looksSystemInjected(m.text),
    );
    const totalTokens = s.tokens.input + s.tokens.output;
    const preview = firstUserMessage
      ? truncate(firstUserMessage.text.trim(), 120)
      : '（无 user prompt）';
    events.push({
      ts: s.startTs.toISOString(),
      type: 'session',
      by: s.envelope.userId,
      project: resolveProjectIdentity(s.envelope),
      summary: preview,
      detail: {
        sessionId: s.envelope.sessionId,
        tokens: totalTokens,
        durationMs: s.durationMs,
        promptFull: firstUserMessage ? truncate(firstUserMessage.text, 4000) : undefined,
      },
    });
  }

  // Milestone events — extract from bash invocations across the scoped set.
  const milestones = extractMilestones(scoped);
  for (const m of milestones) {
    const type = milestoneTypeOf(m.type);
    if (!type) continue;
    events.push({
      ts: m.ts,
      type,
      by: m.by,
      project: inferProjectForMilestone(scoped, m),
      summary: redactForLLM(milestoneSummary(m.detail)),
      detail: {},
    });
  }

  // Sort time-descending. Stable tie-break: sessions before milestones (so a
  // session that triggers a commit at the same ms sorts above the commit).
  events.sort((a, b) => {
    if (a.ts !== b.ts) return a.ts < b.ts ? 1 : -1;
    if (a.type !== b.type) {
      if (a.type === 'session') return -1;
      if (b.type === 'session') return 1;
    }
    return 0;
  });

  // Pagination cursor — strip events at or after `beforeTs`.
  let cursored = events;
  if (input.beforeTs) {
    const cutoff = input.beforeTs.toISOString();
    cursored = events.filter((e) => e.ts < cutoff);
  }

  // Slice to limit + decide hasMore.
  const sliced = cursored.slice(0, limit);
  const hasMore = cursored.length > limit;
  const nextCursor = hasMore ? sliced[sliced.length - 1]!.ts : undefined;

  const snapshot: ActivityFeedSnapshot = {
    schemaVersion: 1,
    range: {
      start: input.range.start.toISOString(),
      end: input.range.end.toISOString(),
      label: String(input.range.label),
    },
    events: sliced,
    hasMore,
    computedAt: input.now.toISOString(),
  };
  if (nextCursor) snapshot.nextCursor = nextCursor;
  if (input.filter) snapshot.appliedFilter = input.filter;
  return snapshot;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function milestoneTypeOf(t: 'commit' | 'push' | 'pr' | 'release' | 'tag'): ActivityEvent['type'] | null {
  switch (t) {
    case 'commit': return 'commit';
    case 'push': return 'push';
    case 'pr': return 'pr_open';
    case 'release': return 'release';
    case 'tag': return 'tag';
    default: return null;
  }
}

function milestoneSummary(detail: string): string {
  // Strip heredoc wrapper $(cat <<'EOF' ... EOF) if present.
  const trimmed = detail.replace(/\$\(cat\s+<<'?EOF'?\s*/i, '').replace(/EOF\s*\)/i, '');
  const firstLine = trimmed.split('\n').map((l) => l.trim()).filter(Boolean)[0] ?? '';
  return firstLine.length > 120 ? firstLine.slice(0, 120) + '…' : firstLine;
}

function inferProjectForMilestone(sessions: ParsedSession[], m: { ts: string; by: string }): string {
  // Find a session by the same user at roughly the same time; use its project.
  const sameUser = sessions.filter((s) => s.envelope.userId === m.by);
  if (sameUser.length === 0) return 'unknown';
  const mts = Date.parse(m.ts);
  let best: ParsedSession | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const s of sameUser) {
    const d = Math.abs(s.startTs.getTime() - mts);
    if (d < bestDelta) {
      bestDelta = d;
      best = s;
    }
  }
  return best ? resolveProjectIdentity(best.envelope) : 'unknown';
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function looksSystemInjected(text: string): boolean {
  const t = text.trimStart();
  if (!t) return true;
  if (/^<[a-z][a-z0-9_-]*[\s>]/i.test(t.slice(0, 60))) return true;
  if (t.startsWith('Caveat: The messages below were generated by the user')) return true;
  if (t.startsWith('Base directory for this skill:')) return true;
  if (t.startsWith('Stop hook feedback:')) return true;
  return false;
}
