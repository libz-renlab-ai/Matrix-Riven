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

# 运行全量测试（vitest，445 个测试用例）
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
  → 本地队列（~/.teamagent/digital-twin/queue/）
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
| `bin-digital-twin.cjs` | CLI 工具（`login` / `pause` / `status` 等） |

### 2. 配置 Claude Code hooks

在 Claude Code 设置中配置 Stop hook（`~/.claude/settings.json` 或项目级 `.claude/settings.json`）：

```json
{
  "hooks": {
    "Stop": [{ "command": "node /path/to/bin-digital-twin-tap.cjs" }],
    "SessionStart": [{ "command": "node /path/to/bin-session-start.cjs" }],
    "UserPromptSubmit": [{ "command": "node /path/to/bin-user-prompt-submit.cjs" }]
  }
}
```

### 3. 客户端配置文件

配置文件位于 `~/.teamagent/digital-twin/digital-twin.json`，首次运行 `bin-digital-twin.cjs login` 后自动生成。本地数据目录：`~/.teamagent/digital-twin/`（队列、配置均在此）。

### 4. 实时状态（可选）

设置环境变量后，hook 薄壳才会向服务端发射实时状态；不设则静默 no-op：

```bash
export TEAMAGENT_REALTIME_URL=http://<your-server>:8080
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
| `TEAMAGENT_COLLECTOR_DIR` | `<HOME>/teamagent-collector` | 数据落盘目录 |
| `BPP_AUTH_TOKEN` | （不设） | 设置后 `POST /v1/cc-sessions` 需要 `Authorization: Bearer <token>` |
| `HTTPS_KEY_PATH` | （不设） | TLS 私钥路径；与 `HTTPS_CERT_PATH` 同时设置才启用 TLS |
| `HTTPS_CERT_PATH` | （不设） | TLS 证书路径 |

### API 端点

- `POST /v1/cc-sessions` — 接收 transcript（可选 token 认证）
- `POST /v1/cc-status` — 接收实时状态快照
- `GET /` — 网页看板
- `GET /api/*` — 查询接口

---

## 设计文档

- **设计文档**：[`docs/superpowers/specs/2026-05-14-teambrain-log-upload-extraction-design.md`](docs/superpowers/specs/2026-05-14-teambrain-log-upload-extraction-design.md)
- **实现计划**：[`docs/superpowers/plans/2026-05-14-teambrain-log-upload-extraction.md`](docs/superpowers/plans/2026-05-14-teambrain-log-upload-extraction.md)
