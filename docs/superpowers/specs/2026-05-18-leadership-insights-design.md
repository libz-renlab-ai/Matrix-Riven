# Leadership Dashboard · Phase 3-D Insights 洞察分析设计文档

**日期**：2026-05-18
**作者**：liboze + Claude
**前置**：
- [`2026-05-18-leadership-focus-filter-design.md`](./2026-05-18-leadership-focus-filter-design.md)（Phase 3-A）
- [`2026-05-18-leadership-activity-design.md`](./2026-05-18-leadership-activity-design.md)（Phase 3-B）
- [`2026-05-18-leadership-member-detail-design.md`](./2026-05-18-leadership-member-detail-design.md)（Phase 3-C）
- [`2026-05-17-leadership-phase2-design.md`](./2026-05-17-leadership-phase2-design.md)（LLM 叙事层，Insights 重度复用）

---

## 1. 为什么有 Insights

Phase 2 在 nav 里留了 `/insights · soon` 占位。Insights 是 leadership 看板**唯一一个不只是"展示"而是"解读"** 的 tab——尝试回答经理脑子里的"**为什么**"和"**接下来会怎样**"，而不只是"**发生了什么**"。

与其他 tab 的分工：

| Tab | 回答什么问题 |
|---|---|
| Overview | "现在团队怎么样？"（横切面） |
| People | "这些人各自怎么样？" |
| Projects | "这些项目各自怎么样？" |
| Activity | "刚刚发生了什么？"（时间倒序） |
| Retro | "本周做了什么？"（文字回顾） |
| **Insights** | **"为什么会这样？接下来会怎样？该做什么？"**（解读 + 预测 + 建议） |

---

## 2. 头脑风暴定下的 3 个决策

| # | 决策 | 排除掉 |
|---|---|---|
| 1 | **3 个可切换轴**：时间对比 / 人对比 / 项目对比，顶部 3 个 sub-tab | 只做 1 个轴；4+ 个轴 |
| 2 | **半图表半 AI**：每个轴下页面分上下两块——上半图表，下半 AI 写的话解读 | 纯图表；纯 AI；颠倒比例 |
| 3 | **包含 4 类增值内容**：异常发现 / 预测 ETA / 建议诊断 / 团队健康总评分 | 任一项剔除 |

---

## 3. 整体方案

### 3.1 页面结构

```
┌──────────────────────────────────────────────────────────────────┐
│  [Overview]  [People]  [Projects]  [Retro]  [Activity]  [Insights]│  ← Top nav
├──────────────────────────────────────────────────────────────────┤
│  🏥 团队健康总评分    72 / 100   ↗ +5 vs 上周         <Score Card> │  ← Section A (常驻)
│     卡住率 ↓ · 节奏 ↑ · 高产 → · 风险 ↓                            │
├──────────────────────────────────────────────────────────────────┤
│  ✨ 建议  (3 条)                                                  │  ← Section B (常驻)
│  · 让 dana 加入 matrix-riven · casey 单点风险                       │
│  · 关注 blake · 本周连续 3 天卡住 status/page.tsx                   │
│  · 该收割了 · matrix v0.3 离 1.0 还 8 天 ETA                       │
├──────────────────────────────────────────────────────────────────┤
│  ⏰ 异常发现  (2 条)                                              │  ← Section C (常驻)
│  · blake 本周 token 量是平时的 2.3x  · 可能突发任务                  │
│  · alex 周五整天无提交  · 历史无此模式                              │
├──────────────────────────────────────────────────────────────────┤
│  ┌──────┐ ┌──────┐ ┌──────────┐                                  │
│  │ 时间 │ │  人  │ │  项目    │  ← Section D - sub-tab 切换         │
│  └──────┘ └──────┘ └──────────┘                                  │
│  ───────────────────────────────────────                          │
│  <图表>                                                            │
│  (sub-tab=时间) 折线：本周/上周/上月 token 对比                     │
│  (sub-tab=人)   柱状：4 成员各项指标横向对比                         │
│  (sub-tab=项目) 柱状：3 项目各项指标横向对比                         │
│  ───────────────────────────────────────                          │
│  <AI 写的话>                                                       │
│  "本周团队总 token 较上周下降 18%，主要原因是 dana 周末不在..."     │
│  "alex 在 deliver 速度上领先（每日 commit 是平均 2x），但..."        │
│  "matrix-riven 健康度最高，但 devops-pipelines 出现 bus-factor..."  │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 各 section 详细行为

#### Section A · 团队健康总评分（常驻顶部）

- **单一 0-100 分**，加上"vs 上周 / vs 上月"箭头和数字
- 由 4 个子项加权得出：卡住率 25% / 节奏 25% / 高产 25% / 风险 25%
- 每个子项展开看具体信号（点击展开 details）
- 历史曲线：mini sparkline（30d）
- **公式版本**：v1 暂用线性加权，每子项以历史均值 +1 σ 为 100，-1 σ 为 0，截断 [0,100]

#### Section B · 建议（3-5 条，按价值排）

- 每条建议有：**触发原因**（一个或多个信号组合）+ **可操作动作** + **置信度**
- 规则引擎驱动 v1：
  - 触发"单点风险"：项目 contributor share > 0.7 + 该 contributor 节奏放缓 → 推荐人员调配
  - 触发"卡壳预警"：member stuck >= 3d + 同一文件 → 推荐对子/code review
  - 触发"deliver in sight"：项目 ETA <= 14d + 节奏稳定 → 推荐"该收割"
- LLM 二次润色（t6-recommendations 提示词），让话说人话不像规则机器人
- **不**写 actionable links（"分配 dana 到 matrix"按钮）—— 这超出"洞察"范畴

#### Section C · 异常发现（2-5 条）

- **算法**：每个 member × 每个信号 维度跑 30d baseline，今日值 z-score > 2 (or < -2) 即报异常
- 输出格式：`"<who> <signal> <direction> <magnitude>"` + LLM 一句话上下文
- 例："blake 本周 token 量是平时的 2.3x · 可能突发任务"
- **不**做：跨人异常（"团队整体异常"）

#### Section D · 3 sub-tab 对比

**sub-tab = 时间（默认）**：
- 上半：折线图（chart.js 太重，用 inline SVG）—— 团队 token / sessions / commits 每周聚合，最近 12 周
- 下半：AI 叙事 t6-insights-time（"本周 vs 上周关键变化…"）

**sub-tab = 人**：
- 上半：横向柱状 —— 4 个 member 在 5 个维度（token/sessions/cost/projects-touched/risky-actions）上的对比
- 下半：AI 叙事 t6-insights-people（"alex 领跑 deliver 速度 / blake 卡住次数最多 …"）

**sub-tab = 项目**：
- 上半：横向柱状 —— 3 个项目在 4 个维度（contributors/sessions/health-score/eta-days）上的对比
- 下半：AI 叙事 t6-insights-projects（"matrix 健康 / devops bus-factor / team-graph 节奏放缓…"）

#### Section E · 预测 ETA（嵌入到 D-项目-tab 内的每个项目卡里）

- 每个项目：基于近 14d 的 commit / push 速率 + 历史项目类比，给出"距离当前目标还需 X 天"
- 显示置信度 low/medium/high（基于数据量）
- v1 用简单线性外推；v2 可以加 LLM 提示词来"读"项目状态做更智能估算
- 这一块已部分存在于 `signals/project-eta.ts`，本 spec 增加可信度上限与 fallback

---

## 4. 架构

### 4.1 模块布局

```
packages/collector-server/src/leadership/
├── aggregator.ts                                      ← 改：buildInsightsSnapshot()
├── insights/                                          ← 新：整个子模块
│   ├── health-score.ts                                ← 新：composite scoring
│   ├── anomaly.ts                                     ← 新：z-score baseline 检测
│   ├── recommendations.ts                             ← 新：rule-based 推荐
│   ├── time-axis.ts                                   ← 新：周对比聚合
│   ├── people-axis.ts                                 ← 新：人横切对比
│   ├── projects-axis.ts                               ← 新：项目横切对比
│   └── __tests__/                                     ← 新
│       ├── health-score.test.ts
│       ├── anomaly.test.ts
│       ├── recommendations.test.ts
│       └── ...
├── llm/prompts/
│   ├── t6-insights-time.ts                            ← 新
│   ├── t6-insights-people.ts                          ← 新
│   ├── t6-insights-projects.ts                        ← 新
│   ├── t6-recommendations.ts                          ← 新
│   └── t6-anomaly-context.ts                          ← 新
├── llm/worker.ts                                      ← 改：增加 t6-* 任务调度
├── llm/cache-keys.ts                                  ← 改：增加 t6-* keys
├── routes.ts                                          ← 改：/insights 从 stub 改真实现
├── types.ts                                           ← 改：InsightsSnapshot 等类型
└── views/
    ├── insights.html.ts                               ← 新：整页渲染
    ├── _health-score-card.ts                          ← 新
    ├── _recommendations-list.ts                       ← 新
    ├── _anomaly-list.ts                               ← 新
    ├── _insights-time.ts                              ← 新（sub-tab 内容）
    ├── _insights-people.ts                            ← 新
    ├── _insights-projects.ts                          ← 新
    ├── _bar-chart.ts                                  ← 新：通用 SVG 柱图
    ├── _line-chart.ts                                 ← 新：通用 SVG 折线
    └── __tests__/                                     ← 新
```

### 4.2 类型

```typescript
// types.ts
export interface InsightsSnapshot {
  schemaVersion: 1;
  computedAt: string;
  
  healthScore: {
    value: number;                  // 0-100
    deltaVsLastWeek: number;
    deltaVsLastMonth: number;
    breakdown: {
      stuckRate: number;            // 0-100 sub-score
      rhythm: number;
      output: number;
      risk: number;
    };
    history30d: number[];           // sparkline data
  };
  
  recommendations: {
    id: string;
    severity: 'info' | 'warn' | 'critical';
    headline: string;               // "让 dana 加入 matrix-riven"
    body: string;                   // LLM-polished narrative
    triggers: string[];             // raw signal IDs that fired
  }[];
  
  anomalies: {
    member: string;
    signal: string;
    direction: 'up' | 'down';
    magnitudeRatio: number;         // 2.3 means "2.3x normal"
    narrative: string;              // LLM context
  }[];
  
  axes: {
    time: {
      weeklySeries: { weekStart: string; tokens: number; sessions: number; commits: number }[];
      narrative: string;            // LLM t6-insights-time
    };
    people: {
      members: { email: string; metrics: Record<string, number> }[];
      narrative: string;            // LLM t6-insights-people
    };
    projects: {
      projects: { name: string; metrics: Record<string, number>; etaDays: number | null; etaConfidence: 'low' | 'medium' | 'high' }[];
      narrative: string;            // LLM t6-insights-projects
    };
  };
}
```

### 4.3 服务端

```typescript
// aggregator.ts
export function buildInsightsSnapshot(input: {
  collectorDir: string;
  range: DateRange;            // 默认 last 30d
  filter: FocusFilter;
  llmCache?: LlmCache;
}): InsightsSnapshot {
  const allSessions = scanAllSessions(collectorDir);
  const filtered = applyFocusFilter(allSessions, input.filter);
  
  const healthScore = computeHealthScore(filtered, /* baseline = same range last period */);
  const anomalies = detectAnomalies(filtered, /* 30d baseline */);
  const recommendations = generateRecommendations(filtered, healthScore, anomalies);
  
  const timeAxis = buildTimeAxis(filtered);
  const peopleAxis = buildPeopleAxis(filtered);
  const projectsAxis = buildProjectsAxis(filtered);
  
  // LLM narratives (cache-only, async-fill via worker)
  attachLlmNarratives({ snapshot, llmCache });
  
  return snapshot;
}
```

### 4.4 routes

```typescript
app.get('/insights', (req, res) => {
  const filter = parseFocusFromQuery(req.query);
  const snapshot = buildInsightsSnapshot({ collectorDir, range, filter, llmCache });
  res.send(renderInsights(snapshot, { activeSubTab: req.query.axis ?? 'time', demo: !!req.query.demo }));
});
app.get('/api/insights', /* JSON */);
```

URL schema:
- `/insights` → 默认时间 sub-tab
- `/insights?axis=people` / `?axis=projects` → 指定 sub-tab
- `/insights?range=30d&focus=...` → 复用 A 的 filter

### 4.5 前端

服务端渲染整页。3 个 sub-tab 内容**全部预渲染**（用 `<div data-axis="time" class="active">...` + JS 切换可见性），避免 sub-tab 切换时重新 fetch；30s polling 重 fetch 整页。

图表用 inline SVG 自己画——团队已经在 v7 Spatial 阶段拒绝外部图表库。`_bar-chart.ts` / `_line-chart.ts` 是约 80-120 行的渲染函数。

---

## 5. 数据流

```
GET /insights?axis=people&range=30d
  ↓
buildInsightsSnapshot({ range, filter })
  ↓
filter sessions
  ↓
parallel:
  - computeHealthScore (signals/* 复用)
  - detectAnomalies (z-score on time series)
  - generateRecommendations (rule engine)
  - buildTimeAxis / buildPeopleAxis / buildProjectsAxis
  ↓
attach LLM narratives from cache (3 t6-* keys hit/miss)
  ↓
return InsightsSnapshot
  ↓
renderInsights → HTML（含 3 个 sub-tab DOM 都渲染好）
  ↓
浏览器（JS 切换 sub-tab 可见性，无额外网络）
```

### 5.1 LLM worker 增量

worker 新增 5 个任务类型 t6-*；每个的 inputs builder 从 InsightsSnapshot 抽对应输入（不发完整 snapshot）：

| 任务 | 输入 | 输出 |
|---|---|---|
| t6-insights-time | weeklySeries | narrative |
| t6-insights-people | per-member metrics | narrative |
| t6-insights-projects | per-project metrics + ETA | narrative |
| t6-recommendations | top 5 raw triggers | polished body for each |
| t6-anomaly-context | anomaly + member context | one-line narrative |

worker 的 budget gate（已存在）继续生效——一次性触发太多时排队。

---

## 6. 边界情况

| 情况 | 行为 |
|---|---|
| 数据 < 7d（团队太新） | Health Score = "数据不足，30 天后再看"；其他 section 各自空状态 |
| LLM 完全关闭（LLM_ENABLED=false） | 所有 narrative 字段为空；前端显示规则引擎原始输出（不漂亮但能看） |
| Anomaly 把整周末判异常 | baseline 中排除周末（detectAnomalies 考虑 day-of-week pattern） |
| Recommendation 跟最近一条重复 | dedup by triggers set + 7d 窗口（缓存最近发出的建议） |
| 数据中 0 个 commit（团队全只用 AI 不 commit） | 时间 sub-tab 折线只有 token/sessions 两条 |
| focus filter 选了某人 + Insights 团队级 | 仍渲染团队级（filter 在数据层只过滤；Insights 永远是团队视角；个人 insights 在 C 详情页里） |

---

## 7. 不做的事（v1 Out of scope）

| 暂不做 | 理由 |
|---|---|
| 跨组织 / 跨团队对比 | 没数据 |
| Recommendation 的"分配按钮" | 看板只读 |
| 异常实时推送（Slack / Email） | 看板不是告警系统 |
| Health Score 历史 > 30d | v1 用 30d sparkline 够看趋势 |
| 用户自定义权重 / 公式 | YAGNI，v1 用固定公式 |
| 导出 PDF / 图表图片 | 浏览器 print + 截图够用 |
| 团队级 ETA（"团队 30 天后会做什么"） | 太大，留 v2 |

---

## 8. 测试策略

| 模块 | 测试数 | 覆盖 |
|---|---|---|
| `insights/health-score.ts` | 8-10 | 4 子分独立计算正确、加权汇总、baseline 缺失时 fallback、边界 0/100 |
| `insights/anomaly.ts` | 12-15 | z-score 正负、baseline 周期、跨成员独立、空 baseline、周末忽略、新加入成员（无历史）skip |
| `insights/recommendations.ts` | 10-12 | 3 类触发规则、dedup、严重度排序、空触发空输出 |
| `insights/time-axis.ts` | 6-8 | 周聚合、缺失周补 0、tz 边界、范围切片 |
| `insights/people-axis.ts` | 5-6 | 横切指标计算、focus filter 不影响（团队级始终全员） |
| `insights/projects-axis.ts` | 5-6 | 同上 + ETA 字段透传 |
| `aggregator.buildInsightsSnapshot` | 8-10 | 各 section 都填、LLM cache miss 时空 narrative、demo fixture |
| `views/insights.html.ts` | 10-12 | 3 sub-tab DOM 都渲染、active sub-tab CSS、health score 卡 |
| `views/_bar-chart.ts` / `_line-chart.ts` | 6-8 each | SVG 维度、空数据空图、负值截断、accessibility title |
| LLM prompts t6-* | 5 each | golden 输入→断言 prompt 含 X 不含 Y |
| 集成 `GET /insights` | 6-8 | 200/HTML、axis query 切换、demo、cache-only 不卡，full LLM 路径单独测 |

预计**总测试数 100+**。

---

## 9. 风险

| 风险 | 缓解 |
|---|---|
| LLM 输出"看起来对其实错"（"alex 领先"但 alex 数据被误读） | 每个 t6-* prompt 在输入里附原始数字，输出强制 cite——同 t1-t5 既有做法；测试覆盖 prompts.test.ts |
| 异常检测假阳性多（周末轻一点就报） | day-of-week baseline + magnitudeRatio 阈值 + 用户态可视化"X 条已忽略" |
| Health Score 公式 v1 不科学 | spec 明确写 v1 是线性加权占位；v2 校准 |
| 推荐重复出现 7d 内同样建议 | dedup by triggers set + 7d cache |
| Insights 重度依赖 LLM → 成本爆炸 | 重用 Phase 2 的 50MB cache + budget gate + 每天 cost stats |
| 12-20h 实现量超出单晚 | spec 明确，分批落地：先 health-score + anomaly + axes（无 LLM 也能跑），再加 recommendations，再润色 |

---

## 10. 落地优先级（如果时间不够）

按"砍掉损失最小"排序：

1. **必须做** · `insights/health-score.ts` + `views/_health-score-card.ts` — 单一数字 + 子分，无 LLM
2. **必须做** · `insights/anomaly.ts` + `views/_anomaly-list.ts` — z-score 即可，narrative 可空
3. **必须做** · `insights/time-axis.ts` + `views/_line-chart.ts` — 一张折线就有页面价值
4. **必须做** · `views/insights.html.ts` + routes 接入 — 整页骨架
5. **应做** · `insights/people-axis.ts` + `_bar-chart.ts`
6. **应做** · `insights/projects-axis.ts`
7. **应做** · `insights/recommendations.ts`（规则引擎部分，不含 LLM）
8. **可选** · LLM narrative（t6-* 提示词 + worker 调度）— 没有就是规则机器人语气，能看
9. **可选** · ETA 嵌入项目卡 — 简单线性外推（信号已存）

---

## 11. 与 writing-plans 衔接

下一步：writing-plans 拆任务，按 §10 优先级排序。预计 30-40 个 task，跨多日实施。
