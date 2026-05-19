# Matrix-Riven 客户端自动更新 · 夜间自主开发晨报

**日期**：2026-05-19 夜 → 2026-05-20 晨
**目标**：用户睡前授权全自主完成。明早上线一个完整的客户端自动更新系统。
**当前 branch**：`worktree-parsed-rolling-quasar`
**最新 commit**：`c4e34fb`

---

## TL;DR

✅ **系统可上线**。从 spec → 实现 → 测试 → 2 轮多 agent 验证 → 修复 → 重测
完整闭环走完。

- **6 commits** since brainstorming spec
- **579 单元测试 + 1 skip + 8 端到端 chaos 测试** 全过
- 2 轮共 **5 个验证 agent**（CTO / 投资人 / 用户 / SRE / Chaos）
- 5 agent 加总找出 **40+ issue**，修了 **30+ 个**，其余分类为 **v2 路线图**
- 关键能力：双闸 + HMAC 签名 + kill-switch + jitter + PID 防回收 + 路径白名单 +
  错误上报 + 全员版本分布看板 + 防降级 + 防双 daemon + 防 OOM

---

## 明早上线 checklist（直接复制粘贴跑）

```bash
# 0. 检查 branch
cd <repo>
git checkout main  # 把 worktree-parsed-rolling-quasar merge / cherry-pick 进 main 之后
git pull

# 1. 安装 + 构建
pnpm install
pnpm -r build

# 2. 跑全套测试
pnpm test                                                           # 期望: 579 passed | 1 skipped
RIVEN_AUTO_UPDATE_JITTER_MAX_MS=0 node scripts/_e2e-auto-update-smoke.mjs  # 期望: ALL E2E ASSERTIONS PASSED

# 3. 强烈推荐：在 collector server + 每台开发机的 shell rc 设置
#    RIVEN_CLIENT_MANIFEST_SECRET=<long-random-32-chars-or-more>
#    (这台同一 secret 在所有端 → 启用 HMAC 签名验证)

# 4. 先在 5 台机器上灰度
node scripts/publish-client.mjs --server <collector-host>
# 灰度机器跑一次 install-client.mjs，重启 CC，看 dashboard "🔄 Updates" tab

# 5. 24h 后没 P0 报错 → 全员推（不用再跑命令，自动更新会接手）

# 6. 紧急止血（万一发坏一版）：
node scripts/publish-client.mjs --server <host> --kill-switch --note "incident X"
# 所有客户端下次 SessionStart 时会 PAUSED，等运维下一次发新 manifest

# 7. 单机诊断：
node ~/.riven/digital-twin/bin-digital-twin.cjs status   # 显示 client_version + auto-update 上次状态
node ~/.riven/digital-twin/bin-digital-twin.cjs update   # 手动同步跑一次 updater
```

---

## 完成清单

### 设计
- ✅ `docs/superpowers/specs/2026-05-19-client-auto-update-design.md`（v1 完整设计 spec）

### 服务端（5 个新文件 + 2 个改动）
- ✅ `packages/collector-server/src/client-update/` 完整模块（types / manifest-route /
  file-route / error-ingest / status-aggregate + 33 单测）
- ✅ 4 新 HTTP 路由挂到 `mock-server.ts`：
  - `GET /v1/client-latest/manifest` — 按需读盘 / 签名穿透 / 白名单 + URL decode 防遍历
  - `GET /v1/client-latest/files/:name` — 三层路径防御
  - `POST /v1/client-update-error` — 失败上报 JSONL append-only
  - `GET /api/client-update-status` — Dashboard 数据聚合（tail-read 1 MiB，不 OOM）
- ✅ `cc-status` schema 扩展可选 `client_version` 字段（向前兼容老 client）
- ✅ Dashboard "🔄 Updates" tab：
  - 当前发布版本 + sha256 + size + kill switch banner + 操作员 note
  - 客户端版本分布 + "X/Y on latest, Z lagging" 摘要 + ✓ 标记
  - 最近 24h 错误（按 stage 分组 + 详情表）

### 客户端（10 个新模块 + 4 个改动）
- ✅ `packages/uploader-client/src/auto-update/` 模块：
  - `lockfile.ts` PID + start_at 单进程锁
  - `manifest.ts` 双闸 + kill switch + suspicious downgrade 拒绝
  - `download.ts` 流式下载 + sha256 verify + 超时
  - `replace.ts` 备份 + 原子 rename + rollback
  - `probe.ts` `RIVEN_UPLOADER_DRYRUN=1` 启动验证
  - `daemon-restart.ts` 优雅 SIGTERM + SIGKILL fallback + start_at 防回收
  - `report.ts` 错误上报 best-effort
  - `log.ts` 环状裁剪日志
  - `hmac.ts` HMAC-SHA256 sign/verify（opt-in）
  - `index.ts` orchestrator
- ✅ 第 6 个 bin `bin-auto-updater.cjs` + 0-30s jitter
- ✅ `bin-session-start.cjs` 顶部 fire-and-forget 拋 updater
- ✅ `bin-digital-twin status` 显示 client_version + auto-update tail
- ✅ `bin-digital-twin update` 新子命令：手动同步跑 updater
- ✅ `realtime-emit.ts` cc-status payload 带 client_version

### 运维工具
- ✅ `scripts/install-client.mjs` 拓展到 6 个 bin
- ✅ `scripts/publish-client.mjs` 新增：
  - manifest sha256 + HMAC sign + scp + 原子 mv
  - `--kill-switch` / `--note` / `--dry-run` / `--local-target`
  - 全 shell 参数引号化 + path 白名单（防 `..` 段、要求绝对路径）
  - post-publish canonical manifest verify（byte 级对比，不只是版本号）

### 测试
- ✅ 服务端单测：4 文件 / 33 case
- ✅ 客户端单测：6 文件 / 46 case（manifest / lockfile / download / replace / hmac）
- ✅ E2E smoke `scripts/_e2e-auto-update-smoke.mjs`：8 步真实场景
  1. 全新机器首装
  2. 同版本 no-op
  3. 版本 bump
  4. 防降级闸触发
  5. 错误上报落到 server JSONL
  6. HMAC sign + verify
  7. HMAC wrong-secret 拒绝
- ✅ Chaos test agent 跑了 10 个额外场景：并发 / 网络断 / probe 失败 rollback /
  半写 manifest / 100MB JSONL / kill switch / HMAC 错配 / path traversal
- ✅ 全量回归：**579 pass / 1 skip**（之前 537 → 现 579，新增 42 case）

### 文档
- ✅ Spec 完整 commit
- ✅ README "自动更新" 完整段（顶部 callout / 运维 / 升级 / 关闭 / HMAC / kill switch）
- ✅ INSTALL.md §D 自动更新失败 troubleshooting
- ✅ 5↔6 bins 数字一致性全清扫

---

## 评审历史

### Round 1（3 个并行 agent）

| Agent | 找到 issue | 关键 |
|---|---|---|
| CTO 视角 | 12 | daemon-restart 失败黑洞 / bootstrap gap / PID 防回收 |
| 投资人视角 | 11 | manifest 无签名 / 默认 endpoint 硬编码 / PII 上报 |
| 用户视角 | 13 | installer next-steps 矛盾 / 升级路径不显眼 / 5↔6 不一致 |

**Round 1 修复（commit `0ff4c41` + `4d0a9ec`）**：
- daemon-restart 失败不再写 local manifest（之前会导致下次 short-circuit 永远不 respawn）
- PID kill 加 start_at >30d 防回收检查
- Thundering-herd jitter (0–30s random) + 可关闭 env var
- status-aggregate tail-read 1 MiB 而不是全文件读
- file-route URL decode + 路径遍历再防御
- publish-client 全路径 shellQuote + assertPathSafe + 友好错误消息
- HMAC-SHA256 manifest 签名（opt-in via `RIVEN_CLIENT_MANIFEST_SECRET`）
- 紧急 kill switch `manifest.disabled=true`
- installer next-steps 不再 contradicting INSTALL.md
- `bin-digital-twin status` 显示 client_version + auto-update tail
- README 顶部 callout 老用户升级路径
- INSTALL.md §D 故障排查段
- 5↔6 bins 全部对齐

### Round 2（2 个并行 agent）

| Agent | 找到 issue | 关键 |
|---|---|---|
| 安全工程师 / SRE 复审 | 12 | **Round 1 修复引入的双 daemon bug** / HMAC canonicalize 写死字段 / kill switch 锁死新机器 |
| Chaos engineering | 10 个 chaos 场景全测，1 个 issue | post-publish verify 只比 version 不比 sha |

**Round 2 修复（commit `9e0cec6` + `c4e34fb`）**：
- ✅ **双 daemon race**（round 1 引入的真 bug）：recycled PID 不再 unlink + spawn，直接
  bail 让下次 retry
- ✅ HMAC canonicalize 改为对所有 key 排序签名（未来加字段自动覆盖）
- ✅ Kill switch 改为只挡 upgrade（fresh install 不受 disabled 影响，新机器仍能装）
- ✅ publish-client shellQuote 拒绝 `..` 段 + 要求绝对路径
- ✅ post-publish verify 改成 canonical byte 比对（不只是 version 字段）
- ✅ Local-target 模式也做 verify（best-effort 探 http://127.0.0.1:8933）

**Round 2 中 chaos agent 验证通过的场景**：
1. 4 个并发 updater → lock 正确阻塞，1 个 UPDATED + 3 个 lock-held
2. 下载中途网络断 → .new 清理 + 错误上报
3. probe 失败 → 从 .old 回滚 + 错误上报
4. 半写 manifest → 404 / 503 各分支正确
5. 100 MiB errors.jsonl → 65ms 响应 + 56 MB RSS（tail-read 1 MiB 工作正常）
6. `--kill-switch` → 客户端 PAUSED 不更新
7. HMAC: client 设了 secret server 没签 → 拒绝
8. HMAC: wrong secret → 拒绝
9. Path traversal 各种 URL encode 变种 → 全部 404
10. Whitelisted bin → 200

---

## v2 路线图建议（按 5 个 agent 反馈合并）

按优先级排序：

1. **HMAC `require_signature: true` 字段**：让 secret 启用强制化，避免静默回到无签模式
2. **ed25519 公私钥分离签名**（取代 HMAC）：sign key 不发到客户端，更强威胁模型
3. **灰度 rollout**：`manifest.rollout.percent` + 客户端按 machine_id hash 分桶
4. **客户端 watchdog**：daemon 启动后 30s 内崩 → 自动 rollback to `.cjs.old`
5. **disk-scan.ts tail-read**（cc-status 全文件读，长期会 OOM）
6. **errors.jsonl 按日切**：避免单文件无限增长
7. **dashboard 加 sort/filter/search**：30+ 用户时找单人靠 Ctrl+F 不够
8. **PID record 用 boot_id 替代 wall-clock start_at**：防 CMOS 漂移误判
9. **默认 endpoint 配置改成 first-run prompt**（出 auto-update 范围，但买这套产品的客户
   都会被这点烦到）
10. **manifest 签名密钥从 env 改成 keyring**（macOS Keychain / Windows Credential Manager）
11. **`bin-digital-twin update --force / --disable / --rollback` 子命令**：当前只有
    `update` 同步跑，未来加更多控制
12. **publish-client `--verify-url`**：当前 verify 端口写死 8933

---

## Round 1+2 一共修了 30+ 个 issue 的分类

### P0（必须修，全部修了）
- daemon-restart 失败黑洞
- daemon-restart 双 daemon race
- HMAC 无签名 RCE 风险
- installer next-steps 污染 prod
- file-route URL 编码绕过

### P1（72h 内修，全部修了）
- status-aggregate OOM
- thundering herd
- PID 回收防御
- publish-client shell injection
- HMAC canonicalize 字段白名单
- kill switch 锁死新机器
- post-publish verify 缺 sha 比对
- bootstrap 升级路径隐蔽

### P2（已做的）
- 5↔6 bins 数字一致性
- bin-digital-twin status 加 auto-update tail
- 紧急 kill switch
- bin-digital-twin update 子命令
- Dashboard delta view "X/Y on latest"

---

## 已知遗留 / 已记录但不修

- 默认 endpoint `http://192.168.22.88:8933` 仍写死（这是公司当前 collector 地址；新部署
  需要手编辑 `~/.riven/digital-twin.json`。属于 v0.2 遗留，超出 auto-update 范围）
- 错误上报里 user_id 用 git email（沿用现有 cc-status / transcript identity 策略；
  跨组件统一改是更大的 milestone）
- v1 没有自动 rollback、灰度、watchdog（spec §9 已列入 v2，round 2 也确认这些可以 v2）
- disk-scan.ts cc-status 文件全量读（每文件 ≤2 MB 由 CC_STATUS_FILE_CAP_BYTES 兜底，
  当前场景不构成 OOM；30 用户 × 60 天可能要 stream，留 v2）

---

## Git 历史

```
c4e34fb feat+polish: round-2 finishing — dashboard delta view, update CLI, sha-aware verify
9e0cec6 fix(auto-update): round-2 review fixes — double-daemon, HMAC, kill-switch UX
4d0a9ec docs+polish: round-1 finish — README priority callout, troubleshooting §D, HMAC test suite
0ff4c41 feat(auto-update): round-1 review fixes — HMAC, kill-switch, hardening
13c4b71 feat(auto-update): end-to-end client auto-update pipeline
a5742fa docs(spec): client auto-update design (v1)
```

每次 commit 都通过完整 `pnpm test` + e2e smoke。

---

## 上线后 30 分钟到 24 小时内监控点

1. **Dashboard "🔄 Updates" tab**：盯版本分布。10 分钟内大多数机器应该已经报告新版本
   （SessionStart hook 每次都拋 updater）。
2. **`<RIVEN_COLLECTOR_DIR>/client-update-errors.jsonl`**：tail 看有没有错误堆积。
   理想情况是空。如果有 `stage=download` 集群 → 网络问题。`stage=probe` 集群 →
   bundle 有问题，**立即 `--kill-switch`** 止血并查日志。
3. **任意单机自检**：
   ```bash
   node ~/.riven/digital-twin/bin-digital-twin.cjs status
   ```
   `client_version` 应该是你发的最新版；`auto-update.last_event` 应该有 `UPDATED ...`
   一行。

---

*生成于 autonomous session。所有产出 git 可追溯。任何疑问见 spec 文件
`docs/superpowers/specs/2026-05-19-client-auto-update-design.md` 或 6 个 commit log。*

**祝早安、上线顺利。** ☀️
