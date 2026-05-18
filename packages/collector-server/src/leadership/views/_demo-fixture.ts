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

import type { OverviewSnapshot } from '../types.js';

const NOW = '2026-05-18T09:00:00Z';

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
        trend7d: [3, 4, 5, 6, 7, 5, 4], deltaVs7dAvgPct: -0.18, warnings: ['卡 2 天'],
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
        llmWeekly: '本周聚焦 LLM 叙事层 T1-T3\n已交付 worker collectInputs',
      },
      {
        email: 'dana@example.com', displayName: 'dana', stateBadge: 'low_activity',
        today: { sessions: 1, tokens: 9_000, estMinutes: 18, costUsd: 0.18 },
        trend7d: [4, 3, 2, 1, 1, 1, 1], deltaVs7dAvgPct: -0.55, warnings: ['节奏下滑'],
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
        trend7d: [1, 0, 1, 0, 1, 1, 0],
        healthScore: 6.8, etaDays: 12, etaConfidence: 'low',
        activeTodayPct: 0, activeTodayCount: 0,
        lastTouch: { filePath: '.github/workflows/ci.yml', by: 'casey', ts: '2026-05-17T15:00:00Z' },
        llmWeekly: '团队在做 CI 流水线优化\n进展缓存命中率 +12% / 待补充测试覆盖',
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
        llmRewrite: 'CI 流水线仅 casey 持续投入，建议安排第二个 contributor 接手。',
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
