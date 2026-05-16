# Leadership Dashboard · Phase 2 设计文档

**日期**：2026-05-17
**作者**：liboze + Claude
**前置**：[`2026-05-16-leadership-dashboard-design.md`](./2026-05-16-leadership-dashboard-design.md)（Phase 1，已落地 22 task）
**Phase 1 实绩**：commits `82b3335 .. c77e304`（31 个），719 测试通过，functional but raw

---

## 1. 为什么有 Phase 2

Phase 1 把"能用"做出来了，但暴露三块没完工的事：

| 块 | 现状 | 用户原话 |
|---|---|---|
| A. 前端杂乱 | 80 个项目铺满屏、6 个成员无排序、列表无分组、Range 没下拉 | "现在前端好乱" |
| B. 实施缺口 | 18+14=32 个信号里 4 个建好了但没接进 snapshot；几处 UI 元素 spec 画了 mockup 但没实装；冷启 17s（spec 预算 2s）没做索引 | "看看哪些功能没做完" |
| C. 数据静态 | 浏览器只刷 3 个 KPI 数字；成员列表/项目列表/详情页根本不刷；新会话来了得手动 F5 | "结合动态数据展示" |

Phase 2 一次性解三件事。**单一可部署交付物**：用同一个 collector-server bundle，从 demo 静态快照无缝切到 prod 真 live 数据。

---

## 2. Phase 1 实施缺口审计

按 [`2026-05-16-leadership-dashboard-design.md`](./2026-05-16-leadership-dashboard-design.md) 逐条对照已 commit 的代码。

### 2.1 计算了但**没接入 snapshot** 的信号 4 条

| Spec § | 信号 | 实现位置 | 当前为什么没显示 |
|---|---|---|---|
| 2.1 #7 后半 | 专注度（avg session 时长 + 中断频次） | `signals/activity.ts::computeFocus` | aggregator 没调用，MemberSnapshot 字段未填 |
| 2.1 #13 | prompt 状态变化（每日均长曲线） | `signals/quality.ts::promptLengthSeries` | 同上，MemberDetail 缺字段 |
| 2.1 #18b | 新触碰扩展名/目录计数 | `signals/learning.ts::computeNewSurfaceCount` | 同上 |
| 2.2 #5 | 协作密度（项目内多人触碰文件比） | `signals/project-collab.ts::computeCollabDensity` | aggregator 没调，ProjectDetail 缺字段 |

→ **Phase 2 P1-1**：把这 4 个钩进 aggregator + 类型 + 渲染器。

### 2.2 Spec 画过 mockup / 写过约定 但 UI 没做的 6 项

| Spec § | 缺的事 | 影响 |
|---|---|---|
| 5.3 | 首屏右上 "Range 下拉（今日 / 24h / 7天 / 30天）" — 当前只有静态标签 | 没法切窗口 |
| 5.3 | 成员列表 "按活跃 ▼ 按需关注" 排序切换 | 6 人时勉强，规模上去全乱 |
| 5.4 | Sessions 行点击 → 跳 `/browse?sid=01J...` 看 raw | Browse tab 跳转死链 |
| 5.4 | 详情页 "状态/工作量/效率/风险/学习" 5 个并排 mini 卡里只有粗略数 | 部分指标（focus、迭代密度、newSurface）没字段对应 |
| 5.6 L2 | "点 [展开] 显示该 session **所有** user prompts" — 当前只展开**第一条**全文 | 实际行为<spec |
| 8 | "忽略通用名 cwd 最后段（src/test/dist/etc），回退倒数第二段" | 80 个项目里一堆叫 "src"/"dist" 的全是同名碰撞 |

→ **Phase 2 P1-2 .. P1-7**：分别补齐。

### 2.3 架构层面的 spec 兜底**没启用**的 1 项

| Spec § | 兜底设计 | 现状 |
|---|---|---|
| 3.4 | "如果实测扫盘超过 2 秒，引入索引文件 `<collectorDir>/.leadership-index.json`，后台异步更新" | 实测 17s，索引**没做**。Demo 阶段勉强用 cache TTL 撑着；上 prod 用户多了就崩 |

→ **Phase 2 P1-8**：实装索引（增量更新 + 启动加载）。

### 2.4 数据正确性（非 spec 但 Task 21 发现的真 bug 已修，无遗留）

- `scanAllSessions` 之前只读 envelope `.json`，snapshot 里是裸 `.jsonl`，Task 21 已补 raw 解析器（commit `63839e6`）。
- 注：prod 真上线后写盘格式还是 envelope `.json`；两种格式现在并行支持，不冲突。

---

## 3. 前端为什么乱 — 诊断与方向

### 3.1 诊断（基于实测数据画面）

| 现象 | 用户感受 |
|---|---|
| 6 成员卡 + **80 项目卡**纵向排开，scroll 三屏才到底 | 信息过载，进首屏就想关 |
| 6 个成员里有 1 active、5 个 quiet/low — 但用同样的卡片样式 | 区分度差，看不出谁该看 |
| "需关注" KPI 卡说 9，但 9 个里哪些是同一人？要往下看才知道 | KPI 和详情没勾连 |
| 80 个项目中很多叫 `src` / `dist` / `node_modules` / `.claude` — 是 cwd 最后段碰撞 | 真假项目混在一起 |
| Range "过去 7 天" 是死标签 — 切不了今日 / 24h | 默认值好，没切的可能 |
| 成员列表无排序、无筛选、无搜索 | 6 人能扛，60 人崩 |
| 项目列表无分组（活跃 / 维护 / 沉睡混排）、无折叠 | 视觉平等错位，沉睡的浪费注意力 |
| Sessions 列表的"展开"按钮只展开**首条** prompt 全文，与 spec §5.6 L2 不符 | 行为不一致 |
| 自动刷新仅 KPI，列表静态 | 想看实时变化得 F5 |

### 3.2 重设计目标

定四条新原则（不推翻 Phase 1 选定的 Modern Card 风格 + 平衡 D 首屏；只调信息架构和密度）：

1. **首屏只展示"值得现在做事"的人和项目** — 默认折叠沉睡项目、低活跃成员（点 "显示全部 N 个" 才展开）
2. **每张卡片"重量"由信号强度决定** — 卡点/求助的卡变高变红，活跃的中等，安静的塌缩成一行
3. **KPI 数字可以点击下钻** — 点 "需关注 9" → 自动 scroll + 高亮筛选出那 9 个；点 "项目 6" → 跳到项目列表段
4. **列表必须可排序 + 可筛选 + 可搜索** — 默认按"需关注度"排，提供"按今日活跃 / 按 7 日趋势 / 按 token / 按字母"切换

### 3.3 新首屏信息架构（ASCII mockup）

```
┌─────────────────────────────────────────────────────────────────────┐
│ Browse  Overview*                       ⌕[搜索]  ▼7天 [🔄live ●]   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ 团队 leadership 视图 · 2026-05-17 14:30 CST                         │
│                                                                     │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                  │
│ │ 团队活跃     │ │ 需关注 ⚠️    │ │ 项目         │                  │
│ │   147        │ │   3 ↑        │ │   6 / 80    │                  │
│ │ sessions/7d  │ │ 1 卡 2 求助  │ │ 活跃/全部    │                  │
│ │ +12 vs 周均  │ │ ↗ 跳到详情   │ │ ↗ 跳到列表   │                  │
│ └──────────────┘ └──↑clickable──┘ └──↑clickable──┘                  │
│                                                                     │
│ ⚠️ 需关注（3） ────────────────────────────── [全部成员>] [关闭X]   │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ 🔴 julielua  ml-pipeline 卡 3h · 同一文件 read 8 次          │  │
│  │              tool 失败 24% · context 爆 1 次                 │  │
│  │              触碰文件 top3：feat.py · loader.py · train.py   │  │
│  │              展开详情 ▾                                       │  │
│  └──────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ 🟡 hrdai   今日 raw prompt 含 "为什么不行" "卡住"            │  │
│  │              WebSearch 8 次（团队均 2 次）                    │  │
│  │              展开详情 ▾                                       │  │
│  └──────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ 🟡 javana00 ← 同一文件多人编辑（与 liboze）                  │  │
│  │              packages/shared/src/config.ts                   │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│ 团队成员 ── 排序：[需关注▼] [活跃] [趋势] [字母]  显示：[全部▾]    │
│  (LB) liboze    14 sess · Matrix-Riven   ▁▃▅█▇▆▅  ↑18%  [活跃]    │
│  (SY) liusy     11 sess · nb-platform    ▁▂▄▅▇▆▅  +5%   [活跃]    │
│  (JV) javana00   7 sess · uploader       ▁▃▄▅▆▅▄  -2%   [协作]    │
│  ── 安静成员（3）展开 ▾  ────────────────────                       │
│                                                                     │
│ 项目 ── [推进中 4] [维护 2] [沉睡 1] [全部 6/80]  排序：[活跃▼]     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │ Matrix-Riven    ▁▃▅█▇▆▅   3 人 · debug · 7.2/10  ≈5d    →  │    │
│  │ nb-platform     ▁▂▄▅▇▆▅   2 人 · impl  · 8.4/10  ≈9d    →  │    │
│  └────────────────────────────────────────────────────────────┘    │
│  ── 沉睡项目（76 个常用名碰撞，已折叠）展开 ▾ ────                  │
│                                                                     │
│ 协作机会（3） ─────────────────────────────────────────────         │
│  liboze · liusy   →  packages/shared/src/config.ts  · 昨天          │
│  javana00 · liboze →  packages/uploader-client/...   · 今天         │
└─────────────────────────────────────────────────────────────────────┘
```

**关键差异**：
- 顶 nav 加 **搜索框 + Range 下拉 + 实时指示灯 ●**
- 首屏第一个内容块是 "**⚠️ 需关注**"，预筛好、可一键关闭/隐藏
- 安静成员、沉睡项目默认折叠
- 80 个 cwd-碰撞项目通过"通用名过滤"砍到 ~6 个 + 一个"碰撞折叠"段
- 成员/项目列表都有排序 toggle
- KPI 卡说"3 ↑"——`↑` 是相对你**上次打开时**变化，需要 client 本地存上次状态

---

## 4. 动态数据更新设计

### 4.1 三条通道，从弱到强

| 通道 | 协议 | 间隔 | 适用 | Phase 2 要做 |
|---|---|---|---|---|
| A. 整段轮询 | HTTP polling | 30s | 默认 | ✅ 必做 |
| B. ETag 节流 | HTTP polling + `If-None-Match` | 30s | 节流 | ✅ 必做（节带宽） |
| C. SSE 推 | Server-Sent Events | 推送 | 高频 leader | ⛔ Phase 2 不做（v3） |

**Phase 2 不上 WebSocket / SSE**。30s polling + ETag 已经能覆盖"多次/天"的使用节奏，省得为低 ROI 的复杂度买单。

### 4.2 客户端刷新模型：全段 DOM 替换（不是 diff）

之前 Phase 1 的 `setInterval(updateKPIonly, 30000)` 只刷了 3 个 KPI 数字。Phase 2 改成：

```javascript
// 每 30s 拉一次完整 JSON
setInterval(async () => {
  const resp = await fetch('/api/overview?range=' + range, { headers: { 'If-None-Match': etag } });
  if (resp.status === 304) return;  // 没变
  etag = resp.headers.get('etag');
  const snap = await resp.json();
  // 拿一份 server 帮我们渲好的 HTML fragment（见下），整段替换
  document.getElementById('attention-section').outerHTML = snap._html.attention;
  document.getElementById('members-section').outerHTML = snap._html.members;
  document.getElementById('projects-section').outerHTML = snap._html.projects;
  document.getElementById('collab-section').outerHTML = snap._html.collab;
  // 头部 timestamp / 实时灯
  document.querySelector('.lh-meta .ts').textContent = snap.computedAt.slice(11, 19);
  document.querySelector('.lh-refresh-tag .dot').classList.toggle('pulse');
}, 30000);
```

服务端 `/api/overview` 响应里加一个 `_html: { attention, members, projects, collab }` 字段（每段是 server-rendered HTML fragment 字符串），客户端用 `outerHTML = ...` 替换。无 diff 算法、无虚拟 DOM、≤50 行 JS。

**为什么不做 diff**：6 个成员 + 6 个真项目 + 几条协作 — DOM 节点总量极小（<200 个 element），整段替换连闪烁都不会有。等数据真涨到 50 成员 100 项目再考虑 incremental。

### 4.3 "自上次以来变化"的实现

客户端 `localStorage` 存最近一次拉到的 KPI 值 + 时间。每次刷新对比，给变化字段加 `↑3` `↓1` 角标，5 秒后淡出。

无服务端状态、无 cookie、纯前端。

### 4.4 详情页同样模式

`/members/:id` 和 `/projects/:name` 各加一段相同的轮询脚本，30s 整段替换。

### 4.5 服务器端配合

```typescript
// routes.ts
function etagFor(snap: OverviewSnapshot): string {
  return '"' + crypto.createHash('sha1').update(JSON.stringify(snap)).digest('hex').slice(0, 16) + '"';
}
// in handler:
const etag = etagFor(snap);
if (req.headers['if-none-match'] === etag) {
  res.writeHead(304, { 'etag': etag });
  res.end();
  return;
}
const html = { attention: renderAttention(snap), members: renderMembers(snap), ... };
res.writeHead(200, { 'content-type': 'application/json', 'etag': etag });
res.end(JSON.stringify({ ...snap, _html: html }));
```

ETag 算在缓存层之上，cache hit 时 ETag 一定相同 → 客户端"304 节流"率自然高。

---

## 5. Phase 2 任务清单（13 task，按 milestone 排）

每个 task 都遵循 Phase 1 的规矩：TDD、文件路径明确、一 task 一 commit、不推远端、不 amend。

### Milestone P-A · 接通缺口（4 task）

- **P-A1** 接 `computeFocus / promptLengthSeries / computeNewSurfaceCount / computeCollabDensity` 到 aggregator，扩 `MemberDetail` / `ProjectDetail` 类型
  - 文件改动：`leadership/aggregator.ts`、`leadership/types.ts`
  - 测试：`leadership/__tests__/aggregator.test.ts` 加 4 个断言
  - 提交：`feat(leadership-p2): wire 4 unused signals into snapshot`

- **P-A2** "通用名过滤"做项目名归并：cwd 最后段如果是 `src|dist|test|node_modules|.claude|.git|build|out|target|__tests__|tests` 则回退到倒数第二段；为空则前缀拼接最后两段
  - 文件：`leadership/transcript-loader.ts`（在 `parseEnvelopeBuffer` / `parseRawJsonlBuffer` 里给 `projectName` 加规则）
  - 测试：`leadership/__tests__/transcript-loader.test.ts` 加 5 例
  - 验证：snapshot 上跑一遍，项目数应从 80 降到 ≤15
  - 提交：`fix(leadership-p2): collapse common-name cwd last-segment collisions`

- **P-A3** Sessions 列表 "展开" 行为修正：展开应显示该 session **所有** user prompts，每条 200 字预览 + [全文]，与 spec §5.6 L2 对齐
  - 文件：`leadership/views/member-detail.html.ts`
  - 测试：`views/__tests__/member-detail.html.test.ts` 加 2 例
  - 提交：`fix(leadership-p2): expand button shows all session prompts per spec`

- **P-A4** 在 MemberDetail 里加 sessions 行的 "查看 raw" 链接，跳 `/?sid=<sessionId>`（用现有 Browse tab 的 query 约定，需先核对 `dashboard-html.ts` 里 Browse tab 怎么 deep-link）
  - 文件：`leadership/views/member-detail.html.ts`、根据需要补 Browse tab 的 query 处理
  - 提交：`feat(leadership-p2): session "view raw" link to Browse tab`

### Milestone P-B · 信息架构重整（4 task）

- **P-B1** 顶 nav 加 Range 下拉 + 搜索框，URL 同步 `?range=` 和 `?q=`
  - 文件：`leadership/views/overview.html.ts`、`routes.ts` 接 `?q=` 做客户端过滤即可（服务端不需要参与搜索）
  - 测试：HTML 含 `<select>` 和 `<input type="search">`
  - 提交：`feat(leadership-p2): range selector + member search in topbar`

- **P-B2** "需关注" 段独立出来，置于成员列表之前，自动包含：state ∈ {stuck, needs_help, low_activity} OR `warnings.length > 0` 的成员
  - 文件：`leadership/views/overview.html.ts`、`leadership/aggregator.ts`（snapshot 加一个 `attention: MemberSnapshot[]` 派生字段）
  - 测试：snapshot 测 + 渲染测
  - 提交：`feat(leadership-p2): dedicated attention section above members list`

- **P-B3** 成员/项目列表加排序 + 折叠（默认按"需关注度"排，安静成员/沉睡项目折叠为一行 "N 个，展开 ▾"）
  - 文件：`leadership/views/overview.html.ts` + 小段客户端 JS（点击展开仅 DOM toggle）
  - 测试：HTML 含 `<details>` + 排序数据属性
  - 提交：`feat(leadership-p2): sortable lists with quiet-row collapse`

- **P-B4** KPI 卡可点击下钻：点"需关注" → scroll + 加视觉高亮 1 秒；点"项目" → scroll 到项目段
  - 文件：`leadership/views/overview.html.ts` 加 anchor + 客户端 JS
  - 提交：`feat(leadership-p2): clickable KPI cards drill-down`

### Milestone P-C · 动态数据（3 task）

- **P-C1** `/api/overview` 输出 ETag + 支持 304；在响应里加 `_html: { attention, members, projects, collab }` 字段
  - 文件：`leadership/routes.ts`、`leadership/views/overview.html.ts`（拆 fragment 渲染函数 `renderAttentionFragment` 等）
  - 测试：`__tests__/routes.test.ts` 加 ETag 304 case + _html 字段存在
  - 提交：`feat(leadership-p2): ETag + per-section HTML fragments in overview API`

- **P-C2** Overview 页客户端刷新脚本升级：每 30s fetch + ETag 节流 + 整段 outerHTML 替换 + KPI 变化角标
  - 文件：`leadership/views/overview.html.ts` 里的 `REFRESH_SCRIPT`（重写）
  - 客户端 localStorage 存上次 KPI 值
  - 浏览器烟测：观察 30s 自动刷新真的动了（看右上"●"指示灯 pulse）
  - 提交：`feat(leadership-p2): overview live polling with ETag + fragment swap`

- **P-C3** 详情页（成员 + 项目）同样接 ETag + 整段刷新（两个详情页一并改一次）
  - 文件：`leadership/views/member-detail.html.ts`、`leadership/views/project-detail.html.ts`、`leadership/routes.ts`（详情页 API 也要返回 `_html` fragments + ETag）
  - 提交：`feat(leadership-p2): detail pages live polling`

### Milestone P-D · 性能 + 收尾（2 task）

- **P-D1** 索引文件 `<collectorDir>/.leadership-index.json`：collector-server 启动时若不存在则后台构建（不阻塞监听）；POST `/v1/cc-sessions` 写盘后追加索引 entry；scan 优先用索引（命中走文件 stat 验证，miss 走全量扫）
  - 文件：新建 `leadership/index.ts`、改 `leadership/transcript-loader.ts` 走 index-first
  - 测试：单测 index 增量 + 集成测全量回退
  - 验证：再跑 Task 21 的 perf 脚本，**冷启 < 2s**，warm < 50ms
  - 提交：`feat(leadership-p2): on-disk session index for sub-2s cold start`

- **P-D2** 浏览器烟测 + 性能验收 + 文档收尾
  - 启服务器，浏览器手测：首屏 attention 段、排序切换、Range 下拉、详情页自动刷新、ETag 节流
  - 跑 `scripts/perf-leadership.mjs`，更新 `docs/superpowers/smoke/2026-05-17-leadership-p2-smoke.md`
  - 提交：`test(leadership-p2): final smoke + perf validation`

### Out of Phase 2（明确不做）

- LLM 总结摘要
- SSE / WebSocket（30s polling 已够）
- 多团队多 collector 聚合
- 移动端响应式（leader 桌面环境）
- 周报导出
- 反 surveillance 成员自查页

---

## 6. 风险与开放问题

| 风险 | 严重度 | 缓解 |
|---|---|---|
| 通用名过滤伤到合法项目（团队真的有项目叫 `src`） | 低 | 过滤名做成配置 const，命中时附带"碰撞"标志便于人工 review |
| ETag 在 polling 模式下计算成本（每次 SHA1 整个 snapshot JSON） | 低 | 6 user/小数据集 SHA1 < 1ms；规模上去再换 hash-of-cache-key |
| 索引和写盘并发：POST 写 `.json` 后追加 index，并发 POST 可能覆盖 | 中 | 用文件锁（`writeFileSync` + `mkstemp + rename` 原子模式），同 uploader-client 那套 |
| 客户端 outerHTML 替换会丢用户的"展开"折叠状态 | 中 | 折叠状态写 localStorage，刷新后从 storage 恢复（P-B3 task 内附加） |
| `localStorage` 多 tab 写竞争（leader 开两个 tab 同时刷） | 低 | 写之前对比 timestamp，新覆盖旧；2 tab 都 30s 间隔，错峰可接受 |

---

## 7. 验收标准（Phase 2 完成的硬指标）

| # | 标准 | 验证方式 |
|---|---|---|
| 1 | 80 个项目折叠到 ≤15 个真项目 + 1 个折叠段 | snapshot 上 `/api/overview` 看 `projects.length` |
| 2 | 4 个未接信号在 MemberDetail/ProjectDetail JSON 可见 | `curl /api/members/<id>` 看新字段 |
| 3 | 首屏"需关注"段为 #1 视觉重心，沉默成员/项目折叠 | 浏览器肉眼 |
| 4 | Range 下拉切换工作，URL 同步 `?range=24h` | 浏览器手测 |
| 5 | Overview 页停留 30s 不动，KPI 数字自动变化 + 角标提示 | 浏览器肉眼 + 改一个 jsonl 文件 mtime |
| 6 | 详情页停留 30s 不动，sessions list 自动出现新 session | 同上 |
| 7 | ETag 304 命中率 > 50%（请求里 N-1 次"无变化"） | 服务端 access log（需加） |
| 8 | 冷启 < 2s（用 index），warm < 50ms | `node scripts/perf-leadership.mjs` |
| 9 | 全 monorepo 测试通过 > 720（基线 719） | `pnpm test --run` |

任意一项不达标 → 那条 task 回炉。

---

## 8. 与 writing-plans 的衔接

本 spec 落地后下一步：

```
Skill: superpowers:writing-plans
输入: 本 spec
输出: docs/superpowers/plans/2026-05-17-leadership-phase2.md
     （13 个 task，每个 bite-sized TDD 步骤，含失败测/impl/commit）
然后: superpowers:subagent-driven-development 自动执行
```

如果"前端乱"还有具体我没看到的痛点，**先告诉我，加进本 spec 再生成 plan**；spec 一旦冻结，13 个 task 就按这里写的走。

---

## 9. 相关文档

- Phase 1 spec：[`2026-05-16-leadership-dashboard-design.md`](./2026-05-16-leadership-dashboard-design.md)
- Phase 1 plan：[`../plans/2026-05-16-leadership-dashboard.md`](../plans/2026-05-16-leadership-dashboard.md)
- Phase 1 smoke：[`../smoke/2026-05-16-leadership-smoke.md`](../smoke/2026-05-16-leadership-smoke.md)
- 上传机制（用户敏感的部分）：本仓库 `packages/shared/src/`、`packages/uploader-client/src/`
