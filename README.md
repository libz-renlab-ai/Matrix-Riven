# Matrix-Riven

从 TeamBrain monorepo 拆分出来的**用户日志上传子系统**，包含 Claude Code transcript 完整上传、实时状态快照以及集中接收服务端三个部分。

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

v0.3.0 起客户端会在**每次 Claude Code 启动**时（SessionStart hook）后台异步检查 collector
server 上是否有新版本。有的话自动下载、原子替换 `~/.riven/digital-twin/` 下的 6 个
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
node scripts/publish-client.mjs --server <collector-host>
```

效果：scp 6 个 .cjs + 原子 manifest 替换到 server。所有客户端**下次** Claude Code 启动
时就会拉到新版。`--dry-run` 可以先看计划不写远端，`--local-target <dir>` 适合本地测试。

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

构建完成后，`packages/uploader-client/dist/` 包含以下 CJS standalone bin（依赖已内联，无需 node_modules）：

| bin | 用途 |
|---|---|
| `bin-digital-twin-tap.cjs` | Claude Code Stop hook，抓取 transcript 进本地队列 |
| `bin-uploader.cjs` | detached 守护进程，负责队列上传 |
| `bin-session-start.cjs` | SessionStart hook 薄壳，发射实时状态 |
| `bin-user-prompt-submit.cjs` | UserPromptSubmit hook 薄壳，发射实时状态 |
| `bin-digital-twin.cjs` | CLI 工具（`login` / `pause` / `status` / `inject-mock` 等） |

### 2. 配置 Claude Code hooks

在 Claude Code 设置中（`~/.claude/settings.json` 或项目级 `.claude/settings.json`）配置 3 个 hook：

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node /path/to/bin-digital-twin-tap.cjs" }] }
    ],
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node /path/to/bin-session-start.cjs" }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "node /path/to/bin-user-prompt-submit.cjs" }] }
    ]
  }
}
```

> Claude Code 真实的 hook schema 是嵌套 `hooks[].hooks[].{type,command}` 形式，不要写成简化的 `{"command": "..."}` —— 那个会被忽略。

### 3. 客户端配置文件

配置文件落在 `~/.riven/digital-twin.json`（**注意是 `.riven` 顶层的 json 文件，不在 `digital-twin/` 子目录里**）。首次运行 `bin-digital-twin.cjs login <token>` 后自动生成。其他本地数据（队列、daemon pid、上传日志、machine-id）都在 `~/.riven/digital-twin/` 下。

⚠️ **当前 `login` 不接受 endpoint 参数**，写出的配置默认使用一个上游遗留的内网 IP（`http://192.168.22.88:8933`）。新部署时需要手动编辑 `~/.riven/digital-twin.json` 里的 `uploader.endpoint` 字段指向你的真实 server，这是已知未优化点。

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
| `PORT` | `8080` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `RIVEN_COLLECTOR_DIR` | `<HOME>/riven-collector` | 数据落盘目录 |
| `RIVEN_AUTH_TOKEN` | （不设） | 设置后 `POST /v1/cc-sessions` 需要 `Authorization: Bearer <token>` |
| `HTTPS_KEY_PATH` | （不设） | TLS 私钥路径；与 `HTTPS_CERT_PATH` 同时设置才启用 TLS |
| `HTTPS_CERT_PATH` | （不设） | TLS 证书路径 |

### API 端点

- `POST /v1/cc-sessions` — 接收 transcript（可选 token 认证）
- `POST /v1/cc-status` — 接收实时状态快照
- `GET /` — 网页看板
- `GET /api/*` — 查询接口

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

## Overview tab（领导视图）

Dashboard 默认开在 **Browse** tab——transcript 文件浏览，跟以前一样。

切到 **Overview** tab 看团队聚合视图（单日）：

- 💰 **Cost** — 今日团队总花费 + 每人花费排行 + 模型选用分布
- ⚡ **Productivity** — 每人 turn 数 / tool 失败率 / 平均会话时长 / OVER_200K 次数
- 📦 **Projects** — 团队在哪些项目（cwd）/ 分支上花时间最多
- ⚠️ **Quality** — 敏感字段被脱敏次数 / tool 失败热点 / 失控会话

任意 panel 里点用户名 → 跳回 Browse tab + 自动选中该用户，看会话原文。

数据 API：`GET /api/overview?date=YYYY-MM-DD`（默认今天 UTC）。返回 JSON 见 [`docs/superpowers/specs/2026-05-15-leadership-overview-design.md`](docs/superpowers/specs/2026-05-15-leadership-overview-design.md) §5.3。

> **权限说明**：和其它 `/api/*` 一样，当前没加 token gate，假设公司内网受限。
> 如果要把它暴露到不受控网络，先按 §7.3 加 auth 再 deploy。

---

## 设计文档

- **当前 milestone（领导视图）**
  - 设计：[`docs/superpowers/specs/2026-05-15-leadership-overview-design.md`](docs/superpowers/specs/2026-05-15-leadership-overview-design.md)
  - 实现计划：[`docs/superpowers/plans/2026-05-15-leadership-overview.md`](docs/superpowers/plans/2026-05-15-leadership-overview.md)
- **拆包 milestone（从 TeamBrain 剥离）**
  - 设计：[`docs/superpowers/specs/2026-05-14-teambrain-log-upload-extraction-design.md`](docs/superpowers/specs/2026-05-14-teambrain-log-upload-extraction-design.md)
  - 实现计划：[`docs/superpowers/plans/2026-05-14-teambrain-log-upload-extraction.md`](docs/superpowers/plans/2026-05-14-teambrain-log-upload-extraction.md)
