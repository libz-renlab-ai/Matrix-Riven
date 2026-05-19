# Leadership Dashboard · Phase 3-C 成员详情完整页设计文档

**日期**：2026-05-18
**作者**：liboze + Claude
**前置**：
- [`2026-05-18-leadership-focus-filter-design.md`](./2026-05-18-leadership-focus-filter-design.md)（Phase 3-A）
- [`2026-05-18-leadership-activity-design.md`](./2026-05-18-leadership-activity-design.md)（Phase 3-B，C 复用 ActivityEvent 类型）

---

## 1. 为什么有成员详情完整页

Phase 2 实现了**右侧抽屉**作为成员快速预览，但容量有限——只能放 3 个 stat 卡 + AI 一段话 + 项目缩略图。代码注释 (`_slideover.html.ts:124`) 留了 "Phase 3 完整页面" 占位。

经理用例分化为两类，需要两个交互档：

| 用例 | 当前体验 | 期望 |
|---|---|---|
| 快速看一眼这人怎么样 | 抽屉够用 | 保留抽屉 |
| 想深度了解这人最近一周/一月情况 | 抽屉装不下，得手动翻 Overview / Activity / Retro 拼凑 | 一个独立页面把这人所有维度都铺开 |

---

## 2. 头脑风暴定下的 2 个决策

| # | 决策 | 排除掉 |
|---|---|---|
| 1 | **并存**：抽屉作快速预览，独立页作深入 | (a) 替换抽屉 → 失去"扫一眼"场景；(b) 抽屉留，新页只从 People tab 进入 → 入口割裂 |
| 2 | **抽屉装不下的 4 类内容都放页面**：完整会话列表 + 7×24 热力图 + 项目深度拆解 + AI 写的近期总结 | 任一项单独取舍 |

---

## 3. 整体方案

### 3.1 URL 与入口

| 入口 | URL | 行为 |
|---|---|---|
| Overview 点成员卡片 | 不变（弹抽屉） | 抽屉 |
| **抽屉里的 "→ 查看完整资料" 链接（新）** | `/people/<member-id>` | 跳详情页 |
| People tab 点成员（如有列表样式） | `/people/<member-id>` | 跳详情页 |
| 直接访问 / 收藏链接 | `/people/<member-id>` | 跳详情页 |

`<member-id>` = email 的 local-part（与 Phase 3-A 的 `focus=` 同语义；如果跟 People tile click 现有契约一致就免新增）。

### 3.2 页面 8 个区块（从上到下）

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Overview                                                       │  ← 1. 面包屑
├─────────────────────────────────────────────────────────────────┤
│  [Avatar]  Blake Wong  <state badge>  <warnings...>               │  ← 2. Hero
│  blake@matrixriven.com                                            │
├─────────────────────────────────────────────────────────────────┤
│  [📅 7 天 ▾]  [📁 全部项目 ▾]  [⚠️ 全部状态 ▾]   ↻ 清空            │  ← 3. Focus bar (复用 Phase 3-A，但去掉 "人" chip)
├─────────────────────────────────────────────────────────────────┤
│  Today      7-day      30-day    ← 3 列 stat 卡组                  │  ← 4. KPI 三柱
│  会话 3     17          71        会话                              │
│  token 28k  342k        1.8M     token                             │
│  消耗 $1.2  $14         $76      USD                               │
├─────────────────────────────────────────────────────────────────┤
│  AI 近期总结                                                      │  ← 5. LLM 叙事 (复用 t2-member)
│  本周他主要在 matrix-riven 上 ... 已交付 ... 遇到 ...                │
├─────────────────────────────────────────────────────────────────┤
│  按项目拆解                                                       │  ← 6. 项目深度
│  matrix-riven   ████░  $9.6 / 7d   focus: slideover/leadership    │
│  team-graph     ██░░░  $3.1 / 7d   focus: render bugs              │
│  docs           ░░░░░  $0.4 / 7d   focus: README sync              │
├─────────────────────────────────────────────────────────────────┤
│  7×24 热力图                                                      │  ← 7. Heatmap
│  Mon ░░░░░░░░░██████░░░░░░░░░░░░                                   │
│  Tue ░░░░░░░░██████████░░░░░░░░░░                                  │
│  ...                                                              │
├─────────────────────────────────────────────────────────────────┤
│  完整会话列表 (71 个)                                              │  ← 8. Session list
│  2026-05-18 14:32  matrix  blake  28min  1.2k tok  "修 status..."  │
│  2026-05-18 13:10  matrix  blake  16min  0.8k tok  "继续修..."      │
│  ... (按 ts desc，分页 50/页) ...                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 行为要点

1. **抽屉→页面跳转**：抽屉底部加一行"📄 查看完整资料 →"链接，点击 `location.assign('/people/<id>')`。
2. **页面顶 focus bar**：复用 Phase 3-A 的 `_filter-bar.html.ts`，但**自动锁定 focus=<id>**（人 chip 显示该人名 + 灰色不可改）；其他三个 chip（项目/时间/状态）可调。
3. **范围联动**：focus bar 选了"项目=matrix" → KPI 三柱 / 项目拆解 / 热图 / 会话列表都按这组合算。状态默认 today / 7d / 30d 三柱并列，独立于 focus bar 的"时间"chip——focus bar 时间 chip 控制 sections 5/6/7/8（AI 总结、项目拆解、热图、会话），KPI 三柱固定显示 today / 7d / 30d 三档。
4. **会话点击展开**：每行 `<details>` 展开显示该会话的前 N 个 user prompt（复用 `MemberDetail.sessions[].firstPromptFull`）。
5. **AI 总结的范围**：当 focus bar 时间选 7d → 用 t2-member 7d 提示词；选 30d → 用 30d 版（如果尚未实现则 fallback "本范围数据更长，AI 总结基于近 7d"）。
6. **未找到该 member**：404 页 "成员 `<id>` 不在当前数据中" + 返回 Overview 链接。
7. **不渲染 Activity 流**：Activity 是单独 tab；详情页里不嵌完整 Activity 流（避免重复）。但项目拆解条目可以点 → 跳 `/activity?focus=<id>&project=<p>`，借用 B 的页面。

---

## 4. 架构

### 4.1 模块布局

```
packages/collector-server/src/leadership/
├── aggregator.ts                                ← 改：扩展 buildMemberDetail() 加 fullSessions/heatmap7x24/projectBreakdown
├── routes.ts                                    ← 改：/people/:id 从抽屉 API-only 改加 HTML 渲染
├── types.ts                                     ← 改：扩展 MemberDetail 类型（加 fullSessions / heatmap7x24 / projectBreakdown / kpiByRange）
└── views/
    ├── member-detail.html.ts                    ← 新：完整页渲染
    ├── _member-hero.ts                          ← 新：hero 区
    ├── _member-kpi-tristack.ts                  ← 新：today/7d/30d 三柱
    ├── _member-project-breakdown.ts             ← 新：项目深度
    ├── _heatmap-7x24.ts                         ← 新：通用 7x24 热图（C+D 都用）
    ├── _session-list.ts                         ← 新：分页会话列表（C+B 都用）
    ├── _slideover.html.ts                       ← 改：加"查看完整资料"链接
    └── __tests__/member-detail.test.ts          ← 新
```

### 4.2 类型扩展

```typescript
// types.ts —— 扩展现有 MemberDetail
export interface MemberDetail {
  // ... 现有字段 ...
  
  /** 三柱 KPI: today / 7d / 30d（固定三档，独立于 focus bar 时间） */
  kpiByRange: {
    today: { sessions: number; tokens: number; costUsd: number };
    last7d: { sessions: number; tokens: number; costUsd: number };
    last30d: { sessions: number; tokens: number; costUsd: number };
  };

  /** focus bar 时间窗下：项目拆解，按 token 倒序 */
  projectBreakdown: {
    name: string;
    tokens: number;
    sessions: number;
    costUsd: number;
    focusSummary: string;        // "slideover/leadership" 等关键文件/主题
  }[];

  /** focus bar 时间窗下：7×24 热图（行=星期一..日，列=0..23 时 UTC+8） */
  heatmap7x24: number[][];

  /** focus bar 时间窗下：完整会话列表（分页） */
  fullSessions: SessionSummary[];
  fullSessionsHasMore: boolean;
  fullSessionsNextCursor?: string;
}
```

### 4.3 服务端：路由

```typescript
// routes.ts
app.get('/people/:id', (req, res) => {
  const filter = { ...parseFocusFromQuery(req.query), focus: req.params.id };
  const detail = buildMemberDetail({ collectorDir, email: req.params.id, range, filter });
  if (!detail) return res.status(404).send(render404('成员', req.params.id));
  res.send(renderMemberDetail({ detail, filter, demo: !!req.query.demo }));
});
app.get('/api/people/:id', /* JSON 同 schema */);
```

### 4.4 前端

服务端渲染整页。客户端 JS：
- focus bar 交互复用 Phase 3-A 的 `_filter-bar.client.ts`
- 会话列表 "加载更多"：滚到底 fetch `?before=<lastTs>` 拼接
- 30s polling 重 fetch

---

## 5. 数据流

```
GET /people/blake?range=7d
  ↓
routes: focus = { focus: 'blake', range: '7d', ... }
  ↓
buildMemberDetail({ collectorDir, email: 'blake', filter })
  ↓
filter sessions by focus + range
  ↓
compute:
  - kpiByRange (3 windows independent: today / 7d / 30d, ignore filter time)
  - projectBreakdown (within focus bar time window)
  - heatmap7x24 (within filter window)
  - fullSessions (within filter window, paginated)
  ↓
LLM cache lookup: t2-member-summary for this member (range-keyed)
  ↓
return MemberDetail with all fields
  ↓
renderMemberDetail → HTML
```

---

## 6. 边界情况

| 情况 | 行为 |
|---|---|
| member 不存在 | 404 页（不是 200 空数据） |
| focus bar 锁定 chip 用户点 ✕ | 忽略（chip 不响应；hover 提示"请通过返回 Overview 来切换成员"） |
| LLM 还在跑 t2 没就绪 | fallback 模板文本 "本周他主要在..."（已有的 leader-lang 输出） |
| 会话量 > 500 | 列表只显示前 50，"加载更多"出现 |
| 7d 时间窗 → heatmap 数据稀疏 | 仍然画 168 格子，多数为 0；空格不画 vs 画浅灰看视觉测试 |
| 项目数 > 20 | 列表显示前 10，下方 "+ N 个项目" 折叠 |

---

## 7. 不做的事（Out of scope）

| 暂不做 | 理由 |
|---|---|
| 编辑成员（名字 / 邮箱 / 标签） | 看板是只读 |
| 设置成员目标 | 还不知道目标的 schema，留 D Insights 之后 |
| 多人对比（blake vs alex） | 留给 D Insights 的"按人对比" |
| 单 session 详情子页（`/people/blake/sessions/<sid>`） | 用 `<details>` inline 展开够用 |
| 导出 PDF | 浏览器自带 print，够用 |

---

## 8. 测试策略

| 模块 | 测试数 | 覆盖 |
|---|---|---|
| `aggregator.buildMemberDetail` 扩展字段 | 8-10 | 三柱 KPI 各自正确、项目拆解 token 排序、heatmap 行列对齐、fullSessions 分页 |
| `views/member-detail.html.ts` | 10-12 | 8 个 section 都渲染、focus bar 锁人 chip、404 页、demo 模式、空数据每个 section 占位 |
| `views/_heatmap-7x24.ts` | 4-5 | 168 格子全部产生、最大值映射颜色刻度、UTC+8 转换正确 |
| `views/_session-list.ts` | 5-6 | 分页 cursor 工作、展开/收起、空状态、超长 prompt 截断 200 字 |
| 集成 `GET /people/:id` | 6-8 | 200/HTML、404、demo、focus bar param 透传、API JSON 同 schema |

---

## 9. 风险

| 风险 | 缓解 |
|---|---|
| 抽屉 + 页面 内容重复维护 | 抽屉只用 `MemberSnapshot`（轻），页面用扩展 `MemberDetail`（重）；公共渲染函数提到 `_member-*.ts` 文件共用 |
| 30d 全量 sessions 慢 | 复用 `TtlCache`，key 包含 `member-id + range`；30d 缓存 60s（其他默认 30s） |
| LLM t2 cache miss 时页面无 AI 段 | fallback 写模板话；用户看到的是"AI 总结正在生成..." |

---

## 10. 与其他 Phase 3 子项目的接口

- **A**：focus bar 直接复用
- **B**：项目拆解条目 "查看活动 →" 跳 `/activity?focus=...&project=...`；session list 用 ActivityEvent 同 schema 的 SessionSummary
- **D**：详情页里**不含 Insights** —— Insights 是团队级，不在个人页

---

## 11. 与 writing-plans 衔接

下一步：writing-plans 拆任务。
