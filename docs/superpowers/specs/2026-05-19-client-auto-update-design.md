# Matrix-Riven：客户端自动更新（Client Auto-Update）

> 设计文档 · 2026-05-19
> 上一份 spec：`docs/superpowers/specs/2026-05-15-leadership-overview-design.md`
> 实现阶段：v1（本 spec）

## 1. 背景与目标

当前发新版客户端的人工流程：

1. 运维（或开发者本人）`git pull && pnpm install && pnpm -r build`
2. `node scripts/install-client.mjs`
3. 重启 Claude Code

每台用 Riven 的机器都得有人手动跑一次。如果只是改一行脱敏正则、调一个 quota 阈值、修一个 daemon 重连 bug，没法做到当天推全员——基本上靠"谁记得跑就跑"，事实上版本永远漂移。

**目标**：用户开 Claude Code，CC 自动比对服务端最新版本、按需下载新 .cjs、原子替换、必要时重启 uploader daemon。用户全程无感，运维一次 `node scripts/publish-client.mjs --server <host>` 就能下推全员。

非目标（明确不在 v1 范围，列在 §9）：灰度 / A-B / 自动 rollback / manifest 签名。

## 2. 范围

**在范围**：

- 服务端：新增 `packages/collector-server/src/client-update/` 模块（manifest 路由 / 错误上报 / 状态聚合 + 单元测试）
- 服务端：dashboard 加 "🔄 Updates" tab（manifest 版本 / 各版本机器分布 / 最近错误）
- 服务端：扩展 `POST /v1/cc-status` 接受可选 `client_version` 字段（不破坏老 client）
- 客户端：新增 `packages/uploader-client/src/auto-update/` 模块 + `bin-auto-updater.cjs` 第六个 bin
- 客户端：改 `bin-session-start.cjs` 顶部 fire-and-forget 拉起 updater
- 客户端：改 `bin-uploader.cjs` 启动时把自身 PID 写到 `~/.riven/digital-twin/uploader.pid`
- Installer：`scripts/install-client.mjs` bins 列表加上 `bin-auto-updater.cjs`
- 发版工具：新增 `scripts/publish-client.mjs`，本地生成 manifest 后 scp 到 server
- 文档：README 加"升级到自动更新版本"段，INSTALL.md 提一下 auto-update 行为

**明确不在范围**（每条都是独立后续 spec 候选）：

- Manifest 签名 / HMAC（暂依赖"仅内网部署"安全模型）
- 灰度 rollout（按 user_id 分桶、按 % 渐进）
- 自动 rollback（已激活的新版本因后续错误自动回退到旧版）
- 客户端 watchdog（daemon 启动后 30s 内崩则自愈）
- 自动 rebuild on server-side（server 自己 `pnpm -r build` 替代 scp）
- Channel 概念（stable / beta / canary 多分支并存）

## 3. 架构与数据流

```
┌──────────────────────────────────────────────────────────────────┐
│ Operator 工作流                                                   │
│                                                                    │
│   pnpm -r build                                                    │
│        │                                                           │
│        ▼                                                           │
│   node scripts/publish-client.mjs --server <host>                  │
│        │  1. 校验 6 个 dist/bin-*.cjs 全存在                       │
│        │  2. 本地算 sha256，生成 manifest.json                     │
│        │     version = `${pkg.version}+${git-short-sha}`           │
│        │     generated_at = now (ISO)                              │
│        │  3. scp 6 个 .cjs 到 server:<DIR>/incoming/               │
│        │  4. scp manifest.json 到 server:<DIR>/incoming/           │
│        │  5. ssh server: 原子 mv incoming/*.cjs ../                 │
│        │  6. ssh server: 最后 mv incoming/manifest.json ../        │
│        ▼                                                           │
│   collector-host:<RIVEN_CLIENT_LATEST_DIR>/                        │
│     ├── manifest.json   ← 最后写，保证原子                          │
│     ├── bin-digital-twin-tap.cjs                                   │
│     ├── bin-session-start.cjs                                      │
│     ├── bin-user-prompt-submit.cjs                                 │
│     ├── bin-uploader.cjs                                           │
│     ├── bin-digital-twin.cjs                                       │
│     └── bin-auto-updater.cjs                                       │
└──────────────────────────────────────────────────────────────────┘
                          │
                          ▼ (HTTP, 按请求读盘，无缓存)
┌──────────────────────────────────────────────────────────────────┐
│ Collector server                                                   │
│                                                                    │
│  GET  /v1/client-latest/manifest        → JSON manifest            │
│  GET  /v1/client-latest/files/:name     → octet-stream .cjs        │
│  POST /v1/client-update-error           → append JSONL             │
│  GET  /api/client-update-status         → UI 数据聚合               │
└──────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ Client                                                              │
│                                                                    │
│  CC 启动                                                            │
│     │                                                              │
│     ▼                                                              │
│  SessionStart hook (bin-session-start.cjs)                         │
│     ├─► fire-and-forget detached spawn bin-auto-updater.cjs        │
│     │     └─► 见下方"auto-updater 流程"                            │
│     │                                                              │
│     └─► 原有实时状态发射 (POST /v1/cc-status)                       │
│           现在 payload 多带一个 client_version 字段                  │
└──────────────────────────────────────────────────────────────────┘

  auto-updater 流程（detached 后台进程）：

    1. 获取 ~/.riven/digital-twin/auto-update.lock
       - 已存在 → 检查 lock 内 PID 是否还活
         - 活 + ts < 1h            → 静默退出
         - 活 + ts ≥ 1h（疑卡死）  → 强占
         - 死                       → 强占
    2. 读本地 manifest:  ~/.riven/digital-twin/manifest.json
       （首次没有视为 {version: null, generated_at: epoch}）
    3. GET /v1/client-latest/manifest
       - 404                 → 静默退出（server 没发布过）
       - 网络失败 / 5xx      → 上报错误，退出
    4. 双闸版本比对：
       update_needed =
         remote.version != local.version
         AND
         remote.generated_at > local.generated_at
       - false → 释放锁，退出
       - 单边触发（version 不等但 generated_at ≤ local）
         → 上报"suspicious manifest"错误，退出，不更新
    5. 对每个 file 依次：
       - GET /v1/client-latest/files/<name>
       - 流式写到 ~/.riven/digital-twin/<name>.cjs.new
       - 计算 sha256，与 manifest 中声明值比对
       - 不匹配 → 删所有 .new 文件，上报，退出
       - 任一文件 404 → 同上
    6. 全部下载验证成功后，进入原子替换阶段：
       - 对每个 file：
         - 备份 cp <name>.cjs → <name>.cjs.old
         - 原子 rename <name>.cjs.new → <name>.cjs
       - rollback 函数：把所有 .cjs.old → .cjs
    7. Probe 新 uploader：
       - spawn node bin-uploader.cjs  with RIVEN_UPLOADER_DRYRUN=1
       - 等 stdout 出现 "dry-run OK"（5s 超时）
       - 失败 → 调 rollback()，上报，退出
    8. 重启 uploader daemon：
       - 读 ~/.riven/digital-twin/uploader.pid
       - PID 存在且 alive：
         - POSIX:  process.kill(pid, 'SIGTERM')
         - Windows: process.kill(pid)（Node 内部映射到 TerminateProcess）
         - 等 10s 优雅退出；超时：
           - POSIX:  process.kill(pid, 'SIGKILL')
           - Windows: spawnSync('taskkill', ['/F', '/T', '/PID', pid])
       - detached spawn 新 bin-uploader.cjs
    9. 原子写 manifest.json 到 ~/.riven/digital-twin/manifest.json
       （写到 .tmp 后 rename）
    10. Append 成功记录到 ~/.riven/digital-twin/auto-update.log
        （环状裁剪到最近 100 行）
    11. 释放锁
```

## 4. 服务端实现

### 4.1 目录布局

```
packages/collector-server/src/
  client-update/
    index.ts                      # 公共导出
    manifest-route.ts             # GET /v1/client-latest/manifest
    file-route.ts                 # GET /v1/client-latest/files/:name
    error-ingest.ts               # POST /v1/client-update-error
    status-aggregate.ts           # GET /api/client-update-status (UI 用)
    types.ts                      # ManifestJSON / UpdateErrorJSON 类型
    __tests__/
      manifest-route.test.ts
      file-route.test.ts
      error-ingest.test.ts
      status-aggregate.test.ts
```

`mock-server.ts`（即 prod server）把四条路由挂到现有 Fastify / http 实例上。

### 4.2 配置

| Env | 默认值 | 说明 |
|---|---|---|
| `RIVEN_CLIENT_LATEST_DIR` | `<RIVEN_COLLECTOR_DIR>/client-latest/` | manifest + .cjs 物理目录 |
| `RIVEN_CLIENT_UPDATE_ERRORS_PATH` | `<RIVEN_COLLECTOR_DIR>/client-update-errors.jsonl` | 错误 JSONL append-only |

### 4.3 接口

**`GET /v1/client-latest/manifest`**

- 实现：每次请求重新 `readFileSync(manifestPath)` + `JSON.parse`。**不缓存、不 fs.watch**。理由：(a) 调用频率低（每个开发者每天 ~50 次），(b) fs.watch 跨平台不稳，(c) 半写状态下 manifest 可能解析失败——直接 503 比缓存半写值安全。
- 文件不存在 → 404 `{error: "no manifest published"}`
- 解析失败 → 503 `{error: "manifest unreadable"}`
- 成功 → 200 + body = manifest JSON 原样

**`GET /v1/client-latest/files/:name`**

- `name` 必须命中白名单（固定 6 个 bin 名），其他 → 404。**严禁** path traversal。
- 文件不存在 → 404（说明 manifest 引用了不存在的文件，operator workflow 出错）
- 成功 → 200 + `Content-Type: application/octet-stream` + stream 文件 bytes
- Server **不**校验 sha256（客户端会校），减少 server CPU

**`POST /v1/client-update-error`**

- Body schema（zod 验证）：
  ```ts
  {
    machine_id: string,        // ~/.riven/digital-twin/machine-id 的内容
    user_id: string,
    from_version: string | null,  // 本地 manifest.version，首次为 null
    to_version: string | null,    // 远端 manifest.version；如果 fetch 失败为 null
    stage: 'fetch-manifest' | 'download' | 'sha256' | 'rename' | 'probe' | 'daemon-restart' | 'manifest-suspicious',
    error_message: string,     // 最长 2KB；超长截断
    ts: string,                // ISO
  }
  ```
- 处理：append 一行 JSONL 到 `RIVEN_CLIENT_UPDATE_ERRORS_PATH`，flock 保证并发安全。
- 200 OK，body `{ok: true}`。
- Body 不合规 → 400。

**`GET /api/client-update-status`**

驱动 UI panel。**实时计算**（不缓存），数据来源：
- 当前 manifest（同 manifest-route，但额外返回 file size 等）
- 客户端版本分布：扫读今日的 `<user>/<date>/<sid>.cc-status.jsonl`，取最新一条 record 的 `client_version` 字段；按 (user_id, client_version) 去重后聚合
- 最近 7 天错误：tail 读 `client-update-errors.jsonl`，按 ts 倒序前 200 条

返回 JSON：
```ts
{
  manifest: {
    version: string;
    generated_at: string;
    files: Array<{ name: string; sha256: string; size: number }>;
  } | null;
  distribution: Array<{
    client_version: string | 'unknown';
    user_count: number;
    users: string[];   // 前 10 个 user_id，UI 显示 "+5 more"
  }>;
  errors: {
    total_24h: number;
    by_stage_24h: Record<string, number>;
    recent: Array<{
      ts: string;
      user_id: string;
      machine_id: string;
      from_version: string | null;
      to_version: string | null;
      stage: string;
      error_message: string;
    }>;  // 最多 50 条
  };
}
```

### 4.4 cc-status payload 扩展

现有 `POST /v1/cc-status` 加可选字段 `client_version?: string`。zod schema 改为 `.optional()`，老 client 不带该字段照常 200。新 client 从本地 `~/.riven/digital-twin/manifest.json` 读 version，没有则填 `"unknown"`。

### 4.5 Dashboard UI

在现有 `dashboard-html.ts` 加第三个 tab "🔄 Updates"（现有是 Browse / Overview，新增 Updates）。

页面结构（单列纵向，宽 100%）：

```
┌─ Section 1: Current Release ───────────────────────────────┐
│ Version: 0.3.1+abc1234                                       │
│ Published: 2026-05-19 12:00 UTC (2h ago)                     │
│ Files:                                                       │
│   bin-digital-twin-tap.cjs       412 KB   sha:abc12...       │
│   ...                                                        │
└──────────────────────────────────────────────────────────────┘

┌─ Section 2: Client Version Distribution (Today) ──────────┐
│ ▓▓▓▓▓▓▓▓▓▓ 0.3.1+abc1234   23 users   (alice, bob, +21)    │
│ ▓▓▓        0.3.0+def5678    4 users   (carol, dave, +2)    │
│ ▓          unknown            1 user   (eve)                │
└─────────────────────────────────────────────────────────────┘

┌─ Section 3: Errors (Last 24h) ─────────────────────────────┐
│ Total: 7    |  fetch:2  download:3  probe:1  restart:1     │
│                                                              │
│ Time     User   From          To           Stage     Message│
│ 12:34    bob    0.3.0+def..   0.3.1+abc..  download   ENOTFOUND │
│ 12:31    bob    0.3.0+def..   null         fetch-...  econnref...│
│ ...                                                          │
└─────────────────────────────────────────────────────────────┘
```

实现：复用 Overview 已有的 tab 切换 + fetch JSON + render 模式（见 dashboard-html.ts 现有结构）。CSS 沿用现有 panel 风格。

无 manifest 时 Section 1 显示 "No manifest published yet."，Section 2 显示 "No client_version data."。

## 5. 客户端实现

### 5.1 目录布局

```
packages/uploader-client/src/
  auto-update/
    index.ts            # orchestrator (调用其它模块串起完整流程)
    manifest.ts         # 读写本地 manifest.json，类型定义
    lockfile.ts         # 获取 / 检查 / 释放 lock，含 PID liveness
    download.ts         # HTTP GET 各 file + sha256 verify
    replace.ts          # 备份 .old + atomic rename + rollback
    probe.ts            # spawn dry-run uploader 验证新版本
    daemon-restart.ts   # 杀老 uploader + spawn 新
    report.ts           # POST 错误到 server（best-effort）
    log.ts              # auto-update.log 环状写入
    __tests__/
      lockfile.test.ts
      download.test.ts
      replace.test.ts
      probe.test.ts
      daemon-restart.test.ts
      manifest.test.ts
      integration.test.ts   # 端到端，临时 HOME + mock server
```

新增 bin 入口 `src/bin-auto-updater.ts`，tsup 配置加一行打包成 `dist/bin-auto-updater.cjs`。

### 5.2 双闸版本比对

```ts
function shouldUpdate(local: LocalManifest, remote: RemoteManifest): UpdateDecision {
  if (remote.version === local.version) return { update: false, reason: 'same-version' };
  const remoteTs = Date.parse(remote.generated_at);
  const localTs = local.generated_at ? Date.parse(local.generated_at) : 0;
  if (!(remoteTs > localTs)) {
    // 版本号不等但远端 ts 不比本地新 —— 强烈嫌疑 operator 写错了 version 或 manifest 损坏
    return { update: false, reason: 'manifest-suspicious', suspect: { remoteTs, localTs } };
  }
  return { update: true };
}
```

`manifest-suspicious` 触发时调用 report.ts 把可疑 manifest 上报，**不更新文件**。这是双闸的核心防线——防止运维误改 version 字符串把所有客户端降级。

### 5.3 锁文件

文件路径 `~/.riven/digital-twin/auto-update.lock`，内容：
```
PID=<int>
TS=<ISO>
```

获取流程：
1. `open(path, O_CREAT | O_EXCL | O_WRONLY)` —— 跨平台用 `fs.openSync(path, 'wx')`
2. 成功 → 写 `PID=${process.pid}\nTS=${new Date().toISOString()}\n` → 返回 holder
3. 失败（EEXIST）→ 读现有内容，提取 PID 和 TS
   - PID liveness: POSIX `process.kill(pid, 0)`（不抛 = 活，抛 ESRCH = 死，EPERM = 活但跨用户）；Windows 用 `process.kill(pid, 0)`（Node 跨平台一致映射）
   - PID 活 + TS 距今 < 1h → 退出，let it run
   - PID 活 + TS 距今 ≥ 1h → 视为卡死，强占（覆盖文件）
   - PID 死 → 强占
4. 进程退出时（finally / SIGINT / SIGTERM）unlink lock

### 5.4 SessionStart hook 改动

`bin-session-start.cjs` 顶部新增（在所有原有代码**之前**）：

```ts
// fire-and-forget: pull latest client bins from server
try {
  const fs = require('node:fs');
  const path = require('node:path');
  const { spawn } = require('node:child_process');
  const stageDir = path.dirname(process.argv[1] || __filename);
  const updaterPath = path.join(stageDir, 'bin-auto-updater.cjs');
  if (fs.existsSync(updaterPath)) {
    const logPath = path.join(stageDir, 'auto-update.log');
    const out = fs.openSync(logPath, 'a');
    const child = spawn(process.execPath, ['--no-warnings', updaterPath], {
      detached: true,
      stdio: ['ignore', out, out],
      windowsHide: true,
    });
    child.unref();
  }
} catch {
  // never block realtime emission
}
```

随后是原有的 cc-status 发射逻辑（不动）。`client_version` 字段从本地 manifest.json 读，没有则 `"unknown"`。

### 5.5 bin-uploader.cjs 改动

启动时写自己 PID 到 `~/.riven/digital-twin/uploader.pid`，退出时 unlink。约 5 行新增。这是 daemon-restart 模块能找到老进程的前提。

### 5.6 Installer 改动

`scripts/install-client.mjs` 的 `allBins` 列表加上 `bin-auto-updater.cjs`（和 `bin-uploader.cjs` / `bin-digital-twin.cjs` 一类，仅 stage 不挂 hook event）。**HOOKS 数组不动**——auto-updater 不是 Claude Code hook，它由 `bin-session-start.cjs` 内部 spawn。

`unstageBins` 同样要加上这个文件，否则卸载残留。

其它逻辑（dry-run / hook merge / 备份 / probe）不变。

## 6. Operator 发版工具

`scripts/publish-client.mjs`：

```
Usage: node scripts/publish-client.mjs --server <user@host> [--target-dir <path>] [--dry-run]
```

流程：
1. 校验 `packages/uploader-client/dist/bin-*.cjs` 6 个文件都存在；缺则报错。
2. 本地为每个文件计算 sha256 + size。
3. 读 `packages/uploader-client/package.json` 的 version 字段。
4. `git rev-parse --short HEAD` 取 git sha。
5. 拼 `version = "${pkg.version}+${gitSha}"`，`generated_at = new Date().toISOString()`。
6. 生成 manifest.json 到临时目录。
7. `--dry-run` 则在这里停下，打印计划。
8. `ssh <server> "mkdir -p <target-dir>/incoming"`
9. `scp dist/bin-*.cjs manifest.json <server>:<target-dir>/incoming/`
10. ssh server 执行：
    ```bash
    for f in incoming/bin-*.cjs; do mv -f "$f" "$(dirname "$f")/../$(basename "$f")"; done
    mv -f incoming/manifest.json ../manifest.json   # 最后一步，原子
    rmdir incoming
    ```
11. 验证：本地 GET `https://<server>/v1/client-latest/manifest`，对比 version 字段。

`--target-dir` 默认从 server 上读 `RIVEN_CLIENT_LATEST_DIR` 配置（或要求用户显式传）。

## 7. 边界 / 风险

### 7.1 Bootstrap 一次性手动步骤

**已经装过的机器**仍跑旧 `bin-session-start.cjs`，里面没有 spawn updater 的代码。

升级路径：开发者跑一次
```bash
cd Matrix-Riven && git pull && pnpm install && pnpm -r build && node scripts/install-client.mjs
```

之后**完全自维护**。这条信息必须写进 README 升级段（§10 列了文案）。

### 7.2 安全边界

`/v1/client-latest/files/*` 是**可执行代码下发通道**。能往 `RIVEN_CLIENT_LATEST_DIR` 写文件的人 = 全员开发机器的 RCE。Spec 不在 v1 加签名/HMAC，但**明确依赖**两条假设：

1. **目录权限**：`<RIVEN_COLLECTOR_DIR>/client-latest/` 仅 operator（典型为 server 上 root / deploy 账号）可写，server 进程只读。
2. **网络位置**：collector server 在公司内网，INSTALL.md 已说明（"仅在公司内网部署使用"）。

如果哪天要把 collector 暴露到 untrusted network，必须**在该 milestone 之前**加 manifest 签名。这里留 TODO。

Path traversal：`file-route.ts` 用固定白名单（写死的 6 个 bin 名字符串数组）匹配，**不**用任何路径拼接逻辑。

### 7.3 Manifest 半写状态

operator 必须**先 scp 所有 .cjs，再原子 mv manifest.json**（publish-client.mjs 已经强制这个顺序）。

防御层：客户端拿到 manifest 后，**任何一个文件 GET 失败**（包括 sha256 不匹配 / 404 / 网络断）→ 立刻删所有已下载的 .new 文件、上报、退出。不动本地任何 staged .cjs。

### 7.4 Lock 文件 staleness

PID 死 → 强占；PID 活 + TS ≥ 1h → 强占（视为卡死）。否则任何一次崩溃就把后续所有 auto-update 卡死。

### 7.5 Daemon 重启的失败模式

Probe 通过后才 kill 老 daemon，所以**新版语法/启动错误**会被 probe 拦下（rollback 起作用）。**新版启动 5s 后才崩**这种延迟错误 v1 不防御——下次 SessionStart 时 PID 文件不在，正常 respawn。可接受。

### 7.6 Viki 互动

本机 `~/.viki/` 会主动覆盖 `~/.claude/settings.json` 的 SessionStart entry（见 memory）。本设计 auto-updater 不写 settings.json，**不会**和 Viki 互踩。但如果 Viki 把 SessionStart hook 直接换成它自己的脚本而**不**保留 riven 的，本机 auto-update 就不触发——这是用户机器配置问题，由用户自决，spec 不强制处理。

### 7.7 跨平台原子 rename

复用 install-client.mjs 现有的 try-rename + Windows EBUSY fallback 模式（`writeJsonAtomic` 同款）。提取成 shared utility。

### 7.8 Self-update of bin-auto-updater 自身

`bin-auto-updater.cjs` 也在 manifest 里。当前正跑的实例**已经把文件完整 require 进内存**，文件被替换不影响当前执行。下次 CC 启动 spawn 新 updater 时自然就是新版本。无特殊处理。

### 7.9 多个 CC session 并发

每个 CC 启动都拋一个 updater，但 lockfile 保证只有一个真在跑，其他静默退出。CC 用户视角无感知。

## 8. 测试

### 8.1 服务端

- `client-update/__tests__/manifest-route.test.ts`：manifest 不存在 / 半写 / 正常三个分支。
- `client-update/__tests__/file-route.test.ts`：白名单内正常 / 白名单外 404 / 文件不存在 404 / path traversal 尝试拒绝。
- `client-update/__tests__/error-ingest.test.ts`：合规 POST / schema 不合规 / 并发 append 不撕烂 JSONL（5 个 worker × 100 条）。
- `client-update/__tests__/status-aggregate.test.ts`：mock 当日 cc-status + errors JSONL，验证 distribution 聚合 + 错误窗口截断。
- `mock-server` 集成测试：四条路由都挂在了正确路径。

### 8.2 客户端

- `auto-update/__tests__/lockfile.test.ts`：首次创建 / 并发抢锁 / PID 死 强占 / PID 活 TS 新 退出 / PID 活 TS 旧 强占 / 进程退出 unlink。
- `auto-update/__tests__/manifest.test.ts`：双闸比对各种 case，特别覆盖 manifest-suspicious 路径。
- `auto-update/__tests__/download.test.ts`：用 `node:http` 起临时 server。正常下载 + sha256 匹配；sha256 不匹配；404；超时；body 短截。
- `auto-update/__tests__/replace.test.ts`：6 个文件全替换成功；中途失败 → rollback 完整恢复；rename 失败 → fallback 路径生效。
- `auto-update/__tests__/probe.test.ts`：mock spawn，stdout "dry-run OK" → 通过；exit 1 → 失败；超时 → 失败。
- `auto-update/__tests__/daemon-restart.test.ts`：mock pid 文件 + child_process，PID 死 / 活+优雅退出 / 活+SIGKILL 兜底 三个分支。
- `auto-update/__tests__/integration.test.ts`：起 mock collector + 临时 `$HOME` + 老 manifest，跑完整 updater 流，断言：
  - 6 个 .cjs 文件 sha256 == manifest 声明值
  - 本地 manifest.json 写出
  - mock uploader pid 收到 SIGTERM
  - auto-update.log 有 success 行

### 8.3 端到端冒烟

`scripts/_e2e-auto-update-smoke.mjs`：起真 collector server + publish-client + 触发 auto-updater + 断言新版生效。在 CI 跑。

## 9. 不在 v1 范围的扩展

- **Manifest 签名**：ed25519 / HMAC-SHA256，server 配 sign key，client 配 verify key。前置条件：跨网部署。
- **灰度 rollout**：manifest 加 `rollout: { percent: 20, salt: "abc" }`，client 用 `sha256(machine_id+salt) % 100 < percent` 决定是否吸收新版。
- **自动 rollback**：客户端记录"激活后 5min 内 uploader 是否成功 ping 通过 server"，否则自动恢复 .cjs.old 并上报。
- **Channel**：stable / beta / canary 多 manifest 并存，client 配置 channel 名。
- **Watchdog**：daemon 启动后 30s 自检，crash 自愈。
- **UI**：错误详情下钻、按 user 过滤、版本分布历史趋势线。

## 10. 文档更新

### 10.1 README 新增段

在 README "客户端部署"和"服务端部署"之间插入：

```markdown
## 自动更新

v0.3.0 起客户端会在每次 Claude Code 启动时（SessionStart hook）后台异步检查 collector
server 上是否有新版本。有的话自动下载、原子替换 `~/.riven/digital-twin/` 下的 6 个
.cjs 文件，必要时优雅重启 uploader daemon。整个过程不阻塞 CC 启动，不需要用户介入。

### 老版本升级到自动更新版本（一次性）

**已经装过 v0.2.x 的机器**需要手动跑一次以下命令，把 `bin-auto-updater.cjs` 装进去
+ 让 SessionStart hook 知道要拋它：

\`\`\`bash
cd Matrix-Riven
git pull
pnpm install
pnpm -r build
node scripts/install-client.mjs
\`\`\`

之后所有更新（包括对 `bin-auto-updater.cjs` 自身的更新）都会自动进行。

### 运维发新版

\`\`\`bash
pnpm -r build
node scripts/publish-client.mjs --server <collector-host>
\`\`\`

效果：scp 6 个 .cjs + 原子 manifest 替换到 server。所有客户端**下次** Claude Code 启动
时就会拉到新版（最迟 30 分钟内全员升级，按典型 CC 使用频率）。

### Dashboard 看升级状况

切到 "🔄 Updates" tab：当前发布版本 / 各客户端版本分布 / 最近 24h 错误。
\`\`\`

### 10.2 INSTALL.md 修订

§5 "已知非自动化项" 现有第一条是 "重启 Claude Code 让 hook 生效"。新增一条：

```markdown
- **现有装机升级到自动更新版本** —— v0.2.x → v0.3.0 仍需手动跑一次
  `node scripts/install-client.mjs`，把 `bin-auto-updater.cjs` 装进 staged dir。
  之后所有后续更新（包括对 updater 自身的）会自动完成，不需要再手动跑 installer。
```

## 11. Open questions（写完 v1 之后可能要回来填）

无。所有关键决策在 brainstorming 阶段已对齐。

---

设计完。准备进入 writing-plans 阶段生成实现计划。
