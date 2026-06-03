/**
 * Phase 3-D · Insights aggregator.
 *
 * Composes all Insights sub-computers (health score / anomalies /
 * recommendations / 3 axes) into a single InsightsSnapshot. v1 is
 * rule-based — no LLM dependency — so the page works with LLM_ENABLED=false.
 * LLM narratives layer on top via t6-* cache lookups when available.
 */

import type {
  ParsedSession,
  OverviewSnapshot,
  InsightsSnapshot,
  InsightsHealthScore,
  InsightsAnomaly,
  InsightsRecommendation,
  InsightsTimeWeek,
  InsightsPersonRow,
  InsightsProjectRow,
  DateRange,
  FocusFilter,
} from '../types.js';

export interface BuildInsightsInput {
  collectorDir: string;
  range: DateRange;
  now: Date;
  /** Sessions in range — usually the same set that fed buildOverviewSnapshot. */
  sessions: ParsedSession[];
  /** Snapshot of the team for cross-reference (project list, member list). */
  snapshot: OverviewSnapshot;
  filter?: FocusFilter;
}

export function buildInsightsSnapshot(input: BuildInsightsInput): InsightsSnapshot {
  const healthScore = computeHealthScore(input.snapshot, input.sessions, input.now);
  const anomalies = detectAnomalies(input.snapshot, input.sessions, input.now);
  const recommendations = generateRecommendations(input.snapshot, anomalies);
  const axes = {
    time: { weeks: buildTimeAxis(input.sessions, input.now) },
    people: { rows: buildPeopleAxis(input.snapshot, input.sessions) },
    projects: { rows: buildProjectsAxis(input.snapshot) },
  };

  const snap: InsightsSnapshot = {
    schemaVersion: 1,
    computedAt: input.now.toISOString(),
    range: {
      start: input.range.start.toISOString(),
      end: input.range.end.toISOString(),
      label: String(input.range.label),
    },
    healthScore,
    recommendations,
    anomalies,
    axes,
  };
  if (input.filter) snap.appliedFilter = input.filter;
  return snap;
}

// ── Health score ─────────────────────────────────────────────────────────────

/**
 * Composite 0-100 team health. v1 is a linear weighted sum of 4 sub-scores:
 *
 *   stuckRate · 25  — share of members in "stuck" / "needs_help" state
 *   rhythm    · 25  — directly from snap.kpis.pace.rhythmDelta
 *   output    · 25  — share of high-output members
 *   risk      · 25  — inverse of risky-action prevalence
 *
 * Each sub-score is normalised to 0-100. Final clamps to [0,100].
 */
export function computeHealthScore(
  snap: OverviewSnapshot,
  sessions: ParsedSession[],
  now: Date,
): InsightsHealthScore {
  const total = Math.max(1, snap.members.length);
  const stuckCount = snap.members.filter((m) => m.stateBadge === 'stuck' || m.stateBadge === 'needs_help').length;
  const stuckRate = Math.round(Math.max(0, 100 * (1 - stuckCount / total)));

  // rhythm: rhythmDelta range typically [-1, +∞). Map to 0-100 with 0 at -0.5, 100 at +0.5.
  const rd = snap.kpis.pace.rhythmDelta;
  const rhythm = Math.round(Math.max(0, Math.min(100, 50 + rd * 100)));

  const high = snap.members.filter((m) => m.deltaVs7dAvgPct > 0.2).length;
  const output = Math.round(Math.max(0, Math.min(100, (high / total) * 100 + 50)));

  const risky = snap.attention.filter((a) => /risky|危险/i.test(a.tag) || a.tagSeverity === 'urgent').length;
  const risk = Math.round(Math.max(0, 100 - risky * 15));

  const value = Math.round((stuckRate + rhythm + output + risk) / 4);

  // 30-day history sparkline: derive from sessions, bucketed by day token sum.
  const buckets: number[] = Array.from({ length: 30 }, () => 0);
  const nowMs = now.getTime();
  for (const s of sessions) {
    const daysAgo = Math.floor((nowMs - s.startTs.getTime()) / 86400000);
    if (daysAgo >= 0 && daysAgo < 30) {
      buckets[29 - daysAgo]! += s.tokens.input + s.tokens.output;
    }
  }
  // Normalise to 0-100 scale for sparkline rendering ease.
  const max = Math.max(...buckets, 1);
  const history30d = buckets.map((v) => Math.round((v / max) * 100));

  return {
    value,
    deltaVsLastWeek: 0, // v1 — no historical persistence; future: compare last 7d vs prior 7d
    breakdown: { stuckRate, rhythm, output, risk },
    history30d,
  };
}

// ── Anomaly detection ────────────────────────────────────────────────────────

/**
 * Per-member token z-score detection. For each member, compute their token
 * total this period and compare to the team average (excluding themselves).
 * Flag when ratio exceeds 2x or falls below 0.4x — these are the cases a
 * leader genuinely cares about ("blake is suddenly 3x the team", "alex
 * cratered to a quarter").
 */
export function detectAnomalies(
  snap: OverviewSnapshot,
  _sessions: ParsedSession[],
  _now: Date,
): InsightsAnomaly[] {
  const members = snap.members;
  if (members.length < 2) return [];

  const totalTeam = members.reduce((a, m) => a + (m.today?.tokens ?? 0), 0);
  const teamAvg = totalTeam / members.length;
  if (teamAvg === 0) return [];

  const out: InsightsAnomaly[] = [];
  for (const m of members) {
    const tokens = m.today?.tokens ?? 0;
    const ratio = tokens / teamAvg;
    if (ratio >= 2.0) {
      out.push({
        member: localPart(m.email),
        signal: 'daily_tokens',
        direction: 'up',
        magnitudeRatio: Math.round(ratio * 10) / 10,
      });
    } else if (ratio > 0 && ratio <= 0.4) {
      out.push({
        member: localPart(m.email),
        signal: 'daily_tokens',
        direction: 'down',
        magnitudeRatio: Math.round((1 / ratio) * 10) / 10,
      });
    }
  }
  return out.sort((a, b) => b.magnitudeRatio - a.magnitudeRatio).slice(0, 5);
}

// ── Recommendations ──────────────────────────────────────────────────────────

/**
 * Rule-based recommendations. v1 catches 3 patterns:
 *
 *   bus_factor      — project contributor share > 0.7 AND that contributor is
 *                     showing a slowdown signal (deltaVs7dAvgPct < -0.2).
 *   stuck_member    — member has been "stuck" badge for ≥1 attention item.
 *   deliver_in_sight — project ETA between 1-14 days with health > 6.
 *
 * Each rec carries triggers[] so a downstream LLM polish (t6-recommendations)
 * can keep the audit trail.
 */
export function generateRecommendations(
  snap: OverviewSnapshot,
  anomalies: InsightsAnomaly[],
): InsightsRecommendation[] {
  const out: InsightsRecommendation[] = [];

  for (const p of snap.projects) {
    if (p.busFactorWarning && p.contributors.length > 0) {
      const top = p.contributors[0]!;
      out.push({
        id: `bus_factor_${p.name}`,
        severity: 'critical',
        headline: `${p.name} 单点风险`,
        body: `${localPart(top.email)} 一人承担 ${Math.round(top.sharePct * 100)}% 的工作量。考虑分散负载，或安排 code review 配对。`,
        triggers: ['busFactorWarning', `contributor:${localPart(top.email)}`],
      });
    }
  }

  for (const m of snap.members) {
    if (m.stateBadge === 'stuck') {
      out.push({
        id: `stuck_${localPart(m.email)}`,
        severity: 'warn',
        headline: `关注 ${localPart(m.email)}`,
        body: `${localPart(m.email)} 状态：卡住。${m.warnings.join('; ') || '建议主动询问进展、提供资源支援。'}`,
        triggers: ['stateBadge:stuck', `member:${localPart(m.email)}`],
      });
    }
  }

  for (const p of snap.projects) {
    if (p.etaDays != null && p.etaDays >= 1 && p.etaDays <= 14 && p.healthScore >= 6) {
      // Round-1 QA P0 (EM): "deliver_in_sight" used to fire for any project
      // with etaDays<=14 + health>=6 regardless of activity. devops-pipelines
      // (activeTodayCount=0 + busFactorWarning=true) was getting "节奏稳定 ·
      // 12 天可 deliver" alongside its own "单点风险（关键）" — directly
      // contradicting itself in the same recommendation list. Suppress the
      // upbeat deliver-in-sight rec when bus_factor already fired OR when
      // there are zero active contributors today.
      if (p.busFactorWarning) continue;
      if (p.activeTodayCount === 0) continue;
      out.push({
        id: `deliver_${p.name}`,
        severity: 'info',
        headline: `${p.name} 临近交付`,
        body: `预计 ${p.etaDays} 天内可 deliver · 健康度 ${p.healthScore}/10 · ${p.activeTodayCount} 人活跃。`,
        triggers: ['etaDays', `project:${p.name}`],
      });
    }
  }

  // Surface top anomalies as a recommendation too — leaders care.
  if (anomalies.length > 0) {
    const a = anomalies[0]!;
    out.push({
      id: `anomaly_${a.member}_${a.signal}`,
      severity: a.direction === 'up' ? 'info' : 'warn',
      headline: `${a.member} 数据明显异常`,
      body: a.direction === 'up'
        ? `${a.member} 本周 token 量是团队均值的 ${a.magnitudeRatio.toFixed(1)}x · 可能突发任务或被分配重活。`
        : `${a.member} 本周 token 量仅是团队均值的 1/${a.magnitudeRatio.toFixed(1)} · 可能在休假、卡壳或调度其他事务。`,
      triggers: ['anomaly', `member:${a.member}`],
    });
  }

  return out.sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity)).slice(0, 6);
}

function severityOrder(s: 'info' | 'warn' | 'critical'): number {
  return s === 'critical' ? 0 : s === 'warn' ? 1 : 2;
}

// ── Time axis ────────────────────────────────────────────────────────────────

/**
 * Aggregate the last 12 weeks of activity into one row per week.
 * Week boundary = server-local Monday 00:00 (consistent with PR4's local-tz
 * day boundary). UTC boundaries flipped the week at local Monday 08:00 for a
 * UTC+8 team, so a Monday-early-morning session landed in the prior week.
 */
export function buildTimeAxis(sessions: ParsedSession[], now: Date): InsightsTimeWeek[] {
  const weeks: InsightsTimeWeek[] = [];
  const todayLocal = localDayStart(now);
  // Find the most recent Monday on or before now, in the server's LOCAL tz.
  const dayOfWeek = todayLocal.getDay(); // 0=Sun,1=Mon,...
  const daysSinceMon = (dayOfWeek + 6) % 7;
  const thisMon = new Date(todayLocal.getTime() - daysSinceMon * 86400000);
  for (let w = 11; w >= 0; w--) {
    const start = new Date(thisMon.getTime() - w * 7 * 86400000);
    const end = new Date(start.getTime() + 7 * 86400000);
    let tokens = 0, sessionsCount = 0, commits = 0;
    for (const s of sessions) {
      if (s.startTs >= start && s.startTs < end) {
        sessionsCount += 1;
        tokens += s.tokens.input + s.tokens.output;
        // Count git commit invocations as commits-in-week.
        for (const m of s.messages) {
          for (const tu of m.toolUses) {
            if (tu.name === 'Bash' && typeof tu.input.command === 'string' && /\bgit commit\b/.test(tu.input.command)) {
              commits += 1;
            }
          }
        }
      }
    }
    weeks.push({
      weekStart: localDateKey(start),
      tokens,
      sessions: sessionsCount,
      commits,
    });
  }
  return weeks;
}

// ── People axis ──────────────────────────────────────────────────────────────

export function buildPeopleAxis(snap: OverviewSnapshot, sessions: ParsedSession[]): InsightsPersonRow[] {
  const byUser = new Map<string, ParsedSession[]>();
  for (const s of sessions) {
    const arr = byUser.get(s.envelope.userId) ?? [];
    arr.push(s);
    byUser.set(s.envelope.userId, arr);
  }
  return snap.members.map((m): InsightsPersonRow => {
    const mine = byUser.get(m.email) ?? [];
    const projectsTouched = new Set(mine.map((s) => s.envelope.projectName)).size;
    const tokens = mine.reduce((a, s) => a + s.tokens.input + s.tokens.output, 0);
    return {
      email: m.email,
      displayName: m.displayName,
      metrics: {
        tokens,
        sessions: mine.length,
        costUsd: m.today?.costUsd ?? 0,
        projectsTouched,
        riskyActions: m.warnings.filter((w) => /危险|risky/i.test(w)).length,
      },
    };
  });
}

// ── Projects axis ────────────────────────────────────────────────────────────

export function buildProjectsAxis(snap: OverviewSnapshot): InsightsProjectRow[] {
  return snap.projects.map((p): InsightsProjectRow => ({
    name: p.name,
    metrics: {
      contributors: p.contributors.length,
      sessions: 0, // populated from sessions if needed; v1 leaves as snapshot-level
      healthScore: p.healthScore,
      etaDays: p.etaDays,
    },
  }));
}

// ── helpers ──────────────────────────────────────────────────────────────────

function localPart(email: string): string {
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}

/** Server-local midnight of `d` (matches PR4's localDayStart). */
function localDayStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Server-local YYYY-MM-DD label for a week-start Date. */
function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
