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
  };
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
      return {
        sessionId: s.envelope.sessionId,
        capturedAt: s.envelope.capturedAt,
        projectName: s.envelope.projectName,
        totalTokens: s.tokens.input + s.tokens.output,
        firstPromptPreview: text.length > 200 ? text.slice(0, 200) : text,
        firstPromptFull: text,
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
