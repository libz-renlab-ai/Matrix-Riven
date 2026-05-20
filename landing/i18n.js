/* i18n — language switch + translation dictionary.
   All visible Chinese strings (UI chrome + demo narrative) are mapped here.
   Components call tr(s) to look up English when LANG === "en".
   Loaded as plain JS BEFORE demo-data.js / helpers.js / app code. */

(function () {
  const KEY = "mr-lang";
  let saved = "zh";
  try { saved = localStorage.getItem(KEY) || "zh"; } catch (_) {}
  window.LANG = saved === "en" ? "en" : "zh";
  document.documentElement.setAttribute("lang", window.LANG === "en" ? "en" : "zh-CN");

  window.setLang = function (lang) {
    window.LANG = lang === "en" ? "en" : "zh";
    try { localStorage.setItem(KEY, window.LANG); } catch (_) {}
    document.documentElement.setAttribute("lang", window.LANG === "en" ? "en" : "zh-CN");
    window.dispatchEvent(new Event("langchange"));
  };

  /* Lookup: returns en when LANG=en and key present, else returns the input. */
  window.tr = function (s) {
    if (typeof s !== "string") return s;
    if (window.LANG !== "en") return s;
    return window.I18N[s] !== undefined ? window.I18N[s] : s;
  };

  window.I18N = {
    /* ──── Common UI ──── */
    "live demo · 真实组件渲染": "live demo · real components",
    "完整介绍 →": "Full overview →",
    "完整介绍": "Full overview",
    "返回简版": "Back to short version",
    "← 返回简版": "← Back to short",
    "回看 dashboard": "Back to dashboard",
    "回看产品": "Back to product",
    "回看产品演示": "Back to demo",
    "暂停自动播放": "Pause auto-play",
    "继续自动播放": "Resume auto-play",
    "下一步 →": "Next →",
    "reset": "reset",
    "看仓库 ↗": "Browse repo ↗",
    "↓ 跳到 dashboard demo": "↓ Jump to dashboard demo",
    "想要看更多 ↗": "Want more ↗",
    "上面 4 个模块都是真的。": "All four modules above are real.",
    "仓库里的代码原样跑。": "The repo code runs as is.",
    "本页四个模块": "On this page",
    "外联": "Links",
    "资料": "Docs",
    "GitHub": "GitHub",
    "GitHub Repo": "GitHub Repo",
    "看接入指南 →": "View install guide →",

    /* ──── VC Hero ──── */
    "matrix·riven · v0.2 · live demo": "matrix·riven · v0.2 · live demo",
    "真实在跑": "running for real",
    "下面就是 Matrix·Riven —— ": "Below is Matrix·Riven — ",
    "没有截图，没有概念图。": "No screenshots. No mockups.",
    "下面 4 个模块都是仓库源码直接渲染的真实组件 —— 点 attention 行开抽屉、点 step 看终端 log、改输入看 PII 脱敏。 你触摸到的每一像素，都是 prod 部署后客户会看到的同一份代码。":
      "The four modules below are React components rendered straight from the repo source — click an attention row to open the drawer, click a step to see the terminal log, edit the input to see PII redaction. Every pixel you touch is the same code customers see in production.",

    /* ──── Section heads ──── */
    "① Dashboard": "① Dashboard",
    "② 数据管线": "② Data Pipeline",
    "③ PII 脱敏": "③ PII Redaction",
    "④ 真实仓库结构": "④ Real Repo Structure",
    "点 attention 行 / 任意成员 tile —— 抽屉从右滑入。":
      "Click an attention row or member tile — drawer slides in from the right.",
    "从 Claude Code Stop hook 到看板 —— 30 秒。":
      "From Claude Code Stop hook to dashboard — 30 seconds.",
    "改输入 / 关任一规则 —— 实时看右侧产物。":
      "Edit input / toggle any rule — see the redacted output live on the right.",
    "268 个源文件 · TypeScript 93.6%。":
      "268 source files · TypeScript 93.6%.",
    "源码：": "Source: ",
    "页面里的所有 KPI、attention 卡、成员 tile 来自同一份 React 渲染。":
      "Every KPI, attention card, and member tile here is the same React render the product uses.",
    "每一步都是源码里真实可点：tap.cjs → 队列 → redactor → gzip → /v1/cc-sessions → aggregator。":
      "Every step is a clickable path in the codebase: tap.cjs → queue → redactor → gzip → /v1/cc-sessions → aggregator.",
    "守护进程上送前在客户端跑过一遍，原文不出网。":
      "The daemon runs this on the client before upload — raw text never leaves the developer's machine.",
    "下方每一行直接来自 GitHub。点路径跳到仓库对应文件。":
      "Every row below is straight from GitHub. Click any path to jump to the file.",
    "↗ 上方 4 个 KPI 来自 leadership/aggregator.ts":
      "↗ 4 KPIs above come from leadership/aggregator.ts",
    "↗ Attention 文案来自 LLM T4 prompt":
      "↗ Attention copy comes from the T4 LLM prompt",
    "↗ 成员两行短文来自 T2 prompt":
      "↗ Member two-line digest comes from the T2 prompt",
    "↗ 完整 268 文件: ": "↗ All 268 files: ",
    "raw · 开发者本地": "raw · on developer's machine",
    "redacted · 上送服务端": "redacted · sent to server",

    /* ──── Slideover ──── */
    "本周快照": "This week",
    "近期会话主题": "Recent session topics",
    "近期里程碑": "Recent milestones",
    "本周节奏": "Weekly rhythm",
    "焦点": "Focus",
    "状态": "State",
    "团队规模": "Team size",
    "整体健康": "Health",
    "今日会话": "Today sessions",
    "今日 token": "Today tokens",
    "今日消耗": "Today cost",
    "字符": "chars",
    "活跃中": "active",
    "进展受阻": "stuck",
    "本周参与不多": "low activity",
    "起草 Slack 开场 →": "Draft Slack opener →",
    "加入下次 1:1 →": "Add to next 1:1 →",
    "看证据": "Show evidence",
    "关闭": "Close",

    /* ──── KPI labels ──── */
    "需要关注": "Attention",
    "高产出": "High output",
    "今日消耗 ": "Today $ ",
    "整体节奏": "Pace",
    "项": "",
    "人": "",
    "较昨日": " vs yesterday",
    "与昨日持平": "flat vs yesterday",
    "平均": " avg",
    "实际成本": "actual cost",
    "对比 7 日均值": " vs 7-day avg",
    "稳": "steady",
    "稳步上行": "trending up",
    "逐渐放缓": "slowing",
    "稳步推进": "steady progress",
    "节奏下滑": "rhythm falling",
    "今日 $": "Today $",
    "需要你看一眼": "Needs your attention",
    "团队": "Team",
    "在做": "On",

    /* ──── Status & dynamic strings ──── */
    "推进新功能": "shipping new features",
    "修复中": "debugging",
    "重构": "refactoring",
    "探索方向": "exploring",
    "回顾收尾": "wrapping up",
    "暂无新工作": "no new work",
    "未知": "unknown",
    "状态吃紧": "stretched",
    "可关注": "watch",
    "良好": "healthy",
    "刚刚活跃": "just active",
    "昨日活跃": "active yesterday",
    "暂无预估": "no estimate",
    "—": "—",

    /* ──── Pills / pace ──── */
    "↘ 逐渐放缓": "↘ slowing",
    "↗ 稳步上行": "↗ trending up",
    "→ 稳步推进": "→ steady",
    "↘ 节奏下滑": "↘ rhythm falling",
    "聚焦 matrix-riven": "focus: matrix-riven",
    "聚焦 team-graph": "focus: team-graph",

    /* ──── Attention rewrites & tags ──── */
    "已在 status/page.tsx 反复尝试两天，建议结对排查 useEffect 依赖。":
      "Two days of repeated attempts on status/page.tsx — suggest pair-debugging the useEffect deps.",
    "CI 流水线长期仅 casey 一人维护，今日无人推进，建议安排第二位贡献者。":
      "The CI pipeline is solo-maintained by casey and saw no activity today — recommend adding a second contributor.",
    "单点依赖": "single owner",
    "2h 前": "2h ago",
    "昨日": "yesterday",

    /* ──── Member callouts (with <em>) ──── */
    "已在 <em>status/page.tsx</em> 反复尝试两天，建议结对排查 useEffect 依赖。":
      "Two days repeatedly hitting <em>status/page.tsx</em> — suggest a pair-debug on the useEffect deps.",
    "正常推进 <em>matrix-riven</em>，本周 <em>稳步上行</em>。":
      "Shipping on <em>matrix-riven</em> as expected; <em>trending up</em> this week.",
    "正常推进 <em>team-graph</em>，本周 <em>稳步上行</em>。":
      "Shipping on <em>team-graph</em> as expected; <em>trending up</em> this week.",
    "已经 14h 前活跃 · 没有新动作 — <em>本周参与不多</em>。":
      "Last active 14h ago, no new actions — <em>low activity</em> this week.",

    /* ──── Project callouts ──── */
    "团队在做 <em>leadership 仪表盘</em>，T1-T3 已上线，待整合 worker。":
      "Team is shipping the <em>leadership dashboard</em>; T1-T3 live, worker integration pending.",
    "团队在做 <em>graph 视图</em>，进展 attention 编辑卡 / 待解决渲染抖动。":
      "Team is on the <em>graph view</em>; attention card landed, rendering jitter to fix.",
    "CI 流水线长期仅 casey 一人维护，今日无人推进，<em>建议安排第二位贡献者</em>。":
      "CI pipeline solo-owned by casey, no activity today — <em>recommend adding a second contributor</em>.",
    "2 位贡献者": "2 contributors",
    "1 位（单点）": "1 (solo)",

    /* ──── Members narrative (llmWeekly) ──── */
    "本周聚焦 overview 仪表盘": "This week: overview dashboard",
    "已交付 hero 与 KPI 卡片骨架": "Shipped hero + KPI card skeleton",
    "本周聚焦 status/page.tsx 报错": "This week: status/page.tsx errors",
    "卡在类型推导，需要结对排查": "Stuck on type narrowing — needs a pair",
    "本周聚焦 team-graph 视图渲染": "This week: team-graph rendering",
    "已交付 attention 编辑卡联动": "Shipped attention card interaction",
    "本周聚焦 文档同步": "This week: doc sync",
    "本周节奏放缓 · 多日无新会话": "Slowing rhythm · several days without a new session",

    /* ──── Project narrative ──── */
    "团队在做 leadership 仪表盘": "Team: leadership dashboard",
    "进展 T1-T3 上线 / 待整合 worker": "T1-T3 live · worker integration pending",
    "团队在做 graph 视图": "Team: graph view",
    "进展 attention 编辑卡 / 待解决渲染抖动": "Attention card landed · jitter to fix",
    "本周 CI 流水线无人推进": "CI pipeline idle this week",
    "今天 0 人在动，建议安排第二位贡献者": "0 contributors active today — recommend a second owner",

    /* ──── llmBrief (T5 daily) ──── */
    "今日团队推进顺利：核心 dashboard 模块已上线，CI 全绿。":
      "Team is shipping smoothly today: core dashboard module live, CI green.",
    "一名工程师在 status/page.tsx 推进受阻 2 天，建议安排一次结对排查。":
      "One engineer has been stuck on status/page.tsx for 2 days — schedule a pair-debug.",
    "明日聚焦 LLM 叙事层与 OKR 联动；本周已无悬而未决的发布。":
      "Tomorrow's focus: LLM narrative ↔ OKR integration. No releases left hanging this week.",

    /* ──── Flow step titles + bodies ──── */
    "Claude Code Stop hook 触发": "Claude Code Stop hook fires",
    "本地队列入盘": "Local queue persist",
    "PII 客户端脱敏": "Client-side PII redaction",
    "gzip 压缩 → POST": "gzip compress → POST",
    "gzip 压缩 + HTTPS POST": "gzip compress + HTTPS POST",
    "服务端落盘": "Server persist",
    "服务端按日分桶落盘": "Server persist · daily bucket",
    "Dashboard 30s 近实时刷新": "Dashboard · 30s near-real-time refresh",
    "Dashboard · 16 detectors + LLM": "Dashboard · 16 detectors + LLM",

    "用户结束一次 Claude Code 会话。配在 ~/.claude/settings.json 的 Stop hook 读取本次 transcript JSONL，按 cc-session schema 校验，打包成 recording 入本地队列。<strong>整个 hook 不到 60ms</strong>，崩了也只是把这条 session 丢掉 —— 永远不挡住 Claude Code 主流程。":
      "A developer ends a Claude Code session. The Stop hook (configured in ~/.claude/settings.json) reads the transcript JSONL, validates against the cc-session schema, and packs a recording into the local queue. <strong>The hook takes &lt;60ms</strong>; if it crashes the session is dropped — Claude Code's main flow is never blocked.",
    "tap 落盘后立刻返回。守护进程没起或网络断开时，队列在本地原地积压。Inbox/outbox 模式把<em>写入</em>和<em>发送</em>解耦，所以采集端从不需要等服务端可达。":
      "tap returns immediately after writing. If the daemon is down or offline, the queue piles up locally. The inbox/outbox model decouples <em>write</em> from <em>send</em> — the client never waits for the server to be reachable.",
    "守护进程取队列条目，先跑一遍脱敏。Bearer token、API key、邮箱、绝对路径中的用户名都被占位符替换。<strong>原文永远不会出开发者机器。</strong> git commit sha 有白名单，避免误把 hash 当 secret。":
      "The daemon pulls a queue entry and runs redaction. Bearer tokens, API keys, emails, and usernames in absolute paths are replaced with placeholders. <strong>Raw text never leaves the developer's machine.</strong> git commit SHAs are whitelisted to avoid being mistaken for secrets.",
    "脱敏后的 payload 经 gzip 压缩（实测约 <em>10×</em>），附 Bearer Token（若开启），HTTPS 上送到 collector。带指数退避的重试，失败的回队列等下一轮。带宽便宜，可靠性优先。":
      "The redacted payload is gzip-compressed (about <em>10×</em> in practice), attached with a Bearer Token (when enabled), and sent to the collector over HTTPS. Exponential backoff on retry — failed entries re-enter the queue. Bandwidth is cheap; reliability comes first.",
    "Collector 按 user × date 分桶写盘。inject-mock 合成内容被自动识别并直接拒收（dropped: 'inject-mock'），防止 smoke test 污染 prod 数据。落盘后追加 .leadership-index.json，让 leadership 聚合的冷启动 O(files) 不是 O(transcripts)。":
      "Collector writes to disk bucketed by user × date. Synthetic content from inject-mock is auto-rejected (dropped: 'inject-mock') so smoke tests never pollute prod data. After each write, .leadership-index.json is appended so the leadership cold-start is O(files), not O(transcripts).",
    "leadership/aggregator 跑 16 个信号检测器 + LLM T1-T5 五层叙事，<em>ETag / 304</em> 双向缓存让无变化 poll 全程不到 200 字节。点 attention 行 → slideover 抽屉。<strong>30 秒内可见，全队同享。</strong>":
      "leadership/aggregator runs 16 signal detectors + 5 LLM narrative tiers (T1-T5). <em>ETag / 304</em> two-way caching keeps unchanged polls under 200 bytes. Click an attention row → slideover drawer. <strong>Visible in 30 seconds, shared across the team.</strong>",

    /* Flow step metric labels (mono uppercase) */
    "hook 开销": "hook cost",
    "对主流程影响": "main-flow impact",
    "写入保证": "durability",
    "持久化": "durability",
    "处理顺序": "order",
    "内置规则": "rules built in",
    "脱敏位置": "where redacted",
    "压缩比": "compression",
    "重试策略": "retry policy",
    "分桶策略": "bucketing",
    "分桶": "bucketing",
    "mock 防护": "mock safeguard",
    "刷新周期": "refresh interval",
    "带缓存": "cached",

    /* ──── File tree roles ──── */
    "客户端 + 服务端共享 schema + PII 脱敏": "Shared schema + PII redactor (client+server)",
    "Stop hook + 守护进程 + 5 个 CJS standalone bin": "Stop hook + daemon + 5 standalone CJS bins",
    "服务端入口 · 默认 loopback · TLS 双开关": "Server entry · loopback default · TLS dual-switch",
    "旧版仪表盘 (P1)": "Legacy dashboard (P1)",
    "16 个信号检测器 + 团队聚合": "16 signal detectors + team aggregation",
    "v7 Spatial 设计系统 · 现版仪表盘": "v7 Spatial design system · current dashboard",
    "Overview 各 section 渲染": "Overview section renderers",
    "成员 / 项目抽屉": "Member / project slideover",
    "/overview?demo=1 的 hand-curated 数据": "Hand-curated fixture for /overview?demo=1",
    "LLM T1-T5 五层叙事 worker": "LLM T1-T5 narrative worker",
    "客户端自动更新 manifest + sha256": "Client auto-update manifest + sha256",
    "library": "library",
    "client": "client",
    "5 files": "5 files",

    /* ──── CTA copy ──── */
    "5 分钟接入你的团队 ——": "5 minutes to plug in your team —",
    "看 30 秒内出现的第一行数据": "watch the first data row appear within 30 seconds",
    "想看产品的完整叙事 / 安全契约 / 5 层 LLM prompt 细节，打开":
      "Want the full narrative / safety pact / 5-layer LLM prompt details? Open the ",
    "想读源码，clone 仓库自己跑：": "Want the source? Clone the repo and run: ",
    "团队工程节奏仪表盘。把 Claude Code 会话变成":
      "Team engineering-rhythm dashboard. Turning Claude Code sessions into ",
    "可观测的工程节奏": "observable engineering rhythm",
    "。": ".",

    /* ──── Misc (detail page chrome) ──── */
    "首页": "Home",
    "问题": "Problem",
    "洞察": "Insight",
    "产品": "Product",
    "叙事": "Narrative",
    "信号": "Signals",
    "管线": "Pipeline",
    "安全契约": "Safety",
    "护城河": "Moat",
    "数字": "Numbers",
    "路线图": "Roadmap",
    "Dashboard demo": "Dashboard demo",
    "数据管线": "Data pipeline",
    "PII 脱敏": "PII redaction",
    "仓库结构": "Repo structure",
    "切换语言": "Switch language",
    "中文": "中文",
    "English": "English"
  };

  /* The toggle is appended to nav bars by the React app via window.MR.LangToggle. */


  /* ──── detail.html — UI strings ──── */
  Object.assign(window.I18N, {
    /* nav labels (already partly there but ensure detail tabs covered) */
    "首页": "Home",
    "Manifesto": "Manifesto",
    "问题": "Problem",
    "洞察": "Insight",
    "产品": "Product",
    "叙事": "Narrative",
    "信号": "Signals",
    "管线": "Pipeline",
    "安全契约": "Safety",
    "护城河": "Moat",
    "数字": "Numbers",
    "路线图": "Roadmap",

    /* hero */
    "matrix·riven · v0.2 · 团队工程节奏仪表盘": "matrix·riven · v0.2 · team engineering rhythm dashboard",
    "把团队的 Claude Code 会话": "Turn your team's Claude Code sessions",
    "变成 ": "into ",
    "可观测的工程节奏": "observable engineering rhythm",
    "你团队每天和 Claude Code 进行成百上千次会话 —— 每一次都揭示": "Your team has hundreds of Claude Code sessions every day — each one reveals",
    "谁在做什么、卡在哪、花了多少钱": "who is working on what, where they're stuck, how much it costs",
    "Matrix·Riven 把这些 transcript 在源头脱敏后汇聚，": "Matrix·Riven aggregates these transcripts after redacting them at the source,",
    "跑 16 个信号检测器加 5 层 LLM 叙事，": "runs 16 signal detectors and 5 LLM narrative tiers,",
    "30 秒近实时": "30-second near-real-time",
    "刷新一份会说人话的领导仪表盘。": "refresh of a dashboard that speaks plain language to leaders.",
    "v0.2.x · 已在 12 个团队上线": "v0.2.x · live in 12 teams",
    "构建于 Node ≥ 22.5 · TypeScript 93.6%": "Node ≥ 22.5 · TypeScript 93.6%",
    "许可证：Apache-2.0": "License: Apache-2.0",
    "查看真实看板 →": "See the live dashboard →",
    "看 LLM 叙事": "View LLM narrative",
    "transcripts captured": "transcripts captured",
    "decisions extracted": "decisions extracted",
    "pii fields redacted": "pii fields redacted",
    "teams connected": "teams connected",

    /* manifesto aside + body */
    "manifesto": "manifesto",
    "chapter i.": "chapter i.",
    "你团队最丰富的工程真相，每天都在被生成 —— 然后被遗忘。": "The richest engineering truth your team produces every day is being generated — and then forgotten.",
    "Claude Code 的每一次会话都是一次完整的工程决策档案：意图、尝试、试错、修复、放弃。它比 Jira 卡片更鲜活，比 commit message 更诚实，比 Slack 群消息更完整。": "Every Claude Code session is a full record of engineering decisions: intent, attempt, error, fix, abandon. It is more alive than a Jira ticket, more honest than a commit message, more complete than a Slack thread.",
    "但没人在用它。它在每位开发者的本地磁盘上以 JSONL 的形式静默积累，几天后就被 IDE 清掉，几周后就连开发者自己也想不起当时为什么这么写了。": "But no one is using it. It piles up silently on every developer's disk as JSONL, gets cleaned up by the IDE in a few days, and within weeks even the engineer who wrote it forgets why.",
    "Matrix·Riven 把这些 transcript 在源头脱敏后汇聚到一台你控制的服务器上，跑 16 个结构化信号检测器加 5 层 LLM 凝缩叙事。": "Matrix·Riven redacts these transcripts at the source, aggregates them on a server you control, and runs 16 structured signal detectors plus 5 layers of LLM-compressed narrative.",
    "30 秒内出现在你的仪表盘上。": "They appear on your dashboard within 30 seconds.",
    "不是新增一个要填的工具，而是把已经发生的工作变得 —— 终于 —— 可观测。": "Not another tool to fill in — finally, just making the work that already happened observable.",
    "本文的主张是 Matrix·Riven 全部产品设计的出发点 —— 既是技术选择的依据，也是和团队领导沟通的语境。": "This essay is the starting point for every product decision in Matrix·Riven — both the engineering rationale and the language to use with leaders.",

    /* problem section */
    "chapter ii. · the gap": "chapter ii. · the gap",
    "团队领导每天问 4 个问题 ——": "Team leaders ask 4 questions every day —",
    "没有一个能在 ": "none answerable in ",
    "10 秒内": "10 seconds",
    " 答上来。": ".",
    "Slack 加 Jira 加 GitHub 加财务报表，四个工具凑出来的图都是滞后的、片面的、需要自己拼。 Matrix·Riven 的前提是：你团队最丰富的真相早就被记录在 Claude Code 的 transcript 里了 —— 只是没人在用它。": "Slack plus Jira plus GitHub plus finance reports — four tools, lagging, partial, and you have to piece them together yourself. Matrix·Riven's premise: your team's richest truth is already in Claude Code transcripts. No one is reading it.",
    "—— 当你回答其中任何一条都要打开 4 个 tab， 团队就会停在「凭感觉」里。我们认为这一秒钟才是最贵的成本。": "— when answering any of these requires opening 4 tabs, the team stays stuck \"on gut feel\". We believe that lost second is the most expensive cost.",
    "团队今天在做什么？": "What is the team doing today?",
    "谁卡在哪？": "Who is stuck and where?",
    "Claude Code 到底花了多少钱？": "How much did Claude Code actually cost?",
    "哪条线只剩一个人？": "Which line only has one person left?",
    "Slack 标记的 9 个 PR、4 张 Jira 卡、几条群消息，凑不出一句完整答案。": "Nine PRs flagged in Slack, four Jira tickets, a couple of group messages — none of it forms a complete answer.",
    "1:1 之前你只能猜。问得太早是骚扰，太晚已经错过结对的窗口。": "Before a 1:1 you can only guess. Ask too early and it's intrusive; too late and you've missed the pairing window.",
    "财务报表月底才到。今天高产出的人可能今天就把月度预算花完了。": "Finance reports arrive at month-end. A high-output engineer might burn through this month's budget today.",
    "单点依赖是组织最大的隐性风险。等那个人请假，你才会发现 CI 没人维护。": "Single-owner dependency is the biggest hidden organizational risk. When that person goes on PTO, you discover no one maintains CI.",

    /* insight pull-quote */
    "chapter iii. · the insight": "chapter iii. · the insight",
    "Transcript": "Transcripts",
    " 就是团队的工程账本。": " are the team's engineering ledger.",
    "它早就在那儿了，": "They've been there all along —",
    "只是没人在 ": "no one is ",
    "读": "reading",
    " 它。": " them.",
    "matrix·riven · 设计原则": "matrix·riven · design principle",

    /* product section */
    "chapter iv. · the dashboard": "chapter iv. · the dashboard",
    "领导 30 秒，": "30 seconds for a leader",
    "读完团队当天的 ": "to read the team's daily ",
    "工程节奏": "engineering rhythm",
    "下方是 Matrix·Riven 真实看板的截图级嵌入 —— 不是设计稿， ": "Below is Matrix·Riven's actual dashboard embedded at screenshot fidelity — not a design mockup, ",
    "布局、文案、配色、组件都直接来自 packages/collector-server/src/leadership/views/": "the layout, copy, colors, and components come straight from packages/collector-server/src/leadership/views/",
    "。 点 attention 行或任意成员 tile，从右侧滑出 520px 详情抽屉。": ". Click an attention row or any member tile to slide a 520px detail drawer in from the right.",
    "what you're looking at": "what you're looking at",
    "T5 领导日报": "T5 leader brief",
    "顶上 3 行衬线短文是 LLM T5 层生成的全队当日简报：今天发生了什么、需要你今天看什么、明天聚焦什么。": "The 3 serif lines at the top are the T5 LLM daily team brief: what happened today, what you should look at today, what to focus on tomorrow.",
    "Attention 编辑卡": "Attention editor card",
    "下方暖琥珀卡片是 16 个信号检测器命中后经 T4 改写的编辑式提示。点行 → slideover。": "The warm amber card is an editorial prompt rewritten by T4 after a signal detector fires. Click a row → slideover.",
    "成员 tile": "Member tile",
    "每张 tile 的两行衬线短文是 T2 层个人周 digest。状态点、健康灯、7 日 sparkline、最近活跃时间一并就位。": "The two serif lines per tile are the T2 weekly digest. Status dot, health light, 7-day sparkline, and last-active time are all included.",
    "Slideover 抽屉": "Slideover drawer",
    "点任意 tile / attention 行 → 从右滑入 520px 抽屉。serif callout、今日 token/$ 三联数、近期会话主题列表。": "Click any tile / attention row → 520px drawer slides in from the right. Serif callout, today's token/$ triplet, recent session topics.",
    "↗ 全部 UI 组件来自 leadership/views/": "↗ All UI components come from leadership/views/",
    "↗ 数据为合成 fixture，结构和 prod 完全一致": "↗ Data is a synthetic fixture; structure matches production",

    /* narrative T1-T5 */
    "chapter v. · five layers": "chapter v. · five layers",
    "从单次会话到一句领导日报 ——": "From one session to a single leader briefing —",
    "五层 LLM 叙事，逐层凝缩": "five LLM narrative tiers, compressing layer by layer",
    "原始 transcript 太碎、太多、太脏，没人会读。我们用 5 层 LLM prompt 把它": "Raw transcripts are too fragmented, too many, too dirty — no one will read them. We use 5 layers of LLM prompts to ",
    "逐层压缩": "compress them layer by layer",
    " —— T1 在一次会话结束时落地，T5 是每天给 CEO 的 3 行简报。 每层独立缓存、按 tier 计费、daily budget 守护。 ": " — T1 lands at the end of each session, T5 is the 3-line daily brief for the CEO. Each tier has its own cache, billing, and daily-budget guard. ",
    "下方是同一条 session 顺着 T1 → T5 完整凝缩的真实样本。": "Below is the same session compressed end-to-end through T1 → T5 — real samples.",
    "—— 同一条 session 沿五层凝缩：47 条工具调用 → 80 字 T1 → 2 行成员 digest → 2 行项目 digest → 1 句 attention 改写 → 1 行领导日报。 每一层都有缓存、单测、tier 预算；任何一层失败，下面那层只是降级为模板，不会把整套关停。": "— One session, five layers: 47 tool calls → 80-char T1 → 2-line member digest → 2-line project digest → 1-sentence attention rewrite → 1-line leader brief. Every tier is cached, unit-tested, budget-bounded; if any tier fails, the next falls back to a template — the whole stack never goes down.",
    "input · 喂给 prompt": "input · fed to prompt",
    "output · 渲染到看板": "output · rendered on dashboard",
    "cache hit ≈ 60%": "cache hit ≈ 60%",
    "单 session 总结": "single-session summary",
    "成员周 digest": "member weekly digest",
    "项目周 digest": "project weekly digest",
    "Attention 编辑卡": "attention rewrite",
    "领导日报": "leader brief",
    "80 字 · 单次 < $0.005 · 触发器：Stop hook": "80 chars · cost <$0.005 · trigger: Stop hook",
    "2 行 · 一人一卡 · 每日刷新": "2 lines · per person · refreshed daily",
    "2 行 · 一个项目一卡": "2 lines · per project",
    "一句结论 · 一句建议 · 一句证据": "one conclusion · one recommendation · one piece of evidence",
    "3 行 · 一天一发 · 仪表盘 hero 顶部": "3 lines · once per day · top of dashboard hero",
    "一次 Claude Code 会话结束后立刻总结：在哪个项目、动了哪些文件、问题是什么、是否结案。是后面四层的原子。": "Summarize a Claude Code session immediately at end: which project, which files touched, what the issue was, whether it was resolved. This is the atom for the next four layers.",
    "把同一位成员本周所有 T1 摘要汇总成两行：第一行交付了什么、第二行下一步或正在卡的事。直接喂给 Overview 的成员 tile 与 People 页详情。": "Aggregate one member's weekly T1 summaries into two lines: line 1, what was delivered; line 2, what's next or where they're stuck. Goes straight into the Overview member tile and People page.",
    "把同一个项目本周所有相关 session 合成两行：团队在推什么、进展到哪、待解决什么。在 Overview 的 Projects 列与 /projects 页双重渲染。": "Aggregate one project's weekly sessions into two lines: what the team is pushing, progress to date, what's left to solve. Rendered on Overview's Projects column and /projects page.",
    "把检测器命中的 stateBadge=stuck 改写成领导能直接转给 manager 的中文。结论 + 建议 + 出处一气呵成，不出现 stateBadge=stuck 这种工程语。": "Rewrite a detector hit (e.g. stateBadge=stuck) into language a leader can forward to a manager. Conclusion + recommendation + source in one breath, without engineering jargon like \"stateBadge=stuck\".",
    "全队一天的 60 个 session 浓缩成 3 行：今天发生了什么、需要你今天看什么、明天聚焦什么。这是仪表盘 hero 下面那个衬线 brief box 的内容来源。": "Compress the team's 60 sessions in a day into 3 lines: what happened today, what to look at today, what to focus on tomorrow. This is what fills the serif brief box under the hero.",

    /* signals chapter */
    "chapter vi. · sixteen signals": "chapter vi. · sixteen signals",
    "16 个结构化信号 —— ": "16 structured signals —",
    "不是关键词检索，": "not keyword search,",
    "是检测器": "they're detectors",
    "每个信号都是独立的 TypeScript 函数，喂团队 7 日窗口的会话快照、吐回一组命中。 它们组合起来回答 4 个领导级问题：": "Each signal is an independent TypeScript function — feed it a 7-day window of session snapshots, get a set of hits back. Together they answer 4 leader-level questions: ",
    "谁在跑、谁在卡、谁在帮、谁在飘": "who is shipping, who is stuck, who is helping, who is drifting",
    "。 按 6 大类组织如下 —— 每条都附本次 demo dataset 的真实命中样本。": ". Organized into 6 categories below — each with a real hit from this demo dataset.",
    "节奏": "Rhythm",
    "节奏 · <em>谁在跑，谁在飘</em>": "Rhythm · <em>who is shipping, who is drifting</em>",
    "团队 7 日活跃曲线的方向与振幅。会判断「今天稳」「正在加速」「逐渐放缓」三种基本形，避免把单日波动当趋势。": "Direction and amplitude of the team's 7-day activity curve. Classifies into three forms — \"steady today\", \"accelerating\", \"slowing\" — so single-day spikes aren't mistaken for trends.",
    "专注": "Focus",
    "专注 · <em>在一件事上还是飘移</em>": "Focus · <em>on one thing or drifting</em>",
    "今日的会话集中在几个 cwd、是否触发了上下文漂移。专注本身不是好坏，但反常的漂移往往是早期信号。": "How concentrated today's sessions are across cwds, and whether context drift fires. Focus is neutral by itself, but unusual drift is often an early signal.",
    "卡住": "Stuck",
    "卡住 · <em>反复尝试，没有进展</em>": "Stuck · <em>retrying without progress</em>",
    "工具失败率、prompt 主题重复度、tool 调用模式叠加判断。和「难度大」区分：难题是慢着推进，卡住是原地打转。": "Combines tool-failure rate, repeated prompt topics, and tool-call pattern. Distinct from \"hard problem\": hard problems progress slowly; stuck means spinning in place.",
    "风险": "Risk",
    "风险 · <em>动作幅度 vs. 失败率</em>": "Risk · <em>action scope vs. failure rate</em>",
    "工程风险不是结果性的，是动作性的：发起的命令本身就高风险，或工具失败率太高已经在制造未来的回滚。": "Engineering risk isn't about outcomes, it's about actions: the command itself is risky, or the tool-failure rate is already manufacturing future rollbacks.",
    "协作": "Collaboration",
    "协作 · <em>谁在帮谁，谁在独撑</em>": "Collaboration · <em>who helps whom, who carries solo</em>",
    "文件共编、git 历史、cwd 重叠综合判断协作模式。最敏感的是「单点依赖」—— 等那个人请假，你才会发现 CI 没人维护。": "File co-editing, git history, and cwd overlap together infer collaboration patterns. The most sensitive: single-owner dependency — when that person takes PTO you discover CI has no owner.",
    "学习": "Learning",
    "学习 · <em>团队的新表面</em>": "Learning · <em>team's new surface area</em>",
    "本周首次出现的文件后缀、框架关键词、WebFetch 调用次数。能勾勒出团队正在啃哪些新东西。": "File extensions seen for the first time this week, framework keywords, WebFetch call counts. Sketches what new ground the team is breaking.",
    "signals": "signals",
    "活跃成员": "active members",
    "今天有 ≥1 个新会话的成员": "members with ≥1 new session today",
    "今日 4 活跃 · 0 安静（昨日同时段 3 活跃 · 1 安静）": "today 4 active · 0 quiet (vs 3 active · 1 quiet yesterday)",
    "节奏曲线": "rhythm curve",
    "成员 7 日会话数趋势的方向与振幅": "direction and amplitude of a member's 7-day session count",
    "casey 节奏 +21% — 本周明显加速，触发 high_output 信号": "casey rhythm +21% — clearly accelerating, triggers high_output signal",
    "deltaVs7dAvgPct > 0.20 的成员": "members with deltaVs7dAvgPct > 0.20",
    "alex 与 casey 命中：分别为 +12% 与 +21%": "alex and casey hit: +12% and +21% respectively",
    "本周节奏明显放缓 / 多日无新会话": "rhythm clearly slowing / multiple days without a new session",
    "dana 触发：trend7d=[4,3,2,1,1,1,0]": "dana hit: trend7d=[4,3,2,1,1,1,0]",
    "聚焦": "focus",
    "今天的会话集中在 ≤1 个 cwd": "today's sessions concentrated in ≤1 cwd",
    "blake distinctCwdsToday=1 — 全天只在 matrix-riven 上": "blake distinctCwdsToday=1 — all day on matrix-riven",
    "上下文漂移": "context drift",
    "OVER_200K（单 session 上下文超过 200k token）": "OVER_200K (single session context exceeds 200k tokens)",
    "blake 触发 1 次 — 拼接历史超过模型窗口": "blake hit once — context stitched beyond model window",
    "超长会话": "long session",
    "单次会话 > 60 分钟或 > 50 turns": "single session > 60min or > 50 turns",
    "alex 今日 1 次：72 分钟，47 turns（hero 整合）": "alex one today: 72min, 47 turns (hero integration)",
    "迭代密度": "iteration density",
    "同一文件单 session 内多次编辑次数": "multiple edits to the same file within one session",
    "blake 在 status/page.tsx 上单 session 内 9 次 Edit": "blake edited status/page.tsx 9 times within one session",
    "工具失败率 > 0.25 且最近 prompt 主题反复": "tool-failure rate > 0.25 and recent prompts repeating themes",
    "blake stuck=true — failureRate=0.31 · 类型主题 4/4": "blake stuck=true — failureRate=0.31 · type-theme 4/4",
    "求助": "needs help",
    "反复试同一个 Bash 命令 / 同一个文件多版本失败": "retries of the same Bash command / multiple failures on the same file",
    "blake 在 status/page.tsx 上 12 次 Edit + 4 次 tsc 失败": "blake: 12 edits on status/page.tsx + 4 failed tsc runs",
    "高风险动作": "risky action",
    "git push --force / rm -rf / 直接编辑 .env": "git push --force / rm -rf / direct .env edits",
    "本周触发 0 次（团队已养成 PR 习惯）": "0 hits this week (team has adopted PR discipline)",
    "工具失败率": "tool-failure rate",
    "tool_calls_failed / tool_calls_total": "tool_calls_failed / tool_calls_total",
    "blake 31% — 显著高于团队中位数 5%": "blake 31% — significantly above team median 5%",
    "协作热区": "collab hotspot",
    "同一文件被 ≥2 人本周内编辑": "same file edited by ≥2 people within the week",
    "_overview-fragments.ts 被 alex + blake 同周编辑": "_overview-fragments.ts edited by alex + blake the same week",
    "单点依赖": "single owner",
    "项目 contributors=1 且最近 7 天无第二人触碰": "project contributors=1 with no second person touching in 7 days",
    "devops-pipelines busFactor=true — casey 一人独撑": "devops-pipelines busFactor=true — casey is solo",
    "沉睡项目": "dormant project",
    "活跃过的项目 ≥7 天无人触碰": "active project untouched for ≥7 days",
    "本周无沉睡项目 — 所有项目本周内都至少有一次提交": "no dormant projects this week — every project had at least one commit",
    "学习面": "learning surface",
    "本周首次出现的文件后缀 / 框架关键词": "file extensions / framework keywords seen for the first time this week",
    "casey 首次接触 .yml / GitHub Actions workflow": "casey first contact with .yml / GitHub Actions workflow",
    "Web 研究": "web research",
    "session 中 WebFetch / WebSearch 工具调用次数": "WebFetch / WebSearch tool calls within sessions",
    "blake 触发 11 次 — 在文档里反复检索 useEffect 行为": "blake fired 11 times — repeated docs search on useEffect behavior",
    "新接触面": "new surface",
    "成员首次接触某项目 / 某语言 / 某工具": "member's first encounter with a project / language / tool",
    "alex 首次接触 graph 算法（force-directed layout）": "alex first contact with graph algorithm (force-directed layout)",

    /* flow chapter */
    "chapter vii. · the pipeline": "chapter vii. · the pipeline",
    "一个 Stop hook 到看板，": "From Stop hook to dashboard —",
    "30 秒": "30 seconds",
    "，6 步。": ", 6 steps.",
    "每位开发者的会话结束都会触发一次完整的 6 步管线。 每一步独立、可重启、可重放，崩溃": "Every developer session-end triggers a full 6-step pipeline. Each step is independent, restartable, replayable — crashes ",
    "从不": "never",
    "影响 Claude Code 主流程。 点左侧任一步骤查看细节，或开自动播放。": " block Claude Code's main flow. Click any step on the left for details, or use auto-play.",
    "暂停": "Pause",
    "自动播放": "Auto-play",

    /* safety chapter (pact) */
    "chapter viii. · the pact": "chapter viii. · the pact",
    "团队的工程数据是": "Team engineering data is",
    "非常敏感的资产": "an extremely sensitive asset",
    "这是我们和你的 6 条契约。每一条在仓库里都有对应的代码路径、单测、launch audit 记录。 说到做到 —— 出处可查。": "These are our 6 commitments to you. Every one has a corresponding code path, unit tests, and launch audit log in the repo. We mean what we say — sources are checkable.",
    "live evidence": "live evidence",
    "上面那条「敏感字段在源头被拦下」是怎么发生的 ——": "How \"sensitive fields are caught at the source\" above actually works —",
    "下方实时演示": "live demo below",
    "改改左侧输入或开关任一规则，看右侧脱敏产物如何变化。 这正是 shared/pii/redactor 在守护进程里跑的逻辑。": "Edit the left input or toggle any rule — see how the redacted output changes on the right. This is exactly the logic shared/pii/redactor runs in the daemon.",
    "敏感字段在 <em>源头</em> 被拦下。": "Sensitive fields are caught at <em>the source</em>.",
    "shared/pii/redactor 在守护进程的 gzip 之前先跑。Bearer token / API key / 邮箱 / 绝对路径中的用户名全部占位符化。 <em>保留语义，不保留内容</em>。": "shared/pii/redactor runs before gzip in the daemon. Bearer tokens / API keys / emails / usernames in absolute paths are replaced with placeholders. <em>Keep the semantics, not the content</em>.",
    "默认绑 <em>127.0.0.1</em>。": "Default bind is <em>127.0.0.1</em>.",
    "prod 启动默认只监听 loopback。要上 LAN 必须显式 HOST=0.0.0.0 <em>且</em> 设 RIVEN_AUTH_TOKEN —— 没设直接拒启，<em>安全是默认值，不是 opt-in</em>。": "Prod boots listening only on loopback. To go on LAN you must set HOST=0.0.0.0 <em>and</em> RIVEN_AUTH_TOKEN — without it the server refuses to start. <em>Security is the default, not an opt-in</em>.",
    "TLS 半成品配置 <em>失败而非降级</em>。": "TLS half-baked config <em>fails instead of downgrading</em>.",
    "HTTPS_KEY_PATH 和 HTTPS_CERT_PATH 必须同时设置才启用。少一个直接启动失败 —— <em>不会悄悄降级到明文 HTTP</em>。": "HTTPS_KEY_PATH and HTTPS_CERT_PATH must both be set to enable. Missing one fails startup — <em>no silent downgrade to plain HTTP</em>.",
    "<em>不外发</em>给第三方。": "<em>No third-party</em> outbound calls.",
    "launch audit 中移除了 Google Fonts 这种第三方请求，所以 air-gapped LAN 安装也能跑。LLM 推理走客户自己的 Anthropic API Key。/sources 页面公开列出每一条数据来源。": "The launch audit removed third-party requests like Google Fonts so air-gapped LAN installs work. LLM inference uses the customer's own Anthropic API key. /sources page lists every data source publicly.",
    "Prompt 原文默认 <em>不渲染</em>。": "Raw prompt text is <em>not rendered by default</em>.",
    "Overview / Slideover 默认不渲染 prompt 原文，只渲染主题分类 + 字符数。v0.3 起，展开原文要点击专门按钮，<em>每一次展开都写服务端 audit log</em>。": "Overview / Slideover never show raw prompt text — only topic classification + character count. From v0.3 onward, expanding the raw text takes a dedicated click <em>that writes a server-side audit log every time</em>.",
    "<em>诚实</em>的过时数据横幅。": "<em>Honest</em> stale-data banners.",
    "数据快照超过 24h？/healthz 立刻显示 lastIngestAt + ageSec；空数据时 hero 写「等待 collector」而不是「一切顺利」。<em>没数据，就说没数据。</em>": "Snapshot older than 24h? /healthz immediately surfaces lastIngestAt + ageSec. When empty, the hero says \"waiting for collector\" instead of \"all good\". <em>No data, say no data.</em>",
    "raw transcript · 开发者本地": "raw transcript · on dev machine",
    "redacted · 上送服务端": "redacted · sent to server",

    /* moat */
    "chapter ix. · why this is hard": "chapter ix. · why this is hard",
    "竞品要追上来 ——": "For a competitor to catch up —",
    "不只是抄一份 UI 的事": "it's not just copying a UI",
    "6 个不易复现的工程取舍。每一条都是花了若干 launch-audit round 才落地的实际工程纪律 —— 既是产品力，也是把买家留下来的开关。": "6 hard-to-copy engineering tradeoffs. Each took multiple launch-audit rounds to land — both product power and a customer-retention switch.",
    "共享 <em>schema</em>，编译期就抓字段漂移。": "Shared <em>schema</em> — drift caught at compile time.",
    "客户端、服务端、聚合器、LLM prompt builder 全部用 packages/shared 同一份 zod schema。改字段意味着 TypeScript 编译失败，不是运行时惊喜。": "Client, server, aggregator, and LLM prompt builder all share the same zod schema in packages/shared. Changing a field means TypeScript fails to compile — not a runtime surprise.",
    "packages/shared/cc-session.ts · 274 行 · 100% test coverage": "packages/shared/cc-session.ts · 274 lines · 100% test coverage",
    "PII 在<em>源头</em>被拦下。": "PII is caught at <em>the source</em>.",
    "redactor 在守护进程的 gzip 之前跑，原始字符串永远不出开发者机器。token / 邮箱 / 绝对路径 / hex secret 全部占位符化，保留语义不保留内容。": "The redactor runs before gzip in the daemon. Raw strings never leave the dev machine. Tokens / emails / absolute paths / hex secrets all become placeholders — keep semantics, drop content.",
    "shared/pii/redactor.ts · 8+ 规则 · git sha 白名单避免误报": "shared/pii/redactor.ts · 8+ rules · git sha whitelist to avoid false positives",
    "LLM <em>分层 + 预算守护</em>。": "LLM <em>tiered + budget-guarded</em>.",
    "T1 用便宜的 haiku（输入大、输出短），T2-T5 用 sonnet（凝缩 + 取舍 + 改写）。每层独立缓存键 + LRU cache。daily budget 默认 $20，到 95% 自动停。一次 cycle 实测 $0.12-0.20。": "T1 uses cheap haiku (big input, short output); T2-T5 use sonnet (compress, choose, rewrite). Each tier has its own cache key + LRU cache. Daily budget defaults to $20, stops at 95%. One cycle is measured at $0.12-0.20.",
    "leadership/llm/cache.ts · 50MB 本地 cache 上限": "leadership/llm/cache.ts · 50MB local cache cap",
    "<em>诚实</em>的过时数据 / 失败可见。": "<em>Honest</em> stale data / visible failures.",
    "/healthz 暴露 lastIngestAt + ageSec；超过 24h 的 snapshot 在 hero 顶部立刻挂横幅。空数据时 hero 写「等待 collector」而不是「一切顺利」。": "/healthz exposes lastIngestAt + ageSec; snapshots older than 24h trigger an immediate banner at the top of the hero. When empty, the hero says \"waiting for collector\" instead of \"all good\".",
    "leadership/views/_overview-fragments.ts · noData 分支 · 16+ launch audit round": "leadership/views/_overview-fragments.ts · noData branch · 16+ launch audit rounds",
    "安全是<em>默认值</em>。": "Security is the <em>default</em>.",
    "prod 启动默认绑 127.0.0.1；要上 LAN 必须设 RIVEN_AUTH_TOKEN，没设直接拒启。HTTPS 双开关，半成品配置会失败而不是悄悄降级到明文。": "Prod binds 127.0.0.1 by default; LAN requires RIVEN_AUTH_TOKEN or refuses to start. HTTPS uses a dual switch — half-baked config fails instead of silently downgrading to plaintext.",
    "bin-prod-server.ts · 默认 loopback · TLS 半套配置 = fail-loud": "bin-prod-server.ts · loopback default · TLS half-config = fail-loud",
    "<em>不外发</em>给第三方。": "<em>No outbound</em> to third parties.",
    "/sources 页面公开列出每条数据来源、每个外联请求。Google Fonts 在 launch audit 中被移除（air-gapped LAN 安装也要能跑）。LLM 推理走客户自己的 Anthropic API Key。": "/sources page publicly lists every data source and every outbound request. Google Fonts was removed in the launch audit (so air-gapped LAN installs work). LLM inference uses the customer's own Anthropic API key.",
    "/sources 路由公开可查 · launch-audit P1-B 已落地": "/sources route publicly visible · launch-audit P1-B shipped",

    /* numbers chapter */
    "chapter x. · in numbers": "chapter x. · in numbers",
    "没有营销话术 ——": "No marketing fluff —",
    "每一个数都能在 ": "every number has its source in ",
    "仓库": "the repo",
    " 里找到出处。": ".",
    "刷新周期": "refresh interval",
    "信号检测器": "signal detectors",
    "LLM 叙事层级": "LLM narrative tiers",
    "单 cycle 成本": "cost per cycle",
    "ETag / 304 双向缓存让无变化 poll 全程不到 200 字节。从 Stop hook 触发到仪表盘可见，30 秒内全队同步。": "ETag / 304 bidirectional caching keeps unchanged polls under 200 bytes end-to-end. From Stop hook trigger to dashboard visible — 30 seconds, team-wide.",
    "节奏 / 专注 / 卡住 / 风险 / 协作 / 学习 六大类，每个独立 TypeScript 函数，每个单测覆盖。": "Six categories: rhythm / focus / stuck / risk / collaboration / learning — each an independent TypeScript function, each unit-tested.",
    "单次会话 → 成员周 → 项目周 → attention 改写 → 领导日报。每层独立缓存，按 tier 计费。": "single session → member week → project week → attention rewrite → leader brief. Each tier independently cached, billed by tier.",
    "haiku + sonnet 分层调度。daily budget 默认 $20，到 95% 自动停。实测 $0.12 - $0.20 之间。": "haiku + sonnet tiered scheduling. Daily budget defaults to $20, stops at 95%. Measured between $0.12 and $0.20.",
    "gzip 压缩比": "gzip ratio",
    "Stop hook 开销": "Stop hook cost",
    "CJS standalone bin": "CJS standalone bin",
    "默认监听": "default bind",
    "12.4 KB → 1.3 KB 上送": "12.4 KB → 1.3 KB on the wire",
    "best-effort，崩了不影响 Claude Code": "best-effort — crash never blocks Claude Code",
    "依赖内联 · 用户机器零 pnpm install": "dependencies inlined · zero pnpm install on user machine",
    "上 LAN 必须显式 + Bearer Token": "LAN requires explicit + Bearer Token",

    /* roadmap chapter */
    "chapter xi. · roadmap": "chapter xi. · roadmap",
    "已发布的、": "Shipped,",
    "正在发的、": "in flight,",
    "要发的": "what's next",
    "v0.2.x 已经稳定跑在内部多个团队上。下一个 minor 聚焦合规化（audit-log）与推送渠道。 v0.4 开始才碰多组织、OKR 联动、自适应阈值这些大题目。": "v0.2.x is running stably across several internal teams. Next minor focuses on compliance (audit-log) and push channels. v0.4 picks up the bigger questions — multi-org, OKR integration, adaptive thresholds.",
    "已发布": "Shipped",
    "下个 minor": "Next minor",
    "之后": "Later",
    "Transcript 上传 + cc-status 实时状态双管线": "Transcript upload + cc-status real-time dual pipeline",
    "v7 Spatial leadership dashboard（Overview / People / Projects / Activity / Insights）": "v7 Spatial leadership dashboard (Overview / People / Projects / Activity / Insights)",
    "LLM T1-T5 五层叙事 + 16 个信号检测器": "LLM T1-T5 narrative + 16 signal detectors",
    "客户端自动更新（manifest + sha256 校验 + 错误回流）": "Client auto-update (manifest + sha256 verification + error feedback)",
    "TeamBrain → Riven 命名空间迁移（向后兼容）": "TeamBrain → Riven namespace migration (backwards compatible)",
    "Audit-log gated prompt reveal —— 点查看原文 → 写服务端日志": "Audit-log gated prompt reveal — click-to-view writes a server-side log",
    "/insights 周报 LLM narrative + Slack / 飞书推送": "/insights weekly LLM narrative + Slack / Feishu push",
    "关闭兼容窗口，移除 ~/.teamagent 旧路径与 TEAMAGENT_* env": "Close compatibility window, remove ~/.teamagent legacy paths and TEAMAGENT_* env",
    "Member detail 增加 promptLengthSeries + newSurfaceCount 二级图": "Member detail gets promptLengthSeries + newSurfaceCount sub-charts",
    "多组织 / 多 collector federation": "Multi-org / multi-collector federation",
    "OKR 联动：把 attention 信号挂到 OKR 进度": "OKR integration: attach attention signals to OKR progress",
    "团队基线模型（用 7 日 baseline 自动校准信号阈值）": "Team baseline model (auto-calibrate signal thresholds with 7-day baseline)",
    "Web Research / Learning Surface 单独 tab 可视化": "Web Research / Learning Surface get a dedicated tab visualization",

    /* CTA chapter */
    "get on it": "get on it",
    "5 分钟接入你的团队 ——": "5 minutes to plug your team in —",
    "看 30 秒内出现的第一行数据": "watch the first data row appear within 30 seconds",
    "装好 Claude Code hook，配 collector 地址，剩下的它自己跑。 想先看演示也行 —— 上方的产品 frame 是真实 demo dataset。": "Install the Claude Code hook, set the collector address — the rest runs itself. Or preview first — the product frame above is a real demo dataset.",
    "看接入指南 →": "View install guide →",

    /* Footer */
    "Matrix·Riven · 团队工程节奏仪表盘 · 视觉对齐自 ": "Matrix·Riven · team engineering rhythm dashboard · visual identity from ",
    "团队工程节奏仪表盘": "team engineering rhythm dashboard",
    "一份团队工程节奏仪表盘。": "A team engineering rhythm dashboard.",
    "从 TeamBrain monorepo 拆分而来，目标：把 Claude Code 会话变成": "Split out from the TeamBrain monorepo. Goal: turn Claude Code sessions into",
    "包": "Packages",
    "文档": "Docs",
    "外联": "External"
  });



  /* ──── DOM text-walker — translates unwrapped Chinese in-place ──── */
  let _reverseBuilt = false;
  function buildReverse() {
    window.I18N_REVERSE = {};
    Object.keys(window.I18N).forEach(zh => {
      const en = window.I18N[zh];
      // Only build reverse for unique English values
      if (en && !window.I18N_REVERSE[en]) window.I18N_REVERSE[en] = zh;
    });
    _reverseBuilt = true;
  }

  function shouldSkipParent(node) {
    let el = node.parentElement;
    while (el) {
      // skip code / pre / mono — keep technical strings as-is
      if (el.classList && (el.classList.contains("mono") || el.tagName === "CODE" || el.tagName === "PRE")) return true;
      // skip term (dark terminal blocks) — they are en-style logs already
      if (el.classList && el.classList.contains("term")) return true;
      el = el.parentElement;
    }
    return false;
  }

  function processTextNode(node) {
    if (!_reverseBuilt) buildReverse();
    if (!node || node.nodeType !== 3 || !node.nodeValue) return;
    if (shouldSkipParent(node)) return;
    const text = node.nodeValue;
    const trimmed = text.trim();
    if (!trimmed) return;
    const map = window.LANG === "en" ? window.I18N : window.I18N_REVERSE;
    const swap = map[trimmed];
    if (swap !== undefined && swap !== trimmed) {
      const replaced = text.replace(trimmed, swap);
      if (node.nodeValue !== replaced) node.nodeValue = replaced;
    }
  }

  function walkAll() {
    if (!document.body) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(processTextNode);
  }

  let _scheduled = false;
  function scheduleWalk() {
    if (_scheduled) return;
    _scheduled = true;
    (window.requestAnimationFrame || setTimeout)(() => { _scheduled = false; walkAll(); }, 16);
  }

  window.addEventListener("langchange", scheduleWalk);

  // Initial + observe future React renders
  function boot() {
    scheduleWalk();
    if (!window._i18nObserver) {
      window._i18nObserver = new MutationObserver(scheduleWalk);
      window._i18nObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

})();
