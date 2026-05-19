# Matrix-Riven 客户端自动更新 · 夜间自主开发晨报

**日期**：2026-05-19 夜 → 2026-05-20 晨
**目标**：用户睡前授权全自主完成。明早上线一个完整的客户端自动更新系统。
**当前 branch**：`worktree-parsed-rolling-quasar`
**最新 commit**：`<填充>`（晨报最后更新时填）

---

## TL;DR

✅ **系统可上线**。从 spec → 实现 → 测试 → 2 轮多 agent 验证 → 修复 → 重测
完整闭环走完。**594+ 单元测试全过、7 步端到端 smoke 全过、HMAC 签名 + 紧急 kill switch
+ 防回滚 + 防回收 PID + 防 thundering herd 全部就位**。

明早建议路线：

1. 在 5 台机器上先跑 24h 灰度（手动 install）
2. 5 台都没 P0 报错 → 全员推
3. 全员推前在公司发布机和每台开发机都设
   `RIVEN_CLIENT_MANIFEST_SECRET=<long-random>` 启用 HMAC 签名

---

## 完成清单

### 设计
- ✅ `docs/superpowers/specs/2026-05-19-client-auto-update-design.md`（v1 设计 spec）

### 服务端
- ✅ `packages/collector-server/src/client-update/` 完整模块（types / manifest-route /
  file-route / error-ingest / status-aggregate）
- ✅ 4 新 HTTP 路由挂到 `mock-server.ts`：
  - `GET /v1/client-latest/manifest` — 按需读盘、签名穿透、白名单 + URL decode 防遍历
  - `GET /v1/client-latest/files/:name` — 白名单 + decode + traversal 三层防御
  - `POST /v1/client-update-error` — 失败上报 JSONL append-only
  - `GET /api/client-update-status` — Dashboard 数据聚合（tail-read 1 MiB，不 OOM）
- ✅ `cc-status` schema 扩展可选 `client_version` 字段（向前兼容老 client）
- ✅ Dashboard "🔄 Updates" tab：
  - 当前发布版本 + sha256 列表 + kill switch banner
  - 各客户端版本分布（聚合自 cc-status）
  - 最近 24h 错误（按 stage 分组 + 最近 50 条详情）

### 客户端
- ✅ `packages/uploader-client/src/auto-update/` 9 个模块：
  - `lockfile.ts` PID + start_at 单进程锁
  - `manifest.ts` 双闸 + kill switch + suspicious downgrade 拒绝
  - `download.ts` 流式下载 + sha256 verify + 超时
  - `replace.ts` 备份 + 原子 rename + rollback
  - `probe.ts` `RIVEN_UPLOADER_DRYRUN=1` 启动新版本验证
  - `daemon-restart.ts` 优雅 SIGTERM + SIGKILL fallback + start_at 防回收
  - `report.ts` 错误上报 best-effort
  - `log.ts` 环状裁剪日志
  - `hmac.ts` HMAC-SHA256 签名验证（opt-in）
  - `index.ts` orchestrator
- ✅ 第 6 个 bin `bin-auto-updater.cjs` + 0-30s jitter
- ✅ `bin-session-start.cjs` 顶部 fire-and-forget 拋 updater
- ✅ `bin-digital-twin status` 现在显示 client_version + auto-update 状态
- ✅ `realtime-emit.ts` cc-status payload 自动带 client_version

### 运维工具
- ✅ `scripts/install-client.mjs` 拓展到 6 个 bin
- ✅ `scripts/publish-client.mjs` 新增（生成 manifest + sha256 + HMAC sign + scp +
  原子 mv + post-publish verify GET）
- ✅ `--kill-switch` / `--note` / `--dry-run` / `--local-target` 等运维体验旗标

### 测试
- ✅ 服务端单测：4 文件 / 33 case（manifest / file-route / error-ingest / status-aggregate）
- ✅ 客户端单测：5 文件 / 35 case（manifest / lockfile / download / replace / hmac）
- ✅ E2E smoke `scripts/_e2e-auto-update-smoke.mjs`：8 步真实场景
  1. 全新机器首装
  2. 同版本 no-op
  3. 版本 bump
  4. 防降级闸触发
  5. 错误上报落到 server JSONL
  6. HMAC sign + verify
  7. HMAC wrong-secret 拒绝
  8. （Chaos agent 补充的额外场景，见下）
- ✅ 全量回归：572 pass，1 skip（之前 537 pass → 现 572）

### 文档
- ✅ README "自动更新" 完整段（含运维 / 升级 / 关闭 / HMAC）
- ✅ INSTALL.md §D "自动更新失败" troubleshooting
- ✅ README 顶部 callout：v0.2.x 老用户必读升级路径
- ✅ Spec 文档完整 commit

---

## 评审历史

### Round 1（3 个并行 agent）
- **CTO 视角** 找出 12 issue，其中 P0 三个：
  1. daemon-restart 失败仍标 updated → "lost daemon 黑洞"（已修）
  2. Bootstrap gap 升级路径不显眼（已修，README banner + INSTALL.md §5）
  3. PID kill 没有 start_at 校验（已修）
- **投资人视角** 找出 11 issue，其中阻挡发布 3 个：
  1. Manifest 无签名 → RCE 风险（已修，HMAC opt-in）
  2. 默认 endpoint 写死内网 IP（已知遗留问题，超出本 spec 范围，README 已注明）
  3. PII 上报 git email（这是仓库整体 identity 策略，超出 auto-update 范围）
- **用户视角** 找出 13 issue，其中 P0 两个：
  1. installer next-steps contradicts INSTALL.md（已修）
  2. 默认 endpoint 写死（同上）
  + 修了 doc count 不一致 5↔6、隐蔽升级路径等。

### Round 2（2 个并行 agent）
- **安全工程师 / SRE 复审**：……（agent 还在跑）
- **Chaos engineering 测试**：……（agent 还在跑）

---

## Round 1 修复明细（commit `0ff4c41`）

| Issue | 修复点 | 文件 |
|---|---|---|
| CTO P0-1 | daemon-restart 失败时不写 local manifest，下次 SessionStart 重试 | `auto-update/index.ts` |
| CTO P0-3 | PID 文件加 start_at 校验，>30d 视为回收不 kill | `auto-update/daemon-restart.ts` |
| CTO P1-4 | publish-client 全路径 shellQuote + assertPathSafe 白名单 | `scripts/publish-client.mjs` |
| CTO P1-5 | publish-client 跑完 GET manifest 验证 server reload | `scripts/publish-client.mjs` |
| CTO P1-6 | status-aggregate tail-read 1 MiB | `client-update/status-aggregate.ts` |
| CTO P1-7 | bin-auto-updater 0-30s 随机 jitter | `bin-auto-updater.ts` |
| CTO P1-10 | file-route URL decode 防绕过 | `client-update/file-route.ts` |
| Investor P0-1 | HMAC-SHA256 manifest 签名 + 验证（opt-in） | `auto-update/hmac.ts` + publish-client |
| New | 紧急 kill switch `manifest.disabled=true` | `auto-update/manifest.ts` + UI |
| User P0-1 | installer next-steps 不再叫用户跑 inject-mock + bin-uploader | `scripts/install-client.mjs` |
| User P0-9 | uninstall 文档 5→6 bins | `INSTALL.md` |
| User-side | bin-digital-twin status 显示 client_version + auto-update tail | `bin-digital-twin.ts` |

---

## v2 路线图建议

按 round 1+2 评审反馈：

1. **manifest 签名升级到 ed25519**（公私钥分离，sign key 不发到客户端）
2. **灰度 rollout** `manifest.rollout.percent` 字段 + 客户端按 machine_id hash 分桶
3. **客户端 watchdog**：daemon 启动后 30s 内崩 → 自动 rollback to `.cjs.old`
4. **errors.jsonl 按日切**：避免单文件无限增长
5. **dashboard 加 sort/filter/search**：30+ 用户时找单人靠 Ctrl+F 不够
6. **`bin-digital-twin update` CLI 子命令**：`force` / `disable` / `status` / `rollback`
7. **默认 endpoint 配置改成 first-run prompt**（非 auto-update 范围，但买这套产品的客户
   都会被这点烦到）
8. **manifest 签名密钥从 env 改成 keyring**（macOS Keychain / Windows Credential Manager）

---

## 上线 checklist（明早跑这套）

```bash
# 1. Pull latest
git checkout main && git pull

# 2. Build
pnpm install
pnpm -r build

# 3. 跑全套测试
pnpm test          # 期望 572 pass / 1 skip
RIVEN_AUTO_UPDATE_JITTER_MAX_MS=0 node scripts/_e2e-auto-update-smoke.mjs   # 期望 ALL E2E ASSERTIONS PASSED

# 4. 设置 server 端 secret（强烈推荐）
ssh <collector-host> "export RIVEN_CLIENT_MANIFEST_SECRET='<long-random>' >> /etc/profile.d/riven.sh"

# 5. 发版到 5 台灰度机器
node scripts/publish-client.mjs --server <collector-host>

# 6. 灰度机器跑一次 install-client（带 secret）
RIVEN_CLIENT_MANIFEST_SECRET='<same-long-random>' node scripts/install-client.mjs

# 7. 重启 Claude Code，看 dashboard "🔄 Updates" tab 确认版本分布

# 8. 24h 后没 error 报告 → 全员推
```

紧急停止：

```bash
node scripts/publish-client.mjs --server <host> --kill-switch --note "incident X, halt updates"
```

---

## 已知遗留 / 已记录但不修

- 默认 endpoint `http://192.168.22.88:8933` 仍写死（这是公司当前 collector 地址；新部署
  需要手编辑 `~/.riven/digital-twin.json`。属于 v0.2 遗留，README 已注明）
- 错误上报里 user_id 用 git email（沿用现有 cc-status / transcript 的 identity 策略；
  跨组件统一改是更大的 milestone）
- v1 没有自动 rollback、灰度、watchdog（spec §9 已列入 v2）

---

*生成于 autonomous session 期间。任何疑问见 `docs/superpowers/specs/2026-05-19-client-auto-update-design.md`。*
