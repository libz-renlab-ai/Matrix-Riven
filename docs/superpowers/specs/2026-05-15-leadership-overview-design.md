# Matrix-Riven：领导视图（Leadership Overview Dashboard）

> 设计文档 · 2026-05-15
> 上一份 spec：`docs/superpowers/specs/2026-05-14-teambrain-log-upload-extraction-design.md`
> 实现阶段：Phase 1（本 spec），后续 Phase 2 / 3 候选见 §12

## 1. 背景与目标

Matrix-Riven 现在每条 transcript 上传时都挂着 quota 块，cc-status 实时流里也包含 `cost_usd` / `tokens_5h` / `tokens_7d` / `subscription_tier` / `turn_count` / `tool_calls_*` / `model` / `cwd` / `git_branch` / 各种 utilization 字段——**数据已经在传**。

但**当前的 dashboard** (`packages/collector-server/src/dashboard-html.ts`) 只是一个 transcript 文件浏览器：Users / Dates / Sessions 三栏 + Preview 原文。`/api/quota` 数据有取，UI 只画了额度桶图，其余字段都没展示。

**Leader 拿不到任何聚合视图**——想回答"今天团队总共花了多少钱"、"谁额度告急"、"谁老把秘钥粘进 CC"、"团队在哪个项目上花时间最多"这些问题，必须自己一个个会话翻原文。

本 spec 的目标：**在服务端加一个 `/api/overview?date=YYYY-MM-DD` 聚合端点，在 dashboard 加一个 Overview tab**，把现有数据按四个领导关心的分类（成本 / 生产力 / 项目 / 质量）聚合呈现。**客户端零改动**。

## 2. 范围

**在范围**：

- 服务端：新增 `packages/collector-server/src/overview/` 模块（types / disk-scan / aggregator + 单元测试）
- 服务端：`mock-server.ts` 加一条路由 `GET /api/overview?date=YYYY-MM-DD`
- 前端：`dashboard-html.ts` 加 Tab 切换 + Overview 视图（4 个 panel，2×2 grid）
- 测试：~25 个新增测试（aggregator / disk-scan / mock-server route / dashboard HTML hook 字符串）

**明确不在范围**（每条都是单独后续 spec）：

- 多日窗口（7d / 30d / 滑动平均 / 趋势线）
- 邮件 / Slack 摘要推送
- 实时告警（阈值触发 webhook）
- 基于 raw_prompt / transcript 内容的关键词/主题分析
- 服务端 rollup 缓存或预聚合表
- 客户端新增字段采集
- `/api/*` 加 auth
- 用户身份匿名化模式

## 3. 架构与数据流

```
              ┌──────────────────────────────────────────────────────┐
              │  现有客户端（零改动）                                  │
              │  Stop → tap → queue → uploader → POST /v1/cc-sessions │
              │  SessionStart / UserPromptSubmit → POST /v1/cc-status │
              └──────────────────────────────────────────────────────┘
                                       │
                                       ▼
              ┌──────────────────────────────────────────────────────┐
              │  服务端落盘（现有，零改动）                            │
              │  $RIVEN_COLLECTOR_DIR/<user>/<date>/                   │
              │     <sid>.jsonl                   (transcript)         │
              │     <sid>.cc-status.jsonl          (实时快照流)         │
              │     <sid>.l1_redaction_count.json  (脱敏次数 sidecar)   │
              │     quota.json                     (额度快照 sidecar)   │
              └──────────────────────────────────────────────────────┘
                                       │
                          按 date 扫读
                                       ▼
              ┌──────────────────────────────────────────────────────┐
              │  ★ 新增：overview/ 模块 + /api/overview               │
              │                                                       │
              │  GET /api/overview?date=2026-05-15                    │
              │    → 单个 JSON：cost / productivity / projects /      │
              │       quality 四个 sub-tree                            │
              │                                                       │
              │  纯函数 aggregator + 按请求扫盘，无缓存                │
              └──────────────────────────────────────────────────────┘
                                       │
                                       ▼
              ┌──────────────────────────────────────────────────────┐
              │  ★ 新增：Overview tab in dashboard-html.ts            │
              │                                                       │
              │  Tab 导航：[Browse] [Overview]                         │
              │  - Browse：现有不动                                    │
              │  - Overview：一次 fetch /api/overview，4 panel 渲染   │
              │  - 点 user_id 跳 Browse + 自动选中                    │
              └──────────────────────────────────────────────────────┘
```

### 3.1 关键架构决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 上传协议 | 不变 | 数据已够用，省一轮客户端升级 |
| 客户端改动 | **零** | 4 个 panel 全用现有字段就能算 |
| 聚合 endpoint | **单个 `/api/overview?date=`** | 减少前端 fetch 串行；某 panel 慢再单独拆 |
| 计算时机 | **每次请求扫盘** | 30 用户 × 30 session/天量级，< 500ms |
| 时间窗口 | **单日** | 答"今天团队怎么样"够用；多日另立 spec |
| 钻取 | **panel 行点击跳 Browse + 自动选中** | 复用 Browse 已有 UI，最小化新代码 |

## 4. 四个 Panel 的指标

### 4.0 聚合范式（4 个 panel 公用）

cc-status 字段 `cost_usd` / `turn_count` / `tool_calls_total` / `tool_calls_failed` / `files_touched` / `tokens_5h` / `tokens_7d` 都是 **session 内累计**的——每个 snapshot 是到该时刻的累计值。

跨 session 聚合按以下两步走（**所有 4 个 panel 都遵守这个范式**）：

1. **每 session 取最新 snapshot**（`latestPerSession[session_id]`，由 `disk-scan.ts` 输出）
2. **按 user_id 求和** 各 session 的最新值

例：用户 X 今日 5 个 session，每个 session 最新 cost_usd 分别为 `[1.2, 3.4, 0.5, 0.0, 2.1]` → 用户 X 今日 cost_usd = 7.2。团队总花费 = Σ 所有用户。

非累计字段（`model` / `cwd` / `git_branch` / `session_health`）按 snapshot 计数或按 session 分组各自处理（每 panel 表里会写清）。

### 4.1 💰 Cost / Quota

| 指标 | 公式 | 数据源 |
|---|---|---|
| 团队今日总花费 USD | `Σ user_cost_today` | 每 session 取最新 cc-status `cost_usd` |
| 每用户花费排行 | 同上按 user_id 分组 | 同上 |
| Max 额度状态 | 每用户最近 `five_hour_utilization` / `seven_day_utilization` | 每 session 最新 cc-status 的 quota 字段 |
| 模型选用分布 | 按 cc-status entry 数量统计 `model` 字符串 | cc-status `model` |

UI：大数字 + 横条 leaderboard（top-10）+ 进度条 + SVG 饼图。

### 4.2 ⚡ Productivity

| 指标 | 公式 | 数据源 |
|---|---|---|
| 每人 turn 数 | `Σ max(turn_count) over sessions per user` | cc-status `turn_count`（cumulative within session）|
| 每人 tool 失败率 | `Σ tool_calls_failed / Σ tool_calls_total` | cc-status |
| 平均会话时长 | `last(ts) - session_started_at` per session，再用户聚合 | cc-status |
| OVER_200K 次数 | session 数 where any cc-status `session_health == 'OVER_200K'` | cc-status |

UI：横条 leaderboard + 时长直方图 + 计数。

### 4.3 📦 Projects

| 指标 | 公式 | 数据源 |
|---|---|---|
| Top 项目 | 按 `basename(cwd)` 聚合 session 数 + 总分钟 | cc-status `cwd` |
| Top 分支 | 按 `git_branch` 聚合 session 数 | cc-status `git_branch` |
| 用户 × 项目 矩阵 | 每用户在每个 cwd 的 session 数 | cc-status |

UI：横条 + 列表 + 简单二维表格。

### 4.4 ⚠️ Quality / Compliance

| 指标 | 公式 | 数据源 |
|---|---|---|
| 团队脱敏总数 | `Σ l1_redaction_count` | `<sid>.l1_redaction_count.json` sidecar |
| 用户脱敏排行 | 同上分组 | 同上 |
| Tool 失败热点 | `Σ tool_calls_failed` per user | cc-status |
| 失控会话 | session list where any snapshot 满足 `OVER_200K` | cc-status |

UI：大数字 + 横条 + 警告色列表（可点击钻 Browse）。

### 4.5 几个微决策

- **成本聚合**：每 session 取 cc-status 最新一条的 `cost_usd`（语义为 session 累计美元）然后按 user 求和。
- **模型分布**：按 cc-status entry 条数计，不按 turn_count 加权。简单先做。
- **用户标识**：直接用 `user_id`（git email），不做花名册映射。

## 5. 服务端模块设计

### 5.1 文件布局

```
packages/collector-server/src/
├── overview/                       ← 新增目录
│   ├── types.ts                    ← OverviewResponse 接口
│   ├── disk-scan.ts                ← scanForOverview(outputDir, date) → RawSnapshots
│   ├── aggregator.ts               ← buildOverview(raw, date) → OverviewResponse（纯函数）
│   └── __tests__/
│       ├── aggregator.test.ts
│       └── disk-scan.test.ts
└── mock-server.ts                  ← 加 if (path === '/api/overview') 分支
```

**纯函数边界**：`aggregator.ts` 接受已 parse 好的 snapshot 数组 + redaction sidecar 数组，返回 JSON——无 fs / 无网络，单测无需 tmpdir。`disk-scan.ts` 负责脏活，返回结构化数据。

### 5.2 接口签名（待实现细化）

```typescript
// overview/types.ts
export interface OverviewResponse {
  date: string;
  generated_at: string;
  cost: CostBlock;
  productivity: ProductivityBlock;
  projects: ProjectsBlock;
  quality: QualityBlock;
}

// overview/disk-scan.ts
export interface RawSnapshots {
  allSnapshots: CcStatusSnapshot[];
  latestPerSession: Map<string, CcStatusSnapshot>;
  redactionsPerSession: Map<string, number>;
}
export function scanForOverview(outputDir: string, date: string): RawSnapshots;

// overview/aggregator.ts
export function buildOverview(raw: RawSnapshots, date: string): OverviewResponse;
```

每个 panel 一个内部 aggregator 函数（`aggregateCost` / `aggregateProductivity` / `aggregateProjects` / `aggregateQuality`），单测独立。

### 5.3 Response JSON 形状（前端契约）

```json
{
  "date": "2026-05-15",
  "generated_at": "2026-05-15T13:30:00.000Z",
  "cost": {
    "team_total_usd": 234.56,
    "per_user": [
      { "user_id": "liboze2026@163.com", "cost_usd": 89.12 }
    ],
    "quota_per_user": [
      { "user_id": "...", "subscription_tier": "max20x",
        "five_hour_utilization": 0.8, "seven_day_utilization": 0.3,
        "five_hour_reset_at": 1234567890, "seven_day_reset_at": 1234567890,
        "stale": false }
    ],
    "model_distribution": [
      { "model": "claude-opus-4-7", "snapshot_count": 1234, "pct": 0.42 }
    ]
  },
  "productivity": {
    "per_user": [
      { "user_id": "...", "turn_count": 45, "tool_calls_total": 89,
        "tool_calls_failed": 3, "session_count": 8,
        "avg_session_minutes": 32, "over_200k_count": 0 }
    ]
  },
  "projects": {
    "top_cwd": [
      { "cwd_basename": "Matrix-Riven", "session_count": 12, "total_minutes": 120 }
    ],
    "top_git_branch": [
      { "git_branch": "main", "session_count": 30 }
    ],
    "user_cwd_matrix": [
      { "user_id": "...", "cwd_basename": "...", "session_count": 3 }
    ]
  },
  "quality": {
    "team_total_redactions": 14,
    "redactions_per_user": [
      { "user_id": "...", "redaction_count": 5 }
    ],
    "tool_failures_per_user": [
      { "user_id": "...", "tool_calls_failed": 3 }
    ],
    "out_of_control_sessions": [
      { "user_id": "...", "session_id": "...",
        "reason": "OVER_200K", "ts": "2026-05-15T11:23:45Z" }
    ]
  }
}
```

### 5.4 性能估算

- 30 用户 × 20 session/天 × 30 snapshot/session ≈ 18K JSON 行 / ~9MB
- 冷 SSD readdir + parse ≈ 200–500ms
- **不需要缓存**。6 个月后规模上去再加 rollup。

## 6. 前端 Dashboard 改动

### 6.1 UI 结构

```
┌─ Header
│   Riven Collector  |  [Browse] [Overview]  |  last refreshed 14:30  |  [Refresh]
├─ Tab content（一次只显示一个）
│
│   Browse tab（现有）：保留 Users/Dates/Sessions/Preview 四栏不变
│
│   Overview tab（新增）：2×2 panel grid
│     ┌─────────────────┬─────────────────┐
│     │ 💰 Cost          │ ⚡ Productivity  │
│     ├─────────────────┼─────────────────┤
│     │ 📦 Projects      │ ⚠️ Quality       │
│     └─────────────────┴─────────────────┘
```

### 6.2 UI 决策

| 项 | 选择 | 理由 |
|---|---|---|
| 图表库 | 零外部依赖，HTML/CSS 横条 + SVG 饼图 | dashboard 现状就零依赖，保留这个原则 |
| 默认 tab | Browse | 保护现有用户习惯 |
| Refresh | 手动 + 切 tab 时自动 fetch | 单次 < 500ms，不轮询 |
| 钻取 | 点 user_id → 跳 Browse tab + 自动选中 | 复用 Browse 逻辑 |
| 移动端 | 不做适配 | 内部桌面工具 |

### 6.3 新增 JS helper

```javascript
function activateTab(name) { ... }              // Browse / Overview
function renderBar(value, max, label) { ... }   // 横条
function renderPie(slices, colors) { ... }      // SVG 饼
```

## 7. 隐私边界 + 边缘 case

### 7.1 隐私姿态

**Overview 与现有 Browse 同一姿态**——leader 已经能在 Browse 看 transcript 原文，新增聚合视图不引入新隐私曝面。

**显示**：用户名 leaderboard、每人 cost / quota / turn / tool 失败 / cwd / git_branch / 脱敏次数。

**不显示**（明确切割）：raw_prompt 内容、transcript 任何片段、关键词敏感检测——这些只在 Browse 提供，Overview 是**度量**视图，Browse 是**证据**视图。

### 7.2 边缘 case 表

| 场景 | 行为 |
|---|---|
| 当天无任何数据 | 返回结构完整、所有数组空。前端 panel 显示「No data」 |
| 某用户今天没产 cc-status | 该用户不出现在 Overview 任何 panel；Browse 里照旧 |
| `.cc-status.jsonl` 单行坏 | 跳过该行，继续 |
| `.l1_redaction_count.json` 缺失 | redaction = 0 |
| 用户目录读权限失败 | 该用户跳过，stderr 一行日志，Overview 不挂 |
| 服务端时钟与客户端时钟不一致 | 按 server-clock 落 `<date>/`，Overview 用 server-clock 解读（沿用现有行为） |
| 单 session 只 1 个 snapshot | 照样计入；turn_count / tool_calls 可能 0；avg_session_minutes = 0 |
| session 跨午夜 | snapshot 按其 ts 所在的 date 分桶——会出现"半个 session"。先接受，跨日合并另立 spec |
| `cost_usd` 缺失（早期版本数据） | 当 0 计 |
| `subscription_tier` 字符串五花八门 | 直接 echo；不归一化 |

### 7.3 安全 / 鉴权

`/api/overview` 与现有 `/api/*`（`/api/users` / `/api/cc-status` 等）**同一保护级别**——LAN-readable，无 auth。本 spec 不引入差异。`/api/*` 加 auth 是另立 spec 的事。

## 8. 测试矩阵

| 模块 | 测试形式 | 关键断言 | 估算用例数 |
|---|---|---|---|
| `overview/aggregator.ts` | fixture 数组 → 调函数 → 校 JSON | 每个 aggregator ≥ 5 case：空 / 单用户 / 多用户 / 字段缺失 / 典型 | ~20 |
| `overview/disk-scan.ts` | tmpdir 造文件树 | 分组正确、跳坏行、缺 sidecar = 0、跳损坏目录 | ~5 |
| `mock-server.ts` 新路由 | startMockServer + 请求 `/api/overview?date=` | 200 + JSON shape / 400 on bad date / 空数据完整结构 | ~5 |
| `dashboard-html.ts` | 字符串包含断言 | `id="tab-overview"` / `/api/overview` / `activateTab` 等 hook 存在 | ~3 |
| 端到端冒烟（不入 CI） | 真机：起 server + 几条 inject-mock + curl `/api/overview` | 4 个 panel 都有真值；浏览器看 Overview tab 正常 | 手验 |

**预期新增测试数 ~33**。当前 461 → 大约 494。

## 9. Rollout 步骤

```
commit 1: feat(collector-server/overview): types + aggregator 纯函数 + 全测试
   ├ overview/types.ts
   ├ overview/aggregator.ts
   └ overview/__tests__/aggregator.test.ts
   ✓ pnpm --filter @matrix-riven/collector-server test 全绿

commit 2: feat(collector-server/overview): disk-scan + 单元测试
   ├ overview/disk-scan.ts
   └ overview/__tests__/disk-scan.test.ts

commit 3: feat(collector-server): mount /api/overview 路由
   ├ mock-server.ts +20 行
   └ __tests__/mock-server.test.ts overview case
   ✓ curl `/api/overview?date=...` 返回合法 JSON

commit 4: feat(collector-server/dashboard-html): Overview tab
   ├ dashboard-html.ts +200 行
   └ __tests__/dashboard-html.test.ts 字符串断言
   ✓ 浏览器手动验

commit 5: docs: README 加 Overview tab 用法
```

每 commit 独立可绿、可 reviewable。一个 PR 合并到 main。

## 10. 验收标准

1. `pnpm -r typecheck` / `pnpm test` / `pnpm -r build` 全绿
2. `curl http://localhost:<port>/api/overview?date=2026-05-15` 返回 §5.3 形状的 JSON
3. 浏览器打开 dashboard → 默认 Browse tab（向后兼容）
4. 切 Overview tab → 4 个 panel 都渲染 + 有真实数据
5. 点 panel 里的 user_id → 跳 Browse tab + 自动选中
6. 某 panel 数据缺失 → 该 panel 空态，其他 panel 正常

## 11. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 扫盘性能在数据量增长后退化 | 当前 6 用户 ≈ 几十 ms；20 用户应 < 500ms。超 1s 再加 rollup（独立 spec）|
| 单 endpoint 4 panel 数据耦合，一个慢拖全部 | aggregator 拆 4 个纯函数，必要时未来再单独 endpoint。MVP 单 endpoint 简单 |
| `cc-status.jsonl` 行格式坏导致整 session 错 | 行级 try/catch，坏行跳过；不影响其他 session |
| 单 session 跨午夜统计不准 | 接受 MVP "按 date 分桶"行为；跨日合并另立 spec |
| dashboard-html.ts 越长越难维护 | 当前 ~200 行；加 200 行后 ~400 行。超过 600 行考虑拆模块 |
| 隐私争议（leaderboard 暴露个人指标） | 设计明确"与 Browse 同姿态"；如组织需要匿名模式，单独 spec 加 `?anonymize=1` |

## 12. 后续 spec 候选（按潜在优先级）

1. **多日窗口 + 趋势线**：`/api/overview?window=7d` + 折线图
2. **服务端 rollup 缓存**：每小时预聚合，单 endpoint 改读缓存
3. **每日邮件 / Slack digest**：cron 触发，markdown 摘要推送
4. **实时告警**：cc-status 入流时检测阈值，触发 webhook
5. **关键词 / 主题分析**：先做隐私政策决策，再选 NLP 方案
6. **`/api/*` 加 auth**：基于团队鉴权方案统一加
7. **客户端补字段**：如发现某 panel 数据稀疏可针对性加（例如 git remote URL）

---

> 实现状态：已设计 · 待开发（实施计划见 `docs/superpowers/plans/2026-05-15-leadership-overview.md`）
