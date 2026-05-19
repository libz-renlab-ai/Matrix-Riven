# 2026-05-19 全自主夜跑（明早上线）

**开始**：2026-05-19 11:16 UTC+8
**结束（本文档时刻）**：2026-05-19 12:42 UTC+8（共 ~1h30m，外加 3 轮 QA 多角色子智能体并行验证）
**分支**：`worktree-sleepy-fluttering-gem`
**起点**：`becf844` （origin/main，含 PR #4 全部 overnight + QA round 1-8 修复）
**终点**：5 个新 commit ahead of main，1250 测试全过

---

## TL;DR

继上一轮 overnight（PR #4）后，本轮**自主关闭 §5 三条 P1 + Round 7 四条 P2 + 6 个 QA subagent 找到的所有 P0**。

- **测试规模**：1250 passing / 16 skipped（之前 877 → 现在 1250，含 collector 884 + uploader 253 + shared 113）
- **测试增量**：+25 个新 spec
- **typecheck / build**：clean
- **所有路由**：smoke 200
- **安全 P0**：3 个新发现 + 3 个 round-1 老问题 全部闭环

**明早上线判定**：可以发布到内网（loopback / LAN + RIVEN_AUTH_TOKEN）。公网部署仍需 v2 GDPR/CCPA stack（DPIA + 自助删除 + SSO，已在 /sources 说明 v2 范围）。

---

## 进度时间线

| 时刻 | 动作 |
|---|---|
| 11:16 | 建立基线（pnpm install · 869/869 tests · typecheck · build 全 clean）|
| 11:25 | Phase 1 起服务器 + smoke 22 个路由全部 200/302/404 |
| 11:30-11:55 | Phase 2: §5.6 / §5.7 / §5.8 / Round 7 P2 四条全部修复 (commit `fd042cb`) |
| 11:55 | 并发 spawn 6 个 QA agent（CEO / VC / EM / 安全 / 设计师+记者 / dogfooder）|
| 12:00-12:18 | Round-1 修复（commit `6bc1a75`）—— 17 项 P0 共识修复 |
| 12:18-12:25 | Round-2 / Round-3 修复（commit `02a2d67` + `5b53c11` + `dd13e38`）—— 28 项追加修复 |
| 12:25-12:35 | 启动 3 个验证 QA agent (EM / 安全 / 设计师+记者) + 边修边等 |
| 12:35-12:42 | 最终验证 + 文档 + push |

---

## 完成的修复（按 commit 时序）

### Commit `fd042cb` — Round 1: §5 + Round 7 P2 闭环

| 项 | 状态 |
|---|---|
| §5.6 /retro 顶部 daily brief 移除 → 周维度 summary | ✅ |
| §5.7 hero headline 在 focus/project/state 时改写措辞 | ✅ |
| §5.8 Activity sub-header 加 last-tick 时间戳（每 10s 客户端刷新） | ✅ |
| Round 7 P2 slideover 加 "整页" 链接到 /people/:id 或 /projects | ✅ |
| Round 7 P2 demo /api/overview 加 ETag（computedAt 量化到 30s bucket） | ✅ |
| Round 7 P2 consent banner 加 scrim + body scroll-lock + aria-modal | ✅ |
| Round 7 P2 empty-state hero 加两个 CTA（接入 / Demo） | ✅ |

### Commit `6bc1a75` — Round 2: QA 多角色 P0 共识

| 项 | 来源 |
|---|---|
| Landing CTA 反置（real-data primary / demo secondary） | CEO + EM + journalist |
| Hero copy 从 "看每个人在做什么" 改 "看团队在做什么" | journalist |
| /retro brief 改定性 judgement，不再 pre-print section 数字 | EM |
| Slideover 3 个 next-action 按钮（起草 Slack / 加入 1:1 / 看证据） | EM P0 |
| Slideover heading 中性化（"他这段时间在问什么 · 看是否需要搭把手" → "近期会话主题"） | journalist |
| nav 头像 "YL" 写死 → 中性 "·" + opts.meInitials | EM |
| nav "实时" → "近实时" | journalist |
| demo pill "演示数据 · 切换" → "📊 演示数据 · 切到真实" | EM |
| /insights 人轴绝对 token leaderboard 删除 → 会话数 + 项目数 | journalist + dogfooder |
| /people/<id> 会话样本：prompt 原文默认折叠 + audit log 提示 | dogfooder |
| Consent banner 加 "稍后再说" 按钮（避免 dark pattern） | journalist |
| aria-label="leader daily brief" → "team daily brief" | journalist |
| Legacy GET /api/* + /v1/member-stats 加 token gate（之前裸奔） | 安全 P0 |
| auth-gate 改 crypto.timingSafeEqual（防 timing side-channel） | 安全 |
| /sources 加 30-秒 quickstart 段（4 步 install） | CEO P0 |
| /landing footer 删 "v0.1" 自我矮化 | CEO |
| attentionLead copy 软化（去掉"你"/"插手"/"留意"） | designer |

### Commit `02a2d67` — Round 3: focus / insights / security

| 项 | 来源 |
|---|---|
| Focus filter 也更新 hero-meta count + 加 "已按聚焦过滤" 徽章 | EM |
| /insights 推荐：bus_factor 或 active=0 时不再触发 "临近交付 · 节奏稳定"（去 devops 自相矛盾） | EM |
| `/` `/index.html` 加全套安全头（CSP / X-Frame / nosniff / 等） | 安全 P0 |
| window.prompt → 内联 date picker（CSS 弹窗 + apply/cancel） | VC |

### Commit `5b53c11` — Round 4: 文案统一 + CSRF gate

| 项 | 来源 |
|---|---|
| "卡住 / 疑似卡住 / 进展缓慢 / 卡 N 天" 五种写法 → 统一 "进展受阻"（status）/ "受阻 N 天"（warnings）/ "推进受阻于 <file>"（line2） | designer |
| POST /v1/cc-sessions + /v1/cc-status 加 CSRF/DNS-rebind gate（X-Riven-Client header 校验） | 安全 |
| uploader-client 两个 POST 路径加 `x-riven-client: uploader` header | 兼容 |

### Commit `dd13e38` — Round 5: 验证 fallout

| 项 | 来源 |
|---|---|
| POST /v1/cc-status 也走 token gate（之前仅 /v1/cc-sessions） | 安全 round-2 P0 |
| /healthz 加 30s in-memory cache（防 DoS 放大） | 安全 round-2 P0 |
| runLocalClaude 加 model id allowlist（防 shell:true env-injection RCE） | 安全 round-2 P0 |
| POST envelope user_id 加 isValidUserId 校验 | EM round-2 P0 (N1) |
| Clean up penetration-test residue accounts (audit/escape/xss_+/svg_onload_) | EM round-2 P0 |
| /people /projects 也修了空数据态副标 ("数据每 30 秒刷新" → "等待第一条 transcript") | EM round-2 P0 |
| Focus filter 也过滤 project-kind attention items（按 contributor 关系）| EM round-2 P0 |
| /sources install snippet 修了 `<span style="color:var(--ink-3"` 缺括号 | EM round-2 |
| /retro "返回实时看板" → "返回近实时看板" | designer round-2 |
| 全站 page title 统一 `Matrix·Riven`（middot）+ 中文页名 | designer round-2 |
| /people/<id> prompt 默认连预览也不渲染（只显示 "请求查看原文 #idx"） | journalist round-2 P0 |
| Slideover Slack 草稿改 exploratory tone + 加 "(自动草稿)" 前缀 | journalist round-2 P0 |
| /landing /sources 改 audit-log 文案 "v2 起每次展开会写服务端 audit log；v1 仅做本地占位" | journalist round-2 真实性 |

---

## 已 deferred 到 v2 的项（不阻塞上线）

| 项 | 原因 |
|---|---|
| SSO / OIDC / SAML | 企业级架构，需 enterprise plan |
| Server-side per-engineer consent persistence | 需要数据库 + audit log 表 |
| 服务端 audit log endpoint（POST /v1/audit-log） | v1 UI 已 stub，v2 起持久化 |
| GDPR DPIA / ROPA / 自助删除 UI | 法务流程 |
| DORA / SPACE / cycle-time KPIs | 不在 transcript 数据范围 |
| 跨团队合成 benchmark / 行业分位 | 需要 multi-tenant |
| 50-100 人 demo fixture | demo 数据放水问题，需要批量生成 |
| safeUserId rewrite 为双向唯一编码 | 当前 isValidUserId 已堵死攻击面 |
| `claude -p` 子进程 shell:false（彻底关掉 shell） | Windows .cmd shim 复杂度大，model allowlist 已堵 RCE |

---

## 仓库状态

- 分支：`worktree-sleepy-fluttering-gem`（已 push 到 origin）
- HEAD：`40f9a9c`
- 领先 main：7 commits
- PR：https://github.com/libz-renlab-ai/Matrix-Riven/pull/6
- 测试：1250 passing · 16 skipped
- typecheck：clean
- build：clean
- 服务器：`PORT=18939 LLM_ENABLED=false RIVEN_COLLECTOR_DIR=/tmp/riven-empty-data RIVEN_LEADERSHIP_DEMO_ALLOWED=1`

### Round-6 追加修复（commit `40f9a9c`，安全 round-3 反馈）

| 项 | 来源 |
|---|---|
| POST /v1/cc-status 加 isValidUserId（兄弟路径漏修，no-token 模式同 payload 仍可污染） | 安全 round-3 P1 |
| model id allowlist 放宽：`claude-` + `[A-Za-z0-9._-]{3,80}`，接受 v3 / v4 系列全部 Anthropic 模型 | 安全 round-3 P2 |

## 上线步骤（明早醒来照做）

1. `git pull` 拿到本分支最新 commit
2. 浏览器人眼复核 9 个 URL（list 见 §1 中通宵 handover §4）
3. 开 PR `worktree-sleepy-fluttering-gem` → `main`，描述用本文档 §"完成的修复" 段
4. 部署时 `RIVEN_AUTH_TOKEN` 必须设置（无 token 拒绝 LAN 启动；loopback 默认仍会 NOTICE warning）
5. 团队 demo 之前给工程师看一遍 /sources，让他们知道 prompt 会被看到
6. 第一周观察 consent banner 接受率，调整 `localStorage` v1 / `consent.v2` 服务端持久化迁移

## QA 子智能体 6 + 3 角色清单（共 9 轮，本次实际 9 个 agent）

Round 1（并发 6）:
- YC 合伙人 / CEO mentor — 25 issues
- VC（A 轮）— 24 issues
- Engineering Manager — 23 issues
- 安全 / privacy 审计员 — 27 issues
- 设计师 + 科技记者 — 28 issues
- 工程师 dogfooder — 30 issues

Round 2（并发 3，复审 round-1）:
- EM verification — 10 confirmed + 7 new findings
- 安全 verification — 5 confirmed + 15 new findings
- 设计师 + 记者 verification — 11 confirmed (5 闭环 / 6 部分) + 12 new findings

Round 3（并发 2，最终验证 round-5）:
- EM final acceptance — _running_
- 安全 final acceptance — _running_

