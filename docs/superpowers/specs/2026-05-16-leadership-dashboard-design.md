# Leadership Dashboard 设计文档

**日期**：2026-05-16
**作者**：liboze + Claude
**状态**：设计中（待用户最终审阅）
**前置依赖**：
- 2026-05-14 拆包 milestone（已落地，本仓库 = collector-server + uploader-client 已成型）
- 2026-05-15 leadership overview milestone（已落地的 Overview tab v1，本文档将**重写**它）

## 1. 背景与目标

### 1.1 一句话
让公司团队 leader 用浏览器打开一个本地（demo 期）或公司内网（prod 期）的 dashboard，**多次/天**地刷出团队和成员的当前状态、卡点、协作机会、项目推进度，全程**只读**，不干扰团队成员工作。

### 1.2 已确认的约束（来自 2026-05-16 brainstorming 会话）

| 维度 | 决策 | 一句话理由 |
|---|---|---|
| 首屏聚焦 | **3 张 KPI 卡平衡并排**（团队活跃 / 需关注 / 项目） | 平衡型，不偏袒任一视角 |
| 主要观众 | **真用户（团队 leader）**，非投资人/成员 | 信息密度高、不带评判口吻 |
| 使用节奏 | **每日多次随手刷**（接受微管理副作用） | 默认视图需暗示"自上次以来变化" |
| 操作能力 | **纯只读** | 不做按钮/外链/留言/通知 |
| 隐私边界 | **中等**：raw prompt 前 200 字 + 点展开看全文；tool result 默认折叠；保留 L1 脱敏 | 在透明和隐私间的折中 |
| 默认时间窗口 | **过去 7 天滚动**，可切换 | 适配 demo 数据 + 看趋势 |
| 项目识别 | **cwd 最后一段作为项目名**自动合并 | 简单，demo 阶段够用 |
| 视觉风格 | **Modern Card**（浅色 SaaS 风、圆角、留白） | 易读 + 不焦虑 |
| 显示名 | **`<email 的 @ 前部分>`** + tooltip 全邮箱 | 节省空间 |
| Demo 端口 | **6066**（本机/IANA 都冷门） | 不和 3000/8080 等常见冲突 |
| Tab 命名 | 重写现有 **Overview** tab，**不**新加 | 避免相似 tab 并存 |

### 1.3 非目标
- 不做 LLM 摘要（成本+延迟+依赖外部 key）
- 不做认证/授权（继承现有"内网受限"假设；prod 部署前再加 token gate）
- 不做实时 WebSocket 推送（用 30s 客户端轮询模拟"live"）
- 不做移动端响应式（leader 的工作环境是桌面）
- 不做多团队/多租户（一个 collector 一个团队）
- 不做导出/邮件报告（v2 再说）

---

## 2. 指标目录

### 2.1 成员级 · 18 条

| # | 指标 | 计算方法 | 信号强度 | 展示位置 |
|---|---|---|---|---|
| **A** | **状态信号** | | | |
| 1 | 摸鱼 / 低活跃 | 工作时段（09–18 本地）session=0 AND 7 日累计 token < 团队中位数 × 0.3，**且** cwd 不在主项目 | 🟡 中 | 成员卡 badge |
| 2 | 遇到困难 | 同一文件在单次 session 内 read/edit 次数 ≥ 5 AND tool 失败率 > 团队均值 | 🟡 中 | 详情页"困难点"区块 |
| 3 | 卡点 | 同一 cwd 在 24h 内开启 ≥ 3 个 session AND 整段无 git commit（bash 检测） AND/OR context 多次爆炸（OVER_200K ≥ 2） | 🟢 强 | 首屏"需关注"卡 |
| 4 | 需要协助 | raw prompt 出现关键词正则（`/卡住\|不会\|为什么.{0,4}不\|help\|stuck\|求助\|救命/i`）OR 短期内重复语义相近问题 OR WebSearch 次数 > 团队均值 × 2 | 🟢 强 | 首屏"需关注"卡 |
| 5 | 协作机会 | 两人 7 天内触碰同一**绝对路径**文件 OR 同 cwd 不同 worktree OR A 编辑了 B 7 天内 write 过的文件 | 🟡 中 | 首屏"协作"区 + 详情页 |
| **B** | **工作量 · 节奏** | | | |
| 6 | 今日活跃度（sessions / tokens / 估算工时） | session 计数；首末 message 间隔累加为"墙钟工时"；total input+output tokens | 🟢 强 | 成员卡主指标 |
| 7 | 专注度（session 平均时长 + 中断频次） | session_duration_p50；distinct cwd 切换次数（一天内） | 🟢 强 | 详情页 |
| 8 | 时段分布（早/中/晚/夜 + 工作日/周末） | message ts 分桶到 24 个小时格子 × 7 天 | 🟡 中 | 详情页 7×24 热力图 |
| 9 | 节奏变化（今日 vs 7 日均值环比） | (今日值 − 过去 7 日均) / 过去 7 日均 | 🟢 强 | 成员卡小箭头 |
| **C** | **效率 · 质量** | | | |
| 10 | tool 失败率 | count(tool_result.is_error=true) / count(tool_use) | 🟢 强 | 成员卡 + 项目卡 |
| 11 | context 爆炸次数 | OVER_200K marker 在 transcript 中出现次数 | 🟢 强 | 成员卡 warning 角标 |
| 12 | 迭代密度 | 每个"任务"（同 cwd 的连续 session 段）平均 user message 数 | 🟡 中 | 详情页 |
| 13 | prompt 状态变化 | 平均 prompt 长度按日变化曲线 | 🔴 弱推断 | 详情页（只展示曲线，不下判断） |
| **D** | **风险 · 安全** | | | |
| 14 | 危险动作触发 | bash 命令文本匹配 `/rm\s+-rf\|git\s+push\s+(-f\|--force)\|git\s+reset\s+--hard\|DROP\s+TABLE/i` | 🟢 强 | 首屏红角 + 详情页时间轴 |
| 15 | 敏感信息脱敏次数 | sum(envelope.l1_redaction_count) | 🟢 强 | 详情页（隐含工作敏感度） |
| **E** | **资源 · 成本** | | | |
| 16 | 今日成本 | tokens × 模型单价；用 Anthropic 2026-05 公开价（Opus $15/$75/Mtok, Sonnet $3/$15, Haiku $0.8/$4） | 🟢 强 | 成员卡侧栏 + 团队 KPI |
| 17 | 模型选择分布 | 按 envelope.model 字段聚合（haiku/sonnet/opus 占比） | 🟢 强 | 详情页饼图 |
| **F** | **学习 · 知识扩张** | | | |
| 18 | 外部资料依赖度 | WebSearch + WebFetch 调用次数 + 新触碰目录/扩展名计数（vs 历史） | 🟡 中 | 详情页"学习曲线" |

### 2.2 项目级 · 14 条

| # | 指标 | 计算方法 | 信号强度 | 展示位置 |
|---|---|---|---|---|
| **A** | **基础** | | | |
| 1 | 项目状态（活跃 / 维护 / 沉睡） | 7 日 sessions ≥ 5 = 活跃；1–4 = 维护；0 = 沉睡 | 🟢 强 | 项目卡 badge |
| 2 | 今日 / 本周推进 | 当日/本周 sessions 数 + distinct 触碰文件 list | 🟢 强 | 项目卡主指标 |
| 3 | ETA 投影 | 取过去 14 日完成率（heuristic：commit 次数 + 新文件数），线性外推到"假定 100%"。**UI 必须明确标注"基于节奏估算，不承诺精度"。** | 🔴 弱推断 | 项目卡（带 ℹ️ tooltip 解释） |
| **B** | **协作 · 结构** | | | |
| 4 | 参与人数 + bus factor | distinct user 数；top-1 user 占总 token 比例（>0.7 = 单人风险） | 🟢 强 | 项目卡（"3 人 · L 占 70%"） |
| 5 | 协作密度 | 多人触碰同一文件次数 / 项目文件总数 | 🟢 强 | 协作面板 |
| 6 | 技术栈构成 | 触碰文件扩展名 top-N | 🟢 强 | 项目详情页饼图 |
| 7 | 工作阶段 | 关键词 + tool 模式分类器（implement/debug/refactor/test/docs/plan） | 🟡 中 | 项目卡当前阶段标签 |
| 8 | 测试覆盖意愿 | edit(`*.test.*` \| `*_test.*` \| `__tests__/**`) 次数 / edit(其他源文件) 次数 | 🟡 中 | 详情页 |
| **C** | **健康 · 风险** | | | |
| 9 | 项目健康度 | 项目内 tool 失败率 + context 爆炸率 + 同文件反复编辑率 的复合分（0-10） | 🟢 强 | 项目卡警示等级 |
| 10 | 里程碑信号 | bash 检测 `git commit\|git push\|gh pr create\|npm publish` + tag 创建 | 🟢 强 | 详情页时间轴 |
| 11 | 沉睡 / 复活 | 最近 7 天活跃但前 7 天无 = 复活；最近 7 天无 = 沉睡 | 🟢 强 | 项目卡 badge |
| **D** | **节奏 · 投入** | | | |
| 12 | 依赖外部资料 | 项目下 WebSearch + WebFetch 次数及占比 | 🟡 中 | 详情页（研究型 vs 实现型） |
| 13 | 时间投入趋势 | 每日 token / session 7 日曲线 | 🟢 强 | 项目卡 sparkline |
| 14 | 峰值时段 | 全项目 message ts 分布到 24 小时格子 | 🟡 中 | 详情页热力图 |

---

## 3. 架构

### 3.1 模块布局

```
packages/collector-server/src/
  leadership/                    ← 新目录（核心新增）
    types.ts                     ← LeaderMemberSnapshot, LeaderProjectSnapshot,
                                   KpiCards, SignalLevel 等类型
    cache.ts                     ← in-memory TTL 缓存（30s）
    transcript-loader.ts         ← 复用 overview/disk-scan，加 transcript 内容解析
    signals/                     ← 每个信号一个文件，便于单测
      activity.ts                ← #6 #7 #9
      blockers.ts                ← #2 #3
      help-needed.ts             ← #4
      collaboration.ts           ← #5
      slacking.ts                ← #1
      quality.ts                 ← #10 #11 #12 #13
      risk.ts                    ← #14 #15
      cost.ts                    ← #16 #17
      learning.ts                ← #18
      project-status.ts          ← P1 P2 P11
      project-eta.ts             ← P3
      project-collab.ts          ← P4 P5
      project-stack.ts           ← P6 P8
      project-phase.ts           ← P7
      project-health.ts          ← P9 P10
      project-rhythm.ts          ← P12 P13 P14
    aggregator.ts                ← 把信号聚合成完整 snapshot
    routes.ts                    ← 挂载 /api/overview, /api/members/:id, /api/projects/:name
    __tests__/                   ← vitest 单测
  dashboard-html.ts              ← 改：把 Overview tab 内容替换为新的 leadership 视图
  bin-prod-server.ts             ← 改：注册 leadership.routes
  ...（其他不动）

packages/collector-server/src/leadership/views/   ← 静态 HTML 片段，server-rendered
  overview.html.ts               ← Overview tab 的 HTML 生成器
  member-detail.html.ts          ← /members/:id 的 HTML 生成器
  project-detail.html.ts         ← /projects/:name 的 HTML 生成器
  styles.css.ts                  ← Modern Card 风格的内联 CSS

packages/collector-server/src/overview/   ← 已有，不动；老 Overview tab 标记为
                                          ← 内部 "raw view" 模式可选切换（不删，
                                          ← 不丢失之前测试覆盖率）
```

### 3.2 数据流

```
┌─────────────────────────────────────────────────────────────────┐
│  RIVEN_COLLECTOR_DIR                                            │
│  └── <user_email>/<UTC_date>/<sid>.json                         │
│        (one envelope per session, transcript embedded gzip+b64) │
└────────────────────┬────────────────────────────────────────────┘
                     │ disk-scan (复用 overview/disk-scan.ts)
                     ▼
            transcript-loader
            ├── unzip 每个 session
            ├── 解析 JSONL message stream
            └── 抽出关键 events:
                · user messages (text)
                · assistant messages (text + tool_use)
                · tool_result (content + is_error)
                · bash invocations (commands)
                · file edits (paths + sizes)
                · WebSearch / WebFetch
                     │
                     ▼
            ┌──────────────────┐
            │ 18 + 14 signal   │  每个 signal 是纯函数:
            │ computers (纯)   │  (sessions[], options) => SignalValue
            └──────┬───────────┘
                   │
                   ▼
            aggregator.ts → LeaderSnapshot { kpis, members[], projects[] }
                   │
                   ▼
            cache.ts (TTL 30s)
                   │
                   ▼
            ┌─────────────────────────────────────┐
            │  HTTP routes                        │
            │  GET /api/overview                  │
            │  GET /api/members/:email_localpart  │
            │  GET /api/projects/:name            │
            │  GET /overview          ← HTML      │
            │  GET /members/:id       ← HTML      │
            │  GET /projects/:name    ← HTML      │
            └─────────────────────────────────────┘
                   │
                   ▼
            浏览器（30s 自动 fetch /api/overview，DOM diff 更新）
```

### 3.3 缓存策略

- 一个**进程级**的 `Map<cacheKey, { snapshot, computedAt }>`。
- `cacheKey` = `${dateRange}|${filterHash}`（默认 dateRange = "7d-rolling"）。
- TTL = **30 秒**（与前端轮询周期匹配；多个浏览器同时刷新只算一次）。
- prod 模式下，新 POST `/v1/cc-sessions` 进来时**不**主动失效缓存——TTL 自然过期 30s 内就行，避免请求并发问题。
- 启动时不预热（避免冷启动延迟和 OOM）。

### 3.4 性能预算

| 指标 | 目标 |
|---|---|
| 冷启动首次 `/api/overview` | < 2 秒（扫 281 MB / 488 jsonl + 全部信号） |
| 缓存命中 `/api/overview` | < 50 毫秒 |
| 单成员详情 `/api/members/:id` | < 1 秒 |
| 单项目详情 `/api/projects/:name` | < 800 毫秒 |
| 内存峰值 | < 500 MB（含 Node + 全部解析后的会话索引） |

如果实测扫盘超过 2 秒，引入**索引文件**（`<collector_dir>/.leadership-index.json`），后台异步更新。v1 不做。

---

## 4. API 契约

### 4.1 `GET /api/overview`

Query params:
- `range` = `7d` (default) | `today` | `24h` | `30d` | `custom:YYYY-MM-DD..YYYY-MM-DD`

Response (JSON):

```ts
interface OverviewResponse {
  schema_version: 1;
  range: { start: string; end: string; label: string };  // ISO + label
  computed_at: string;                                    // ISO
  kpis: {
    team_activity: { value: number; delta_vs_avg: number; unit: 'sessions' };
    attention:     { value: number; delta_today: number; breakdown: { stuck: number; needs_help: number; risky_action: number } };
    projects:      { active: number; maintaining: number; dormant: number };
  };
  members: MemberSnapshot[];
  projects: ProjectSnapshot[];
  collaboration: CollabHit[];   // 信号 #5 命中
}

interface MemberSnapshot {
  email: string;
  display_name: string;          // email local-part
  state_badge: 'active' | 'quiet' | 'stuck' | 'needs_help' | 'low_activity';
  today: { sessions: number; tokens: number; est_minutes: number; cost_usd: number };
  trend_7d: number[];            // 7 day sessions
  delta_vs_7d_avg_pct: number;
  warnings: string[];            // 短文本：'context 爆炸 2 次', 'tool 失败率 18%'
  ...
  // 仅 /api/members/:id 返回的完整版有：sessions_list, heatmap_24x7, etc.
}

interface ProjectSnapshot {
  name: string;
  state: 'active' | 'maintaining' | 'dormant' | 'revived';
  contributors: { email: string; share_pct: number }[];
  bus_factor_warning: boolean;
  trend_7d: number[];
  phase_guess: 'implement' | 'debug' | 'refactor' | 'test' | 'docs' | 'plan' | 'mixed';
  health_score: number;          // 0-10
  eta_days: number | null;       // null = 数据不足
  eta_confidence: 'low';         // 永远是 low（诚实）
}

interface CollabHit {
  file_path: string;
  members: string[];              // 邮箱
  last_touched: string;
}
```

### 4.2 `GET /api/members/:email_localpart`

Response: `MemberSnapshot`（完整版）+ `sessions: SessionSummary[]`（按时间倒序，每个含 sid 跳转链接到 Browse tab）+ `heatmap_24x7: number[][]`。

### 4.3 `GET /api/projects/:name`

Response: `ProjectSnapshot` + `recent_files: FileTouchSummary[]` + `milestones: MilestoneEvent[]` + `heatmap_24x7`。

### 4.4 错误

- 找不到成员/项目 → `404 { error: 'not_found' }`
- 解析失败 → `500 { error: 'internal', detail: '...' }`（不暴露栈）
- 不需要 auth（继承现有 collector 行为）；prod 部署前再加 token gate。

---

## 5. 前端设计（Modern Card 风格）

### 5.1 配色 / 字体

```
背景:        #f9fafb (页) / #ffffff (卡片)
主文本:      #111827
次文本:      #6b7280
分隔/边框:   #e5e7eb
强调蓝:      #3b82f6
成功绿:      #16a34a / bg #dcfce7
警告橙:      #d97706 / bg #fed7aa
错误红:      #dc2626 / bg #fee2e2
中性灰:      #71717a / bg #f4f4f5

字体:        系统字体栈
             -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
             'Hiragino Sans GB', 'Microsoft YaHei', sans-serif

数字字体:    SF Pro Display / Inter（首选）+ font-feature-settings: "tnum"
            （等宽数字，避免对齐跳）
```

### 5.2 关键组件

- **`.kpi-card`**：白底圆角 10px，padding 16px，shadow `0 1px 3px rgba(0,0,0,.06)`，宽 1/3。
- **`.member-card`**：白底圆角 10px，padding 12px，flex 横排，左 28×28 圆形 avatar（背景色由 email hash 派生），中间名字+元信息，右 badge。
- **`.project-card`**：同 member-card 但更高，内嵌一个 60×20 的 SVG/CSS sparkline。
- **`.badge.<state>`**：state ∈ {`ok`, `warn`, `stuck`, `quiet`, `low`}，颜色见 5.1。
- **`.sparkline`**：CSS only，7 个垂直 div 高度由 token 量映射；不引图表库。
- **`.heatmap`**：7×24 grid，每格颜色透明度按 token 强度。

### 5.3 页面骨架

```
┌─────────────────────────────────────────────────────────────┐
│ [Logo]  Browse  Overview*                            [⚙]    │  ← top nav (* = active)
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  团队 leadership 视图    ▼ 过去 7 天          [🔄 30s]      │  ← date selector + refresh hint
│                                                             │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐         │
│  │ 团队活跃     │ │ 需关注       │ │ 项目         │         │
│  │  147 sessions│ │  3           │ │  6           │         │
│  │  ↑12 vs 周均 │ │  1 卡点 2 求助│ │  4 活跃 2 沉睡│         │
│  └──────────────┘ └──────────────┘ └──────────────┘         │
│                                                             │
│  成员                                  按活跃 ▼ 按需关注    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ (LB) Liu Boze   14 sess · Matrix-Riven       [活跃]  │  │ ← clickable
│  │ (SY) Liu Siyu   11 sess · nb-platform        [活跃]  │  │
│  │ (JL) Julie Lua   9 sess · ml-pipeline        [卡 3h] │  │ ← red badge
│  │ (HR) Hr Dai      4 sess · static 2h          [安静]  │  │
│  │ (JV) javana00    7 sess · uploader           [活跃]  │  │
│  │ (ZZ) zhangziyi   2 sess · 个人项目           [低活跃] │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  项目                                                       │
│  ┌────────────────────────────────────┐                     │
│  │ Matrix-Riven  ▁▃▅█▇▆▅              │                     │
│  │ 3 人 · 阶段:debug · 健康 7.2/10    │                     │
│  └────────────────────────────────────┘                     │
│  ┌────────────────────────────────────┐                     │
│  │ nb-platform  ▁▂▄▅▇▆▅               │                     │
│  │ 2 人 · 阶段:implement · 健康 8.4/10 │                     │
│  └────────────────────────────────────┘                     │
│  ...                                                        │
│                                                             │
│  协作机会（7 天内）                                          │
│  ┌────────────────────────────────────┐                     │
│  │ liboze · liusy  →  same file:      │                     │
│  │ packages/shared/src/config.ts      │                     │
│  └────────────────────────────────────┘                     │
└─────────────────────────────────────────────────────────────┘
```

### 5.4 详情页骨架（成员）

```
[← Overview]  Liu Boze (liboze2026@163.com)         ▼ 过去 7 天

┌─ 概览 ─────────────────────────────────────────────┐
│ 14 sessions   892K tokens   $13.20    估算 6.2 工时 │
│ ↑18% vs 7 日均                                    │
└────────────────────────────────────────────────────┘

┌─ 状态 ──┐ ┌─ 工作量 ──┐ ┌─ 效率 ──┐ ┌─ 风险 ──┐ ┌─ 学习 ──┐
│ 活跃    │ │ 见详细    │ │ 见详细  │ │ 0 触发  │ │ 见详细  │
└─────────┘ └───────────┘ └─────────┘ └─────────┘ └─────────┘

工作时段热力图 (7×24)
┌─────────────────────────────────────────────────┐
│ 周一 ▁▁▁▁▁▁▁▁▃▅▆▇█▆▅▄▃▂▁▁▁▁▁▁                  │
│ 周二 ▁▁▁▁▁▁▁▁▂▄▆▇▆▅▃▂▁▁▁▁▁▁▁▁                  │
│ ...                                              │
└─────────────────────────────────────────────────┘

触碰文件 top 10
┌────────────────────────────────────────┐
│ packages/shared/src/config.ts   24 edits │
│ packages/uploader-client/...    12 edits │
│ ...                                      │
└────────────────────────────────────────┘

Sessions 列表（中等隐私：默认显首条 user prompt 前 200 字 + 展开）
┌────────────────────────────────────────────────────────┐
│ 2026-05-14 18:34  Matrix-Riven  3.2K tok      [展开]   │
│ ▸ "把 collector-server 的 Overview tab 重写成… (前 200)" │
│ ▾ 点击 [展开] 后：显示该 session 全部 user prompts，     │
│   每条仍是 200 字预览 + [全文]；tool result 默认折叠，   │
│   点 [详细] 才展开。继续向下钻进 raw 文件 → 跳 Browse    │
│   tab：/browse?sid=01J...                                │
│ 2026-05-14 14:20  Matrix-Riven  18K tok       [展开]   │
│ ▸ "Stop hook 自己 spawn daemon 的逻辑是不是…"           │
│ ...                                                     │
└────────────────────────────────────────────────────────┘
```

### 5.5 自动刷新

每 30 秒前端 `fetch('/api/overview?range=...')`，DOM diff 更新（不全页刷新）。无 WebSocket。视觉上加一个 **`🔄 30s`** 角标显示刷新周期，用户能看出"它在 live"。

### 5.6 隐私三段式（呼应 Q5 中等隐私决策）

| 层级 | 内容 | 默认状态 |
|---|---|---|
| L0 · 聚合视图 | KPI 卡、成员卡片、项目卡片上的数字 / badge / sparkline | 始终可见 |
| L1 · 文本预览 | 成员详情页 Sessions 列表里，每条 session 显示首条 user prompt 的**前 200 字符** | 始终可见 |
| L2 · 文本展开 | 点 [展开] 后显示该 session 所有 user prompts（每条仍是 200 字 + [全文]） | 一次点击 |
| L3 · 原始 transcript | tool result / assistant 长输出 / 完整 JSONL | 跳转到现有 Browse tab |

`tool_result` 字段在 L1/L2 永远不显示，只在 L3（Browse tab）可见。L1 redaction 在所有层级保留。

---

## 6. Demo 与 Prod 部署路径

### 6.1 Demo（本机）

```powershell
# 1. 构建
pnpm install
pnpm -r build

# 2. 指 collector_dir 到 snapshot 目录（直接用，不复制）
$env:RIVEN_COLLECTOR_DIR = "D:\0jingtong\Matrix-Riven\data\teamagent-logs-20260514-190026"
$env:PORT                = "6066"

# 3. 启
node packages/collector-server/dist/bin-prod-server.cjs

# 4. 浏览器
# http://localhost:6066/overview
```

### 6.2 Prod（几天后推到内网服务器）

- 同样的二进制，只是 `RIVEN_COLLECTOR_DIR` 改成服务器上接收 POST 写入的目录（默认 `~/riven-collector/`）。
- `PORT` 选公司可达端口（用户首选 **6066**）。
- `RIVEN_AUTH_TOKEN` 设上（启用 token gate）。
- HTTPS：用 `HTTPS_KEY_PATH` / `HTTPS_CERT_PATH` 或前面挂 nginx。
- Windows 公网 bind 需要在防火墙允许该端口（`netsh advfirewall firewall add rule name="riven-6066" dir=in protocol=tcp localport=6066 action=allow`）。本机 127.0.0.1 bind 不需要。

### 6.3 反 demo 污染

> 复用 INSTALL.md 末尾的 lesson：**不要**用 `inject-mock` + `bin-uploader` 做端到端验证，那会写假数据到 prod collector。本设计**只读** snapshot 目录，不会污染。

---

## 7. 测试计划

### 7.1 单元测试（vitest，每个 signal 一个 spec）

- 每个 `signals/*.ts` 文件配套 `__tests__/<name>.test.ts`。
- Fixture：手写 ~20 行的 mini JSONL 字符串覆盖正反例（不依赖真 snapshot）。
- 信号阈值（如"摸鱼"的 token 比例 0.3）做成**模块顶部常量**，测试时 mock 时间和团队均值。

### 7.2 集成测试（vitest）

- `__tests__/aggregator.test.ts`：给一个小 fixture 目录（3 user × 2 day × 2 session），断言 `LeaderSnapshot` 结构和关键字段。
- `__tests__/routes.test.ts`：起一个 mock HTTP server，断言 `/api/overview` 返回结构。

### 7.3 视觉烟测

- 启动 collector-server，浏览器开 `localhost:6066/overview`，肉眼对 6 个成员卡片 + 3 KPI 卡的渲染做截图存档。
- 不做 Playwright（v1 不引浏览器测试）。

### 7.4 性能测试

- 一个 `scripts/perf-overview.mjs`：`fetch /api/overview` × 100，输出 p50/p95/p99。
- 目标：冷启 < 2s，热缓存 p50 < 50ms。

---

## 8. 风险与开放问题

| 风险 | 严重度 | 缓解 |
|---|---|---|
| 281 MB / 488 jsonl 解析超过预算 | 中 | 第一个里程碑实测，若超 2s 引入 disk 索引 |
| ETA 信号弱、leader 误读 | 高 | UI 用 ℹ️ tooltip 解释；不显示精确天数，只显示"按节奏推算" |
| 关键词正则误伤（中文"卡住"出现在代码注释里被误判为求助） | 中 | 只在 user message 段匹配，不扫 assistant 输出 / tool result |
| 多人同名 cwd 最后段冲突（"src"作为项目名） | 中 | 加规则：忽略通用名如 `src/test/dist/node_modules/etc`，回退到 cwd 倒数第二段 |
| 工时估算（信号 #6）的 session 间隔虚高 | 中 | 单 session 内首末 ts 间隔，超过 30 min 间断截断 |
| 6066 端口在用户的公司内网被占用 | 低 | INSTALL 文档里 `PORT` 可改 |

---

## 9. 后续 v2 候选

- LLM 摘要："今日 A 主要做了 X、Y、Z"，需用户提供 Anthropic API key
- 周报导出（Markdown / PDF）
- 多团队 / 多 collector 聚合
- 实时 SSE 推送（替换 30s 轮询）
- 跨成员协作图（社交网络图）
- 反 surveillance：成员侧自查页（"我看起来怎样"）

---

## 10. 相关文档

- 上传机制综述：`packages/shared/src/`、`packages/uploader-client/src/` 源码
- 现有 Overview tab：`packages/collector-server/src/overview/`、`docs/superpowers/specs/2026-05-15-leadership-overview-design.md`
- 拆包 milestone：`docs/superpowers/specs/2026-05-14-teambrain-log-upload-extraction-design.md`
