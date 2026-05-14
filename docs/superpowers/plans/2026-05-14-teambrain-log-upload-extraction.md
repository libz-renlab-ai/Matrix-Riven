# TeamBrain 用户日志上传子系统拆分 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 TeamBrain 的「用户日志上传到服务器」能力（transcript 上传 + 实时状态快照 + 接收服务端）拆成一个可独立运行的三包 pnpm workspace，落到 Matrix-Riven 仓库。

**Architecture:** 三包 `shared` / `uploader-client` / `collector-server`，依赖单向（两个业务包 → shared）。绝大多数源文件从 `TeamBrain-src` 原样复制，只改跨包 import 前缀；`mock-server.ts` 需做删除手术（去 bpp + 视频路由）；`@teamagent/core` 的 PII 脱敏 vendor 进 shared；3 个可执行入口自解析 stdin/argv，不引入 packages/cli 的 runHook 框架。

**Tech Stack:** TypeScript (ES2022 / ESNext / bundler resolution)、pnpm workspace、vitest、tsup（双输出：ESM 库 + CJS standalone bin）、运行时唯一依赖 `ulid`。

**源仓库位置:** `C:\Users\tianhaoxuan\TeamBrain-src`（已 clone）。本仓库：`C:\Users\tianhaoxuan\Matrix-Riven`。

**设计文档:** `docs/superpowers/specs/2026-05-14-teambrain-log-upload-extraction-design.md`

---

## 包边界与 import 改写规则

**`@matrix-riven/shared` 导出的模块**（凡是引用到这些的跨包 import 都改成 `from '@matrix-riven/shared'`）：
`paths` · `limits` · `identity` · `config` · `schemas/cc-session` · `schemas/recording` · `cc-status/*` · `pii/redactor`

**import 改写规则**（在 uploader-client / collector-server 的源文件里）：
- 原 `from '../paths.js'` / `'../limits.js'` / `'../identity.js'` / `'../config.js'` / `'../schemas/cc-session.js'` / `'../schemas/recording.js'` / `'../cc-status/*.js'` / `'./cc-status/*.js'` → 改为 `from '@matrix-riven/shared'`
- 原 `from '@teamagent/core'`（仅 `daemon/uploader.ts`、`mock-server.ts` 两处）→ 改为 `from '@matrix-riven/shared'`
- 原 `from '@teamagent/digital-twin'`（CLI 文件 `bin-digital-twin-tap.ts`、`realtime-emit.ts`、`commands/digital-twin.ts`）→ 拆分：属于 shared 的符号从 `@matrix-riven/shared` 引入，属于 uploader-client 的从相对路径或 `@matrix-riven/uploader-client` 引入
- 同包内的相对 import（如 `daemon/process-manager.ts` → `./queue.js`）**保持不变**
- `bin-uploader.ts` 原从 `./index.js` 引入 `loadConfig` / `isEnabled` / `digitalTwinPaths` → 这三个属于 shared，改为 `from '@matrix-riven/shared'`

**验证兜底:** 每个包搬运 + 改写完成后跑 `pnpm --filter <pkg> exec tsc --noEmit`，按报错逐个修剩余 import。

---

## Task 1: 仓库脚手架 + feature 分支

**Files:**
- Create: `.gitignore`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`
- Create: `packages/uploader-client/package.json`, `packages/uploader-client/tsconfig.json`, `packages/uploader-client/tsup.config.ts`
- Create: `packages/collector-server/package.json`, `packages/collector-server/tsconfig.json`, `packages/collector-server/tsup.config.ts`

- [ ] **Step 1: 开 feature 分支**

```bash
git checkout -b feat/log-upload-extraction
```

- [ ] **Step 2: 写 `.gitignore`**

```
node_modules/
dist/
*.log
.DS_Store
coverage/
*.tsbuildinfo
.teamagent/
packages/*/.teamagent/
.env
.env.local
```

- [ ] **Step 3: 写根 `package.json`**

```json
{
  "name": "matrix-riven",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "TeamBrain 用户日志上传子系统（transcript 上传 + 实时状态 + 接收服务端）",
  "scripts": {
    "build": "pnpm -r build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.base.json --pretty false"
  },
  "engines": { "node": ">=22.5.0" },
  "packageManager": "pnpm@9.15.9",
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsup": "^8.3.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 4: 写 `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 5: 写 `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"],
    "allowImportingTsExtensions": true
  },
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 6: 写 `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

// Windows + pnpm monorepo OOM workaround：本地单线程串行。
const isCI = !!process.env.CI;
const isWindows = process.platform === "win32";
const enableParallel = isCI && !isWindows;

export default defineConfig({
  test: {
    globals: false,
    include: ["packages/*/src/**/__tests__/**/*.test.ts"],
    environment: "node",
    fileParallelism: enableParallel,
    pool: "threads",
    poolOptions: { threads: { singleThread: !enableParallel } },
    testTimeout: 30000,
  },
});
```

- [ ] **Step 7: 写 `packages/shared/package.json`**

```json
{
  "name": "@matrix-riven/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "ulid": "^2.3.0" },
  "devDependencies": { "vitest": "^2.1.0" }
}
```

- [ ] **Step 8: 写 `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 9: 写 `packages/uploader-client/package.json`**

```json
{
  "name": "@matrix-riven/uploader-client",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@matrix-riven/shared": "workspace:*",
    "ulid": "^2.3.0"
  },
  "devDependencies": { "vitest": "^2.1.0" }
}
```

- [ ] **Step 10: 写 `packages/uploader-client/tsconfig.json`** （内容同 Step 8）

- [ ] **Step 11: 写 `packages/uploader-client/tsup.config.ts`**

双输出：ESM 库入口 + CJS standalone bins（`ulid` 必须 `noExternal` 内联，因为 staged binaries 跑在没有 node_modules 的 `~/.teamagent/digital-twin/` 下）。

```typescript
import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    outDir: 'dist',
    clean: false,
    splitting: false,
  },
  {
    entry: [
      'src/bin-uploader.ts',
      'src/bin-digital-twin-tap.ts',
      'src/bin-session-start.ts',
      'src/bin-user-prompt-submit.ts',
      'src/bin-digital-twin.ts',
    ],
    format: ['cjs'],
    target: 'node16',
    outDir: 'dist',
    clean: false,
    splitting: false,
    noExternal: ['ulid', '@matrix-riven/shared'],
  },
]);
```

- [ ] **Step 12: 写 `packages/collector-server/package.json`**

```json
{
  "name": "@matrix-riven/collector-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./mock-server": "./src/mock-server.ts"
  },
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "@matrix-riven/shared": "workspace:*" },
  "devDependencies": { "vitest": "^2.1.0" }
}
```

- [ ] **Step 13: 写 `packages/collector-server/tsconfig.json`** （内容同 Step 8）

- [ ] **Step 14: 写 `packages/collector-server/tsup.config.ts`**

```typescript
import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/mock-server.ts'],
    format: ['esm'],
    dts: true,
    outDir: 'dist',
    clean: false,
    splitting: false,
  },
  {
    entry: ['src/bin-prod-server.ts'],
    format: ['cjs'],
    target: 'node16',
    outDir: 'dist',
    clean: false,
    splitting: false,
    noExternal: ['@matrix-riven/shared'],
  },
]);
```

- [ ] **Step 15: 装依赖**

Run: `pnpm install`
Expected: 成功，生成 `pnpm-lock.yaml`，三个 workspace 包被识别。

- [ ] **Step 16: Commit**

```bash
git add -A
git commit -m "chore: 三包 workspace 脚手架"
```

---

## Task 2: shared 包 — 搬源文件 + vendor PII + 写 index

**Files (从 `TeamBrain-src` 复制到 `packages/shared/src/`):**
- `packages/digital-twin/src/paths.ts` → `packages/shared/src/paths.ts`
- `packages/digital-twin/src/limits.ts` → `packages/shared/src/limits.ts`
- `packages/digital-twin/src/identity.ts` → `packages/shared/src/identity.ts`
- `packages/digital-twin/src/config.ts` → `packages/shared/src/config.ts`
- `packages/digital-twin/src/schemas/cc-session.ts` → `packages/shared/src/schemas/cc-session.ts`
- `packages/digital-twin/src/schemas/recording.ts` → `packages/shared/src/schemas/recording.ts`
- `packages/digital-twin/src/cc-status/{types,path-safety,compute,store,index}.ts` → `packages/shared/src/cc-status/`
- `packages/core/src/pii/redactor.ts` → `packages/shared/src/pii/redactor.ts`
- Create: `packages/shared/src/index.ts`

- [ ] **Step 1: 复制源文件**

```bash
SRC=/c/Users/tianhaoxuan/TeamBrain-src/packages/digital-twin/src
DST=/c/Users/tianhaoxuan/Matrix-Riven/packages/shared/src
mkdir -p "$DST/schemas" "$DST/cc-status" "$DST/pii"
cp "$SRC/paths.ts" "$SRC/limits.ts" "$SRC/identity.ts" "$SRC/config.ts" "$DST/"
cp "$SRC/schemas/cc-session.ts" "$SRC/schemas/recording.ts" "$DST/schemas/"
cp "$SRC/cc-status/"{types,path-safety,compute,store,index}.ts "$DST/cc-status/"
cp /c/Users/tianhaoxuan/TeamBrain-src/packages/core/src/pii/redactor.ts "$DST/pii/redactor.ts"
```

- [ ] **Step 2: 检查包内相对 import**

这些文件之间的相对 import 全部是同包内（`config.ts` → `./paths.js` / `./identity.js`；`cc-status/*` 之间）——**保持不变**。`identity.ts` import `ulid`（已在 shared deps）。无 `@teamagent/*` 引用需要改（确认：`grep -rn "@teamagent" packages/shared/src` 应为空）。

- [ ] **Step 3: 写 `packages/shared/src/index.ts`**

汇总导出。参考 `TeamBrain-src/packages/digital-twin/src/index.ts` 的前半部分（paths / limits / identity / config / cc-session schema / cc-status / recording schema 那几块），**只保留属于 shared 的导出**，并新增 pii 导出。具体：

```typescript
export {
  digitalTwinPaths,
  DEFAULT_PATHS,
  type DigitalTwinPaths,
} from './paths.js';

export { MAX_PAYLOAD_BYTES } from './limits.js';

export { getUserId, getMachineId } from './identity.js';

export {
  loadConfig,
  saveConfig,
  defaultConfig,
  isEnabled,
  ensureDefaultConfig,
  TEAM_SHARED_TOKEN,
  quotaProbeSettings,
  DEFAULT_QUOTA_PROBE_WINDOW_MINUTES,
  FIRST_RUN_BANNER,
  type DigitalTwinConfig,
  type DefaultConfigInput,
  type EnsureDefaultConfigDeps,
  type QuotaProbeConfig,
  type ResolvedQuotaProbeSettings,
} from './config.js';

export {
  buildCcSessionEnvelope,
  isCcSessionMetadata,
  type CcSessionEnvelope,
  type CcSessionMetadata,
  type CcSessionQuotaBlock,
  type BuildEnvelopeInput,
} from './schemas/cc-session.js';

export {
  buildRecordingEnvelope,
  isRecordingMetadata,
  RECORDING_CODEC_DEFAULTS,
  type RecordingEnvelope,
  type RecordingMetadata,
  type BuildRecordingEnvelopeInput,
} from './schemas/recording.js';

export {
  CC_STATUS_SCHEMA_VERSION,
  CC_STATUS_FILE_SUFFIX,
  CONTEXT_BUDGET_TOKENS,
  FIVE_HOURS_MS,
  SEVEN_DAYS_MS,
  shouldPush,
  parseTranscriptLines,
  buildCcStatusSnapshot,
  safeStatusUserId,
  sanitizeCcStatusSnapshot,
  ccStatusJsonlPath,
  appendCcStatusSnapshot,
  readLatestPerSession,
  readLatestForSession,
  readLatestAllUsers,
  readHistory,
  type CcSessionHealth,
  type CcStatusSnapshot,
  type CcStatusQueryRow,
  type TranscriptMetrics,
  type QuotaSnapshotInput,
  type BuildCcStatusInput,
  type AppendResult,
} from './cc-status/index.js';

export {
  safeUserId,
  dateStamp,
  isUnreservedComponent,
} from './cc-status/path-safety.js';

export {
  detectSensitiveText,
  redactSensitiveText,
  type SensitiveFinding,
  type SensitiveFindingKind,
} from './pii/redactor.js';
```

> 执行时核对：上述每个 re-export 的符号名必须与 `TeamBrain-src/packages/digital-twin/src/index.ts` 及各源文件 `export` 的实际名字一致。`cc-status/index.ts` 自身已 re-export 子模块，若 `path-safety` 的符号已被 `cc-status/index.ts` 导出则不要重复导出（去重，以 tsc 报错为准）。

- [ ] **Step 4: typecheck**

Run: `pnpm --filter @matrix-riven/shared exec tsc --noEmit`
Expected: 无错误（如有 import 名不符按报错修正 index.ts）。

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): 搬入 paths/identity/config/schemas/cc-status + vendor PII"
```

---

## Task 3: shared 包 — 搬测试 + 跑绿

**Files (复制测试):**
- `digital-twin/src/__tests__/{paths,identity,config}.test.ts` → `packages/shared/src/__tests__/`
- `digital-twin/src/schemas/__tests__/{cc-session,recording}.test.ts` → `packages/shared/src/schemas/__tests__/`
- `digital-twin/src/cc-status/__tests__/{compute,store}.test.ts` → `packages/shared/src/cc-status/__tests__/`
- `core/src/pii/__tests__/redactor.test.ts` → `packages/shared/src/pii/__tests__/redactor.test.ts`

- [ ] **Step 1: 复制测试文件**

```bash
SRC=/c/Users/tianhaoxuan/TeamBrain-src/packages/digital-twin/src
DST=/c/Users/tianhaoxuan/Matrix-Riven/packages/shared/src
mkdir -p "$DST/__tests__" "$DST/schemas/__tests__" "$DST/cc-status/__tests__" "$DST/pii/__tests__"
cp "$SRC/__tests__/"{paths,identity,config}.test.ts "$DST/__tests__/"
cp "$SRC/schemas/__tests__/"{cc-session,recording}.test.ts "$DST/schemas/__tests__/"
cp "$SRC/cc-status/__tests__/"{compute,store}.test.ts "$DST/cc-status/__tests__/"
cp /c/Users/tianhaoxuan/TeamBrain-src/packages/core/src/pii/__tests__/redactor.test.ts "$DST/pii/__tests__/"
```

- [ ] **Step 2: 检查测试 import**

这些测试用相对 import 引用同包源文件（`../paths.js` 等），**保持不变**。确认无 `@teamagent/*` 引用：`grep -rn "@teamagent" packages/shared/src/**/__tests__` 应为空；若有则按包边界规则改为 `@matrix-riven/shared` 或相对路径。

- [ ] **Step 3: 跑测试**

Run: `pnpm --filter @matrix-riven/shared test`
Expected: 全部 PASS。失败时——若是 import 路径问题按规则修；若是真实逻辑失败，对照 `TeamBrain-src` 同名测试确认是否漏搬被测文件的依赖。

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src
git commit -m "test(shared): 搬入并跑绿 shared 包测试"
```

---

## Task 4: uploader-client 包 — 搬库源文件 + 改跨包 import

**Files (从 `digital-twin/src` 复制到 `packages/uploader-client/src/`):**
- `hooks/tap-session.ts`
- `daemon/{queue,uploader,backoff,uploader-log,process-manager}.ts`
- `bin-uploader.ts`
- `incremental/scan.ts`
- `quota/{probe,state,scheduler,hourly}.ts`
- `realtime-client.ts`
- Create: `packages/uploader-client/src/index.ts`

- [ ] **Step 1: 复制源文件**

```bash
SRC=/c/Users/tianhaoxuan/TeamBrain-src/packages/digital-twin/src
DST=/c/Users/tianhaoxuan/Matrix-Riven/packages/uploader-client/src
mkdir -p "$DST/hooks" "$DST/daemon" "$DST/incremental" "$DST/quota"
cp "$SRC/hooks/tap-session.ts" "$DST/hooks/"
cp "$SRC/daemon/"{queue,uploader,backoff,uploader-log,process-manager}.ts "$DST/daemon/"
cp "$SRC/bin-uploader.ts" "$SRC/realtime-client.ts" "$DST/"
cp "$SRC/incremental/scan.ts" "$DST/incremental/"
cp "$SRC/quota/"{probe,state,scheduler,hourly}.ts "$DST/quota/"
```

- [ ] **Step 2: 改跨包 import（按「包边界与 import 改写规则」）**

逐文件改：
- `hooks/tap-session.ts`：`../paths.js` `../limits.js` `../schemas/cc-session.js` → `@matrix-riven/shared`
- `daemon/queue.ts`：`../paths.js` `../limits.js` `../schemas/cc-session.js` `../schemas/recording.js` → `@matrix-riven/shared`；`./uploader.js` 等同包保持不变
- `daemon/uploader.ts`：`../schemas/cc-session.js` `../schemas/recording.js` `@teamagent/core` → `@matrix-riven/shared`
- `daemon/uploader-log.ts`：`../paths.js` → `@matrix-riven/shared`
- `daemon/process-manager.ts`：`../paths.js` → `@matrix-riven/shared`；`./queue.js` `./uploader.js` `./backoff.js` 保持
- `daemon/backoff.ts`：无 import，不动
- `bin-uploader.ts`：原 `from './index.js'` 引入的 `loadConfig` `isEnabled` `digitalTwinPaths` → `from '@matrix-riven/shared'`；`./daemon/process-manager.js` 保持
- `incremental/scan.ts`：检查并按规则改（若引用 paths/schemas）
- `quota/probe.ts`：`../schemas/cc-session.js` → `@matrix-riven/shared`
- `quota/state.ts`：`../schemas/cc-session.js` → `@matrix-riven/shared`
- `quota/scheduler.ts`：检查并按规则改
- `quota/hourly.ts`：`../config.js` `../paths.js` `../schemas/cc-session.js` → `@matrix-riven/shared`；`./scheduler.js` `./state.js` `./probe.js` `../incremental/scan.js` `../hooks/tap-session.js` 保持（同包）
- `realtime-client.ts`：`./cc-status/types.js` → `@matrix-riven/shared`

- [ ] **Step 3: 写 `packages/uploader-client/src/index.ts`**

参考 `TeamBrain-src/packages/digital-twin/src/index.ts` 中属于 uploader-client 的导出块（daemon/uploader、daemon/queue、daemon/backoff、daemon/process-manager、bin-uploader、daemon/uploader-log、tap-session、quota/*、incremental/scan、realtime-client）。逐符号核对名字。骨架：

```typescript
export {
  tapSession,
  projectDirForCwd,
  claudeTranscriptPath,
  type TapSessionInput,
  type TapSessionDeps,
  type TapSessionResult,
  type TapSessionStatus,
} from './hooks/tap-session.js';

export {
  uploadCcSession,
  uploadEntry,
  classifyResponse,
  type UploadOutcome,
  type UploadInput,
  type UploadDeps,
  type FetchLike,
} from './daemon/uploader.js';

export {
  listPending,
  loadEntry,
  removeEntry,
  moveToDeadLetter,
  enforceCapacity,
  writeMetadataAtomic,
  isEntryTooLarge,
  DEFAULT_QUEUE_CAPACITY_BYTES,
  type QueueEntry,
  type LoadedEntry,
  type LoadedEntryMetadata,
} from './daemon/queue.js';

export {
  backoffMs,
  shouldDeadLetter,
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
  DEAD_LETTER_AFTER_MS,
} from './daemon/backoff.js';

export {
  acquirePidLock,
  releasePidLock,
  readPidFile,
  isPidAlive,
  runUploadCycle,
  mainLoop,
  POLL_INTERVAL_MS,
  IDLE_EXIT_MS,
  type DaemonConfig,
  type CycleSummary,
  type CyclePerEntryOutcome,
  type PidFileContent,
  type MainLoopExit,
} from './daemon/process-manager.js';

export { runDaemon } from './bin-uploader.js';
export { readLastUploaderError, type UploaderLogError } from './daemon/uploader-log.js';

export {
  listLocalSessions,
  filterToUtcDate,
  planIncrementalUpload,
  type LocalSession,
  type ScanLocalDeps,
} from './incremental/scan.js';

export {
  probeQuota,
  parseQuotaHeaders,
  type ProbeQuotaInput,
  type ProbeQuotaDeps,
  type ProbeQuotaResult,
} from './quota/probe.js';

export {
  claudeCredentialsPath,
  loadOAuthCredentials,
  loadQuotaCache,
  saveQuotaCache,
  markStale,
  type OAuthCredentials,
  type FsReadDeps,
  type FsWriteDeps,
} from './quota/state.js';

export {
  shouldRunHourlyScan,
  loadLastHourlyScanAt,
  recordHourlyScanFired,
  type SchedulerReadDeps,
  type SchedulerWriteDeps,
} from './quota/scheduler.js';

export {
  runHourlyScanIfDue,
  utcDateString,
  projectDirFromTranscriptPath,
  type HourlyScanInput,
  type HourlyScanDeps,
  type HourlyScanOutcome,
} from './quota/hourly.js';

export {
  postCcStatusSnapshot,
  type PostCcStatusOptions,
  type PostCcStatusOutcome,
} from './realtime-client.js';
```

> 执行时核对每个符号名与源文件 `export` 一致；多余/缺失以 `tsc` 报错为准。

- [ ] **Step 4: typecheck**

Run: `pnpm --filter @matrix-riven/uploader-client exec tsc --noEmit`
Expected: 无错误。剩余 import 报错按包边界规则修。

- [ ] **Step 5: Commit**

```bash
git add packages/uploader-client/src
git commit -m "feat(uploader-client): 搬入 daemon/hooks/quota/incremental 库源文件"
```

---

## Task 5: uploader-client 包 — 可执行入口

**Files:**
- Copy+改: `cli/src/bin-digital-twin-tap.ts` → `packages/uploader-client/src/bin-digital-twin-tap.ts`
- Copy+改: `cli/src/realtime-emit.ts` → `packages/uploader-client/src/realtime-emit.ts`
- Copy+改: `cli/src/commands/digital-twin.ts` → `packages/uploader-client/src/bin-digital-twin.ts`
- Create: `packages/uploader-client/src/bin-session-start.ts`（薄壳，新写）
- Create: `packages/uploader-client/src/bin-user-prompt-submit.ts`（薄壳，新写）

- [ ] **Step 1: 搬 `bin-digital-twin-tap.ts`**

```bash
cp /c/Users/tianhaoxuan/TeamBrain-src/packages/cli/src/bin-digital-twin-tap.ts \
   /c/Users/tianhaoxuan/Matrix-Riven/packages/uploader-client/src/bin-digital-twin-tap.ts
```

改 import：原 `from '@teamagent/digital-twin'` 引入的 `ensureDefaultConfig` `isEnabled` `digitalTwinPaths` 属 shared → `from '@matrix-riven/shared'`；`tapSession` `runHourlyScanIfDue` 属本包 → `from './index.js'`（或分别从 `./hooks/tap-session.js`、`./quota/hourly.js`）。其余逻辑不动。

- [ ] **Step 2: 搬 `realtime-emit.ts`**

```bash
cp /c/Users/tianhaoxuan/TeamBrain-src/packages/cli/src/realtime-emit.ts \
   /c/Users/tianhaoxuan/Matrix-Riven/packages/uploader-client/src/realtime-emit.ts
```

改 import：原 `from "@teamagent/digital-twin"` 引入的 `CC_STATUS_SCHEMA_VERSION` `digitalTwinPaths` `getMachineId` `getUserId` `loadConfig` `type CcStatusSnapshot` `type DigitalTwinConfig` 属 shared → `from '@matrix-riven/shared'`；`postCcStatusSnapshot` `type PostCcStatusOutcome` 属本包 → `from './realtime-client.js'`。

- [ ] **Step 3: 搬并改造 `commands/digital-twin.ts` → `bin-digital-twin.ts`**

```bash
cp /c/Users/tianhaoxuan/TeamBrain-src/packages/cli/src/commands/digital-twin.ts \
   /c/Users/tianhaoxuan/Matrix-Riven/packages/uploader-client/src/bin-digital-twin.ts
```

改造：
1. 改 import：原 `from '@teamagent/digital-twin'` 引入的符号——`digitalTwinPaths` `loadConfig` `saveConfig` `defaultConfig` `getUserId` `getMachineId` 属 shared → `@matrix-riven/shared`；`listPending` `readPidFile` `isPidAlive` `readLastUploaderError` `tapSession` `claudeTranscriptPath` `type TapSessionResult` 属本包 → `from './index.js'`。
2. 在文件末尾追加自解析 argv 的入口（参考 `bin-digital-twin-tap.ts` 末尾的 `process.argv[1]` 自调用模式）。该文件已导出 `parseArgs` 风格的解析函数与 handler——调用它们：读 `process.argv.slice(2)` → 解析 → 调对应 handler → `process.exit(result.exitCode)`。执行时读文件确认导出的解析函数/handler 实际签名再接线。

- [ ] **Step 4: 写 `bin-session-start.ts`（薄壳）**

```typescript
#!/usr/bin/env node
/**
 * SessionStart hook 薄壳：读 stdin → 调 emitCcStatus(session_start) → 退出。
 * 不引入 packages/cli 的 runHook 框架。绝不抛错、绝不阻塞会话。
 */
import { emitCcStatus } from './realtime-emit.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
}

export async function main(
  stdinReader: () => Promise<string> = readStdin,
): Promise<void> {
  if (process.env.TEAMAGENT_DISABLED === '1') return;
  let raw: string;
  try {
    raw = (await stdinReader()).trim();
  } catch {
    return;
  }
  if (!raw) return;
  let parsed: { session_id?: unknown; cwd?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  const cwd = typeof parsed.cwd === 'string' ? parsed.cwd : process.cwd();
  const sessionId = parsed.session_id;
  try {
    emitCcStatus({
      event: 'session_start',
      ...(typeof sessionId === 'string' ? { sessionId } : {}),
      cwd,
    });
  } catch {
    /* never propagate */
  }
}

// 自调用判断：纯 process.argv 检查（ESM 源文件里没有 require/module）。
if (process.argv[1]?.includes('bin-session-start')) {
  main().catch(() => {
    /* never block session close */
  });
}
```

> 执行时核对 `emitCcStatus` 的实际参数类型（在 `realtime-emit.ts` 里）。若 `emitCcStatus` 的 `event` 取值或字段名不同，按其真实签名调整。

- [ ] **Step 5: 写 `bin-user-prompt-submit.ts`（薄壳）**

同 Step 4，唯一区别：`event: 'user_prompt'`（核对 `realtime-emit.ts` 里 `emitCcStatus` 接受的 event 字面量；UserPromptSubmit 对应的取值以 `realtime-emit.ts` 实际定义为准），自调用判断改成 `'bin-user-prompt-submit'`。完整代码：

```typescript
#!/usr/bin/env node
/**
 * UserPromptSubmit hook 薄壳：读 stdin → 调 emitCcStatus(user_prompt) → 退出。
 * 不引入 packages/cli 的 runHook 框架。绝不抛错、绝不阻塞会话。
 */
import { emitCcStatus } from './realtime-emit.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
}

export async function main(
  stdinReader: () => Promise<string> = readStdin,
): Promise<void> {
  if (process.env.TEAMAGENT_DISABLED === '1') return;
  let raw: string;
  try {
    raw = (await stdinReader()).trim();
  } catch {
    return;
  }
  if (!raw) return;
  let parsed: { session_id?: unknown; cwd?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  const cwd = typeof parsed.cwd === 'string' ? parsed.cwd : process.cwd();
  const sessionId = parsed.session_id;
  try {
    emitCcStatus({
      event: 'user_prompt',
      ...(typeof sessionId === 'string' ? { sessionId } : {}),
      cwd,
    });
  } catch {
    /* never propagate */
  }
}

// 自调用判断：纯 process.argv 检查（ESM 源文件里没有 require/module）。
if (process.argv[1]?.includes('bin-user-prompt-submit')) {
  main().catch(() => {
    /* never block session close */
  });
}
```

- [ ] **Step 6: typecheck**

Run: `pnpm --filter @matrix-riven/uploader-client exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 7: Commit**

```bash
git add packages/uploader-client/src
git commit -m "feat(uploader-client): 可执行入口（tap/emit/digital-twin CLI + 薄壳 hook bin）"
```

---

## Task 6: uploader-client 包 — 搬测试 + 跑绿

**Files (复制测试):**
- `digital-twin/src/hooks/__tests__/tap-session.test.ts` → `packages/uploader-client/src/hooks/__tests__/`
- `digital-twin/src/daemon/__tests__/{backoff,l1-recall,process-manager,queue,uploader-log,uploader}.test.ts` → `packages/uploader-client/src/daemon/__tests__/`
- `digital-twin/src/incremental/__tests__/scan.test.ts` → `packages/uploader-client/src/incremental/__tests__/`
- `digital-twin/src/quota/__tests__/{hourly,probe,scheduler,state}.test.ts` → `packages/uploader-client/src/quota/__tests__/`
- `digital-twin/src/__tests__/{bin-uploader,realtime-client}.test.ts` → `packages/uploader-client/src/__tests__/`
- `cli/src/__tests__/{bin-digital-twin-tap,digital-twin-command,realtime-emit}.test.ts` → `packages/uploader-client/src/__tests__/`

- [ ] **Step 1: 复制测试文件**

```bash
DT=/c/Users/tianhaoxuan/TeamBrain-src/packages/digital-twin/src
CLI=/c/Users/tianhaoxuan/TeamBrain-src/packages/cli/src
DST=/c/Users/tianhaoxuan/Matrix-Riven/packages/uploader-client/src
mkdir -p "$DST/hooks/__tests__" "$DST/daemon/__tests__" "$DST/incremental/__tests__" "$DST/quota/__tests__" "$DST/__tests__"
cp "$DT/hooks/__tests__/tap-session.test.ts" "$DST/hooks/__tests__/"
cp "$DT/daemon/__tests__/"{backoff,l1-recall,process-manager,queue,uploader-log,uploader}.test.ts "$DST/daemon/__tests__/"
cp "$DT/incremental/__tests__/scan.test.ts" "$DST/incremental/__tests__/"
cp "$DT/quota/__tests__/"{hourly,probe,scheduler,state}.test.ts "$DST/quota/__tests__/"
cp "$DT/__tests__/"{bin-uploader,realtime-client}.test.ts "$DST/__tests__/"
cp "$CLI/__tests__/"{bin-digital-twin-tap,digital-twin-command,realtime-emit}.test.ts "$DST/__tests__/"
```

- [ ] **Step 2: 改测试 import**

- 大多数 daemon/hooks/quota/incremental 测试用相对路径引用同包源文件——保持不变。
- 引用 shared 符号的（如 `../../schemas/cc-session.js`、`../paths.js`）→ 按包边界规则改 `@matrix-riven/shared`。
- 从 cli 搬来的 3 个测试：原引用 `../bin-digital-twin-tap.js`、`../realtime-emit.js`、`../commands/digital-twin.js` → 改为 `./bin-digital-twin-tap.js`、`./realtime-emit.js`、`./bin-digital-twin.js`（注意 `digital-twin-command.test.ts` 引用的是改造后的 `bin-digital-twin.ts`，且测试的是其导出的 handler 函数，不是 argv 入口——若测试直接调 argv 入口需相应调整）。
- 任何 `@teamagent/*` 残留按规则改。

- [ ] **Step 3: 跑测试**

Run: `pnpm --filter @matrix-riven/uploader-client test`
Expected: 全部 PASS。

失败处理：
- import 路径问题 → 按规则修。
- `digital-twin-command.test.ts` 若因改造（argv 入口）失败 → 该测试原本测 handler 函数，确保改造保留了原 handler 导出；测试只调 handler 不调 argv main 的话应无需改。若测试断言了 command-registry 行为，删除该断言（已无 registry）。
- `bin-digital-twin-tap.test.ts` 的 `resolveDaemonBin` 测试用 fixture monorepo 路径 → 路径相对结构未变应仍通过；失败则核对 fixture 引用。

- [ ] **Step 4: Commit**

```bash
git add packages/uploader-client/src
git commit -m "test(uploader-client): 搬入并跑绿 uploader-client 包测试"
```

---

## Task 7: collector-server 包 — 搬源文件 + mock-server 手术

**Files (从 `digital-twin/src` 复制到 `packages/collector-server/src/`):**
- `dashboard-html.ts`
- `member-stats.ts`
- `realtime-stream.ts`
- `mock-server.ts`（手术）
- `bin-prod-server.ts`
- Create: `packages/collector-server/src/index.ts`

- [ ] **Step 1: 复制源文件**

```bash
SRC=/c/Users/tianhaoxuan/TeamBrain-src/packages/digital-twin/src
DST=/c/Users/tianhaoxuan/Matrix-Riven/packages/collector-server/src
mkdir -p "$DST"
cp "$SRC/dashboard-html.ts" "$SRC/member-stats.ts" "$SRC/realtime-stream.ts" "$SRC/mock-server.ts" "$SRC/bin-prod-server.ts" "$DST/"
```

- [ ] **Step 2: 改非 mock-server 文件的 import**

- `dashboard-html.ts`：检查（应无跨包 import）。
- `member-stats.ts`：`./cc-status/path-safety.js` → `@matrix-riven/shared`。
- `realtime-stream.ts`：`./cc-status/store.js` `./cc-status/types.js` → `@matrix-riven/shared`。
- `bin-prod-server.ts`：`./mock-server.js` 保持（同包）。

- [ ] **Step 3: mock-server.ts 手术 — 删 bpp**

删除以下 bpp 相关内容：
- import 行：`./bpp/server-handlers.js`、`./bpp/revoke.js`、`./bpp/force-push.js`、`./bpp/store.js`、`./bpp/role-hierarchy.js`、`./bpp/sse-broadcast.js`、`./bpp/accept-handler.js`、`./bpp/https-server.js`、`./bpp/auth-gate.js`（共 9 个 `./bpp/*` import；`requireBearerToken`/`wrapServerWithHttps` 等若被非 bpp 路由用到则需保留并改实现——见下方说明）
- 路由常量：`ROUTE_BP_PUSH`、`ROUTE_BP_REVOKE`、`ROUTE_BP_FORCE_PUSH`、`ROUTE_INBOX_ACT`、`ROUTE_BP_MEMBERS`
- `handleGet` 内的 bpp GET 路由分支：`/v1/inbox`、`/v1/audit`、`/v1/role`、`/v1/inbox/stream`（SSE）
- `startMockServer` 内的 bpp POST 路由分支：`handleBpPush`、`handleRevoke`、`handleForcePush`、`handleInboxAct`、`handleMemberJoin` 及其 `route === ROUTE_BP_*` 判断
- POST 路由白名单里的 `ROUTE_BP_*` 项

注意 `requireBearerToken`（`./bpp/auth-gate.js`）和 `wrapServerWithHttps`（`./bpp/https-server.js`）：若它们也守卫 `/v1/cc-sessions` 或被 TLS 选项用到（设计文档保留 token auth + TLS），则**不要删** —— 改为把这两个文件一并搬进 collector-server（`packages/collector-server/src/auth-gate.ts`、`https-server.ts`，它们是小而独立的工具），import 改为 `./auth-gate.js` / `./https-server.js`。执行时 grep `requireBearerToken`、`wrapServerWithHttps` 在 mock-server.ts 的使用点判断。

- [ ] **Step 4: mock-server.ts 手术 — 删视频**

删除：
- import：`./videos-html.js`（`VIDEOS_DASHBOARD_HTML`）
- 路由常量：`ROUTE_VIDEOS`、`ROUTE_RECORDINGS`
- `handleGet` 内：`/videos`、`/videos.html`、`/api/videos` 分支
- `startMockServer` 内：`route === ROUTE_VIDEOS`、`route === ROUTE_RECORDINGS` 分支
- POST 白名单里的 `ROUTE_VIDEOS`、`ROUTE_RECORDINGS`

**保留**：`POST /v1/cc-sessions`、`POST /v1/cc-status`、`GET /`（dashboard）、`/api/cc-status*`、`/api/users`、`/api/dates`、`/api/sessions`、`/api/quota`、`/api/file`、`GET /v1/member-stats`。

- [ ] **Step 5: mock-server.ts 手术 — 改剩余 import**

`@teamagent/core`（`detectSensitiveText`/`redactSensitiveText`）→ `@matrix-riven/shared`；`./cc-status/path-safety.js`、`./cc-status/store.js` → `@matrix-riven/shared`；`./dashboard-html.js`、`./member-stats.js` 保持（同包）。

- [ ] **Step 6: 写 `packages/collector-server/src/index.ts`**

```typescript
export {
  startMockServer,
  safeUserId,
  dateStamp,
  type MockServerOptions,
  type MockServerHandle,
} from './mock-server.js';

export { runProdServer, type RunProdServerDeps } from './bin-prod-server.js';
export { DASHBOARD_HTML, quotaBucket } from './dashboard-html.js';
export { computeMemberStats, type MemberStats } from './member-stats.js';
export { createSseHandler, type SseHandlerOptions } from './realtime-stream.js';
```

> 核对符号名与源文件 `export` 一致（`safeUserId`/`dateStamp` 若 mock-server.ts 不再导出则从此处移除；以 tsc 为准）。

- [ ] **Step 7: typecheck**

Run: `pnpm --filter @matrix-riven/collector-server exec tsc --noEmit`
Expected: 无错误。常见残留：手术删干净后仍被引用的 bpp 符号 → 继续删对应路由分支。

- [ ] **Step 8: Commit**

```bash
git add packages/collector-server/src
git commit -m "feat(collector-server): 搬入服务端 + mock-server 手术（去 bpp/视频）"
```

---

## Task 8: collector-server 包 — 搬测试（剔 bpp/视频用例）+ 跑绿

**Files (复制测试到 `packages/collector-server/src/__tests__/`):**
- `digital-twin/src/__tests__/{bin-prod-server,dashboard-html,member-stats,mock-server,mock-server-cc-status,realtime-stream,throughput-1500}.test.ts`

- [ ] **Step 1: 复制测试文件**

```bash
SRC=/c/Users/tianhaoxuan/TeamBrain-src/packages/digital-twin/src/__tests__
DST=/c/Users/tianhaoxuan/Matrix-Riven/packages/collector-server/src/__tests__
mkdir -p "$DST"
cp "$SRC/"{bin-prod-server,dashboard-html,member-stats,mock-server,mock-server-cc-status,realtime-stream,throughput-1500}.test.ts "$DST/"
```

- [ ] **Step 2: 改测试 import**

测试用相对路径引用同包源文件（`../mock-server.js` 等）——保持不变。引用 shared 符号的按规则改 `@matrix-riven/shared`。

- [ ] **Step 3: 剔除 `mock-server.test.ts` 里的 bpp/视频用例**

`mock-server.test.ts` 有约 5 处引用 bpp/视频路由（`bp-push`、`/v1/videos`、`/v1/recordings`、`handleBp*` 等）。删除这些 `it(...)` / `describe(...)` 用例块（整块删，不留空壳）。`mock-server-cc-status.test.ts` 只测 cc-status，应无需改。

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter @matrix-riven/collector-server test`
Expected: 全部 PASS。

失败处理：
- 若某用例依赖已删的视频/bpp 路由 → 该用例漏剔，删掉。
- `throughput-1500.test.ts` 测 `startMockServer` 吞吐，应仍通过。
- import 路径问题按规则修。

- [ ] **Step 5: Commit**

```bash
git add packages/collector-server/src
git commit -m "test(collector-server): 搬入测试并剔除 bpp/视频用例，跑绿"
```

---

## Task 9: 全量验证 + 构建契约

- [ ] **Step 1: 全量 typecheck**

Run: `pnpm -r exec tsc --noEmit`
Expected: 三个包全部无错误。

- [ ] **Step 2: 全量测试**

Run: `pnpm test`
Expected: 全部 PASS。

- [ ] **Step 3: 全量构建**

Run: `pnpm -r build`
Expected: 三个包各自产出 `dist/`。`uploader-client/dist/` 含 `bin-uploader.cjs`、`bin-digital-twin-tap.cjs`、`bin-session-start.cjs`、`bin-user-prompt-submit.cjs`、`bin-digital-twin.cjs`；`collector-server/dist/` 含 `bin-prod-server.cjs`。

- [ ] **Step 4: CJS bundle 自包含校验**

Run（检查 staged binary bundle 里没有残留的外部 `require()`）:
```bash
grep -nE "require\(['\"](ulid|@matrix-riven)" packages/uploader-client/dist/bin-uploader.cjs packages/collector-server/dist/bin-prod-server.cjs
```
Expected: 无输出（`ulid` 与 `@matrix-riven/shared` 都已 `noExternal` 内联）。若有输出说明 tsup `noExternal` 配置漏项，回 Task 1 Step 11/14 修。

- [ ] **Step 5: Commit（若构建产物需要忽略，确认 .gitignore 已含 dist/）**

```bash
git add -A
git commit -m "chore: 全量 typecheck/test/build 通过 + CJS 自包含校验" --allow-empty
```

---

## Task 10: 端到端冒烟（真实客户端 → 服务端链路）

- [ ] **Step 1: 起服务端**

```bash
TEAMAGENT_COLLECTOR_DIR=/tmp/mr-collector-smoke PORT=8099 \
  node packages/collector-server/dist/bin-prod-server.cjs &
```
记下 PID。Expected: stderr 打印 `listening on http://0.0.0.0:8099`。

- [ ] **Step 2: 造一个 fixture 队列条目**

写一个临时脚本（`tsx`）用 shared 的 `buildCcSessionEnvelope` 不行——队列条目是 `<id>.payload`（原始 jsonl 字节）+ `<id>.json`（`CcSessionMetadata`）。直接造：
```bash
mkdir -p ~/.teamagent/digital-twin/queue/pending
ID=$(date +%s)smoke
printf '{"type":"user","message":"hello"}\n' > ~/.teamagent/digital-twin/queue/pending/$ID.payload
```
`$ID.json` 的内容参考 `TeamBrain-src/packages/digital-twin/src/hooks/tap-session.ts` 里 `CcSessionMetadata` 的字段（`id`/`kind:'cc-session'`/`session_id`/`cwd`/`project_name`/`transcript_path`/`payload_size`/`captured_at`/`source`/`host`/`teamagent_version`/`schema_version:1`）。执行时按该 interface 写一份合法 JSON，`id` = `$ID`。

同时确保 `~/.teamagent/digital-twin.json` 存在且 `uploader.enabled=true`、`uploader.endpoint=http://127.0.0.1:8099`、`uploader.token` 非空（可手写，或先跑一次 `bin-digital-twin.cjs login <token>`）。

- [ ] **Step 3: 跑守护进程排空队列**

```bash
node packages/uploader-client/dist/bin-uploader.cjs
```
Expected: 进程跑完退出码 0；`~/.teamagent/digital-twin/queue/pending/` 被清空（条目上传成功后删除）。

- [ ] **Step 4: 验证服务端落盘**

```bash
find /tmp/mr-collector-smoke -type f
```
Expected: 出现 `<user>/<date>/` 下的 transcript 文件。

- [ ] **Step 5: 验证看板**

```bash
curl -s http://127.0.0.1:8099/ | grep -o "<title>.*</title>"
curl -s "http://127.0.0.1:8099/api/users"
```
Expected: dashboard HTML 返回；`/api/users` 列出刚上传的 user。

- [ ] **Step 6: 收尾**

杀掉服务端进程，清理 `/tmp/mr-collector-smoke` 与 fixture 队列条目。记录冒烟结果。

- [ ] **Step 7: Commit（如冒烟过程中修了 bug）**

```bash
git add -A
git commit -m "fix: 端到端冒烟修正" --allow-empty
```

---

## Task 11: 收尾 — 合并 + push

- [ ] **Step 1: 更新设计文档状态**

在 `docs/superpowers/specs/2026-05-14-teambrain-log-upload-extraction-design.md` 末尾追加一行：`> 实现状态：已完成（feat/log-upload-extraction，2026-05-14）`。

- [ ] **Step 2: 写最小 README**

`README.md`：项目简介（三包结构）、`pnpm install` / `pnpm test` / `pnpm -r build` 用法、客户端 vs 服务端的部署说明（env 变量 `TEAMAGENT_COLLECTOR_DIR` / `TEAMAGENT_REALTIME_URL` 等）。

- [ ] **Step 3: 合并到 main**

```bash
git add -A && git commit -m "docs: 更新实现状态 + README"
git checkout main
git merge --no-ff feat/log-upload-extraction -m "feat: 从 TeamBrain 拆分用户日志上传子系统"
```

- [ ] **Step 4: push**

```bash
git push -u origin main
```
Expected: push 成功到 `github.com/libz-renlab-ai/Matrix-Riven`。

---

## 完成定义（Definition of Done）

1. `pnpm install` 干净通过，无 `@teamagent/*` 外部依赖。
2. `pnpm -r exec tsc --noEmit` 全绿。
3. `pnpm test` 全绿。
4. `pnpm -r build` 产出全部 bin，CJS bundle 无外部 `require()`。
5. Task 10 端到端冒烟通过：transcript 经客户端 → 服务端落盘 → 看板可见。
6. 仓库不含 `recorder/`、`bpp/`、`videos-html.ts`。
7. 已 push 到 `origin/main`。
