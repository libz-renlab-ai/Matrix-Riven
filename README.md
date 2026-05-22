# Matrix-Riven

从 TeamBrain monorepo 拆分出来的**用户日志上传子系统**，包含 Claude Code transcript 完整上传、实时状态快照以及集中接收服务端三个部分。

---

## 🌐 项目主页 / Pitch Site

- **VC 简版**：<https://landing-tau-lake.vercel.app/>
- **完整版（13 章 editorial）**：<https://landing-tau-lake.vercel.app/detail.html>
- 顶部 nav 右上角 `中 / EN` 按钮切换语言（状态存 localStorage）
- 源码在 [`landing/`](landing/)，纯静态 + Vercel zero-config 部署

---

## 包结构

依赖方向：`uploader-client` → `shared`，`collector-server` → `shared`。

| 包 | 路径 | 职责 |
|---|---|---|
| `@matrix-riven/shared` | `packages/shared` | 客户端与服务端共用的纯逻辑与 schema：paths/limits/identity/config、cc-session & recording schema、cc-status 子系统、PII 脱敏（`pii/redactor`） |
| `@matrix-riven/uploader-client` | `packages/uploader-client` | 运行在开发者机器上。Stop hook 抓取会话 transcript 进本地队列，守护进程 gzip 后 POST 到服务端；含增量扫描、Max 额度探针、实时状态发射 |
| `@matrix-riven/collector-server` | `packages/collector-server` | 集中部署的接收服务端。接收 transcript 和实时状态，按 `<user>/<date>/` 落盘，提供网页看板与 `/api/*` 查询接口 |

---

## 快速开始

**环境要求：** Node >= 22.5.0，pnpm 9

```bash
# 安装依赖
pnpm install

# 运行全量测试
pnpm test

# 构建全部三包（产出 dist/）
pnpm -r build

# 类型检查（不产出文件）
pnpm -r exec tsc --noEmit
```

---

## 数据流

```
Claude Code Stop hook
  → 本地队列（~/.riven/digital-twin/queue/）
  → 守护进程 gzip 压缩后 POST /v1/cc-sessions
  → 服务端按 <user>/<date>/ 落盘
  → 网页看板 / /api/* 查询
```

实时状态快照（cc-status）经 `bin-session-start` / `bin-user-prompt-submit` 薄壳 hook 发往 `POST /v1/cc-status`，独立于 transcript 管线。

---

## 自动更新

> ⚠️ **v0.2.x 老用户必读**：升到 v0.3.0 需要**手动跑一次**
> `node scripts/install-client.mjs`（详见下面"升级一次性"段）。
> 跑完之后再也不用手动 install，所有后续更新全自动。

v0.3.0 起客户端会在**每次 Claude Code 启动**时（SessionStart hook）后台异步检查 collector
server 上是否有新版本。有的话自动下载、原子替换 `~/.riven/digital-twin/` 下的 9 个
`.cjs` 文件，必要时优雅重启 uploader daemon。**整个过程不阻塞 CC 启动，不需要用户介入**。

### 老版本升级到自动更新版本（一次性）

**已经装过 v0.2.x 的机器**需要手动跑一次以下命令，把 `bin-auto-updater.cjs` 装进去
+ 让 SessionStart hook 知道要拋它：

```bash
cd Matrix-Riven
git pull
pnpm install
pnpm -r build
node scripts/install-client.mjs
```

之后所有更新（包括对 `bin-auto-updater.cjs` 自身的更新）都会自动进行。

### 运维发新版

```bash
pnpm -r build
node scripts/publish-client.mjs --server <user@collector-host>
```

`<user@collector-host>` 是标准 SSH 格式（与 `ssh user@host` 同语法）。

效果：scp 9 个 .cjs + 原子 manifest 替换到 server。所有客户端**下次** Claude Code 启动
时就会拉到新版（带 0–30s 随机 jitter，避免 30 台机器同毫秒打 server）。

**可选参数**：
- `--dry-run` 只打印计划，不写远端
- `--local-target <dir>` 写本地目录（用于测试 / staging）
- `--kill-switch` 把 manifest 标 `disabled: true`，所有客户端拒绝更新（紧急回滚用）
- `--note "<msg>"` 把注释附到 manifest，dashboard 会显示

**HMAC 签名（推荐生产环境启用）**：在发布机和每台开发机都设置同一个
`RIVEN_CLIENT_MANIFEST_SECRET=<long-random-string>` 环境变量。publish-client 自动用它
HMAC-SHA256 签 manifest；客户端用它验证。secret 未设两侧都是 backward-compat 跳过模式。
**强烈建议生产部署启用**——这是防止运维账号被盗后下推 RCE 的最后一道防线。

### Dashboard 看升级状况

切到 dashboard 的 **"🔄 Updates"** tab：
- **Current Release**：当前发布版本 / 时间 / 6 个文件的 sha256/size
- **Client Version Distribution**：今日哪些用户跱哪个版本（按 cc-status 聚合）
- **Update Errors (Last 24h)**：失败的 stage / 用户 / 错误消息

错误也以 JSONL 形式 append 在 `<RIVEN_COLLECTOR_DIR>/client-update-errors.jsonl`，
运维直接 `tail -f` 也能看。

### 双闸防误降级

客户端只在 `remote.version != local.version` **且** `remote.generated_at > local.generated_at`
两个条件都成立时才更新。如果运维误改 version 字符串但 generated_at 没动，客户端会
上报一条 `manifest-suspicious` 错误并**拒绝**更新——防止全员一夜回滚。

### 关掉自动更新

设置 `RIVEN_AUTO_UPDATE_DISABLED=1` 环境变量即可。CC 不会再拋 updater 子进程。

---

## 客户端部署

### 1. 构建

```bash
pnpm -r build
```

构建完成后，`packages/uploader-client/dist/` 包含以下 9 个 CJS standalone bin（依赖已内联，无需 node_modules）：

| bin | 用途 |
|---|---|
| `bin-digital-twin-tap.cjs` | Claude Code Stop hook，抓取 transcript 进本地队列 |
| `bin-uploader.cjs` | detached 守护进程，负责队列上传 |
| `bin-auto-updater.cjs` | SessionStart 时 fire-and-forget 拉起，做客户端自我升级 |
| `bin-session-start.cjs` | SessionStart hook，发射实时状态 + 拋 auto-updater |
| `bin-user-prompt-submit.cjs` | UserPromptSubmit hook，实时状态发射 |
| `bin-pre-tool-use.cjs` | PreToolUse hook，工具调用前的实时观测 |
| `bin-pre-compact.cjs` | PreCompact hook，记录 compact 事件 |
| `bin-session-end.cjs` | SessionEnd hook，记录会话结束 |
| `bin-digital-twin.cjs` | CLI 工具（`login` / `pause` / `status` / `inject-mock` 等） |

### 2. 配置 Claude Code hooks

**推荐**：直接跑 `node scripts/install-client.mjs`，它会把 9 个 bin 装到 `~/.riven/digital-twin/` 并在 `~/.claude/settings.json` 里幂等合并 6 个 hook 条目，最后自动 `login team-shared` 写好默认 config——零交互。详见 [INSTALL.md](./INSTALL.md)。

如果你想手工配，6 个 hook 的最小 JSON 形如：

```json
{
  "hooks": {
    "Stop":             [{ "hooks": [{ "type": "command", "command": "node /path/to/bin-digital-twin-tap.cjs" }] }],
    "SessionStart":     [{ "hooks": [{ "type": "command", "command": "node /path/to/bin-session-start.cjs" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node /path/to/bin-user-prompt-submit.cjs" }] }],
    "PreToolUse":       [{ "hooks": [{ "type": "command", "command": "node /path/to/bin-pre-tool-use.cjs" }] }],
    "PreCompact":       [{ "hooks": [{ "type": "command", "command": "node /path/to/bin-pre-compact.cjs" }] }],
    "SessionEnd":       [{ "hooks": [{ "type": "command", "command": "node /path/to/bin-session-end.cjs" }] }]
  }
}
```

> Claude Code 真实的 hook schema 是嵌套 `hooks[].hooks[].{type,command}` 形式，不要写成简化的 `{"command": "..."}` —— 那个会被忽略。

### 3. 客户端配置文件

配置文件落在 `~/.riven/digital-twin.json`（**注意是 `.riven` 顶层的 json 文件，不在 `digital-twin/` 子目录里**）。`install-client.mjs` 跑完会自动通过 `bin-digital-twin.cjs login team-shared` 创建一份默认配置（zero-touch），不需要用户手动跑 login。其他本地数据（队列、daemon pid、上传日志、machine-id）都在 `~/.riven/digital-twin/` 下。

⚠️ **当前 `login` 不接受 endpoint 参数**，installer 写出的默认配置使用 `http://192.168.22.88:8933`。**自建 collector 的部署**装完后需手动编辑 `~/.riven/digital-twin.json` 里的 `uploader.endpoint` 字段指向你自己的 server。这是已知未优化点。

### 4. 实时状态（可选）

设置环境变量后，hook 薄壳才会向服务端发射实时状态；不设则静默 no-op：

```bash
export RIVEN_REALTIME_URL=http://<your-server>:8080
```

---

## 服务端部署

### 启动

```bash
node packages/collector-server/dist/bin-prod-server.cjs
```

### 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8933` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址。默认 loopback，**避免领导仪表盘在没有 token 的情况下被 LAN 任意访问**。明确放 LAN 必须设 `HOST=0.0.0.0` 并配 `RIVEN_AUTH_TOKEN`。 |
| `RIVEN_COLLECTOR_DIR` | `<HOME>/riven-collector` | 数据落盘目录 |
| `RIVEN_AUTH_TOKEN` | （不设） | 设置后 **`POST /v1/cc-sessions` + 所有 `/api/*` 与 `/overview` 等领导路由**均要求 `Authorization: Bearer <token>` |
| `RIVEN_MAIN_PROJECTS` | （不设） | 逗号分隔的主项目名列表。slacking 信号检测器据此判定"在非主项目摸鱼"。空 = 检测器静默 |
| `LLM_ENABLED` | `false` | 打开后 `claude -p` 后台 worker 每 5 分钟跑一次，把 T1–T5 中文叙事写进本地 cache，看板渲染时只读 cache（永不阻塞） |
| `LLM_DAILY_BUDGET_USD` | `5` | 日预算软上限，到 95% 自动停下剩余 tier |
| `LLM_TIER1_MODEL` | `claude-haiku-4-5-20251001` | T1–T4 用的模型 |
| `LLM_TIER5_MODEL` | `claude-sonnet-4-6` | T5 日报用的模型 |
| `LLM_CACHE_DIR` | `<HOME>/.matrix-riven/llm-cache` | LLM cache JSONL 目录，50MB 软上限 + 最老条目淘汰 |
| `LLM_WORKER_INTERVAL_MS` | `300000` | worker 触发间隔（5 分钟） |
| `LLM_BRIEF_INTERVAL_MS` | `3600000` | T5 简报间隔（1 小时） |
| `HTTPS_KEY_PATH` | （不设） | TLS 私钥路径；与 `HTTPS_CERT_PATH` 同时设置才启用 TLS |
| `HTTPS_CERT_PATH` | （不设） | TLS 证书路径 |

### API + HTML 端点

**Public（不需 token）：**
- `GET /landing` — 公开 landing page，给冷点击者看
- `GET /sources` — 数据来源 + 16 个信号检测器的透明页
- `GET /overview?demo=1` — Demo 看板，跑在烤进去的 fixture 上（合成数据，无 PII）
- `GET /api/overview?demo=1` — 同上的 JSON 形式

**Receiver（POST，可选 token）：**
- `POST /v1/cc-sessions` — 接收 transcript（可选 token 认证）。**`inject-mock` 合成内容会被拒收**：返回 `200 {ok: true, dropped: 'inject-mock'}` 而非落盘，防止 smoke test 误推污染 prod。`RIVEN_UPLOADER_DRYRUN=1` 仍是本地烟测的正路。
- `POST /v1/cc-status` — 接收实时状态快照

**Leadership（GET，配 token 后强制鉴权）：**
- `GET /` 或 `GET /overview` — 实时领导仪表盘（Overview tab）
- `GET /people` / `GET /projects` — 全量成员/项目页
- `GET /retro` — 周回顾（本周交付/需要看一眼/突出表现/沉睡项目）
- `GET /activity` / `GET /insights` — Phase 3 占位 stub（带 nav + 主题切换）
- `GET /api/overview[?range=today|24h|7d|30d]` — Overview 快照 JSON
- `GET /api/members/<localpart>` — 单个成员详情（含 slideover HTML 片段）
- `GET /api/projects/<name>` — 单个项目详情
- `GET /api/llm/status` — LLM 工作状态 ops 端点：`{enabled, cache: {entries, bytes, todayCostUsd, byTier}}`

非 GET 请求到任意 HTML/JSON leadership 路由都返回 `405 method_not_allowed`（带 `x-content-type-options: nosniff` / `x-frame-options: DENY` / `referrer-policy: no-referrer`）。

### 端到端起一个完整 demo

```bash
# 一行起一个本地跑得起来的实时仪表盘
PORT=8933 HOST=127.0.0.1 \
  RIVEN_COLLECTOR_DIR=/path/to/your/riven-collector \
  LLM_ENABLED=true \
  RIVEN_AUTH_TOKEN=$(openssl rand -hex 32) \
  RIVEN_MAIN_PROJECTS=your-repo,owner/repo \
  node packages/collector-server/dist/bin-prod-server.cjs

# 访问：
#   http://127.0.0.1:8933/landing       — public marketing
#   http://127.0.0.1:8933/overview?demo=1 — demo dashboard, no auth
#   http://127.0.0.1:8933/overview        — real dashboard (need bearer)
#   http://127.0.0.1:8933/api/llm/status   — ops health
```

---

## 从 TeamBrain 迁移（v0.2.0 改名说明）

v0.2.0 把运行时命名空间从 `teamagent` / `TEAMAGENT_*` 改成了 `riven` / `RIVEN_*`。所有老名字仍然向后兼容，但每次命中老路径或老 env var 时会向 stderr 打一行 deprecation 警告：

| 老 | 新 |
|---|---|
| `~/.teamagent/` | `~/.riven/` |
| `~/teamagent-collector/` | `~/riven-collector/` |
| `TEAMAGENT_COLLECTOR_DIR` | `RIVEN_COLLECTOR_DIR` |
| `TEAMAGENT_REALTIME_URL` | `RIVEN_REALTIME_URL` |
| `TEAMAGENT_REALTIME_TOKEN` | `RIVEN_REALTIME_TOKEN` |
| `TEAMAGENT_REALTIME_ALLOW_REMOTE` | `RIVEN_REALTIME_ALLOW_REMOTE` |
| `TEAMAGENT_REALTIME_RAW_PROMPT` | `RIVEN_REALTIME_RAW_PROMPT` |
| `TEAMAGENT_REALTIME_DEBUG` | `RIVEN_REALTIME_DEBUG` |
| `TEAMAGENT_DISABLED` | `RIVEN_DISABLED` |
| `TEAMAGENT_UPLOADER_DRYRUN` | `RIVEN_UPLOADER_DRYRUN` |
| `TEAMAGENT_HOME` | `RIVEN_HOME` |
| `BPP_AUTH_TOKEN` | `RIVEN_AUTH_TOKEN` |
| 队列元数据 `teamagent_version` | `riven_version` |

兼容窗口将在下一个 minor release 关闭——届时需要把 `~/.teamagent/` 目录里的数据手动 `mv` 到 `~/.riven/`，env var 重命名。

---

## Leadership 看板（已重写：v0.3 起为默认入口）

> **本节描述 v0.3 之后的实际 UI**。原来基于 4 panel（Cost / Productivity / Projects / Quality）的 Overview tab 已被替换成 v7 spatial design 的整页仪表盘——hero + KPI 卡 + Attention + Members + Projects + Highlights + Collab + slideover。入口在 `GET /` 或 `GET /overview`。

看板布局（自上而下）：

- **Hero** — 一句话标题（基于 attention / high-output 计数）+ 可选 T5 三行日报 briefBox
- **KPI 行** — 需关注 / 高产出 / 今日消耗 (USD) / 整体节奏，每张卡都有真 sparkline
- **需要你看一眼** — 卡住 / 求助 / 闲置 / 单点依赖 / 沉睡项目；点击展开 slideover
- **团队** — 4 张成员卡：今日会话 · 焦点项目 · LLM 周报或推断性 fallback narrative
- **项目** — 4 张项目卡：phase / 健康分 / ETA / bus-factor / 近期文件
- **近期关键进展** — commit / push / PR / release，自动用 T1 narrative 替换原始 shell
- **协作热点** — 同文件多人触碰

切到 `/people` / `/projects` 看全量列表。Slideover 通过点击成员/项目卡片自动打开，显示该实体的近况 + prompt 演变 + 项目分布。

数据 API：`GET /api/overview[?range=today|24h|7d|30d]`（默认 7d）。完整端点列表见上一节"API + HTML 端点"。

**权限说明（v0.3 起重写）：**
- 默认 `HOST=127.0.0.1`（loopback）——本地起服务时不会自动暴露到 LAN。
- 配 `RIVEN_AUTH_TOKEN` 后，`POST /v1/cc-sessions` **以及** 所有领导路由（`/overview` / `/api/*`）都要求 `Authorization: Bearer <token>`。Public landing / sources / demo 仍可匿名访问。
- 要在 LAN 上 demo：`HOST=0.0.0.0 RIVEN_AUTH_TOKEN=$(openssl rand -hex 32)`。两者必须同时配，否则 bin-prod-server 在 stderr 打 WARNING。

---

## 设计文档

- **当前 milestone（领导视图）**
  - 设计：[`docs/superpowers/specs/2026-05-15-leadership-overview-design.md`](docs/superpowers/specs/2026-05-15-leadership-overview-design.md)
  - 实现计划：[`docs/superpowers/plans/2026-05-15-leadership-overview.md`](docs/superpowers/plans/2026-05-15-leadership-overview.md)
- **拆包 milestone（从 TeamBrain 剥离）**
  - 设计：[`docs/superpowers/specs/2026-05-14-teambrain-log-upload-extraction-design.md`](docs/superpowers/specs/2026-05-14-teambrain-log-upload-extraction-design.md)
  - 实现计划：[`docs/superpowers/plans/2026-05-14-teambrain-log-upload-extraction.md`](docs/superpowers/plans/2026-05-14-teambrain-log-upload-extraction.md)
