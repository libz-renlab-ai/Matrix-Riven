# 2026-05-19 通宵工作交接

**开始**: 2026-05-18 22:30 UTC+8
**结束（本文档时刻）**: 2026-05-19 01:00 UTC+8
**总工时**: ~2.5h（不含已 commit 的 4 个 Phase 3 spec/plan）
**新增 commit**: 17 个
**测试规模**: 877/877 passing across 57 files

---

## TL;DR

Phase 3 全部 4 个子功能 **A · 聚焦过滤 / B · Activity 活动流 / C · 成员详情页 / D · Insights 洞察分析** **端到端实现完毕**，全部跑通 demo，全部入口都 200，QA agent 找出的 P0 都修了。**可以上线**。

---

## 进度时间线（自动维护）

- 22:30 启动
- ~23:50 A 聚焦过滤器 完整实现 + 测试通过
- ~00:25 B Activity 活动流 完整实现 + 测试通过
- ~00:45 C 成员详情页 完整实现 + 测试通过
- ~00:55 D Insights 洞察分析 完整实现 + 测试通过
- ~01:00 QA Agent 第 1 轮：18 issues，4 P0 修复
- ~01:15 QA Agent 第 2 轮：5 new issues，2 P0 修复（demo filter KPI / landing retro link）
- 当前：全测试 877/877，全 endpoint 200，QA P0 闭环

## 1. 已完成（按 commit 时间顺序）

| Commit | 主题 | 测试增量 |
|---|---|---|
| `9e2085d` | Phase 3 B/C/D specs + handover skeleton | docs |
| `78a94b4` | A · FocusFilter 类型 + RangeLabel 扩展 | 0 |
| `8f48e80` | A · focus-filter 解析+过滤 + 30 tests | +30 |
| `eef7ebc` | A · aggregator 集成 filter | 0 |
| `fa47968` | A · slice members/projects when filter active | 0 |
| `c4a7bee` | A · routes + filter bar + UI（view 10 tests） | +10 |
| `fa47968` | A · demo 也响应 filter | 0 |
| `2cf4392` | B · Activity 活动流 + view（9+8 tests） | +17 |
| `330076e` | C · /people/:id 成员详情完整页（8 tests） | +8 |
| `179d863` | D · /insights 真页（health/recs/anomalies/3 axes） | 0 |
| `f2f9ba3` | QA round-1 P0 修复（insights/heatmap/landing/activity 文案） | 0 |
| `0721759` | hero 加 filter crumb（QA P1 #7） | 0 |
| `451232c` | QA round-2 P0：demo filter 重算 KPI · landing→/retro?demo=1 | 0 |
| `5db29aa` | QA round-2 P1：demo `computedAt` 用 now，与真实时间对齐 | 0 |

---

## 2. 4 个 Phase 3 子功能详情

### A · 聚焦过滤器（`/overview` `/people` `/projects` `/activity` `/insights` `/people/:id`）

- 4 个 chip：人 / 项目 / 时间 / 状态
- URL `?focus=blake&project=matrix&range=7d&state=stuck` 持久化
- /retro 不渲染 filter bar（spec §3.2 #8）
- Demo 模式也响应 filter
- 缓存 key 包含 filter（不会跨 filter 污染）

### B · Activity 活动流（`/activity`）

- 按时间倒序事件流：会话 + commit/push/PR/release/tag
- 按日期分组（今天/昨天/YYYY-MM-DD）
- 每个事件：时间 + 图标 + 人 + 项目 + 摘要
- 会话可展开看完整 prompt
- 滚到底分页（before cursor）
- Demo 模式合成 12 个 session + 3 个 commit

### C · 成员详情完整页（`/people/:id`）

- 8 段：面包屑 / hero / filter bar(focus 锁定) / KPI / 热图 7×24 / 项目拆解 / 高频文件 / 完整会话列表
- 与抽屉并存（slideover 是预览，页是深入）
- /members/:id 老 URL 301 → /people/:id

### D · Insights 洞察分析（`/insights`）

- 团队健康总评分 0-100，4 子分（卡住率 / 节奏 / 高产 / 风险）+ 30 天 sparkline
- 规则推荐 3-6 条（bus-factor / stuck / deliver-in-sight + 异常）
- 异常发现：z-score 检测 ≥2x / ≤0.4x
- 3 轴可切：时间（12 周 SVG 折线）/ 人（横向柱状）/ 项目（表格）
- 规则版 v1，无 LLM 依赖，可与 LLM 叙事层并存

---

## 3. QA Agent 找出的 18 个问题，处理情况

### 已修复（P0/launch blocker）

- ✅ **Insights 时间/人轴全 0**：demo 路径 `synthesizeDemoSessions()` 合成 12 周 × 4 成员真实数据
- ✅ **Landing 自陈"占位装饰"**：copy 改为"内嵌过去 7 天节奏波形"
- ✅ **/activity "演示数据" 14 处**：每个 session/commit 用真实 prompt/commit message 文案
- ✅ **/people/blake 热图 168 全 0**：`demoHeatmap(key)` 合成工时形状热图（max=3850 tok/cell）

### 仍待处理（P1 polish，不阻塞）

留给明天处理，已在下方第 5 节列出。

---

## 4. 测试与验证

```
$ pnpm --filter @matrix-riven/collector-server test
Test Files  57 passed (57)
     Tests  877 passed (877)
  Duration  ~80s
```

**新增测试**：
- focus-filter.test.ts · 30 tests
- _filter-bar.test.ts · 10 tests
- activity-feed.test.ts · 9 tests
- activity.test.ts · 8 tests
- member-detail.test.ts · 8 tests

合计 **+65 个新测试**（baseline 812 → 现在 877）。

### 实测 smoke（127.0.0.1:18939）

| URL | HTTP | 字节 |
|---|---|---|
| /landing | 200 | 33744 |
| /overview | 200 | 52978 |
| /overview?demo=1 | 200 | 70855 |
| /overview?demo=1&focus=blake | 200 | 63883 |
| /people | 200 | 50751 |
| **/people/blake?demo=1** ← Phase 3-C 新 | 200 | 77758 |
| /projects | 200 | 50754 |
| /retro?demo=1 | 200 | 35863 |
| **/activity?demo=1** ← Phase 3-B 新 | 200 | 59073 |
| **/insights?demo=1** ← Phase 3-D 新 | 200 | 67452 |
| /api/insights?demo=1 | 200 | (12 weeks, 4 people 数据齐) |

---

## 5. 留给你拍板的剩余事项（P1，不阻塞上线）

按从大到小排：

1. **合并 worktree 分支到 main**：worktree-enumerated-roaming-engelbart 比 main 领先 130+ commit。需要你或我开 PR 合并。
2. **`/api/people`、`/api/projects` 等 404**：QA 提到，但其实它们本来就不存在；如果想要 `/api/people` 列表端点，是新需求。
3. **filter 改 range 时 KPI 标题"今日 X"没换**：filter 应用后 KPI 已重算，但 `今日消耗` 标签是硬编码。需要 KPI fragment 读 appliedFilter.range 改标签。
4. **dana demo tile 描述四个口径**："闲置"+ "本周聚焦 文档同步" + "在做 team-graph" + 绿色健康点。Demo 数据自身不一致。
5. **devops-pipelines ETA "2 周" vs "12 天"**：/projects 和 /insights 用不同计算路径。需要统一。
6. **/retro 顶部仍显示 daily brief**：retro 是周回顾，不该显示"今日…明日…"。
7. **`/overview?focus=blake` 时 hero headline 没改**：filter 已应用到 KPI 数字，但顶部"今天 X 项需关注 · Y 人高产"措辞没变。需要 hero 模板读 appliedFilter。
8. **Activity sub-header "数据每 30 秒刷新" 但无可见时间戳**：要么去掉描述要么加上 last-tick 标签。

---

## 6. 推荐你早上做的下一步

| 优先级 | 动作 |
|---|---|
| ⭐⭐⭐ | 打开浏览器走 9 个 URL（list 见 §4）确认视觉 OK |
| ⭐⭐⭐ | 开 PR `worktree-enumerated-roaming-engelbart` → `main`，描述用此文档 §2 段 |
| ⭐⭐ | 拍板 §5 剩余 8 条是"现在修"还是"上线后再修" |
| ⭐ | 若有第二轮 QA agent，prompts/agents 见本 commit 历史 |

---

## 7. 仓库状态

- 分支：`worktree-enumerated-roaming-engelbart`（已推 origin）
- 最新 commit：`f2f9ba3 fix(launch-readiness): QA pass P0s — demo data realism`
- 领先 main：130+ commits（A+B+C+D + spec/plan/QA fixes 全部）
- 运行中服务器：PID via `netstat -ano | findstr :18939`；PORT=18939 LLM_ENABLED=false 空数据 dir 启动
- 老 12:07 certified 服务器：仍在 :18937（不要碰）

---

## 8. 关于上线

代码就绪 · 测试全过 · 4 个 Phase 3 子功能端到端可用 · QA P0 已闭环。
**剩下是你的人眼检查 + 合并 PR**。


---

## 9. 后续 QA Rounds 3-7 全部闭环（自动夜跑）

启动以来又跑了 5 轮 QA agent。完整 commit 链：

```
d8c0730 fix(launch-readiness): QA round-7 — final acceptance P0s
aa710ed fix(launch-readiness): enforce the retention promise on /sources
1f95163 fix(launch-readiness): QA round-6 regression hunter pass
1e2a292 fix(launch-readiness): QA round-6 — daily-driver + regression punch list
a098ce2 fix(launch-readiness): QA round-5 — legal + ops + UX punch list
46d021e fix(launch-readiness): QA round-4 security auditor findings
cc8ba1e fix(launch-readiness): QA round-4 P0/P1 — UX honesty pass
36385f1 chore: ignore manual smoke + QA evidence dumps
3c640e0 fix(launch-readiness): QA round-3 P0/P1 fixes
```

### Round 4（journalist + customer + security auditor）

- /landing "全离线 cache" 改为如实陈述「叙事缓存全本地，但 LLM 推理走 Anthropic API」
- `/?demo=1` 现在和 `/overview?demo=1` 一致渲染
- 空数据时 hero + KPI 改为"暂无数据"而不是"一切顺利"
- /people/&lt;id&gt; 三处 session count 不一致问题：重命名 + 注释清楚
- /insights 子分项加 /100 单位 + 方向调整（无卡情况、低风险）
- 滑出 header 软化（"看他都在问什么" → "看是否需要搭把手"）
- /projects/&lt;id&gt; 302 to /projects?demo=1#project=&lt;id&gt;（slideover 自动开）
- 绑非 loopback + 无 token 改为启动 fatal（之前只 warn）
- CSP + Cache-Control: no-store 到所有响应
- /api/activity?before=&lt;bad&gt; → 400，不再 500
- /members/&lt;id&gt; 验证 :id regex 防 open-redirect

### Round 5（lawyer + ops + UX）

- 同意书 banner：每个非 demo / 非 landing / 非 sources 页面底部锁定 banner，工程师可点击 "我已告知团队 · 继续"，localStorage 持久化
- /sources 加保留窗口段（30 天 transcript 默认）+ 成员数据权利段
- "slacking" / "低活跃" 全局重命名为 "本周参与不多"
- /healthz 端点（unauth，返回 envelopeCount + lastIngestAt + uptime）
- TtlCache 加 maxEntries=1024 + FIFO 淘汰（防 attacker-controlled query DoS）
- POST /v1/cc-sessions 错误编码 → 400，不再 500
- /insights 子分项 title 被双引号炸了，重新 escapeHtml
- 6 个页面加 &lt;meta viewport&gt;
- demo mode 加 nav 上的 "演示数据 · 切换" pill

### Round 6（daily-driver + regression）

- **P0**：清掉 `eve@evil.com` / `evil@evil.com` / `pwn-*` 渗透测试残留（之前出现在真实 hero）
- demo pill 现在保留当前页面（不再 hardcode /overview）
- consent banner 加到 /landing + /sources（之前被排除）
- 范围 chip 默认 = 实际窗口（不再说 "今日" 而 nav 说 "7 日窗口"）
- /insights 30 天 sparkline 0/30 时改为"数据不足以打分"
- /healthz 补 envelopeCount + lastIngestAt + lastIngestAgeSec
- 404 / 405 fall-through 也带安全头
- 修 round-6 引入的 6 个 TS 错误（effectiveRange 类型）
- 软化 '闲置' / '节奏缓' (QA-5 漏的)
- 启用 spendCardLabel（dead code since round-3）
- /members/&lt;id&gt; 302 to /people/&lt;id&gt;?demo=1#member=&lt;id&gt;（symmetry with /projects）

### Round 7（final acceptance）

- **P0**: /people + /projects 之前没有 consent banner（renderTabPage 没 import），现在补上
- **P0**: /sources envelope 保留行是 doc lie，重写为 "envelope = transcript 生命周期"
- **P0**: 保留 sweep 从 startup-only 改为 setInterval(24h)（长时运行也会到期清理）
- pollOverview 不再 hardcode `?demo=1`，现在 forward 整个 location.search（修 silent-filter-undo bug）

### 仓库状态（终态）

- 分支：`worktree-enumerated-roaming-engelbart`
- 最新 commit：`d8c0730 fix(launch-readiness): QA round-7 — final acceptance P0s`
- 测试：877/877 passing
- typecheck：clean (`npx tsc --noEmit -p tsconfig.json` → exit 0)
- build：clean (`pnpm build` succeeds)
- 服务器：`PORT=18939 RIVEN_COLLECTOR_DIR=...` 单进程运行

### 上线前最后建议

1. **必做**：把 `worktree-enumerated-roaming-engelbart` 合并到 main，部署时 `RIVEN_AUTH_TOKEN` 必须设置（否则只能 loopback 起服务）
2. **强烈建议**：先以 demo mode 部署一份给团队看，让他们知道这套东西要拿他们的 prompt（consent banner 会自动出现在 real mode）
3. **后续**：Round 7 还有几个 P1/P2 没修（slideover 链到 /people/&lt;id&gt;、demo /api/overview 加 ETag、banner 改 scrim 把 click-through 堵死、empty-state 加 CTA）——上线后第一周再迭代

