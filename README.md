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

## 设计文档

- **设计文档**：[`docs/superpowers/specs/2026-05-14-teambrain-log-upload-extraction-design.md`](docs/superpowers/specs/2026-05-14-teambrain-log-upload-extraction-design.md)
- **实现计划**：[`docs/superpowers/plans/2026-05-14-teambrain-log-upload-extraction.md`](docs/superpowers/plans/2026-05-14-teambrain-log-upload-extraction.md)
