// packages/collector-server/src/leadership/aggregator.ts
// Composes all 32 signal computers into OverviewSnapshot / MemberDetail / ProjectDetail.

import { scanAllSessions, isNoiseProjectName } from './transcript-loader.js';
import type {
  ParsedSession,
  OverviewSnapshot,
  MemberSnapshot,
  MemberDetail,
  MemberStateBadge,
  ProjectSnapshot,
  ProjectDetail,
  CollabHit,
  KpiCards,
  SessionSummary,
  DateRange,
  AttentionItem,
} from './types.js';
import { computeActivity, computeFocus, computeRhythmDelta } from './signals/activity.js';
import { detectLowActivity } from './signals/slacking.js';
import { detectBlocker } from './signals/blockers.js';
import { detectHelpNeeded } from './signals/help-needed.js';
import { detectCollabHits } from './signals/collaboration.js';
import {
  computeToolFailureRate,
  countContextOverflow,
  computeIterationDensity,
  promptLengthSeries,
} from './signals/quality.js';
import { extractRiskyActions, sumRedactions } from './signals/risk.js';
import { computeCostUsd, computeModelMix } from './signals/cost.js';
import { computeWebResearch, computeNewSurfaceCount } from './signals/learning.js';
import { classifyProject, getRecentFiles } from './signals/project-status.js';
import { projectEta } from './signals/project-eta.js';
import {
  computeCollabDensity,
  computeContributors,
  hasBusFactorWarning,
} from './signals/project-collab.js';
import { computeExtensionMix, computeTestRatio } from './signals/project-stack.js';
import { guessPhase } from './signals/project-phase.js';
import { computeHealthScore, extractMilestones } from './signals/project-health.js';
import { computeWebResearchShare, computeTrend7d, computeHeatmap7x24 } from './signals/project-rhythm.js';

// sumRedactions is imported but only used indirectly (available for callers).
// Suppress TS unused-import by using it in a re-export.
export { sumRedactions };

export interface BuildOverviewInput {
  collectorDir: string;
  range: DateRange;
  now: Date;
  /** Project names treated as "main" for slacking detection. Empty array disables that check. */
  mainProjects?: string[];
  /** Test seam — inject sessions instead of disk scan. */
  sessions?: ParsedSession[];
}

export function buildOverviewSnapshot(input: BuildOverviewInput): OverviewSnapshot {
  const sessions = input.sessions ?? loadSessionsForRange(input.collectorDir, input.range);
  const inRange = sessions.filter((s) => s.startTs >= input.range.start && s.startTs <= input.range.end);

  const teamMedianTokens = median(inRange.map((s) => s.tokens.input + s.tokens.output));

  // Members
  const byEmail = groupBy(inRange, (s) => s.envelope.userId);
  const memberEmails = [...byEmail.keys()].sort();
  const members: MemberSnapshot[] = memberEmails.map((email) =>
    buildMemberSnapshotInner(email, byEmail.get(email) ?? [], inRange, teamMedianTokens, input),
  );

  // Second pass — reclassify stateBadge against team distribution (P-D2).
  // Absolute thresholds (e.g. failRate > 0.2) and the bare-keyword detector
  // both flagged ~all members on the real 2026-05-14 snapshot — `help`,
  // `stuck`, `卡住` are common substrings in any technical conversation.
  // Relative percentile gates make the badge mean "high vs team", which is
  // the only useful signal at small team sizes. `stuck` is preserved when
  // the structural blocker detector fired (3 sessions same cwd, no commit).
  reclassifyMemberStateAgainstTeam(members, byEmail);

  // Projects — filter noise + low-volume scratch BEFORE finalizing list (P-D2).
  // We compute raw snapshots over all groups, then apply the noise filter and
  // the < 3-session cutoff with an optional env allow-list escape hatch.
  const byProject = groupBy(inRange, (s) => s.envelope.projectName);
  const projectNames = [...byProject.keys()].sort();
  const allowList = parseProjectAllowList(process.env.LEADERSHIP_PROJECT_ALLOW);
  const projects: ProjectSnapshot[] = projectNames
    .map((name) => buildProjectSnapshotInner(name, byProject.get(name) ?? [], input.now))
    .filter((p) => isProjectInteresting(p, allowList));

  // Collaboration
  const collaboration: CollabHit[] = detectCollabHits(inRange);

  // Attention items (P-B4) — derived from member badges + project signals,
  // sorted by severity desc, folded by shape, and globally capped (P-D2).
  const attention: AttentionItem[] = deriveAttention(members, projects, input.now, byProject);

  // Team-wide pace: today vs prior-7-day daily-average tokens.
  // Uses the same computeRhythmDelta helper that powers per-member delta,
  // but applied to the whole team so the dashboard card reflects real motion.
  const sevenDayWindowStart = new Date(input.now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const todayTeamSessions = filterToday(inRange, input.now);
  const past7TeamSessions = inRange.filter((s) => s.startTs < sevenDayWindowStart);
  const rhythmDelta = computeRhythmDelta(todayTeamSessions, past7TeamSessions);
  const paceLabel: '升' | '稳' | '缓' =
    rhythmDelta > 0.2 ? '升' : rhythmDelta < -0.2 ? '缓' : '稳';

  // High-output members + their mean delta — replaces hardcoded "↑" trend line.
  const highOutputMembers = members.filter((m) => m.deltaVs7dAvgPct > 0.2);
  const avgHighOutputDelta = highOutputMembers.length === 0
    ? 0
    : highOutputMembers.reduce((a, m) => a + m.deltaVs7dAvgPct, 0) / highOutputMembers.length;

  // Today $ cost — sum across all members' today.costUsd
  const todayCostUsd = members.reduce((a, m) => a + (m?.today?.costUsd ?? 0), 0);

  // KPI cards
  const stuckCount = members.filter((m) => m.stateBadge === 'stuck').length;
  const helpCount = members.filter((m) => m.stateBadge === 'needs_help').length;
  const riskyCount = members.filter((m) => m.warnings.some((w) => /危险|risky/i.test(w))).length;
  const kpis: KpiCards = {
    teamActivity: { value: inRange.length, deltaVsAvg: 0 },
    attention: {
      value: stuckCount + helpCount + riskyCount,
      deltaToday: 0,
      breakdown: { stuck: stuckCount, needsHelp: helpCount, riskyAction: riskyCount },
    },
    projects: {
      active: projects.filter((p) => p.state === 'active').length,
      maintaining: projects.filter((p) => p.state === 'maintaining').length,
      dormant: projects.filter((p) => p.state === 'dormant').length,
    },
    pace: { rhythmDelta, label: paceLabel },
    highOutput: { count: highOutputMembers.length, avgDeltaPct: avgHighOutputDelta },
    todayCostUsd: Math.round(todayCostUsd * 100) / 100,
  };

  // Snapshot staleness — when the freshest session in `inRange` is older than
  // 1 day relative to `now`, surface a banner-ready signal so the renderer
  // can warn the leader that "today" KPIs are relative to a stale capture
  // rather than live data. Computed AFTER the filter passes so we use the
  // same session set the dashboard renders.
  const staleness = computeStaleness(inRange, input.now);

  const snap: OverviewSnapshot = {
    schemaVersion: 1,
    range: {
      start: input.range.start.toISOString(),
      end: input.range.end.toISOString(),
      label: String(input.range.label),
    },
    computedAt: input.now.toISOString(),
    kpis,
    members,
    projects,
    collaboration,
    attention,
  };
  if (staleness) snap.staleness = staleness;
  return snap;
}

// ---------------------------------------------------------------------------
// Helpers added during the 2026-05-17 data-trust-layer rebuild (P-D2)
// ---------------------------------------------------------------------------

/**
 * Inclusive linear-rank percentile. Returns 0 for empty inputs so callers can
 * compose into Math.max(percentile(...), floor) without an `isFinite` guard.
 *
 * Why not interpolated: at typical team sizes (3-15 members) interpolation
 * adds noise without changing the threshold meaningfully; nearest-rank keeps
 * the floor-driven calibration intuitive.
 */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(Math.floor(sorted.length * p), sorted.length - 1);
  return sorted[idx]!;
}

/**
 * Reclassify each member's `stateBadge` against the team's distribution
 * (P-D2). The original implementation used absolute thresholds (failRate
 * > 0.2, sessions === 0, etc.) which flagged 6 of 6 members on the real
 * 2026-05-14 snapshot because the whole team had high failure rates. The
 * relative gates below cap the population that can be flagged to roughly
 * the worst quartile, with a hard floor so a single outlier still trips
 * when the team is small but well-behaved.
 *
 * State priority is preserved: stuck > needs_help > low_activity > quiet >
 * active. `stuck` is left untouched because the blocker detector already uses
 * structural evidence (3 sessions in the same cwd with no commit) that is
 * NOT susceptible to the distribution problem.
 */
function reclassifyMemberStateAgainstTeam(
  members: MemberSnapshot[],
  byEmail: Map<string, ParsedSession[]>,
): void {
  if (members.length === 0) return;
  const failureRates = members.map((m) => m.toolFailureRate ?? 0).filter((x) => x > 0);
  const p75Failure = Math.max(percentile(failureRates, 0.75), 0.1);
  const iterDensities = members.map((m) => m.iterationDensity ?? 0).filter((x) => x > 0);
  const p75Iter = Math.max(percentile(iterDensities, 0.75), 2.5);
  const recents = members.map((m) => {
    const sessions = byEmail.get(m.email) ?? [];
    return sessions.length;
  });
  const p20Recent = percentile(recents, 0.2);

  for (const m of members) {
    // Preserve `stuck` — that uses structural cwd-grouped evidence
    // (3 same-cwd sessions, no commit), not distributional signals.
    if (m.stateBadge === 'stuck') continue;
    const fail = m.toolFailureRate ?? 0;
    const iter = m.iterationDensity ?? 0;
    const recent = (byEmail.get(m.email) ?? []).length;

    if (fail > 0 && fail > p75Failure) {
      m.stateBadge = 'needs_help';
      continue;
    }
    if (iter > 0 && iter > p75Iter) {
      m.stateBadge = 'stuck';
      continue;
    }
    if (recent <= p20Recent && recent < 3) {
      m.stateBadge = 'low_activity';
      continue;
    }
    // No relative red flag → demote prior absolute-threshold / bare-keyword
    // misfires to `active`. `quiet` only when truly zero sessions.
    m.stateBadge = recent === 0 ? 'quiet' : 'active';
  }
}

/**
 * Parse the `LEADERSHIP_PROJECT_ALLOW` env var into a set of project names
 * that bypass the noise + low-volume filters. Empty / unset → no escape
 * hatch (default). Comma-separated, leading / trailing whitespace trimmed.
 *
 * This is the documented escape hatch for cases where the noise heuristics
 * are too eager — set the env var on the server and the listed names come
 * back into the dashboard unconditionally.
 */
function parseProjectAllowList(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

/**
 * Apply the project-list noise filter introduced 2026-05-17 (P-D2). A
 * project survives when:
 *   - its name is in the LEADERSHIP_PROJECT_ALLOW allow-list (escape hatch);
 *   OR
 *   - its name is not noise (hash, bench fixture, etc.) AND it has at least
 *     3 sessions over the 7-day window. The < 3 cutoff drops one-off
 *     scratch projects without obscuring real low-volume work.
 */
function isProjectInteresting(p: ProjectSnapshot, allowList: Set<string>): boolean {
  if (allowList.has(p.name)) return true;
  if (isNoiseProjectName(p.name)) return false;
  // Drop "project name == contributor's email local-part" — that's the
  // signature of a session that ran in `/home/<user>/` without a real
  // project folder. Treats those as personal scratch.
  if (projectNameLooksLikeUsername(p)) return false;
  const totalSessions = p.trend7d.reduce((a, b) => a + b, 0);
  if (totalSessions < 3) return false;
  // Additional volume gate (2026-05-17 calibration): a "real" project on
  // the dashboard either spans ≥ 2 active days OR has ≥ 5 sessions. One
  // afternoon of 3-4 sessions is usually scratch/exploration, not work
  // worth dashboard real estate. Allow-list bypass already returned above.
  const activeDays = p.trend7d.filter((n) => n > 0).length;
  if (activeDays < 2 && totalSessions < 5) return false;
  return true;
}

/**
 * Detects the "project name is just a username" case (`hrdai`, `zhangziyi`
 * on the 2026-05-14 snapshot). These come from sessions whose cwd was the
 * user's home folder rather than a real repo. Compare lowercase.
 */
function projectNameLooksLikeUsername(p: ProjectSnapshot): boolean {
  const nameLc = p.name.toLowerCase();
  for (const c of p.contributors) {
    const atIdx = c.email.indexOf('@');
    const localPart = atIdx >= 0 ? c.email.slice(0, atIdx).toLowerCase() : c.email.toLowerCase();
    if (nameLc === localPart) return true;
    // Hostname-style emails (`zhangziyi@zhangziyideMacBook-Air.local`):
    // strip trailing `de…` (CJK possessive in Hanyu Pinyin) and digits so
    // we catch the common `<name>deLaptop` machine-id format.
    if (nameLc === localPart.replace(/(de)?[A-Za-z0-9_-]+$/, '')) {
      // Only accept this fuzzy match if the head is non-trivially long.
      if (nameLc.length >= 4) return true;
    }
  }
  return false;
}

/**
 * Compute snapshot staleness — `null` when the most-recent session in scope
 * is within ~1 day of `now`. Otherwise return a structured payload the
 * renderer turns into a "data is N days old" banner.
 *
 * Day boundary uses 86_400_000 ms = 1 day (no DST math needed — both ends
 * are ms-since-epoch). `ageDays` is rounded to one decimal so the banner
 * reads cleanly ("距今 3.2 天").
 */
function computeStaleness(
  sessions: ParsedSession[],
  now: Date,
): { ageDays: number; lastActivityAt: string } | undefined {
  if (sessions.length === 0) return undefined;
  let lastTs = sessions[0]!.endTs.getTime();
  for (const s of sessions) {
    const t = s.endTs.getTime();
    if (t > lastTs) lastTs = t;
  }
  const ageMs = now.getTime() - lastTs;
  const ageDays = ageMs / 86_400_000;
  if (ageDays <= 1) return undefined;
  return {
    ageDays: Math.round(ageDays * 10) / 10,
    lastActivityAt: new Date(lastTs).toISOString(),
  };
}

/**
 * Derive an attention list from member badges + project signals.
 * Output is sorted by severity DESC so the editorial card renders the most
 * urgent rows first. line2 strings now interpolate real per-member /
 * per-project values (iteration density, idle hours, contributor email, etc.)
 * Email values are escaped before embedding — anything else interpolated is
 * a number or controlled string, safe to emit unescaped by the renderer.
 */
function deriveAttention(
  members: MemberSnapshot[],
  projects: ProjectSnapshot[],
  now: Date,
  projectSessionsByName?: Map<string, ParsedSession[]>,
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const m of members) {
    const initials = m.displayName.slice(0, 2).toLowerCase();
    if (m.stateBadge === 'stuck') {
      const dens = m.iterationDensity ?? 0;
      const len = m.meanPromptLen ?? 0;
      items.push({
        kind: 'member', refId: m.email, displayName: m.displayName, initials,
        tag: '疑似卡住', tagSeverity: 'urgent',
        line2: `最近 ${dens.toFixed(1)} 次 prompt · 均长 ${len} 字`,
        time: '—', severity: 9,
      });
    }
    if (m.stateBadge === 'needs_help') {
      const failPct = ((m.toolFailureRate ?? 0) * 100).toFixed(0);
      const risky = m.riskyActionCount ?? 0;
      items.push({
        kind: 'member', refId: m.email, displayName: m.displayName, initials,
        tag: '求助', tagSeverity: 'urgent',
        line2: `工具失败率 ${failPct}% · ${risky} 次风险动作`,
        time: '—', severity: 8,
      });
    }
    if (m.stateBadge === 'low_activity') {
      let line2 = `近期活动低于均值`;
      if (m.lastSessionAt) {
        const last = new Date(m.lastSessionAt);
        const idleHours = Math.max(0, Math.round((now.getTime() - last.getTime()) / 3_600_000));
        const hh = last.getUTCHours().toString().padStart(2, '0');
        const mm = last.getUTCMinutes().toString().padStart(2, '0');
        line2 = `未活跃 ${idleHours} 小时 · 上次会话 ${hh}:${mm}`;
      }
      items.push({
        kind: 'member', refId: m.email, displayName: m.displayName, initials,
        tag: '闲置', tagSeverity: 'normal',
        line2,
        time: '—', severity: 5,
      });
    }
  }

  for (const p of projects) {
    const initials = p.name.slice(0, 2).toUpperCase();
    if (p.busFactorWarning && p.contributors[0]) {
      const top = p.contributors[0];
      const pct = Math.round(top.sharePct * 100);
      items.push({
        kind: 'project', refId: p.name, displayName: p.name, initials,
        tag: '单点依赖', tagSeverity: 'calm',
        line2: `顶贡献者 ${escapeHtmlEmail(top.email)} 占 ${pct}%`,
        time: '—', severity: 4,
      });
    }
    if (p.state === 'dormant' && p.contributors.length > 0) {
      let line2 = `近期无活动`;
      const sessions = projectSessionsByName?.get(p.name);
      if (sessions && sessions.length > 0) {
        let latest = sessions[0]!.startTs;
        for (const s of sessions) if (s.startTs > latest) latest = s.startTs;
        const days = Math.max(0, Math.floor((now.getTime() - latest.getTime()) / 86_400_000));
        line2 = `上次活动 ${days} 天前`;
      }
      items.push({
        kind: 'project', refId: p.name, displayName: p.name, initials,
        tag: '沉睡', tagSeverity: 'calm',
        line2,
        time: '—', severity: 3,
      });
    }
  }

  return foldSameShape(items);
}

/**
 * Collapse same-shape attention rows into a single "N 个X" row, then sort
 * by severity DESC and cap at 10 globally (P-D2). A "shape" is defined by
 * `${kind}:${tag}` — e.g. all "单点依赖" project rows fold together, all
 * "求助" member rows fold together. Groups of 2 or fewer pass through
 * unchanged so small teams don't see N=1 / N=2 fold rows.
 *
 * The folded row picks the worst severity in the group and packs the first
 * three displayNames into `line2` so the leader still sees who is in the
 * fold without expanding. Identical refId is preserved on the sample so a
 * downstream slideover click still works (lands on the first member /
 * project in the fold).
 */
function foldSameShape(items: AttentionItem[]): AttentionItem[] {
  const groups = new Map<string, AttentionItem[]>();
  for (const it of items) {
    const key = `${it.kind}:${it.tag}`;
    const arr = groups.get(key) ?? [];
    arr.push(it);
    groups.set(key, arr);
  }
  const folded: AttentionItem[] = [];
  for (const group of groups.values()) {
    if (group.length <= 2) {
      folded.push(...group);
      continue;
    }
    const sample = group[0]!;
    const preview = group.slice(0, 3).map((g) => g.displayName).join('、');
    const ellipsis = group.length > 3 ? '...' : '';
    folded.push({
      ...sample,
      displayName: `${group.length} 个${sample.tag}`,
      initials: String(group.length),
      line2: preview + ellipsis,
      severity: Math.max(...group.map((g) => g.severity)),
    });
  }
  return folded.sort((a, b) => b.severity - a.severity).slice(0, 10);
}

/**
 * Escape an email for safe embedding in HTML emitted unescaped by the
 * attention renderer. Emails almost never contain `<`/`>`, but a malformed
 * envelope could; we encode `&<>` defensively here so line2 stays trusted.
 */
function escapeHtmlEmail(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildMemberSnapshotInner(
  email: string,
  memberSessions: ParsedSession[],
  allSessions: ParsedSession[],
  teamMedianTokens: number,
  input: BuildOverviewInput,
): MemberSnapshot {
  const display = email.includes('@') ? email.split('@')[0]! : email;
  const activity = computeActivity(memberSessions);
  const cost = computeCostUsd(memberSessions);
  void cost; // available to callers via computeCostUsd; cost included in today below

  // Trend over 7 days (sessions per day, oldest first)
  const trend7d = computeTrend7d(memberSessions, input.now);

  // Past 7d for rhythm delta
  const sevenDayWindowStart = new Date(input.now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const todaySessions = filterToday(memberSessions, input.now);
  const past7Sessions = memberSessions.filter((s) => s.startTs < sevenDayWindowStart);
  const deltaVs7dAvgPct = computeRhythmDelta(todaySessions, past7Sessions);

  // State badge — priority: stuck > needs_help > low_activity > quiet > active
  let stuck = false;
  const cwds = new Set(memberSessions.map((m) => m.envelope.cwd));
  for (const cwd of cwds) {
    const r = detectBlocker(memberSessions, cwd, input.now);
    if (r.isBlocked) { stuck = true; break; }
  }

  const teamAvgWebSearch = avg(allSessions.map((s) => {
    let n = 0;
    for (const m of s.messages) for (const tu of m.toolUses) if (tu.name === 'WebSearch' || tu.name === 'WebFetch') n++;
    return n;
  }));
  const help = detectHelpNeeded(memberSessions, teamAvgWebSearch);
  const slacking = detectLowActivity(
    memberSessions,
    teamMedianTokens,
    { mainProjects: input.mainProjects ?? [] },
  );

  let badge: MemberStateBadge;
  if (stuck) badge = 'stuck';
  else if (help.isNeeded) badge = 'needs_help';
  else if (slacking.isLow) badge = 'low_activity';
  else if (activity.sessions === 0) badge = 'quiet';
  else badge = 'active';

  const warnings: string[] = [];
  const overflow = countContextOverflow(memberSessions);
  if (overflow > 0) warnings.push(sanitizeWarningText(`context 爆炸 ${overflow} 次`));
  const failRate = computeToolFailureRate(memberSessions);
  if (failRate > 0.2) warnings.push(sanitizeWarningText(`tool 失败率 ${(failRate * 100).toFixed(0)}%`));
  const risky = extractRiskyActions(memberSessions);
  if (risky.length > 0) warnings.push(sanitizeWarningText(`危险动作 ${risky.length} 次`));

  // Top project today
  const projectCounts = new Map<string, number>();
  for (const s of todaySessions) {
    projectCounts.set(s.envelope.projectName, (projectCounts.get(s.envelope.projectName) ?? 0) + 1);
  }
  let topProject: string | undefined;
  let topMax = 0;
  for (const [p, c] of projectCounts) if (c > topMax) { topMax = c; topProject = p; }

  // Last session timestamp — used by deriveAttention to compute real idle hours
  // for low_activity members. Picks the maximum startTs across this member's sessions.
  let lastSessionAt: string | undefined;
  if (memberSessions.length > 0) {
    let latest = memberSessions[0]!.startTs;
    for (const s of memberSessions) if (s.startTs > latest) latest = s.startTs;
    lastSessionAt = latest.toISOString();
  }

  // Pre-compute fields that deriveAttention's line2 strings need so it doesn't
  // have to re-iterate session data per member.
  const iterationDensity = computeIterationDensity(memberSessions);
  let userMsgChars = 0;
  let userMsgCount = 0;
  for (const s of memberSessions) {
    for (const m of s.messages) {
      if (m.role === 'user') {
        userMsgChars += m.text.length;
        userMsgCount += 1;
      }
    }
  }
  const meanPromptLen = userMsgCount === 0 ? 0 : Math.round(userMsgChars / userMsgCount);

  return {
    email,
    displayName: display,
    stateBadge: badge,
    today: {
      sessions: todaySessions.length,
      tokens: todaySessions.reduce((a, s) => a + s.tokens.input + s.tokens.output, 0),
      estMinutes: computeActivity(todaySessions).estMinutes,
      costUsd: computeCostUsd(todaySessions),
    },
    trend7d,
    deltaVs7dAvgPct,
    warnings,
    topProject,
    lastSessionAt,
    toolFailureRate: failRate,
    riskyActionCount: risky.length,
    iterationDensity,
    meanPromptLen,
  };
}

function buildProjectSnapshotInner(name: string, projectSessions: ParsedSession[], now: Date): ProjectSnapshot {
  const state = classifyProject(projectSessions, now);
  const contributors = computeContributors(projectSessions);
  const busFactorWarning = hasBusFactorWarning(contributors);
  const trend7d = computeTrend7d(projectSessions, now);
  const phaseGuess = guessPhase(projectSessions);
  const healthScore = computeHealthScore(projectSessions);
  const eta = projectEta(projectSessions, now);

  // Active-today ratio = (contributors with ≥1 session in last 24h) / total contributors.
  // Replaces the placeholder "sum(trend7d) / recentFiles" heuristic in the
  // project row's progress bar.
  const todayProjectSessions = filterToday(projectSessions, now);
  const activeToday = new Set<string>();
  for (const s of todayProjectSessions) activeToday.add(s.envelope.userId);
  const activeTodayCount = activeToday.size;
  const activeTodayPct = contributors.length === 0
    ? 0
    : Math.round((activeTodayCount / contributors.length) * 1000) / 1000;

  return {
    name,
    state,
    contributors,
    busFactorWarning,
    trend7d,
    phaseGuess,
    healthScore,
    etaDays: eta.etaDays,
    etaConfidence: eta.confidence,
    activeTodayPct,
    activeTodayCount,
  };
}

export function buildMemberDetail(input: {
  collectorDir: string;
  email: string;
  range: DateRange;
  now: Date;
  sessions?: ParsedSession[];
  mainProjects?: string[];
}): (MemberSnapshot & { detail: MemberDetail }) | null {
  const all = input.sessions ?? loadSessionsForRange(input.collectorDir, input.range);
  const inRange = all.filter((s) => s.startTs >= input.range.start && s.startTs <= input.range.end);
  const memberSessions = inRange.filter((s) => s.envelope.userId === input.email);
  if (memberSessions.length === 0) return null;

  const teamMedianTokens = median(inRange.map((s) => s.tokens.input + s.tokens.output));
  const base = buildMemberSnapshotInner(input.email, memberSessions, inRange, teamMedianTokens, {
    collectorDir: input.collectorDir,
    range: input.range,
    now: input.now,
    mainProjects: input.mainProjects,
  });

  // Detail-only fields
  const toolFailureRate = computeToolFailureRate(memberSessions);
  const overContext200kCount = countContextOverflow(memberSessions);
  const iterationDensity = computeIterationDensity(memberSessions);
  const riskyActions = extractRiskyActions(memberSessions);
  const modelMix = computeModelMix(memberSessions);
  const webResearchCount = computeWebResearch(memberSessions);

  // P-A1: previously-unused signals now wired into the snapshot.
  const todayMemberSessions = filterToday(memberSessions, input.now);
  const focus = computeFocus(todayMemberSessions);
  const prLenSeries = promptLengthSeries(memberSessions);
  // "Historical" = same member's sessions in the 7-day window preceding range.start.
  const historyWindowMs = 7 * 24 * 60 * 60 * 1000;
  const historicalStart = new Date(input.range.start.getTime() - historyWindowMs);
  const historicalMemberSessions = all.filter(
    (s) =>
      s.envelope.userId === input.email &&
      s.startTs >= historicalStart &&
      s.startTs < input.range.start,
  );
  const newSurfaceCount = computeNewSurfaceCount(memberSessions, historicalMemberSessions);

  // Collaborators — files shared with others via collab hits
  const collabHits = detectCollabHits(inRange);
  const collaborators = new Map<string, Set<string>>();
  for (const h of collabHits) {
    if (!h.members.includes(input.email)) continue;
    for (const other of h.members) {
      if (other === input.email) continue;
      const set = collaborators.get(other) ?? new Set<string>();
      set.add(h.filePath);
      collaborators.set(other, set);
    }
  }

  // Sessions list with 200-char preview
  const sessionsList: SessionSummary[] = memberSessions
    .slice()
    .sort((a, b) => b.startTs.getTime() - a.startTs.getTime())
    .map((s): SessionSummary => {
      const firstUser = s.messages.find((m) => m.role === 'user');
      const text = firstUser?.text ?? '';
      // P-A3: enumerate every non-empty user prompt for the L2 expand UI.
      const allPrompts = s.messages
        .filter((m) => m.role === 'user' && m.text.trim().length > 0)
        .map((m) => ({
          ts: (m.ts ?? s.startTs).toISOString(),
          preview: m.text.length > 200 ? m.text.slice(0, 200) : m.text,
          full: m.text,
        }));
      return {
        sessionId: s.envelope.sessionId,
        capturedAt: s.envelope.capturedAt,
        projectName: s.envelope.projectName,
        totalTokens: s.tokens.input + s.tokens.output,
        firstPromptPreview: text.length > 200 ? text.slice(0, 200) : text,
        firstPromptFull: text,
        allPrompts,
      };
    });

  // Heatmap + top files
  const heatmap7x24 = computeHeatmap7x24(memberSessions, input.now);
  const fileEdits = new Map<string, number>();
  for (const s of memberSessions) {
    for (const m of s.messages) {
      for (const tu of m.toolUses) {
        if (['Edit', 'Write', 'MultiEdit'].includes(tu.name)) {
          const fp = typeof tu.input.file_path === 'string' ? tu.input.file_path : undefined;
          if (fp) fileEdits.set(fp, (fileEdits.get(fp) ?? 0) + 1);
        }
      }
    }
  }
  const topFiles = [...fileEdits.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([path, edits]) => ({ path, edits }));

  const detail: MemberDetail = {
    toolFailureRate,
    overContext200kCount,
    iterationDensity,
    riskyActions,
    collaborators: [...collaborators.entries()].map(([withEmail, files]) => ({
      withEmail,
      sharedFiles: [...files],
    })),
    modelMix,
    webResearchCount,
    sessions: sessionsList,
    heatmap7x24,
    topFiles,
    focus,
    promptLengthSeries: prLenSeries,
    newSurfaceCount,
  };

  return { ...base, detail };
}

export function buildProjectDetail(input: {
  collectorDir: string;
  projectName: string;
  range: DateRange;
  now: Date;
  sessions?: ParsedSession[];
}): (ProjectSnapshot & { detail: ProjectDetail }) | null {
  const all = input.sessions ?? loadSessionsForRange(input.collectorDir, input.range);
  const inRange = all.filter((s) => s.startTs >= input.range.start && s.startTs <= input.range.end);
  const projectSessions = inRange.filter((s) => s.envelope.projectName === input.projectName);
  if (projectSessions.length === 0) return null;

  const base = buildProjectSnapshotInner(input.projectName, projectSessions, input.now);

  const todayFiles = getRecentFiles(filterToday(projectSessions, input.now));
  const weekFiles = getRecentFiles(projectSessions);
  const extensionMix = computeExtensionMix(projectSessions);
  const testRatio = computeTestRatio(projectSessions);
  const milestones = extractMilestones(projectSessions);
  const webResearchShare = computeWebResearchShare(projectSessions);
  const heatmap7x24 = computeHeatmap7x24(projectSessions, input.now);

  const fileEdits = new Map<string, number>();
  for (const s of projectSessions) {
    for (const m of s.messages) {
      for (const tu of m.toolUses) {
        if (['Edit', 'Write', 'MultiEdit'].includes(tu.name)) {
          const fp = typeof tu.input.file_path === 'string' ? tu.input.file_path : undefined;
          if (fp) fileEdits.set(fp, (fileEdits.get(fp) ?? 0) + 1);
        }
      }
    }
  }
  const recentFiles = [...fileEdits.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([path, touches]) => ({ path, touches }));

  const collabDensity = computeCollabDensity(projectSessions);

  const detail: ProjectDetail = {
    todayFiles,
    weekFiles,
    extensionMix,
    testRatio,
    milestones,
    webResearchShare,
    heatmap7x24,
    recentFiles,
    collabDensity,
  };

  return { ...base, detail };
}

// ----- helpers -----

function loadSessionsForRange(collectorDir: string, range: DateRange): ParsedSession[] {
  return scanAllSessions(collectorDir, {
    fromDate: range.start.toISOString().slice(0, 10),
    toDate: range.end.toISOString().slice(0, 10),
  });
}

function groupBy<T, K>(items: T[], keyFn: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const it of items) {
    const k = keyFn(it);
    const arr = m.get(k) ?? [];
    arr.push(it);
    m.set(k, arr);
  }
  return m;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1]! + sorted[mid]!) / 2;
  return sorted[mid]!;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function filterToday(sessions: ParsedSession[], now: Date): ParsedSession[] {
  const dayMs = 24 * 60 * 60 * 1000;
  const todayStart = new Date(now.getTime() - dayMs);
  return sessions.filter((s) => s.startTs >= todayStart && s.startTs <= now);
}

// ---------------------------------------------------------------------------
// Encoding sanitisation boundary (P-D2)
// ---------------------------------------------------------------------------

/**
 * Strip lone surrogate code points from a warning string before it enters
 * the snapshot.
 *
 * Context: the on-the-wire `/api/overview` payload is clean UTF-8 — the
 * mojibake the leadership audit observed (`镉遍橳铔ㄤ綔 92 婘\udca1`) was a
 * downstream display issue (a terminal interpreting UTF-8 bytes as GBK).
 * The trailing `\udca1` in that audit copy IS a real signal: it is a lone
 * low surrogate that survived a Buffer-decode somewhere upstream and would
 * have re-corrupted any JSON serializer.
 *
 * We replace lone surrogates with `?` at the construction site so even if
 * upstream transcript bytes ever land mis-decoded, the warning string the
 * dashboard sees stays valid UTF-16 and round-trips cleanly through
 * JSON.stringify → JSON.parse on the client. Well-formed strings pass
 * through unchanged.
 */
export function sanitizeWarningText(s: string): string {
  // Match high surrogate not followed by low, OR low surrogate not preceded
  // by high. The negative-lookaround pair makes the regex idempotent.
  return s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '?');
}
