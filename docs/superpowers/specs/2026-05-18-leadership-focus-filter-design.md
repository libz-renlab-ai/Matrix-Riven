# Leadership Dashboard · Phase 3-A 聚焦过滤器设计文档

**日期**：2026-05-18
**作者**：liboze + Claude
**前置**：
- [`2026-05-16-leadership-dashboard-design.md`](./2026-05-16-leadership-dashboard-design.md)（Phase 1）
- [`2026-05-17-leadership-phase2-design.md`](./2026-05-17-leadership-phase2-design.md)（Phase 2）

**Phase 3 总规划**：4 件独立子项目，按顺序推进（每件单独走 spec → plan → 实现）。

| # | 子项目 | 状态 |
|---|---|---|
| **A** | **聚焦过滤器（本文档）** | spec 撰写中 |
| B | Activity 活动流 | 待启动 |
| C | 成员详情完整页 | 待启动 |
| D | Insights 洞察分析 | 待启动 |

本文档**只覆盖 A**。

---

## 1. 为什么有聚焦过滤器

Phase 1-2 把"全景看板"做到了能用，但**没办法定向钻进去**。两类典型困扰：

| 场景 | 当前体验 | 想要的体验 |
|---|---|---|
| 经理担心 blake 状态 | 在 Overview 里翻成员卡找他、点抽屉看；要看他在哪个项目同样得翻 | 顶上选"blake"，整页只剩 blake 的数字、关注、项目 |
| 想专门看 devops-pipelines 项目 | 翻项目列表找它、点开抽屉，看不到"谁在上面活跃" | 顶上选"devops-pipelines"，KPI / 关注 / 成员都按这个项目重算 |

**关键约束**：用户对**所有 4 个维度**（人 / 项目 / 时间 / 状态）都有过滤需求；4 个维度要能**叠加使用**；**整页跟着变**而不是只变一个区域。

---

## 2. 头脑风暴定下的 3 个决策

| # | 决策 | 含义 | 排除掉的备选 |
|---|---|---|---|
| 1 | **过滤带式**（filter bar） | 顶 nav 下方一条独立的 chip 带，4 个 chip 对应 4 个维度 | "钻入式"（点谁就进谁，整页切换）—— 限定一次只能从一个维度看，不能叠加 |
| 2 | **整页范围** | 4 个 chip 任意组合后，**当前页所有数据**（KPI / 关注 / 成员 / 项目）按筛选重算；不跨 tab 持久化 | (a) 只变成员/项目卡（KPI 不变）；(b) 跨 tab 持久化（复杂度高、Phase 3 后续可加） |
| 3 | **每个 chip 单选** | 人 chip 选一个人，项目 chip 选一个项目，时间 chip 选一个预设，状态 chip 选一个状态 | 多选（OR 语义）；混合（不同轴不同规则）—— 95% 场景用单选就够，多选 v2 再加 |

每个决策的"为什么"都跟用户当面对过（脑暴会话日志：`.superpowers/brainstorm/551-1779116287/`）。

---

## 3. 整体方案

### 3.1 视觉

**未启用时**：顶 nav 下方一条灰白底带，4 个 chip 显示"👤 全部成员 ▾ / 📁 全部项目 ▾ / 📅 今日 ▾ / ⚠️ 全部状态 ▾"，右侧灰字"未启用"。

**启用任一时**：
- 该 chip → 橙色（`#ff9d3a`）底 + 白字 + `✕` 删除按钮
- 整个 bar → 浅橙底（`#fffaf0`）+ 橙色下边框（2 px）
- 右侧出现"↻ 清空"按钮

视觉 token 跟 Phase 2 v7 Spatial 完整对齐，复用现有 `_css.ts` 的 `--accent-warm` 变量；新增 `--filter-active-bg` / `--filter-chip-active` 两个 token。

### 3.2 9 条行为要点

| # | 要点 | 实现位置 |
|---|---|---|
| 1 | **位置**：顶 nav 下方、内容上方，独立条带，sticky=否（随页面滚走，避免遮挡） | `views/_filter-bar.html.ts`（新） |
| 2 | **默认**：4 chip 都"全部 X / 今日"；状态文字"未启用" | 同上 |
| 3 | **激活**：选了任意 chip → 该 chip 橙色 + ✕；bar 整体加橙色下边 | 同上 + 服务端依据 query 决定渲染 |
| 4 | **影响**：KPI 数字按筛选重算；KPI 标题文本拼接已激活的维度（例：`blake · matrix-riven · 近 7 天`；未激活维度从标题省略；时间维度始终显示，即便是默认"今日"）；成员卡只高亮匹配的，不匹配的 `opacity: 0.3` 但**仍可见**（不 hide，避免"东西不见了"的困惑） | `aggregator.ts` 增加 `applyFocusFilter()`；`_overview-fragments.ts` 渲染时打 `dimmed` class |
| 5 | **清空**：右侧"↻ 清空"链接，点击后 URL 去掉所有 focus query → 重渲染 | `_filter-bar.html.ts` + 客户端 `_filter-bar.client.ts`（新） |
| 6 | **单 chip 关闭**：chip 上 ✕ 点击 → URL 去掉那一个 param → 重渲染 | 同上 |
| 7 | **记忆**：过滤状态写到 URL query；刷新、复制链接、按浏览器后退都生效；不写 localStorage | `routes.ts` 解析 query 传给 aggregator |
| 8 | **出现 tab**：Overview / People / Projects 三个 tab 都显示；**Retro 不显示**（Retro 已是周度回顾，过滤会破坏其语义） | `_filter-bar.html.ts` 在三个 view 各自调用，Retro view 不调用 |
| 9 | **时间预设**：5 项 — `today` / `yesterday` / `7d` / `30d` / `custom`；custom 弹出 `<input type=date>` 双框 | `_filter-bar.html.ts` 渲染下拉菜单，custom 默认两端为今日往前推 7 天 |

### 3.3 信息架构

URL query schema：

```
/overview?focus=<email-local-part>
         &project=<project-name>
         &range=today|yesterday|7d|30d|custom
         &from=<YYYY-MM-DD>           ← 仅 range=custom 时读取
         &to=<YYYY-MM-DD>             ← 仅 range=custom 时读取
         &state=stuck|active|quiet|needs_help|low_activity
         &demo=1                       ← 现有 demo flag 与 focus 兼容
```

**与现有 `?range=` 兼容**：现有路由已支持 `?range=7d` 当成时间窗（Phase 1 时段切换），这里复用同一个 param，行为不变；新增 `today` / `yesterday` / `custom` 三个值。

---

## 4. 架构

### 4.1 模块布局（新增 + 改）

```
packages/collector-server/src/leadership/
├── aggregator.ts                              ← 改：增加 applyFocusFilter()
├── focus-filter.ts                            ← 新：filter 逻辑 + URL parser
├── __tests__/focus-filter.test.ts             ← 新：单测
├── routes.ts                                  ← 改：query → FocusFilter 解析
├── types.ts                                   ← 改：增 FocusFilter type
└── views/
    ├── _filter-bar.html.ts                    ← 新：服务端渲染 chip bar
    ├── _filter-bar.client.ts                  ← 新：客户端下拉菜单 JS 串
    ├── __tests__/_filter-bar.test.ts          ← 新
    ├── _overview-fragments.ts                 ← 改：渲染 dimmed class，调 _filter-bar
    ├── overview.html.ts                       ← 改：注入 _filter-bar
    ├── people.html.ts                         ← 改：注入 _filter-bar
    ├── projects.html.ts                       ← 改：注入 _filter-bar
    └── retro.html.ts                          ← 不动
```

### 4.2 类型

```typescript
// types.ts
export interface FocusFilter {
  focus?: string;          // member email local-part
  project?: string;        // project name
  range: RangeLabel | { from: Date; to: Date };  // 默认 'today'
  state?: MemberStateBadge;
}

export type RangeLabel = 'today' | 'yesterday' | '7d' | '30d';
```

### 4.3 服务端：filter 应用点

**在 aggregator 内部**：所有 4 个维度都映射到对 `ParsedSession[]` 的过滤，**在 signals 计算之前**就过滤完。这样所有下游 signal computer 不用知道 filter 的存在。

```typescript
// focus-filter.ts
export function parseFocusFromQuery(query: URLSearchParams): FocusFilter { /* ... */ }

export function applyFocusFilter(
  sessions: ParsedSession[],
  filter: FocusFilter,
  membersIndex: Map<string, MemberStateBadge>, // 状态过滤需要先算一遍状态再过滤
): ParsedSession[] { /* ... */ }
```

`state` 维度比较特殊——它依赖每个人**在当前时间窗下的状态徽章**，需要先用其他 3 个 filter 跑一遍状态计算、再用结果过滤。这部分在 aggregator 内分两阶段做：

1. 用 `focus + project + range` 过 sessions → 算每人 stateBadge
2. 用 `state` 在结果里筛人 → 得到最终 member 集合
3. 再返回去重新过 sessions（按 member 集合）→ 喂给所有信号计算

### 4.4 前端：渲染与交互

服务端渲染 chip bar 的当前状态（哪些 chip 激活、文字内容）。下拉菜单的展开/合上、用户挑选选项、写到 URL、跳转，这些用最小化的客户端 JS（约 60-80 行），追加到 `_refresh.js.ts` 同样的 inline `<script>` 注入路径。

**关键约束**：选择时不做"前端单页应用"那套 fetch+局部 patch；而是改 URL 然后 `location.assign()`，让服务端完整重渲染。这与现有 dashboard 服务端渲染范式一致。

### 4.5 routes 改动

每个会调用 `buildOverviewSnapshot` / `buildPeopleSnapshot` / `buildProjectsSnapshot` 的 GET handler 都改成：

```typescript
const filter = parseFocusFromQuery(url.searchParams);
const snapshot = buildOverviewSnapshot({ ..., filter });
```

handler 本身不需要懂 filter 的细节，只是把 query 解析出来再传下去。

---

## 5. 数据流

```
URL (?focus=blake&project=matrix-riven&range=7d)
  ↓
routes.ts: parseFocusFromQuery() → FocusFilter
  ↓
aggregator.buildOverviewSnapshot({ ..., filter })
  ↓
1. scan all sessions in collectorDir
  ↓
2. apply filter (focus + project + range) → filtered sessions
  ↓
3. compute member state badges on filtered sessions
  ↓
4. apply state filter → final filtered sessions
  ↓
5. compute all signals on final sessions
  ↓
6. build snapshot (members[], projects[], KPIs)
  ↓
views/overview.html.ts: render with _filter-bar showing active chips
  ↓
HTML to browser
```

服务端无需缓存 per-filter 快照——现有的 `TtlCache` key 已经包含 `range`；扩展为 key=`${focus||'all'}|${project||'all'}|${range}|${state||'all'}` 即可。

---

## 6. 行为细节

### 6.1 默认状态（无任何 query）

- `focus = undefined`
- `project = undefined`
- `range = 'today'`
- `state = undefined`
- Bar 显示"未启用"
- 跟 Phase 2 当前 `/overview` 行为完全一致 → 零 regression

### 6.2 激活状态判定

只要 `focus || project || (range !== 'today') || state` → 视为已启用。
- 注：用户**特意改成 7d** 也算启用（chip 变橙）
- 但默认就是 today，所以默认不会被误判成"启用"

### 6.3 边界 — 无匹配数据

筛选条件之下，`members.length === 0`：
- KPI 标题：仍显示"`<人> · <项目> · <时间窗>`"
- KPI 数字：`0 / 0 / $0.00 / —`
- 成员区：空状态文案"这个过滤组合下没有匹配的成员。试试放宽条件，或点 ↻ 清空。"
- 不报错、不 5xx

### 6.4 边界 — URL 参数无效

- `focus=nonexistent_user` → 服务端 silently 忽略（应用 filter 后结果为空，按 6.3 处理）
- `range=invalid` → 落回默认 `today`，stderr 一行 warning
- `from=2099-99-99` → 解析失败 → 落回默认
- 不返回 4xx；保持"页面始终能打开"

### 6.5 边界 — 冲突筛选

用户选了 `focus=blake` + `state=quiet`，但 blake 此时状态是 stuck：
- 结果为空（按 6.3 处理）
- **不**自动取消任一 chip；让用户自己看到"哦冲突了"再调

### 6.6 持久化

| 操作 | 过滤是否保留 |
|---|---|
| 刷新页面 | ✓ |
| 浏览器后退 / 前进 | ✓ |
| 复制链接给同事 | ✓ |
| 关 tab 重开 | ✗（URL 没了就没了） |
| 跨 tab 切换（Overview → People） | ✗（**故意不持久化**，决策 #2） |

### 6.7 时间预设

| 标签 | 含义 |
|---|---|
| 今日 | `now` 当天 00:00 UTC 到当前 |
| 昨日 | `now-1d` 当天 00:00 UTC 到 24:00 UTC |
| 近 7 天 | `now-7d` 到 `now` |
| 近 30 天 | `now-30d` 到 `now` |
| 自定义 | 弹出两个 `<input type="date">`，from 到 to（含两端） |

时间用 UTC 计算，跟 collector 落盘日期目录格式（`YYYY-MM-DD`，UTC）对齐。Custom 模式下的两端按 UTC 解释（`from` 当日 00:00 UTC 到 `to` 当日 24:00 UTC，闭区间）。

### 6.8 状态选项

5 个 `MemberStateBadge` 全列出：
- 活跃中（active）
- 安静（quiet）
- 卡住（stuck）
- 求助（needs_help）
- 低活跃（low_activity）

---

## 7. 不做的事（Out of scope）

| 暂不做 | 理由 |
|---|---|
| 多选每个 chip | 95% 场景单选够用；多选 UI 复杂度高，v2 再加 |
| 跨 tab 持久化 | 复杂度大幅上升（需 localStorage 同步 + 跨页 nav 注入 URL）；用户可以"打开新 tab"达到类似效果 |
| 保存"我的过滤器"功能 | YAGNI；URL 复制本身就是分享 |
| 搜索框（输入名字自动补全） | 团队小（<20 人）时 dropdown 够用 |
| 服务端排序的过滤后再排序 | 现有排序就在过滤后的列表上做，无需特殊处理 |
| filter bar 在 Retro tab 出现 | Retro 是周度回顾固定语义，加 filter 破坏语义 |
| 用前端 SPA 局部 patch | 与现有服务端渲染范式不符；keep stateless |

---

## 8. 测试策略

### 8.1 单测

| 模块 | 测试 |
|---|---|
| `focus-filter.ts::parseFocusFromQuery` | 8-10 个：所有合法值、无效值落回默认、custom range 从/到、demo flag 透传 |
| `focus-filter.ts::applyFocusFilter` | 12-15 个：每个维度单独工作、4 维度叠加、状态二阶段过滤、空匹配、缺失维度等价于不过滤 |
| `aggregator.buildOverviewSnapshot` with filter | 6-8 个：filter 透传到 signals、KPI 重算正确、members/projects 被正确筛选 |
| `views/_filter-bar.html.ts` | 6-8 个：默认状态渲染、激活态渲染（每个维度独立）、"↻ 清空"出现条件、Retro 不渲染 bar |
| `views/_filter-bar.client.ts` | 4-6 个：点击 chip 打开菜单、选项后 URL 改写、✕ 单独删除、↻ 清空全删 |

### 8.2 集成

| 路由 | 断言 |
|---|---|
| `GET /overview?focus=blake` | 200，HTML 含 `<chip ... data-active>blake</chip>`，成员区 blake 高亮 / 其他 dimmed |
| `GET /overview?project=matrix-riven&range=7d` | KPI 标题含 "matrix-riven · 近 7 天" |
| `GET /overview?focus=nonexistent` | 200，空状态文案 |
| `GET /retro?focus=blake` | 200，HTML **不含** filter bar |
| `GET /api/overview?focus=blake&range=7d` | JSON snapshot 的 members 仅 blake，KPI 重算 |

### 8.3 性能

加 1 个 perf 测试：`scripts/perf-leadership-filter.mjs`，对比"无 filter" vs "复杂 4 维度 filter"的冷热响应时间。预算：
- 冷 < 2.5s（vs 当前 2s，留 25% 给额外过滤）
- 热 p50 < 60ms（vs 当前 50ms，留 20%）

---

## 9. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 状态过滤的两阶段算法复杂 → bug 概率高 | 在 `focus-filter.test.ts` 写 5+ 个针对性测试覆盖每种组合；先实现 single-phase 路径再做 state 阶段 |
| URL params 与现有 `?demo=1` 互动出错 | demo 模式直接走 demo fixture，filter 无影响；测试覆盖 `?demo=1&focus=blake` 情况 |
| 浏览器跳转导致用户编辑状态丢失（不存在编辑场景，但若以后加） | 当前 dashboard 无可编辑状态，不是 P0 |
| 大团队（>50 人）下拉太长 | 不是 P0；超过 20 人触发分组（按状态分），v1.1 再加 |

**回滚路径**：filter bar 是新增组件，关闭路径很干净——把 `views/overview.html.ts` 里调用 `renderFilterBar()` 那 1 行删掉，其余服务端代码因为 query 缺失而走默认值，整套回到 Phase 2 行为。

---

## 10. 开放问题

无。所有决策已与用户对齐，9 条要点写实，无 placeholder。

---

## 11. 与 writing-plans 的衔接

本 spec 落地后下一步：

```
brainstorm (本轮) → spec (本文档) → writing-plans → 实施
```

接下来调用 writing-plans 技能，把本文档分解为按任务的实施清单。
