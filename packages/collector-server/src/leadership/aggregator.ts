// packages/collector-server/src/leadership/aggregator.ts
// Composes all 32 signal computers into OverviewSnapshot / MemberDetail / ProjectDetail.

import { scanAllSessions } from './transcript-loader.js';
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

  // Projects
  const byProject = groupBy(inRange, (s) => s.envelope.projectName);
  const projectNames = [...byProject.keys()].sort();
  const projects: ProjectSnapshot[] = projectNames.map((name) =>
    buildProjectSnapshotInner(name, byProject.get(name) ?? [], input.now),
  );

  // Collaboration
  const collaboration: CollabHit[] = detectCollabHits(inRange);

  // Attention items (P-B4) — derived from member badges + project signals,
  // sorted by severity desc so the editorial card can render row-by-row.
  // We pass byProject so dormant rows can interpolate real "X days since
  // last activity" rather than the old "48 小时无活动" template.
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

  return {
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

  return items.sort((a, b) => b.severity - a.severity);
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
  if (overflow > 0) warnings.push(`context 爆炸 ${overflow} 次`);
  const failRate = computeToolFailureRate(memberSessions);
  if (failRate > 0.2) warnings.push(`tool 失败率 ${(failRate * 100).toFixed(0)}%`);
  const risky = extractRiskyActions(memberSessions);
  if (risky.length > 0) warnings.push(`危险动作 ${risky.length} 次`);

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
