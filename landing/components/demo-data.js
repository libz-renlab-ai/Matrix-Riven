/* Hand-curated demo content for the pitch site.
   Mock data shape follows packages/collector-server/src/leadership/types.ts. */

window.DEMO = {
  computedAt: "2026-05-20T09:00:00Z",
  rangeLabel: "7 日窗口",

  /* ---- Hero: counters seeded with believable team size ---- */
  hero: {
    transcriptsCaptured: 18472,
    decisionsExtracted:  9215,
    redactionsApplied:    524,
    teamsConnected:        12
  },

  llmBrief: [
    "今日团队推进顺利：核心 dashboard 模块已上线，CI 全绿。",
    "一名工程师在 status/page.tsx 推进受阻 2 天，建议安排一次结对排查。",
    "明日聚焦 LLM 叙事层与 OKR 联动；本周已无悬而未决的发布。"
  ],

  /* ---- Overview KPIs ---- */
  kpis: {
    attention:  { value: 2, deltaToday: -1 },
    highOutput: { count: 2, avgDeltaPct: 0.18 },
    spend:      { todayUsd: 4.32 },
    pace:       { rhythmDelta: 0.04, label: "稳" }
  },

  members: [
    {
      email: "alex@example.com", displayName: "alex", initials: "al",
      avatarClass: "av-4", status: "active", stateBadge: "active",
      today: { sessions: 7, tokens: 84000, costUsd: 1.65 },
      trend7d: [5,6,7,7,8,6,7], deltaVs7dAvgPct: 0.12,
      topProject: "matrix-riven", lastSessionAt: "2026-05-20T08:30:00Z",
      toolFailureRate: 0.06,
      llmWeekly: ["本周聚焦 overview 仪表盘","已交付 hero 与 KPI 卡片骨架"],
      health: 9.4
    },
    {
      email: "blake@example.com", displayName: "blake", initials: "bl",
      avatarClass: "av-1", status: "warn", stateBadge: "stuck",
      today: { sessions: 4, tokens: 51000, costUsd: 0.92 },
      trend7d: [9,7,5,3,2,1,4], deltaVs7dAvgPct: -0.18,
      topProject: "matrix-riven", lastSessionAt: "2026-05-20T07:10:00Z",
      toolFailureRate: 0.31,
      llmWeekly: ["本周聚焦 status/page.tsx 报错","卡在类型推导，需要结对排查"],
      health: 6.9
    },
    {
      email: "casey@example.com", displayName: "casey", initials: "ca",
      avatarClass: "av-2", status: "active", stateBadge: "active",
      today: { sessions: 6, tokens: 72000, costUsd: 1.41 },
      trend7d: [4,5,5,6,7,6,6], deltaVs7dAvgPct: 0.21,
      topProject: "team-graph", lastSessionAt: "2026-05-20T08:48:00Z",
      toolFailureRate: 0.04,
      llmWeekly: ["本周聚焦 team-graph 视图渲染","已交付 attention 编辑卡联动"],
      health: 9.6
    },
    {
      email: "dana@example.com", displayName: "dana", initials: "da",
      avatarClass: "av-3", status: "idle", stateBadge: "low_activity",
      today: { sessions: 0, tokens: 0, costUsd: 0 },
      trend7d: [4,3,2,1,1,1,0], deltaVs7dAvgPct: -0.55,
      topProject: "team-graph", lastSessionAt: "2026-05-19T19:30:00Z",
      toolFailureRate: 0.02,
      llmWeekly: ["本周聚焦 文档同步","本周节奏放缓 · 多日无新会话"],
      health: 9.8
    }
  ],

  attention: [
    {
      kind: "member", refId: "blake@example.com",
      displayName: "blake", initials: "bl", avatarClass: "av-1",
      tag: "进展受阻", tagSeverity: "urgent",
      llmRewrite: "已在 status/page.tsx 反复尝试两天，建议结对排查 useEffect 依赖。",
      time: "2h 前", severity: 9
    },
    {
      kind: "project", refId: "devops-pipelines",
      displayName: "devops-pipelines", initials: "DE", avatarClass: "av-6",
      tag: "单点依赖", tagSeverity: "calm",
      llmRewrite: "CI 流水线长期仅 casey 一人维护，今日无人推进，建议安排第二位贡献者。",
      time: "昨日", severity: 4
    }
  ],

  projects: [
    {
      name: "matrix-riven",
      phaseGuess: "implement",
      trend7d: [4,5,6,7,6,6,6],
      healthScore: 8.2, etaDays: 5,
      activeTodayCount: 2, totalContributors: 2,
      lastTouch: { filePath: "src/leadership/views/_overview-fragments.ts", by: "alex", ts: "2026-05-20T08:30:00Z" },
      llmWeekly: ["团队在做 leadership 仪表盘","进展 T1-T3 上线 / 待整合 worker"]
    },
    {
      name: "team-graph",
      phaseGuess: "debug",
      trend7d: [2,3,4,3,3,2,3],
      healthScore: 7.4, etaDays: 8,
      activeTodayCount: 1, totalContributors: 2,
      lastTouch: { filePath: "src/graph/render.ts", by: "casey", ts: "2026-05-20T08:48:00Z" },
      llmWeekly: ["团队在做 graph 视图","进展 attention 编辑卡 / 待解决渲染抖动"]
    },
    {
      name: "devops-pipelines",
      phaseGuess: "refactor",
      trend7d: [3,2,2,1,0,1,0],
      healthScore: 6.8, etaDays: 12,
      activeTodayCount: 0, totalContributors: 1,
      lastTouch: { filePath: ".github/workflows/ci.yml", by: "casey", ts: "2026-05-19T15:00:00Z" },
      llmWeekly: ["本周 CI 流水线无人推进","今天 0 人在动，建议安排第二位贡献者"]
    }
  ],

  highlights: [
    { ts: "2026-05-20T08:48:00Z", type: "commit",  by: "casey", project: "team-graph",
      llmDigest: "加入 attention 行点击直接开 slideover 的能力" },
    { ts: "2026-05-20T08:30:00Z", type: "push",    by: "alex",  project: "matrix-riven",
      llmDigest: "修一致性：hero 计数现与 attention 行同步" },
    { ts: "2026-05-20T07:10:00Z", type: "commit",  by: "blake", project: "matrix-riven",
      llmDigest: "继续尝试收敛 status/page 类型；仍未通过 tsc" },
    { ts: "2026-05-19T22:14:00Z", type: "release", by: "alex",  project: "matrix-riven",
      llmDigest: "首版仪表盘上线：hero / KPI / attention / 项目栏到齐" }
  ],

  /* slideover details */
  memberDetail: {
    blake: {
      callout: "已在 <em>status/page.tsx</em> 反复尝试两天，建议结对排查 useEffect 依赖。",
      stats: { rhythm: "↘ 逐渐放缓", focus: "聚焦 matrix-riven", state: "进展受阻" },
      usage: { sessions: 4, tokens: "51.0k", cost: "0.92" },
      evolve: [
        { ts: "07:10", topic: "排错 / 修 bug",    len: 84 },
        { ts: "06:42", topic: "类型 / 接口",      len: 132 },
        { ts: "06:18", topic: "排错 / 修 bug",    len: 96 },
        { ts: "昨 22:14", topic: "排错 / 修 bug", len: 58 }
      ]
    },
    alex: {
      callout: "正常推进 <em>matrix-riven</em>，本周 <em>稳步上行</em>。",
      stats: { rhythm: "↗ 稳步上行", focus: "聚焦 matrix-riven", state: "活跃中" },
      usage: { sessions: 7, tokens: "84.0k", cost: "1.65" },
      evolve: [
        { ts: "08:30", topic: "UI / 样式",     len: 142 },
        { ts: "08:02", topic: "常规编码",     len: 88 },
        { ts: "07:21", topic: "重构",         len: 102 }
      ]
    },
    casey: {
      callout: "正常推进 <em>team-graph</em>，本周 <em>稳步上行</em>。",
      stats: { rhythm: "↗ 稳步上行", focus: "聚焦 team-graph", state: "活跃中" },
      usage: { sessions: 6, tokens: "72.0k", cost: "1.41" },
      evolve: [
        { ts: "08:48", topic: "UI / 样式",   len: 64 },
        { ts: "08:12", topic: "排错 / 修 bug", len: 121 },
        { ts: "07:30", topic: "性能",        len: 78 }
      ]
    },
    dana: {
      callout: "已经 14h 前活跃 · 没有新动作 — <em>本周参与不多</em>。",
      stats: { rhythm: "↘ 节奏下滑", focus: "聚焦 team-graph", state: "本周参与不多" },
      usage: { sessions: 0, tokens: "0", cost: "0.00" },
      evolve: [
        { ts: "昨 19:30", topic: "文档", len: 52 }
      ]
    }
  },
  projectDetail: {
    "matrix-riven": {
      callout: "团队在做 <em>leadership 仪表盘</em>，T1-T3 已上线，待整合 worker。",
      stats: { rhythm: "↗ 稳步上行", team: "2 位贡献者", health: "良好" },
      evolve: [
        { ts: "09:14", note: "提交 · feat(slideover): today numbers" },
        { ts: "08:30", note: "推送 · feat(views): hero count" },
        { ts: "07:10", note: "提交 · wip: status/page.tsx narrowing" }
      ]
    },
    "team-graph": {
      callout: "团队在做 <em>graph 视图</em>，进展 attention 编辑卡 / 待解决渲染抖动。",
      stats: { rhythm: "→ 稳步推进", team: "2 位贡献者", health: "良好" },
      evolve: [
        { ts: "11:00", note: "提交 · fix(graph): jitter on layout" },
        { ts: "15:22", note: "提交 · feat(graph): attention drill-in" }
      ]
    },
    "devops-pipelines": {
      callout: "CI 流水线长期仅 casey 一人维护，今日无人推进，<em>建议安排第二位贡献者</em>。",
      stats: { rhythm: "↘ 逐渐放缓", team: "1 位（单点）", health: "可关注" },
      evolve: [
        { ts: "昨 15:00", note: "提交 · chore(ci): bump runner image" },
        { ts: "周三",     note: "发布 · gh release create v0.3.2" }
      ]
    }
  },

  /* ---- VC pitch content ---- */
  problems: [
    { glyph: "?", title: "团队今天在做什么？",
      copy: "Slack 标记的 9 个 PR + 4 张 Jira 卡 + 几条群消息，凑不出一句完整答案。" },
    { glyph: "⌧", title: "谁卡在哪？",
      copy: "1:1 之前你只能猜。问得太早是骚扰，太晚已经错过结对的窗口。" },
    { glyph: "$", title: "Claude Code 到底花了多少钱？",
      copy: "财务报表月底才到。今天高产出的人可能今天就把月度预算花完了。" },
    { glyph: "△", title: "哪条线只剩一个人？",
      copy: "单点依赖是组织最大的隐性风险。等那个人请假，你才会发现 CI 没人维护。" }
  ],

  llmTiers: [
    {
      key: "T1", name: "单 session 总结", model: "haiku",
      sub: "约 80 字 · 单次 < $0.005",
      desc: "一次 Claude Code 会话结束后立刻总结：在哪个项目、动了哪几个文件、问题是什么。是后面四层的原子。",
      input:
`{
  "session_id": "ses_8f3a2c",
  "user": "blake",
  "project": "matrix-riven",
  "messages": 47,
  "tools": [
    { "name": "Read",  "path": "src/app/status/page.tsx" },
    { "name": "Edit",  "path": "src/app/status/page.tsx" },
    { "name": "Bash",  "cmd": "pnpm tsc --noEmit" }
  ],
  "first_prompt": "status/page.tsx 的 useEffect 依赖一直报错…"
}`,
      output:
`blake 在 matrix-riven 排查 status/page.tsx 的
useEffect 依赖告警，对 useEffect 的 deps 反复
做了 4 次类型收敛尝试，tsc --noEmit 一直没
通过。本次会话以未结案告终。`
    },
    {
      key: "T2", name: "成员周 digest", model: "sonnet",
      sub: "2 行 · 一人一卡 · 每日刷新",
      desc: "把一位成员本周的会话浓缩成两行：第一行交付了什么，第二行下一步或正在卡的事。直接喂给成员 tile。",
      input:
`blake 的本周（5 天）共 18 个会话，主要分布：
  matrix-riven  · status/page.tsx     12 次
  matrix-riven  · src/leadership/*     4 次
  internal-tools · 工具脚本             2 次
工具失败率 31% · OVER_200K 1 次 ·
最近 4 次 prompt 均与 useEffect 类型相关`,
      output:
`本周聚焦 status/page.tsx 报错
卡在类型推导，需要结对排查`
    },
    {
      key: "T3", name: "项目周 digest", model: "sonnet",
      sub: "2 行 · 一个项目一卡",
      desc: "把同一个项目本周所有相关会话合成两行：团队在推什么、进展到哪、待解决什么。",
      input:
`matrix-riven 本周共 9 位贡献者参与（alex 55% · blake 45%）
本周关键事件：
  ✓ alex   feat(slideover): today numbers
  ✓ blake  wip: status/page.tsx narrowing (3 次)
  ✓ alex   feat(views): hero count
busFactor=false · ETA 5d (low confidence)`,
      output:
`团队在做 leadership 仪表盘
进展 T1-T3 上线 / 待整合 worker`
    },
    {
      key: "T4", name: "Attention 编辑卡", model: "sonnet",
      sub: "一句结论 · 一句建议 · 一句证据",
      desc: "把模板生成的「卡 2 天」改写成领导能直接转给 manager 的中文：结论 + 建议 + 出处。",
      input:
`触发：state=stuck · 持续 2 天
信号叠加：
  · failureRate=0.31（>0.25 阈值）
  · 重复 prompt 主题：类型/接口 4/4
  · OVER_200K 1 次 · last tool: Bash tsc fail
原始模板："blake 卡在 status/page.tsx 已经 2 天"`,
      output:
`已在 status/page.tsx 反复尝试两天，
建议结对排查 useEffect 依赖。`
    },
    {
      key: "T5", name: "领导日报", model: "sonnet",
      sub: "3 行 · 一天一发 · hero 顶部",
      desc: "全队一天的 60 个会话浓缩成 3 行：今天发生了什么、需要你今天看什么、明天聚焦什么。",
      input:
`team_today: 4 active · 0 quiet · 60 sessions
attention rows: 1 stuck (blake) · 1 single_owner (devops)
high_output: 2 (alex +12% · casey +21%)
$ today: 4.32 (within budget)
notable highlights: release v0.1.0 · push hero count fix`,
      output:
`今日团队推进顺利：核心 dashboard 模块已上线，CI 全绿。
一名工程师在 status/page.tsx 推进受阻 2 天，建议安排一次结对排查。
明日聚焦 LLM 叙事层与 OKR 联动；本周已无悬而未决的发布。`
    }
  ],

  signals: [
    { id: "active",        glyph: "⬢", name: "活跃成员",     cat: "节奏",
      desc: "今天有 ≥1 个新会话的成员",
      example: "今日 4 活跃 · 0 安静（昨日同时段为 3 活跃 · 1 安静）" },
    { id: "rhythm",        glyph: "≋", name: "节奏曲线",     cat: "节奏",
      desc: "成员 7 日会话数趋势的方向与振幅",
      example: "casey 节奏 +21% — 本周明显加速，触发 high_output 信号" },
    { id: "high_output",   glyph: "↑", name: "高产出",       cat: "节奏",
      desc: "deltaVs7dAvgPct > 0.20 的成员",
      example: "alex 与 casey 命中：分别为 +12% 与 +21%" },
    { id: "low_activity",  glyph: "○", name: "本周参与不多", cat: "节奏",
      desc: "本周节奏明显放缓 / 多日无新会话",
      example: "dana 触发：trend7d=[4,3,2,1,1,1,0]，最近活跃为昨晚 19:30" },

    { id: "focus",         glyph: "▣", name: "聚焦",         cat: "专注",
      desc: "今天的会话集中在 ≤1 个 cwd",
      example: "blake distinctCwdsToday=1 — 全天只在 matrix-riven 上" },
    { id: "context_drift", glyph: "↔", name: "上下文漂移",   cat: "专注",
      desc: "OVER_200K（单 session 上下文超过 200k token）",
      example: "blake 触发 1 次 — 拼接历史超过模型窗口" },
    { id: "stuck",         glyph: "✕", name: "进展受阻",     cat: "卡住",
      desc: "工具失败率 > 0.25 且最近 prompt 主题反复",
      example: "blake stuck=true — failureRate=0.31 · 类型主题 4/4" },
    { id: "needs_help",    glyph: "?!", name: "求助",        cat: "卡住",
      desc: "反复试同一个 Bash 命令 / 同一个文件多版本失败",
      example: "blake 在 status/page.tsx 上 12 次 Edit + 4 次 tsc 失败" },

    { id: "risky_action",  glyph: "△", name: "高风险动作",   cat: "风险",
      desc: "git push --force / rm -rf / 直接编辑 .env",
      example: "本周触发 0 次（团队已养成 PR 习惯）" },
    { id: "tool_failure",  glyph: "⊘", name: "工具失败率",   cat: "风险",
      desc: "tool_calls_failed / tool_calls_total",
      example: "blake 31% — 显著高于团队中位数 5%" },
    { id: "collab_hot",    glyph: "⌘", name: "协作热区",     cat: "协作",
      desc: "同一文件被 ≥2 人本周内编辑",
      example: "_overview-fragments.ts 被 alex + blake 同周编辑" },
    { id: "single_owner",  glyph: "①", name: "单点依赖",     cat: "协作",
      desc: "项目 contributors=1 且最近 7 天无第二人触碰",
      example: "devops-pipelines busFactor=true — casey 一人独撑" },

    { id: "dormant",       glyph: "𝑧", name: "沉睡项目",     cat: "协作",
      desc: "活跃过的项目 ≥7 天无人触碰",
      example: "本周无沉睡项目 — 所有项目本周内都至少有一次提交" },
    { id: "learning",      glyph: "✚", name: "学习面",       cat: "学习",
      desc: "本周首次出现的文件后缀 / 框架关键词",
      example: "casey 首次接触 .yml / GitHub Actions workflow" },
    { id: "web_research",  glyph: "⌬", name: "Web 研究",     cat: "学习",
      desc: "session 中 WebFetch / WebSearch 工具调用次数",
      example: "blake 触发 11 次 — 在文档里反复检索 useEffect 行为" },
    { id: "long_session",  glyph: "⌛", name: "超长会话",     cat: "节奏",
      desc: "单次会话 > 60 分钟或 > 50 turns",
      example: "alex 今日 1 次：72 分钟，47 turns（仪表盘 hero 整合）" }
  ],

  flowSteps: [
    { key: "stop",    title: "Claude Code Stop hook",       sub: "node bin-digital-twin-tap.cjs",
      body: "用户结束一次 Claude Code 会话。配在 ~/.claude/settings.json 的 Stop hook 读取本次 transcript JSONL，按 schema 校验，打包成 recording 入本地队列。",
      metrics: [["< 60ms","hook 开销"],["0","对主流程影响"]] },
    { key: "queue",   title: "本地队列入盘",                  sub: "~/.riven/digital-twin/queue/",
      body: "tap 落盘后立刻返回。daemon 未起或网络断开时队列原地积压，inbox/outbox 模式让写入与发送解耦。",
      metrics: [["fsync","持久化"],["FIFO","处理顺序"]] },
    { key: "redact",  title: "PII 客户端脱敏",                sub: "shared/pii/redactor",
      body: "守护进程取出队列条目后先跑脱敏。Bearer token / API key / 邮箱 / 绝对路径中的用户名都被占位符替换。原文不出网。",
      metrics: [["8+","内置规则"],["client-side","脱敏位置"]] },
    { key: "gzip",    title: "gzip 压缩 → POST",              sub: "POST /v1/cc-sessions",
      body: "脱敏后的 payload 经 gzip 压缩（约 10×），附 Bearer Token（若开启），HTTPS 上送到 collector。带指数退避的重试，失败的回队列。",
      metrics: [["~10×","压缩比"],["exp-backoff","重试"]] },
    { key: "persist", title: "服务端按日分桶落盘",            sub: "<COLLECTOR_DIR>/<user>/<date>/",
      body: "按 user × date 二维分桶。inject-mock 合成内容自动拒收。落盘后追加 .leadership-index.json 加速 leadership 聚合的冷启动。",
      metrics: [["user/date","分桶"],["auto-drop","mock 防护"]] },
    { key: "render",  title: "Dashboard 30s 近实时刷新",       sub: "GET / · GET /api/overview",
      body: "leadership/aggregator 跑 16 个信号检测器 + LLM T1-T5 五层叙事。ETag/304 双向缓存，30 秒近实时刷新。点 attention 行 → slideover 抽屉。",
      metrics: [["30s","刷新周期"],["ETag/304","带缓存"]] }
  ],

  /* numbers grid (VC slide) */
  numbers: [
    { val: "30",   unit: "s",  label: "近实时刷新周期", foot: "ETag/304 缓存让无变化 poll 全程 200 字节" },
    { val: "16",   unit: "",   label: "信号检测器",     foot: "节奏 / 专注 / 卡住 / 风险 / 协作 / 学习 — 每个都有单测" },
    { val: "T1-T5",unit: "",   label: "LLM 叙事层级",   foot: "单 session → 成员周 → 项目周 → attention → 领导日报" },
    { val: "<$0.20",unit: "",  label: "单 cycle LLM 成本", foot: "haiku + sonnet 分层 · 95% ceiling 守护 · daily budget 可调" },
    { val: "10",   unit: "×",  label: "gzip 压缩比",    foot: "12.4 KB transcript → 1.3 KB 上送" },
    { val: "<60",  unit: "ms", label: "Stop hook 开销", foot: "best-effort，崩了不影响 Claude Code 主流程" },
    { val: "5",    unit: "",   label: "CJS standalone bin", foot: "依赖内联 · 用户机器零 pnpm install" },
    { val: "127.0.0.1",unit: "",label: "默认监听地址", foot: "上 LAN 必须显式 HOST=0.0.0.0 + Bearer Token" }
  ],

  moat: [
    {
      title: "<em>共享 schema</em>，编译期就抓字段漂移",
      body: "客户端、服务端、聚合器、LLM prompt builder 全部用 packages/shared 同一份 zod schema。改字段意味着 TS 编译失败，不是运行时惊喜。",
      proof: "packages/shared/cc-session.ts · 274 行 · 100% test coverage"
    },
    {
      title: "PII 在<em>源头</em>被拦下",
      body: "redactor 在守护进程的 gzip 之前跑，原始字符串永远不出开发者机器。token / 邮箱 / 绝对路径 / hex secret 全部占位符化，保留语义不保留内容。",
      proof: "shared/pii/redactor.ts · 8+ 规则 · git sha 白名单避免误报"
    },
    {
      title: "LLM <em>分层 + 预算守护</em>",
      body: "T1 用 haiku，T2-T5 用 sonnet；每层都有独立缓存键 + cache。daily budget 默认 $20，到 95% 自动停。一次 cycle 实测 $0.12-0.20。",
      proof: "leadership/llm/cache.ts · 50MB 本地 cache 上限 · prompts/ 全部 schema 化"
    },
    {
      title: "<em>诚实</em>的过时数据 / 失败可见",
      body: "/healthz 暴露 lastIngestAt + ageSec；超过 24h 的 snapshot 在 hero 顶部立刻挂横幅。空数据时 hero 写「等待 collector」而不是「一切顺利」。",
      proof: "leadership/views/_overview-fragments.ts · noData 分支 · 16 个 round-X audit 修复"
    },
    {
      title: "安全是<em>默认值</em>",
      body: "prod 启动默认绑 127.0.0.1；上 LAN 必须设 RIVEN_AUTH_TOKEN，没设直接拒启。HTTPS 双开关（KEY + CERT 同时配齐才启用），半成品配置会失败而不是悄悄降级到明文。",
      proof: "bin-prod-server.ts · 默认 loopback · TLS 半套配置 = fail-loud"
    },
    {
      title: "<em>不外发</em>给第三方",
      body: "/sources 页面公开列出每条数据来源、每个外联请求。Google Fonts 在 launch audit 中被移除（air-gapped LAN 安装也要能跑）。LLM 推理走客户自己的 Anthropic API Key。",
      proof: "/sources 路由公开可查 · launch-audit P1-B 已落地"
    }
  ],

  roadmap: [
    { phase: "已发布", lbl: "v0.2.x", color: "var(--accent)", items: [
      "transcript 上传 + cc-status 实时状态双管线",
      "v7 Spatial leadership dashboard（Overview / People / Projects / Activity / Insights）",
      "LLM T1-T5 五层叙事 + 16 个信号检测器",
      "客户端自动更新（manifest + sha256 校验 + 错误回流）",
      "TeamBrain → Riven 命名空间迁移（向后兼容）"
    ]},
    { phase: "下个 minor", lbl: "v0.3", color: "var(--warn)", items: [
      "audit-log gated prompt reveal（点查看原文 → 写服务端日志）",
      "/insights 周报 LLM narrative + Slack/飞书推送",
      "ETag 关闭兼容窗口，移除 ~/.teamagent 旧路径",
      "Member detail 增加 promptLengthSeries + newSurfaceCount 二级图"
    ]},
    { phase: "之后", lbl: "v0.4+", color: "var(--ink-4)", items: [
      "多组织 / 多 collector federation",
      "OKR 联动：把 attention 信号挂到 OKR 进度",
      "团队基线模型（用 7 日 baseline 自动校准信号阈值）",
      "Web Research / Learning Surface 单独 tab 可视化"
    ]}
  ]
};
