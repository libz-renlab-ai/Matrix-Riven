# Matrix-Riven：从 TeamBrain 拆分「用户日志上传到服务器」子系统

> 设计文档 · 2026-05-14
> 上游：`github.com/libz-renlab-ai/TeamBrain`（参考 `TeamBrain-feature-inventory.md`）
> 目标仓库：`github.com/libz-renlab-ai/Matrix-Riven`

## 1. 背景与目标

TeamBrain 是一个多包 monorepo（11 个 npm 包），其中「上传用户日志到服务器」这条业务能力
分散在 `packages/digital-twin`、`packages/cli`、`packages/core` 三个包里，并与录屏（B3）、
BPP 最佳实践挖掘（3172 行）等无关子系统耦合在同一个包内。

本设计把这条能力**完整地、可独立运行地**拆出来，落到全新的 Matrix-Riven 仓库，作为后续
开发的基线。

**范围（两条管线 + 服务端）：**

1. **完整会话 transcript 上传** —— Claude Code 的 `.jsonl` 完整对话日志，经 Stop hook
   抓取后整份上传到中心服务器。
2. **实时状态快照** —— 轻量的「队友的 Claude Code 此刻在做什么」实时活动快照（cc-status +
   SSE 推送），不含完整对话内容。
3. **服务端** —— 接收端点 + 落盘存储 + 网页看板。

**明确不在范围内：** 录屏（`recorder/*`）、BPP 最佳实践挖掘（`bpp/*`）、视频看板
（`videos-html.ts`）、合成数据演示器（`bin-realtime-demo.ts`）。

## 2. 架构：三包结构

```
packages/
  shared/            客户端 + 服务端共用的纯逻辑与 schema
  uploader-client/   跑在每个开发者机器上：采集 + 队列 + 上传守护 + 实时状态发射
  collector-server/  集中部署：接收 + 落盘 + 看板 + SSE

依赖方向（单向，不可反向）：
  uploader-client  → shared
  collector-server → shared
  两个业务包互不依赖。
```

- pnpm workspace，`packages/*`。
- 运行时依赖只有 `ulid`。
- **不依赖 `@teamagent/core`** —— 其唯一被用到的能力（PII 脱敏）是一个 132 行、零依赖的
  文件，直接 vendor 进 `shared`。

### 2.1 数据落盘路径（客户端 / 服务端互不交叉）

- **客户端** 写 `$HOME/.teamagent/digital-twin/`：上传队列（`queue/pending`、
  `queue/dead-letter`）、配置 `digital-twin.json`、`machine-id`、守护进程 PID、
  `uploader.log`、额度缓存。
- **服务端** 写 `$TEAMAGENT_COLLECTOR_DIR`（默认 `$HOME/teamagent-collector`）：
  按 `<user>/<date>/` 落盘的 transcript、cc-status、quota 快照。
- `cc-status/store.ts` 位于 `shared`，客户端与服务端都用它，但**所有路径按传入的 base dir
  参数化**——两边读写各自的目录，不读对方的。

## 3. 各包文件清单

### 3.1 `packages/shared`

| 文件 | 作用 |
|---|---|
| `paths.ts` | `~/.teamagent/digital-twin/` 下各路径定义 |
| `limits.ts` | 单 payload 大小上限（`MAX_PAYLOAD_BYTES`） |
| `identity.ts` | `user_id`（git email 兜底）/ `machine_id` 生成与缓存 |
| `config.ts` | `digital-twin.json` 配置读写、零接触默认配置、`isEnabled` |
| `schemas/cc-session.ts` | transcript 上传信封 schema + `buildCcSessionEnvelope` |
| `schemas/recording.ts` | **保留为叶子文件**（见 §5），不接录屏功能 |
| `cc-status/types.ts` | cc-status 快照类型定义 |
| `cc-status/path-safety.ts` | `safeUserId` / `dateStamp` 等路径安全工具 |
| `cc-status/compute.ts` | `buildCcStatusSnapshot`（客户端构建快照） |
| `cc-status/store.ts` | cc-status 快照读写（按 base dir 参数化，两端共用） |
| `cc-status/index.ts` | cc-status 子系统对外导出 |
| `pii/redactor.ts` | 从 `@teamagent/core` vendor 的 PII 脱敏（`detectSensitiveText` / `redactSensitiveText`） |

### 3.2 `packages/uploader-client`

| 文件 | 作用 |
|---|---|
| `hooks/tap-session.ts` | Stop hook tap：把会话 transcript 拷进上传队列、写 metadata、best-effort 拉起守护进程 |
| `daemon/queue.ts` | 队列操作（列举 pending、加载、删除、移入 dead-letter、容量回收） |
| `daemon/uploader.ts` | 单次上传：按 `kind` 路由、L1 PII 脱敏、HTTP POST、响应分类 |
| `daemon/backoff.ts` | 指数退避 + dead-letter 时窗判定（纯函数叶子） |
| `daemon/uploader-log.ts` | 守护进程错误日志读取 |
| `daemon/process-manager.ts` | PID 锁、上传主循环、空闲自退出 |
| `bin-uploader.ts` | 上传守护进程入口（可执行） |
| `incremental/scan.ts` | 扫描本地 Claude session、规划增量上传（历史日志补传） |
| `quota/probe.ts` | Claude Max 额度探针（解析 `anthropic-ratelimit-*` 响应头） |
| `quota/state.ts` | OAuth 凭证读取、额度缓存读写 |
| `quota/scheduler.ts` | 小时级扫描时窗判定 |
| `quota/hourly.ts` | 小时级扫描编排（探额度 + 入队当日 session） |
| `realtime-client.ts` | `postCcStatusSnapshot`：cc-status 快照实时推送（fire-and-forget） |
| `realtime-emit.ts` | env-gated（`TEAMAGENT_REALTIME_URL`）实时状态发射器 |
| `bin-digital-twin-tap.ts` | **可执行入口**：Stop hook，自解析 stdin → `tapSession` + `runHourlyScanIfDue` |
| `bin-session-start.ts` | **可执行入口（薄壳，新写）**：自解析 stdin → `emitCcStatus({event:'session_start'})` |
| `bin-user-prompt-submit.ts` | **可执行入口（薄壳，新写）**：自解析 stdin → `emitCcStatus({event:'user_prompt'})` |
| `bin-digital-twin.ts` | **可执行入口（由 `commands/digital-twin.ts` 改造）**：自解析 argv 的 CLI，子命令 `login` / `pause` / `status` |

### 3.3 `packages/collector-server`

| 文件 | 作用 |
|---|---|
| `mock-server.ts` | HTTP 服务（**裁剪后**，见 §5）：保留 `/v1/cc-sessions`、`/v1/cc-status`、dashboard + `/api/*` 路由 |
| `bin-prod-server.ts` | 生产接收端入口（可执行）：绑 `0.0.0.0`、env 配置、优雅退出 |
| `dashboard-html.ts` | 看板 HTML（`DASHBOARD_HTML` + `quotaBucket`） |
| `member-stats.ts` | 成员自查统计（`computeMemberStats`） |
| `realtime-stream.ts` | SSE handler：服务端读 cc-status 并向看板推流 |

## 4. 关键决策：可执行入口不引入 runHook 框架

TeamBrain 的 `bin-session-start.ts` / `bin-user-prompt-submit.ts` 依赖 `packages/cli` 的
`runHook` / `runAdvancedHook` 框架（`ctx.env` / `ctx.input` / `ctx.cwd`），且文件内夹带
大量学习引擎逻辑（embedder daemon、attribution 等），与本子系统无关。

**决策**：本仓库所有可执行入口都**自己解析 stdin / argv**，与现有的
`bin-digital-twin-tap.ts` 风格一致（它本身就是脱离 runHook 框架、直接读 stdin 的）。

- `bin-session-start.ts` / `bin-user-prompt-submit.ts` —— **新写薄壳**，只做：读 stdin →
  解析 JSON → 调 `emitCcStatus` → 退出。绝不抛错、绝不阻塞会话。
- `bin-digital-twin.ts` —— 把 `commands/digital-twin.ts`（441 行）从 cli 命令注册表里
  剥出来，改成自解析 `process.argv` 的独立 CLI。

这样 `uploader-client` 完全不依赖 `packages/cli`。

## 5. 需要做的「手术」（改动点清单）

| 文件 | 改动 |
|---|---|
| `daemon/uploader.ts`、`mock-server.ts` | `import { detectSensitiveText, redactSensitiveText } from '@teamagent/core'` → 改为从 `shared` 的 `pii/redactor` 引入 |
| `mock-server.ts`（1264 行） | **删除** 8 个 `./bpp/*` import；**删除** BPP 路由（`/v1/bp-push`、`/v1/revoke`、`/v1/bp-push/force`、`/v1/inbox/act`、`/v1/members`、`GET /v1/inbox`、`GET /v1/audit`、`GET /v1/role`、SSE inbox stream）；**删除** `videos-html` import + 视频路由（`/v1/videos`、`/v1/recordings`、`GET /videos`、`/api/videos`、`VIDEOS_DASHBOARD_HTML`）。**保留**：`POST /v1/cc-sessions`、`POST /v1/cc-status`、`GET /`（dashboard）、`/api/cc-status*`、`/api/users`、`/api/dates`、`/api/sessions`、`/api/quota`、`/api/file`、`GET /v1/member-stats` |
| `schemas/recording.ts` | **保留** 为 `shared` 叶子文件。`daemon/queue.ts` 与 `daemon/uploader.ts` 中的 recording 分支（`isRecordingMetadata` / `buildRecordingEnvelope` / `ROUTE_BY_KIND.recording`，约 10 行）**留作死代码**，无运行时影响——以最小化对 daemon 文件的改动。如需彻底剥离另行处理 |
| `bin-session-start.ts` / `bin-user-prompt-submit.ts` | 不搬原文件，按 §4 新写薄壳 |
| `commands/digital-twin.ts` | 按 §4 改造成独立 `bin-digital-twin.ts` |
| 全包 import 路径 | `@teamagent/digital-twin` → `@matrix-riven/shared` 等；包内相对路径按新目录结构调整 |
| 包元数据 | 每个包新建 `package.json` / `tsconfig.json` / `tsup.config.ts`；新建根 `package.json` / `pnpm-workspace.yaml` / `tsconfig.base.json` |

## 6. 构建配置（双输出，关键）

沿用 TeamBrain 的 `tsup` 双输出模式。`uploader-client` 的 staged binaries
（`bin-uploader`、`bin-digital-twin-tap`、`bin-session-start`、`bin-user-prompt-submit`、
`bin-digital-twin`）会被安装到 `~/.teamagent/digital-twin/` 下运行，**那里没有
`node_modules` 树**，任何残留的外部 `require()` 都会导致 `MODULE_NOT_FOUND` 静默崩溃。

- **ESM 输出**：库入口（`src/index.ts` 等），供 workspace 内其他包以源码/构建产物消费。
- **CJS standalone 输出**：所有可执行 bin，`format: ['cjs']`、`noExternal: ['ulid']`
  把 `ulid` 内联进 bundle。
- `collector-server` 同理：ESM 库入口 + `bin-prod-server` 的 CJS standalone。

## 7. 测试

**一起搬过来**（用于验证拆分正确性）：

- `daemon/{queue,uploader,backoff,process-manager,uploader-log}` 测试
- `hooks/tap-session` 测试
- `cc-status/*` 测试
- `quota/*` 测试
- `incremental/scan` 测试
- `mock-server` 测试（**剔除** 其中 BPP / recording / 视频相关用例）
- `bin-digital-twin-tap` 测试（`resolveDaemonBin` 等）

**不搬**：所有 `bpp/__tests__/*`、`recorder` 测试、`schemas/recording` 测试。

**新增**：`bin-session-start` / `bin-user-prompt-submit` 薄壳的最小测试（读 stdin →
调 `emitCcStatus` → 不抛错）。

## 8. 验收标准

1. `pnpm install` 在干净环境成功，无 `@teamagent/*` 外部依赖。
2. `pnpm -r typecheck` 全绿。
3. `pnpm -r test` 全绿（搬过来的测试 + 新增薄壳测试）。
4. `pnpm -r build` 产出：`uploader-client` 的 CJS standalone bin 不含外部 `require()`；
   `collector-server` 的 `bin-prod-server.cjs` 同样自包含。
5. 端到端冒烟（走真实的客户端 → 服务端链路）：本地起 `bin-prod-server`（指定
   `$TEAMAGENT_COLLECTOR_DIR`）→ 把一份 fixture transcript 放进
   `~/.teamagent/digital-twin/queue/pending/`（`<id>.payload` + `<id>.json` 对）→
   跑 `bin-uploader` 守护进程 → 队列被排空、服务端按 `<user>/<date>/` 落盘 →
   看板页面能列出该 session。
6. 仓库不含 `recorder/`、`bpp/`、`videos-html.ts`。

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| `mock-server.ts` 裁剪误删保留路由 | 裁剪后用搬过来的 mock-server 测试（剔 BPP/视频用例后）做回归；§8.5 端到端冒烟兜底 |
| CJS standalone bundle 残留外部 `require()` | 沿用上游 `noExternal: ['ulid']`；构建后 grep bundle 确认无 `require('` 外部模块 |
| import 路径大面积重写引入 bug | 三包结构尽量保持包内目录与上游一致，只改跨包 import 前缀；typecheck + 全量测试兜底 |
| 薄壳 hook bin 与上游 `emitCcStatus` 契约不一致 | 薄壳只做「读 stdin → 调 `emitCcStatus`」，契约面最小；新增最小测试覆盖 |
| recording 死代码引起困惑 | 在 `schemas/recording.ts` 与相关分支加注释说明「保留未接线，见设计文档 §5」 |

## 10. 收尾

拆分完成、§8 验收标准全部通过后：在 Matrix-Riven 仓库 commit，push 到
`github.com/libz-renlab-ai/Matrix-Riven`（仓库已 `git init` 并配置 `origin`，默认分支
`main`）。
