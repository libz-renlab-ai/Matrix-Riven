/**
 * Demo-mode fixture. When a request arrives at `/overview?demo=1` we render
 * the dashboard against this hand-curated `OverviewSnapshot` instead of the
 * real aggregator output. This lets a cold visitor (CTO, investor, new
 * teammate) see a fully populated dashboard before pointing any data at the
 * server.
 *
 * The names are deliberately synthetic ("Alex/Blake/Casey/Dana") so the
 * demo never leaks real emails or project names; every narrative line is
 * the kind of T2/T3/T4 output the real LLM tier produces.
 */

import type {
  OverviewSnapshot,
  MemberSnapshot,
  MemberDetail,
  ProjectSnapshot,
  ProjectDetail,
} from '../types.js';

const NOW = '2026-05-18T09:00:00Z';

// 2026-05-18 round-8 audit P0: /api/members/:id and /api/projects/:name
// previously didn't honor `?demo=1`, so a CTO clicking a row on the demo
// overview hit a 404 in the drawer (the product's hero interaction).
// These helpers build a minimal but presentable MemberDetail /
// ProjectDetail so the slideover renders without crashing.

function emptyHeatmap(): number[][] {
  return Array.from({ length: 7 }, () => Array(24).fill(0));
}

/**
 * QA P0 fix (2026-05-19): synthesize a believable work-hour heatmap so the
 * demo member detail page's flagship 7×24 grid doesn't render 168 blank
 * cells. Seeded by `key` so each demo member gets a slightly different
 * pattern.
 */
function demoHeatmap(key: string): number[][] {
  let seed = 0;
  for (let i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) & 0xffffffff;
  const out: number[][] = [];
  for (let r = 0; r < 7; r++) {
    const row: number[] = [];
    for (let c = 0; c < 24; c++) {
      let base = 0;
      if (c >= 9 && c < 12) base = 6 + ((seed + c) % 5);
      else if (c >= 14 && c < 18) base = 5 + ((seed + r) % 4);
      else if (c >= 18 && c < 22) base = 2 + ((seed + r * c) % 3);
      else if (c >= 8 && c < 9) base = 3;
      if (r >= 5) base = Math.round(base * 0.3);
      const jitter = ((seed * (r + 1) * (c + 1)) % 7) - 3;
      row.push(Math.max(0, Math.round((base + jitter) * 350)));
    }
    out.push(row);
  }
  return out;
}

// 2026-05-18 round-9 audit P1: returning one static detail for every
// demo member contradicted their top-level snapshots (e.g., blake top
// "stuck · 0.31 failure" vs detail "matrix-riven hero work · 0 failures").
// Now per-member, matching toolFailureRate / riskyActionCount / topProject
// so a CEO clicking around sees coherent narratives.
const MEMBER_DETAILS: Record<string, MemberDetail> = {
  alex: {
    toolFailureRate: 0.06,
    overContext200kCount: 0,
    iterationDensity: 5,
    riskyActions: [],
    collaborators: [{ withEmail: 'blake@example.com', sharedFiles: ['src/leadership/views/_overview-fragments.ts'] }],
    modelMix: { 'claude-sonnet-4-6': 0.82, 'claude-opus-4-7': 0.15, 'claude-haiku-4-5': 0.03 },
    webResearchCount: 2,
    sessions: [
      {
        sessionId: 'demo-alex-1',
        capturedAt: '2026-05-18T08:30:00Z',
        projectName: 'matrix-riven',
        totalTokens: 42_000,
        firstPromptPreview: '继续完善 overview 仪表盘的 hero 区',
        firstPromptFull: '继续完善 overview 仪表盘的 hero 区，把 KPI 卡的样式收尾。',
        allPrompts: [
          { ts: '2026-05-18T08:30:00Z', preview: '继续完善 overview 仪表盘的 hero 区', full: '继续完善 overview 仪表盘的 hero 区，把 KPI 卡的样式收尾。' },
        ],
      },
    ],
    heatmap7x24: demoHeatmap('alex'),
    topFiles: [
      { path: 'src/leadership/views/_overview-fragments.ts', edits: 9 },
      { path: 'src/leadership/aggregator.ts', edits: 4 },
    ],
    focus: { distinctCwdsToday: 1, avgSessionMinutes: 22 },
    promptLengthSeries: [],
    newSurfaceCount: 2,
  },
  blake: {
    toolFailureRate: 0.31,
    overContext200kCount: 1,
    iterationDensity: 9,
    riskyActions: [
      { ts: '2026-05-18T07:10:00Z', sessionId: 'demo-blake-1', pattern: 'other', snippet: 'tsc --noEmit (再次重试)' },
    ],
    collaborators: [],
    modelMix: { 'claude-sonnet-4-6': 0.65, 'claude-opus-4-7': 0.32, 'claude-haiku-4-5': 0.03 },
    webResearchCount: 11,
    sessions: [
      {
        sessionId: 'demo-blake-1',
        capturedAt: '2026-05-18T07:10:00Z',
        projectName: 'matrix-riven',
        totalTokens: 51_000,
        firstPromptPreview: 'status/page.tsx 的 useEffect 依赖一直报错，能不能再看一下',
        firstPromptFull: 'status/page.tsx 的 useEffect 依赖一直报错，能不能再看一下',
        allPrompts: [
          { ts: '2026-05-18T07:10:00Z', preview: 'status/page.tsx 的 useEffect 依赖一直报错', full: 'status/page.tsx 的 useEffect 依赖一直报错，能不能再看一下' },
        ],
      },
    ],
    heatmap7x24: demoHeatmap('blake'),
    topFiles: [
      { path: 'src/app/status/page.tsx', edits: 12 },
      { path: 'src/app/status/hooks.ts', edits: 3 },
    ],
    focus: { distinctCwdsToday: 1, avgSessionMinutes: 35 },
    promptLengthSeries: [],
    newSurfaceCount: 0,
  },
  casey: {
    toolFailureRate: 0.04,
    overContext200kCount: 0,
    iterationDensity: 4,
    riskyActions: [],
    collaborators: [{ withEmail: 'dana@example.com', sharedFiles: ['src/graph/render.ts'] }],
    modelMix: { 'claude-sonnet-4-6': 0.84, 'claude-opus-4-7': 0.12, 'claude-haiku-4-5': 0.04 },
    webResearchCount: 3,
    sessions: [
      {
        sessionId: 'demo-casey-1',
        capturedAt: '2026-05-18T08:48:00Z',
        projectName: 'team-graph',
        totalTokens: 38_000,
        firstPromptPreview: '修一下 graph 视图渲染抖动',
        firstPromptFull: '修一下 graph 视图渲染抖动，attention 编辑卡也需要联动。',
        allPrompts: [
          { ts: '2026-05-18T08:48:00Z', preview: '修一下 graph 视图渲染抖动', full: '修一下 graph 视图渲染抖动，attention 编辑卡也需要联动。' },
        ],
      },
    ],
    heatmap7x24: demoHeatmap('casey'),
    topFiles: [
      { path: 'src/graph/render.ts', edits: 7 },
      { path: '.github/workflows/ci.yml', edits: 2 },
    ],
    focus: { distinctCwdsToday: 2, avgSessionMinutes: 26 },
    promptLengthSeries: [],
    newSurfaceCount: 1,
  },
  dana: {
    toolFailureRate: 0.02,
    overContext200kCount: 0,
    iterationDensity: 2,
    riskyActions: [],
    collaborators: [],
    modelMix: { 'claude-sonnet-4-6': 0.71, 'claude-opus-4-7': 0.05, 'claude-haiku-4-5': 0.24 },
    webResearchCount: 1,
    sessions: [
      {
        sessionId: 'demo-dana-1',
        capturedAt: '2026-05-17T19:30:00Z',
        projectName: 'team-graph',
        totalTokens: 9_000,
        firstPromptPreview: '帮我整理 README 的输入/输出格式说明',
        firstPromptFull: '帮我整理 README 的输入/输出格式说明，让团队接入更顺。',
        allPrompts: [
          { ts: '2026-05-17T19:30:00Z', preview: '帮我整理 README 的输入/输出格式说明', full: '帮我整理 README 的输入/输出格式说明，让团队接入更顺。' },
        ],
      },
    ],
    heatmap7x24: demoHeatmap('dana'),
    topFiles: [
      { path: 'README.md', edits: 2 },
      { path: 'docs/format.md', edits: 1 },
    ],
    focus: { distinctCwdsToday: 0, avgSessionMinutes: 18 },
    promptLengthSeries: [],
    newSurfaceCount: 0,
  },
};

function demoMemberDetail(localPart: string): MemberDetail {
  return MEMBER_DETAILS[localPart] ?? MEMBER_DETAILS.alex!;
}

// 2026-05-18 round-10 audit P1: same blindspot as round-9 fixed for
// members — every project drawer returned the same hardcoded detail,
// so clicking devops-pipelines (lastTouch=.github/workflows/ci.yml)
// showed src/leadership/views/_overview-fragments.ts in recentFiles.
// Now per-project, with topFiles + extensionMix matching each project's
// actual story.
const PROJECT_DETAILS: Record<string, ProjectDetail> = {
  'matrix-riven': {
    todayFiles: ['src/leadership/views/_overview-fragments.ts'],
    weekFiles: [
      'src/leadership/views/_overview-fragments.ts',
      'src/leadership/aggregator.ts',
      'src/leadership/views/_slideover.html.ts',
      'src/app/status/page.tsx',
    ],
    extensionMix: { ts: 0.86, tsx: 0.09, md: 0.04, json: 0.01 },
    testRatio: 0.42,
    milestones: [],
    webResearchShare: 0.08,
    heatmap7x24: demoHeatmap('matrix-riven'),
    recentFiles: [
      { path: 'src/leadership/views/_overview-fragments.ts', touches: 9 },
      { path: 'src/leadership/aggregator.ts', touches: 4 },
      { path: 'src/app/status/page.tsx', touches: 12 },
    ],
    collabDensity: 0.55,
    recentPrompts: [
      { ts: '2026-05-18T09:14:00Z', by: 'alex@example.com', preview: '继续完善 overview 仪表盘的 hero 区' },
      { ts: '2026-05-18T08:42:00Z', by: 'sara@example.com', preview: 'KPI 卡数据为什么是 0？' },
      { ts: '2026-05-17T16:30:00Z', by: 'alex@example.com', preview: '把 attention 编辑卡的样式收尾' },
    ],
  },
  'team-graph': {
    todayFiles: ['src/graph/render.ts'],
    weekFiles: [
      'src/graph/render.ts',
      'src/graph/layout.ts',
      'README.md',
    ],
    extensionMix: { ts: 0.74, md: 0.18, json: 0.08 },
    testRatio: 0.28,
    milestones: [],
    webResearchShare: 0.15,
    heatmap7x24: demoHeatmap('team-graph'),
    recentFiles: [
      { path: 'src/graph/render.ts', touches: 7 },
      { path: 'src/graph/layout.ts', touches: 3 },
      { path: 'README.md', touches: 2 },
    ],
    collabDensity: 0.33,
    recentPrompts: [
      { ts: '2026-05-18T11:00:00Z', by: 'lin@example.com', preview: '修一下 graph 视图渲染抖动' },
      { ts: '2026-05-18T10:08:00Z', by: 'lin@example.com', preview: 'layout.ts 里 force-directed 的参数怎么调？' },
    ],
  },
  'devops-pipelines': {
    // activeTodayCount=0; lastTouch yesterday. Mirror reality: no
    // todayFiles, weekFiles only contains the CI infra casey owns.
    todayFiles: [],
    weekFiles: [
      '.github/workflows/ci.yml',
      '.github/workflows/release.yml',
      'scripts/ci/cache-warm.sh',
    ],
    extensionMix: { yml: 0.62, sh: 0.31, md: 0.07 },
    testRatio: 0.0,
    milestones: [],
    webResearchShare: 0.05,
    heatmap7x24: demoHeatmap('devops-pipelines'),
    recentFiles: [
      { path: '.github/workflows/ci.yml', touches: 4 },
      { path: 'scripts/ci/cache-warm.sh', touches: 2 },
      { path: '.github/workflows/release.yml', touches: 1 },
    ],
    collabDensity: 0.0,
    recentPrompts: [],
  },
};

function demoProjectDetail(name: string): ProjectDetail {
  return PROJECT_DETAILS[name] ?? PROJECT_DETAILS['matrix-riven']!;
}

/**
 * Look up a demo member by email local-part. Returns the member snapshot
 * (from the overview fixture) plus a hand-built `detail` object. Used by
 * `/api/members/:localPart?demo=1`.
 */
export function getDemoMemberByLocalPart(
  localPart: string,
): (MemberSnapshot & { detail: MemberDetail }) | null {
  const snap = getDemoSnapshot();
  const lp = localPart.toLowerCase();
  const member = snap.members.find(
    (m) => (m.email.split('@')[0] ?? '').toLowerCase() === lp,
  );
  if (!member) return null;
  return { ...member, detail: demoMemberDetail(lp) };
}

/**
 * Look up a demo project by name. Used by `/api/projects/:name?demo=1`.
 */
export function getDemoProjectByName(
  name: string,
): (ProjectSnapshot & { detail: ProjectDetail }) | null {
  const snap = getDemoSnapshot();
  const project = snap.projects.find((p) => p.name === name);
  if (!project) return null;
  return { ...project, detail: demoProjectDetail(name) };
}

export function getDemoSnapshot(): OverviewSnapshot {
  return {
    schemaVersion: 1,
    range: { start: '2026-05-11T09:00:00Z', end: NOW, label: '7d' },
    computedAt: NOW,
    staleness: undefined,
    llmBrief: [
      '今日团队推进顺利：核心 dashboard 模块已上线，CI 全绿。',
      '一名工程师在 status/page.tsx 卡住两天，需要一次结对排查。',
      '明日聚焦 LLM 叙事层与 OKR 联动；本周已无悬而未决的发布。',
    ],
    kpis: {
      teamActivity: { value: 4, deltaVsAvg: 0.08 },
      attention:    { value: 2, deltaToday: -1, breakdown: { stuck: 1, needsHelp: 0, riskyAction: 1 } },
      projects:     { active: 2, maintaining: 1, dormant: 0 },
      pace:         { rhythmDelta: 0.04, label: '稳' },
      highOutput:   { count: 2, avgDeltaPct: 0.18 },
      todayCostUsd: 4.32,
    },
    members: [
      {
        email: 'alex@example.com', displayName: 'alex', stateBadge: 'active',
        today: { sessions: 7, tokens: 84_000, estMinutes: 142, costUsd: 1.65 },
        trend7d: [5, 6, 7, 7, 8, 6, 7], deltaVs7dAvgPct: 0.12, warnings: [],
        topProject: 'matrix-riven', lastSessionAt: '2026-05-18T08:30:00Z',
        toolFailureRate: 0.06, riskyActionCount: 1,
        llmWeekly: '本周聚焦 overview 仪表盘\n已交付 hero 与 KPI 卡片骨架',
      },
      {
        email: 'blake@example.com', displayName: 'blake', stateBadge: 'stuck',
        today: { sessions: 4, tokens: 51_000, estMinutes: 96, costUsd: 0.92 },
        // 2026-05-18 round-11 audit P1: was [3,4,5,6,7,5,4] which
        // trendLabel() classified as "正在加速" while stateBadge=stuck.
        // 2026-05-18 round-13 audit P1: trend7d[6] (today) must equal
        // today.sessions (the dana fix's symmetric sibling). Shape now
        // lands on "逐渐放缓" (earlier=21, later=10 < 10.5) AND ends at
        // 4 — matches today.sessions=4 + stuck narrative.
        trend7d: [9, 7, 5, 3, 2, 1, 4], deltaVs7dAvgPct: -0.18, warnings: ['卡 2 天'],
        topProject: 'matrix-riven', lastSessionAt: '2026-05-18T07:10:00Z',
        toolFailureRate: 0.31, riskyActionCount: 4,
        llmWeekly: '本周聚焦 status/page.tsx 报错\n卡在 类型推导，需要结对排查',
      },
      {
        email: 'casey@example.com', displayName: 'casey', stateBadge: 'active',
        today: { sessions: 6, tokens: 72_000, estMinutes: 128, costUsd: 1.41 },
        trend7d: [4, 5, 5, 6, 7, 6, 6], deltaVs7dAvgPct: 0.21, warnings: [],
        topProject: 'team-graph', lastSessionAt: '2026-05-18T08:48:00Z',
        toolFailureRate: 0.04, riskyActionCount: 0,
        // 2026-05-18 round-11 audit P1: was "LLM 叙事层 T1-T3 / worker
        // collectInputs" which contradicted casey's topProject=team-graph
        // and the actual session "修一下 graph 视图渲染抖动". Now matches
        // the graph-rendering narrative threaded through the rest of the
        // fixture.
        llmWeekly: '本周聚焦 team-graph 视图渲染\n已交付 attention 编辑卡联动；修 SVG 抖动中',
      },
      {
        email: 'dana@example.com', displayName: 'dana', stateBadge: 'low_activity',
        // 2026-05-18 round-12 audit: today.sessions=1 conflicted with
        // lastSessionAt=yesterday + llmWeekly "多日无新会话". Set today
        // counters to 0 so the raw JSON matches the narrative.
        today: { sessions: 0, tokens: 0, estMinutes: 0, costUsd: 0 },
        trend7d: [4, 3, 2, 1, 1, 1, 0], deltaVs7dAvgPct: -0.55, warnings: ['节奏下滑'],
        topProject: 'team-graph', lastSessionAt: '2026-05-17T19:30:00Z',
        toolFailureRate: 0.02, riskyActionCount: 0,
        llmWeekly: '本周聚焦 文档同步\n本周节奏放缓 · 多日无新会话',
      },
    ] as unknown as OverviewSnapshot['members'],
    projects: [
      {
        name: 'matrix-riven', state: 'active', phaseGuess: 'implement',
        contributors: [
          { email: 'alex@example.com', sharePct: 0.55 },
          { email: 'blake@example.com', sharePct: 0.45 },
        ],
        busFactorWarning: false,
        trend7d: [4, 5, 6, 7, 6, 6, 6],
        healthScore: 8.2, etaDays: 5, etaConfidence: 'low',
        activeTodayPct: 1.0, activeTodayCount: 2,
        lastTouch: { filePath: 'src/leadership/views/_overview-fragments.ts', by: 'alex', ts: '2026-05-18T08:30:00Z' },
        llmWeekly: '团队在做 leadership 仪表盘\n进展 T1-T3 上线 / 待整合 worker',
      },
      {
        name: 'team-graph', state: 'active', phaseGuess: 'debug',
        contributors: [
          { email: 'casey@example.com', sharePct: 0.70 },
          { email: 'dana@example.com', sharePct: 0.30 },
        ],
        busFactorWarning: false,
        trend7d: [2, 3, 4, 3, 3, 2, 3],
        healthScore: 7.4, etaDays: 8, etaConfidence: 'low',
        activeTodayPct: 0.5, activeTodayCount: 1,
        lastTouch: { filePath: 'src/graph/render.ts', by: 'casey', ts: '2026-05-18T08:48:00Z' },
        llmWeekly: '团队在做 graph 视图\n进展 attention 编辑卡 / 待解决渲染抖动',
      },
      {
        name: 'devops-pipelines', state: 'maintaining', phaseGuess: 'refactor',
        contributors: [
          { email: 'casey@example.com', sharePct: 1.0 },
        ],
        busFactorWarning: true,
        // 2026-05-18 round-11 audit P1: was [1,0,1,0,1,1,0] which lands
        // on "稳步推进" (earlier=2, later=2). Reshape so the pace stat
        // reads "逐渐放缓" (earlier=7, later=2) — matches "无人推进"
        // copy + activeTodayCount=0.
        trend7d: [3, 2, 2, 1, 0, 1, 0],
        healthScore: 6.8, etaDays: 12, etaConfidence: 'low',
        activeTodayPct: 0, activeTodayCount: 0,
        lastTouch: { filePath: '.github/workflows/ci.yml', by: 'casey', ts: '2026-05-17T15:00:00Z' },
        // 2026-05-18 round-9 audit P1: matches activeTodayCount:0 + yesterday
        // lastTouch — was "团队在做 / 进展 +12%" which read as active work.
        llmWeekly: '本周 CI 流水线无人推进\n缓存命中率 +12% 是上周成果；今天 0 人在动，需安排第二个 contributor',
      },
    ] as unknown as OverviewSnapshot['projects'],
    attention: [
      {
        kind: 'member', refId: 'blake@example.com', displayName: 'blake', initials: 'bl',
        tag: '疑似卡住', tagSeverity: 'urgent',
        line2: '卡在 <span class="mono">status/page.tsx</span>',
        time: '2h 前', severity: 9,
        llmRewrite: '已在 status/page.tsx 反复尝试两天，建议结对排查 useEffect 依赖。',
      },
      {
        kind: 'project', refId: 'devops-pipelines', displayName: 'devops-pipelines', initials: 'DE',
        tag: '单点依赖', tagSeverity: 'calm',
        line2: 'casey 一人独撑',
        time: '昨日', severity: 4,
        // 2026-05-18 round-8 audit P1: was "casey 持续投入" but the project
        // pill below shows "0/1 人在做" (activeTodayCount=0 today). Past
        // tense matches the data.
        llmRewrite: 'CI 流水线长期仅 casey 一人维护，今日无人推进，建议安排第二个 contributor 接手。',
      },
    ] as unknown as OverviewSnapshot['attention'],
    highlights: [
      { ts: '2026-05-18T08:48:00Z', type: 'commit',  by: 'casey', project: 'team-graph',
        detail: 'feat(graph): attention slideover open-from-row',
        llmDigest: '加入 attention 行点击直接开 slideover 的能力' },
      { ts: '2026-05-18T08:30:00Z', type: 'push',    by: 'alex',  project: 'matrix-riven',
        detail: 'feat(views): hero count from snap.attention.length',
        llmDigest: '修一致性：hero 计数现与 attention 行同步' },
      { ts: '2026-05-18T07:10:00Z', type: 'commit',  by: 'blake', project: 'matrix-riven',
        detail: 'wip: status/page.tsx type narrowing attempts',
        llmDigest: '继续尝试收敛 status/page 类型；仍未通过 tsc' },
      { ts: '2026-05-17T22:14:00Z', type: 'release', by: 'alex',  project: 'matrix-riven',
        detail: 'v0.1.0 — initial leadership dashboard',
        llmDigest: '首版仪表盘上线：hero / KPI / attention / 项目栏到齐' },
      { ts: '2026-05-17T19:30:00Z', type: 'pr',      by: 'dana',  project: 'team-graph',
        detail: 'docs: README clarify input/output formats',
        llmDigest: '补 README：输入/输出格式定义更明确' },
    ] as unknown as OverviewSnapshot['highlights'],
    collaboration: [
      {
        filePath: 'src/leadership/views/_overview-fragments.ts',
        members: ['alex', 'blake'],
        lastTouched: '2026-05-18T08:30:00Z',
      },
    ],
  };
}
