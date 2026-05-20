# Leadership Dashboard · Phase 3-B Activity 活动流设计文档

**日期**：2026-05-18
**作者**：liboze + Claude
**前置**：
- [`2026-05-18-leadership-focus-filter-design.md`](./2026-05-18-leadership-focus-filter-design.md)（Phase 3-A，并行进行中，B 依赖 A 的 FocusFilter 类型）

---

## 1. 为什么有 Activity 活动流

Phase 2 在 nav 里留了 `/activity · soon` 占位，当前点击得到"尚未实现"页。Activity 是 leadership 看板里**唯一按时间倒序看团队动作流**的视图——回答"今天/这周这个团队具体在干什么"。

跟现有 tab 的区别：

| Tab | 视角 | 时间锚 |
|---|---|---|
| Overview | 团队全景（KPI / 关注 / 高产） | "今日 X" 静态聚合 |
| People | 按人横列 | 默认今日 |
| Projects | 按项目横列 | 默认今日 |
| Retro | 周度文字回顾 | 本周 |
| **Activity（本文档）** | **按时间倒序事件流** | **可滚动到任意历史时间** |

Activity 提供 leadership 在前 4 个 tab 看不到的能力：**逐分钟、逐小时**精度地看团队动作展开。

---

## 2. 头脑风暴定下的 2 个决策

| # | 决策 | 排除掉 |
|---|---|---|
| 1 | **按时间倒序**（统一时间线） | 按人分组泳道；按项目分组泳道（两者跨人/跨项目的"今天怎么走的"会被打散） |
| 2 | **事件 = AI 会话 + git 里程碑** | 只 AI 会话（缺少"交付动作"上下文）；会话 + git + AI 诊断（v2 再加） |

---

## 3. 整体方案

### 3.1 视觉

一条**纵向时间线**（左侧"时间柱"），每个事件一行：

```
今天
14:32  [📝]  blake · matrix-riven  · 会话 28 min · 1.2k tok · prompt: "修 status/page.tsx 类型..."
13:45  [✅]  alex · matrix-riven   · commit · "feat(slideover): today numbers + ..."
13:10  [📝]  casey · team-graph    · 会话 12 min · 800 tok
11:20  [🚀]  alex · matrix-riven   · push · 3 commits → main
10:05  [📝]  dana · docs           · 会话 5 min · 200 tok

昨天 (2026-05-17)
22:14  [🏷️]  alex · matrix-riven   · release · v0.3.2
...
```

**事件类型 → 图标**：
- `session` → 📝（最常见）
- `commit` → ✅
- `push` → 🚀
- `pr_open` → 🔀
- `pr_merged` → 🎯
- `release` → 🏷️

**视觉层级**：会话条目用最小字号（密集）；commit/push/PR/release 加底色突出。

**日期分隔条**：每天一个 sticky header（"今天 / 昨天 / 2026-05-16"）。

### 3.2 行为要点

1. **默认窗口**：今日 + 昨日（48h）。如果数据少（<20 事件），向前扩到 7d。
2. **滚到底加载更多**：服务端分页，每页 100 事件，URL `?before=<ts>` 继续读。
3. **聚焦过滤器（Phase 3-A）适用**：顶部仍显示 A 的 chip bar；选了 blake → 流里只剩 blake 的事件，等等。
4. **会话条目可展开**：点击行 → inline 展开显示前 200 字符的 first user prompt（已经在 aggregator 里有，复用）。
5. **commit 条目可链接**：如果项目有 GitHub remote 信息（已经在 `git-remote.ts` 里有），commit 行显示 `<a href="github.com/...">` 跳到该 commit。无 remote 信息则纯文本。
6. **AI 自动刷新**：30s 心跳，与 dashboard 其他 tab 一致；新事件从顶部插入并轻微高亮 2s 渐隐。
7. **空状态**：当前过滤 + 时间窗下无任何事件 → "近 48 小时这个范围内没有活动。试试放宽过滤或换更长时间窗。"

### 3.3 信息架构

URL schema：

```
/activity                                 ← 默认 48h
/activity?range=7d                        ← 用 Phase 3-A 的 range chip
/activity?focus=blake&range=7d            ← 与 A 过滤组合
/activity?before=<ISO-ts>&limit=100       ← 分页（用户下拉触发）
/activity?demo=1                          ← demo 数据
```

### 3.4 事件来源映射

| 事件类型 | 数据来源 | 时间戳 |
|---|---|---|
| `session` | `ParsedSession.envelope` | `startTs` |
| `commit` | bash invocations in any session（已在 `signals/project-health.ts::extractMilestones` 实现） | 命令执行时刻 |
| `push` | 同上 | 同上 |
| `pr_open` / `pr_merged` | 扫 `gh pr create` / `gh pr merge` 命令 | 同上 |
| `release` | 扫 `npm publish` / `gh release create` / `git tag` | 同上 |

复用 `extractMilestones()` —— 它已经从 bash 命令里提取了 commit/push/pr/release/tag。本 spec 增加：把它的输出 + 每个 session 本身都拍扁到统一的 `ActivityEvent[]` 数组。

---

## 4. 架构

### 4.1 模块布局

```
packages/collector-server/src/leadership/
├── aggregator.ts                              ← 改：新增 buildActivityFeed()
├── activity-feed.ts                           ← 新：sessions + milestones → flat events
├── __tests__/activity-feed.test.ts            ← 新
├── routes.ts                                  ← 改：/activity 从 stub 改真实现
├── types.ts                                   ← 改：新增 ActivityEvent / ActivityFeedSnapshot
└── views/
    ├── activity.html.ts                       ← 新：渲染事件流页
    ├── __tests__/activity.test.ts             ← 新
    └── _activity-row.ts                       ← 新：单行渲染（被 activity.html 调用）
```

### 4.2 类型

```typescript
// types.ts
export type ActivityEventType =
  | 'session' | 'commit' | 'push' | 'pr_open' | 'pr_merged' | 'release' | 'tag';

export interface ActivityEvent {
  ts: string;                  // ISO timestamp
  type: ActivityEventType;
  by: string;                  // member email
  project: string;             // project name (cwd-derived or git-remote)
  /** Type-specific payload */
  summary: string;             // 一行摘要（会话→prompt preview；commit→msg first line；...）
  /** Full data when needed for click-through */
  detail?: {
    sessionId?: string;        // session 时
    tokens?: number;           // 同上
    durationMs?: number;       // 同上
    promptFull?: string;       // session 展开时显示
    commitSha?: string;        // commit 时
    githubUrl?: string;        // 有 remote 时
  };
}

export interface ActivityFeedSnapshot {
  schemaVersion: 1;
  range: { start: string; end: string; label: string };
  events: ActivityEvent[];           // 时间倒序
  hasMore: boolean;                  // 是否还有更早的事件未加载
  nextCursor?: string;               // hasMore=true 时，下一页的 before=
  computedAt: string;
}
```

### 4.3 服务端：`activity-feed.ts`

```typescript
export function buildActivityFeed(input: {
  collectorDir: string;
  range: DateRange;
  filter: FocusFilter;             // 复用 Phase 3-A 的 FocusFilter
  beforeTs?: Date;                 // 分页
  limit?: number;                  // 默认 100
}): ActivityFeedSnapshot {
  // 1. scan all sessions in [range.start, beforeTs ?? range.end]
  // 2. apply focus filter (focus/project/state)
  // 3. for each session: emit one 'session' event + push session.messages to milestone extractor
  // 4. run extractMilestones() across all filtered sessions, get [commit, push, pr_*, release, tag]
  // 5. sort by ts descending
  // 6. slice to limit; set hasMore + nextCursor
}
```

### 4.4 前端：`views/activity.html.ts`

服务端渲染完整页面（包含 nav + filter bar + event list），单页是一份字符串 HTML。客户端 JS 极少：
- 30s polling 重 fetch + 替换 DOM（与其他 tab 一致）
- 滚到底触发 `?before=<lastTs>` 加载更多
- 会话行点击展开 prompt（用 `<details>`）

### 4.5 routes.ts 改动

```typescript
// 原：
app.get('/activity', (req, res) => res.send(renderStubPage('Activity')));

// 改：
app.get('/activity', (req, res) => {
  const filter = parseFocusFromQuery(req.query);
  const before = parseISOOrNull(req.query.before);
  const snapshot = buildActivityFeed({ collectorDir, range, filter, beforeTs: before, limit: 100 });
  res.send(renderActivityPage(snapshot, { filter, demo: !!req.query.demo }));
});

app.get('/api/activity', /* JSON 同样 schema */);
```

---

## 5. 数据流

```
GET /activity?focus=blake&range=7d&before=2026-05-17T12:00:00Z
  ↓
routes: parseFocusFromQuery + parseISOOrNull
  ↓
buildActivityFeed({ filter, range, beforeTs })
  ↓
scanAllSessions(collectorDir) → filter by range + focus → [...sessions]
  ↓
emitSessionEvents(sessions) → [...sessionEvents]
extractMilestones(sessions) → [...milestoneEvents]
  ↓
sort by ts DESC → take first 100 → return + nextCursor
  ↓
renderActivityPage → HTML
  ↓
浏览器
```

---

## 6. 边界情况

| 情况 | 行为 |
|---|---|
| 范围内 0 事件 | 空状态文案，不报错 |
| 同时间戳 ms 级冲突 | 用 `sessionId` 或 `commitSha` 作 tie-breaker，稳定排序 |
| 一个 session 跨多天（startTs 在 D-1，endTs 在 D） | 归到 startTs 所在的日 |
| commit 没有作者邮箱（cwd-only） | by 字段 fallback 到 session.userId |
| 数据库式过滤后 hasMore 误判 | 跑完后再判一次：如果 `events.length === limit`，hasMore=true；否则 false |
| 分页 cursor 收到无效 ISO | 忽略 cursor，从头开始 |

---

## 7. 不做的事（Out of scope）

| 暂不做 | 理由 |
|---|---|
| AI 诊断事件（"blake 14:30 看起来卡住"） | 留给 D Insights 的 anomaly detection |
| 事件归类分组（"上午高产 / 下午调试"） | 留给 D Insights |
| 事件多选 + 批量操作 | 没需求 |
| 通知 / 提醒 | 显示性页，不是任务系统 |
| 编辑 / 删除事件 | 只读 |

---

## 8. 测试策略

| 模块 | 测试数 | 覆盖 |
|---|---|---|
| `activity-feed.ts::buildActivityFeed` | 12-15 | session 抽取、milestone 抽取、合并排序、分页 cursor 正确、focus 过滤透传、空集、相同 ts tie-break |
| `views/activity.html.ts` | 6-8 | 默认窗口渲染、过滤态渲染、日期分隔条、空状态、commit 链接（有 remote/无 remote）、`<details>` 展开 |
| 集成：`GET /activity` | 5-6 | 200/HTML 结构、过滤透传、分页 cursor 工作、demo 模式、cache key 区分 |

---

## 9. 风险

| 风险 | 缓解 |
|---|---|
| 大数据（数千事件）下页面卡顿 | 分页 + 限制单页 100 + DOM virtualization 不做（v1 OK） |
| 30d 范围下 milestone 扫描慢 | 单页限 100 + 服务端 cache key 包含 `before` cursor |
| commit message 含敏感信息 | 复用现有 `redactor.ts` 在 milestone summary 上 |

---

## 10. 与其他 Phase 3 子项目的接口

- **Phase 3-A 聚焦过滤器**：直接复用 `parseFocusFromQuery` / `FocusFilter` / `applyFocusFilter`。Activity 是 A 之后立刻能用的第一个 tab——A 没做 Activity 也跑不起来。**B 依赖 A 完成**。
- **Phase 3-C 成员详情页**：Member detail 页里"最近活动" section 直接调 `buildActivityFeed({ filter: { focus: <member> } })`。**C 依赖 B 的 ActivityEvent 类型**。
- **Phase 3-D Insights**：Insights 的 "anomaly detection" 在 activity stream 上跑（信号源相同）。**D 依赖 B 完成**。

故 Phase 3 内部依赖序：**A → B → C ↘ D**（D 与 C 可并行）。

---

## 11. 与 writing-plans 的衔接

接下来 writing-plans 把本 spec 分解为按任务实施清单。
