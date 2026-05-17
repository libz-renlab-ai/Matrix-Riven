# Leadership Dashboard · Phase 2 设计文档

**日期**：2026-05-17
**作者**：liboze + Claude
**前置**：[`2026-05-16-leadership-dashboard-design.md`](./2026-05-16-leadership-dashboard-design.md)（Phase 1，已落地 22 task）
**Phase 1 实绩**：commits `82b3335 .. c77e304`（31 个），719 测试通过，functional but raw
**视觉参考**：`.superpowers/brainstorm/2613-1778952522/content/dashboard-redesign-v7-spatial.html`（v7 Spatial，用户已确认）

---

## 1. 为什么有 Phase 2

Phase 1 把"能用"做出来了，但暴露三块没完工的事：

| 块 | 现状 | 用户原话 |
|---|---|---|
| A. 前端杂乱 | 80 个项目铺满屏、6 个成员无排序、列表无分组、Range 没下拉 | "现在前端好乱" |
| B. 实施缺口 | 18+14=32 个信号里 4 个建好了但没接进 snapshot；几处 UI 元素 spec 画了 mockup 但没实装；冷启 17s（spec 预算 2s）没做索引 | "看看哪些功能没做完" |
| C. 数据静态 | 浏览器只刷 3 个 KPI 数字；成员列表/项目列表/详情页根本不刷；新会话来了得手动 F5 | "结合动态数据展示" |
| D. 视觉不够格 | Phase 1 是技术 demo，不是给领导看的 | "太丑了，重新设计" ×2 |

Phase 2 一次性解四件事。**单一可部署交付物**：用同一个 collector-server bundle，从 demo 静态快照无缝切到 prod 真 live 数据。

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

→ **Phase 2 P-A1**：把这 4 个钩进 aggregator + 类型 + 渲染器。

### 2.2 Spec 画过 mockup / 写过约定 但 UI 没做的 6 项

| Spec § | 缺的事 | 影响 |
|---|---|---|
| 5.3 | 首屏右上 "Range 下拉（今日 / 24h / 7天 / 30天）" — 当前只有静态标签 | 没法切窗口 |
| 5.3 | 成员列表 "按活跃 ▼ 按需关注" 排序切换 | 6 人时勉强，规模上去全乱 |
| 5.4 | Sessions 行点击 → 跳 `/browse?sid=01J...` 看 raw | Browse tab 跳转死链 |
| 5.4 | 详情页 "状态/工作量/效率/风险/学习" 5 个并排 mini 卡里只有粗略数 | 部分指标（focus、迭代密度、newSurface）没字段对应 |
| 5.6 L2 | "点 [展开] 显示该 session **所有** user prompts" — 当前只展开**第一条**全文 | 实际行为<spec |
| 8 | "忽略通用名 cwd 最后段（src/test/dist/etc），回退倒数第二段" | 80 个项目里一堆叫 "src"/"dist" 的全是同名碰撞 |

→ **Phase 2 P-A2 .. P-A4** + **P-B5/P-B6** 分别补齐（详情 mini 卡随滑出抽屉一并重做）。

### 2.3 架构层面的 spec 兜底**没启用**的 1 项

| Spec § | 兜底设计 | 现状 |
|---|---|---|
| 3.4 | "如果实测扫盘超过 2 秒，引入索引文件 `<collectorDir>/.leadership-index.json`，后台异步更新" | 实测 17s，索引**没做**。Demo 阶段勉强用 cache TTL 撑着；上 prod 用户多了就崩 |

→ **Phase 2 P-D1**：实装索引（增量更新 + 启动加载）。

### 2.4 数据正确性（非 spec 但 Task 21 发现的真 bug 已修，无遗留）

- `scanAllSessions` 之前只读 envelope `.json`，snapshot 里是裸 `.jsonl`，Task 21 已补 raw 解析器（commit `63839e6`）。
- 注：prod 真上线后写盘格式还是 envelope `.json`；两种格式现在并行支持，不冲突。

---

## 3. 前端重设计 — v7 Spatial（已锁）

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
| 视觉风格像内部 SaaS demo | "太丑了" — 不像给领导看的 |

### 3.2 重设计目标

定五条新原则：

1. **首屏只展示"值得现在做事"的人和项目** — 默认折叠沉睡项目、低活跃成员
2. **每条 attention 行"重量"由信号强度决定** — 紧急的高、安静的塌缩
3. **KPI 卡 + attention 行可点击下钻** — 不跳页，**滑出 520px 抽屉**就地看
4. **列表必须可排序 + 可筛选 + 可搜索** — 默认按"需关注度"排
5. **视觉是 Apple/Notion 编辑器风（Spatial）**——温暖纸面背景、单一 sage accent、衬线大标题、柔影替代边框；不是 SaaS dashboard，是"放在桌上的一份简报"

### 3.3 信息架构（已锁）

**顶 nav 5 tab + Overview 三段 + 滑出抽屉**。视觉与文本细节以 v7 参考 HTML 为准。

```
┌────────────────────────────────────────────────────────────────────┐
│  [LOGO] Matrix·Riven    Overview  People  Projects  Activity  ⋯    │
│                                          ● live · 7 日 · 14:32 [YL]│
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  今天，团队总体 *平稳*。                ← Newsreader serif H1, 36px│
│  但有 *三件事* 值得你看一眼。              (em 用 sage 斜体)        │
│  5月17日 周六 · 14:32 · 数据每 30 秒刷新   6 位成员 · 8 个项目      │
│                                                                    │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐    ← KPI 浮卡 4 张    │
│  │ 需关注 │ │ 高产出 │ │ 消耗 ¥ │ │ 节奏   │      圆角 20px、柔影  │
│  │ 2 ↑1  │ │ 3 ↑33% │ │ 47.2k → │ │ 稳健   │     右上角 SVG 曲线    │
│  └────────┘ └────────┘ └────────┘ └────────┘                      │
│                                                                    │
│  ▒ 需要你看一眼 (3) ─────────────── 按紧急度 · 看全部 →            │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ ⚠ 三件事在等你 — 看一眼，决定要不要插手。  (serif 17px 斜体强调)│ │
│  ├──────────────────────────────────────────────────────────────┤ │
│  │ (li) liboze   闲置 11h pill (橙色 8pt)        03:12 →        │ │
│  │     上一次会话停在 api/overview.test.ts · 似乎没卡住，但没动 │ │
│  ├──────────────────────────────────────────────────────────────┤ │
│  │ (hr) hrdai    疑似卡住 pill                   14:08 →        │ │
│  │     连续 4 次问 Claude 同一类问题 · 关于 schema-v3 迁移      │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ▒ 团队 (6) ───────────────── 按活跃度 · 看全部 →                  │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐    ← 4 列网格、20px 圆角     │
│  │hrdai │ │javan │ │julie │ │liboze│      点击 → 滑出抽屉          │
│  │在 MR │ │在 RAG│ │在 doc│ │⬤ 闲  │      右上角 SVG sparkline    │
│  │142/¥ │ │ 97/¥ │ │ 63/¥ │ │ 88/¥ │                              │
│  └──────┘ └──────┘ └──────┘ └──────┘                              │
│                                                                    │
│  ▒ 项目 (8) ───────────────── 按推进 · 看全部 →                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ [MR] Matrix-Riven    ▓▓▓▓▓▓▓░░  1031/1450 ·慢2d  AvAvAv  → │ │
│  │ [RG] RAG-eval        ▓▓▓▓▓▓▓▓░  446/510                  → │ │
│  │ [DS] docs-site       ▓▓▓▓░░░░░  112/207                  → │ │
│  └──────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘

                          ╔══════════════════════╗ ← 520px 滑出抽屉
                          ║ (li) liboze       ✕ ║   spring 动效
                          ║ 闲置 11h · 上次03:12 ║   scrim blur(4px)
                          ╠══════════════════════╣
                          ║ ⚠ callout 框 (serif) ║
                          ║ "今天到现在 0 次..." ║
                          ╠══════════════════════╣
                          ║ 本周快照              ║
                          ║ 88 · ¥11.3k · 71%   ║
                          ║ ──────────────────── ║
                          ║ prompt 演变           ║
                          ║ 03:12 │ "如果..."    ║ ← 最新条带 amber
                          ║ 03:08 │ "vitest..."  ║
                          ║ 02:54 │ "renderQ..." ║
                          ║ ──────────────────── ║
                          ║ 在哪些项目里          ║
                          ╚══════════════════════╝
```

**Tab 路由**：
- `/` = Overview tab（默认）
- `/people` = People tab（所有成员的可排序表）
- `/projects` = Projects tab（所有项目，含折叠组）
- `/activity` = Activity tab（时间轴 / Phase 2 后期，先 stub）
- `/insights` = Insights tab（趋势对比 / Phase 2 后期，先 stub）
- 现有 `/?sid=...` Browse tab 视为 Activity 的子路径，保留兼容

**滑出抽屉路由**：
- 不改变浏览器 URL（不 push history），用 `?detail=member:<id>` query 同步可分享/可深 link，但抽屉本身是 client-side overlay
- 关闭时清 query
- 同时只允许一个抽屉打开（点新行 → 抽屉内容平滑切换）

### 3.4 v7 Spatial 视觉 token（已锁）

CSS 变量逐字钉死，所有后续 P-B 任务都从这里取色。

```css
:root {
  /* Background — warm, paper-like */
  --bg:         #F7F6F2;
  --bg-elev:    #FAFAF7;
  --surface:    #FFFFFF;
  --surface-2:  #FBFBF8;

  /* Ink — gentle, not pure black */
  --ink-1:      #1C1B19;   /* primary text */
  --ink-2:      #45433E;   /* secondary */
  --ink-3:      #7A776F;   /* tertiary */
  --ink-4:      #A8A59C;   /* placeholder */
  --ink-5:      #D8D5CB;   /* faint */
  --hairline:   #ECEAE2;   /* dividers, replaces all 1px borders */

  /* Single sage accent + 3 muted status colors */
  --accent:     #6F8B5E;   /* sage */
  --accent-soft:#E8EEDF;
  --accent-ink: #3F5736;
  --warn:       #C8924B;   /* soft amber — attention/idle */
  --warn-soft:  #F4E9D6;
  --danger:     #B0625A;   /* dusty terracotta — stuck/blocked */
  --danger-soft:#F1DCD7;
  --calm:       #8A9AAA;   /* soft slate — neutral metric */
  --calm-soft:  #E5EBF0;

  /* Depth — soft shadows replacing all borders */
  --shadow-1:   0 1px 2px rgba(28,27,25,.04), 0 4px 16px rgba(28,27,25,.04);
  --shadow-2:   0 1px 3px rgba(28,27,25,.05), 0 12px 32px rgba(28,27,25,.06);
  --shadow-3:   0 2px 6px rgba(28,27,25,.06), 0 24px 64px rgba(28,27,25,.10);
  --shadow-lift:0 1px 2px rgba(28,27,25,.04), 0 8px 28px rgba(28,27,25,.08);

  /* Radius — generous */
  --r-sm: 10px;   /* inner pills */
  --r-md: 14px;   /* callout/stat blocks */
  --r-lg: 20px;   /* tiles / KPI / member */
  --r-xl: 28px;   /* major surfaces, nav, slide-over */

  /* Motion */
  --ease:   cubic-bezier(.2,.7,.2,1);
  --spring: cubic-bezier(.34,1.56,.64,1);
}
```

**字体**（Google Fonts CDN，prod 部署内嵌或自托管二选一）：

- `Inter` 300/400/450/500/600/700 — 主 UI 字体
- `JetBrains Mono` 400/500 — 文件路径、时间戳
- `Newsreader` 400/500 ital — 编辑器口吻大标题、callout、滑出 prompt 演变

**body 默认**：`font-feature-settings: 'cv11', 'ss01', 'tnum'; letter-spacing: -0.005em`。**所有数字必带 `tnum`**（tabular numerals）。

**背景三层径向 mesh**（fixed，pointer-events:none）：

```css
background:
  radial-gradient(800px 600px at 10% -10%, rgba(111,139,94,.06), transparent 60%),
  radial-gradient(700px 500px at 100% 0%, rgba(200,146,75,.04), transparent 55%),
  radial-gradient(900px 700px at 50% 110%, rgba(138,154,170,.04), transparent 60%);
```

**Frosted nav**（顶 navbar 必须）：`backdrop-filter: blur(20px) saturate(180%); background: rgba(255,255,255,.72)`。

**状态色用法约束**（必须遵守）：

- accent/warn/danger/calm 这四色**只能出现在 ≤8px 圆点、≤22px pill、内文一两个 em 强调字**上
- **永远不允许**当大块背景或大字主色（防止 v5 的 cheap SaaS look 复发）
- KPI 数字主体永远是 `--ink-1`，颜色只用作小点 + trend 箭头

**编辑器口吻硬约束**：

- 首屏 hero H1 必须是一句拟人句子，含 1-2 个 serif em 斜体（如 "今天，团队总体 *平稳*。但有 *三件事* 值得你看一眼。"）
- attention 段头必须有一句衬线 prose（如 "三件事在等你 — *看一眼，决定要不要插手*。"）
- 滑出抽屉头部必须有一个 callout box，serif 13.5px italic，叙事性表达"这个数据意味着什么"（如 "过去三天平均每天 14 次会话，今天 *到现在 0 次*。最后一次停在测试文件上 — *不像是卡住，更像是没开工*。"）
- callout 文案根据 member.state 模板化生成，不是死字符串

### 3.5 参考实现

完整 HTML / CSS / SVG sparkline / 滑出动效 / 字体加载都在
**`.superpowers/brainstorm/2613-1778952522/content/dashboard-redesign-v7-spatial.html`**。

实施时**直接复制其 CSS 块进 `LEADERSHIP_CSS`**，不要重写。结构层（成员/项目 tile、attention 行、slide-over）的 HTML 也按 v7 抄。

---

## 4. 动态数据更新设计

### 4.1 三条通道，从弱到强

| 通道 | 协议 | 间隔 | 适用 | Phase 2 要做 |
|---|---|---|---|---|
| A. 整段轮询 | HTTP polling | 30s | 默认 | ✅ 必做 |
| B. ETag 节流 | HTTP polling + `If-None-Match` | 30s | 节流 | ✅ 必做（节带宽） |
| C. SSE 推 | Server-Sent Events | 推送 | 高频 leader | ⛔ Phase 2 不做（v3） |

**Phase 2 不上 WebSocket / SSE**。30s polling + ETag 已经能覆盖"多次/天"的使用节奏。

### 4.2 客户端刷新模型：分段 fragment 替换（不是 diff）

Phase 2 的 Overview tab 客户端：

```javascript
// 每 30s 拉一次完整 JSON
setInterval(async () => {
  const resp = await fetch('/api/overview?range=' + range, { headers: { 'If-None-Match': etag } });
  if (resp.status === 304) return;  // 没变
  etag = resp.headers.get('etag');
  const snap = await resp.json();
  // 拿一份 server 帮我们渲好的 HTML fragment，整段替换
  document.getElementById('hero').outerHTML       = snap._html.hero;       // 含编辑器 H1 + 元信息
  document.getElementById('kpis').outerHTML       = snap._html.kpis;
  document.getElementById('attention').outerHTML  = snap._html.attention;
  document.getElementById('members').outerHTML    = snap._html.members;
  document.getElementById('projects').outerHTML   = snap._html.projects;
  // 顶部 live 灯
  document.querySelector('.live-dot').classList.toggle('pulse', true);
}, 30000);
```

服务端 `/api/overview` 响应里加 `_html: { hero, kpis, attention, members, projects }` 字段，客户端 `outerHTML = ...` 替换。

**为什么不做 diff**：6-20 个成员 + ~8 个真项目 — DOM 节点 <300 个，整段替换无闪烁。规模真涨到 50+ 再上 incremental。

### 4.3 "自上次以来变化"的实现

客户端 `localStorage` 存最近一次拉到的 KPI 值 + 时间。每次刷新对比，给变化字段加 `↑3` `↓1` 角标，5 秒后淡出。无服务端状态、纯前端。

### 4.4 滑出抽屉的实时刷新

滑出抽屉打开时，**抽屉自己启动 second polling**（同 30s 间隔 + ETag）：

- `GET /api/members/:id` 拉 MemberDetail JSON
- 返回里同样带 `_html: { callout, stats, evolve, projects }` 4 段
- 抽屉里 `outerHTML` 替换这 4 段（不重画头部 avatar / 关闭按钮）
- 关闭抽屉时 cancel 该 polling

**没有独立 detail page**。`/members/:id` 仅作为 JSON API 存在；旧的"全页 detail HTML"渲染器在 P-B6 删除，渲染逻辑迁到 slide-over fragment。

### 4.5 服务器端配合

```typescript
// routes.ts
function etagFor(snap: object): string {
  return '"' + crypto.createHash('sha1').update(JSON.stringify(snap)).digest('hex').slice(0, 16) + '"';
}
// in handler:
const etag = etagFor(snap);
if (req.headers['if-none-match'] === etag) {
  res.writeHead(304, { 'etag': etag });
  res.end();
  return;
}
const html = {
  hero: renderHeroFragment(snap),
  kpis: renderKpisFragment(snap),
  attention: renderAttentionFragment(snap),
  members: renderMembersFragment(snap),
  projects: renderProjectsFragment(snap),
};
res.writeHead(200, { 'content-type': 'application/json', 'etag': etag });
res.end(JSON.stringify({ ...snap, _html: html }));
```

ETag 算在缓存层之上，cache hit 时 ETag 相同 → 客户端 304 节流率高。

---

## 5. Phase 2 任务清单（15 task，按 milestone 排）

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
  - 文件：`leadership/views/member-detail.html.ts`（此 task 完成后该文件被 P-B6 替换，故直接改 fragment 渲染器更划算 — 但本 task 先在旧渲染器上修正以保持中间态可用）
  - 测试：`views/__tests__/member-detail.html.test.ts` 加 2 例
  - 提交：`fix(leadership-p2): expand button shows all session prompts per spec`

- **P-A4** 在抽屉 sessions 行加 "查看 raw" 链接，跳 `/?sid=<sessionId>`（兼容现有 Browse tab 的 query 约定）
  - 文件：`leadership/views/member-detail.html.ts`（同 P-A3，先在旧渲染器加，P-B6 时迁到 fragment）
  - 提交：`feat(leadership-p2): session "view raw" link to Browse tab`

### Milestone P-B · v7 Spatial 视觉与 IA（6 task）

> 实施纪律：每个 P-B 任务都从 `.superpowers/brainstorm/2613-1778952522/content/dashboard-redesign-v7-spatial.html` 复制对应 CSS/HTML 块，**不重写视觉**。task 是把 v7 静态参考变成数据驱动的真实组件。

- **P-B1** 落地 v7 Spatial 设计 token：把 §3.4 的 CSS 变量（`--bg/--ink-*/--accent/--warn/--shadow-*/--r-*/--ease`）写进 `LEADERSHIP_CSS`，配 body 三层径向 mesh + Google Fonts 加载（Inter + JetBrains Mono + Newsreader）
  - 文件：`leadership/views/_css.ts`（新建，从 `overview.html.ts` 抽出常量；或保留在 overview.html.ts 但加 token 段）
  - 测试：snapshot 测 CSS 字符串含 `--accent:#6F8B5E` `--r-xl:28px` 等关键值
  - 视觉验收：浏览器开页面，背景为温暖纸色 `#F7F6F2`，body font Inter，serif Newsreader 可用
  - 提交：`feat(leadership-p2): v7 spatial design tokens in CSS`

- **P-B2** 顶 nav：frosted glass 5 tab + brand mark + live 灯 + 当前用户头像；URL 路由 `/` `/people` `/projects` `/activity` `/insights`（Activity / Insights 先做 stub 页 "尚未实现"）
  - 文件：`leadership/views/_nav.html.ts`（新建，所有 tab 共用），`leadership/routes.ts` 加 4 个 GET handler
  - 测试：`routes.test.ts` 4 个 200 + nav HTML 含 5 个 tab link
  - 视觉验收：sticky top:16px、backdrop-filter blur(20px) 工作、活跃 tab 高亮
  - 提交：`feat(leadership-p2): frosted top nav with 5 tabs`

- **P-B3** Overview hero（编辑器口吻 H1 + 元信息）+ KPI 4 浮卡：H1 文案根据 attention 数量模板化（如 "今天，团队总体 *平稳*。但有 *三件事* 值得你看一眼。"）；4 KPI = 需关注 / 高产出 / 消耗 / 节奏，每张含数字 + 趋势 + SVG sparkline
  - 文件：`leadership/views/overview.html.ts` 重写为组合 fragment，新增 `renderHeroFragment(snap)` + `renderKpisFragment(snap)`
  - 文案模板：`leadership/views/_copy.ts`（新建，含 `heroHeadline(snap)` `attentionLead(snap)` `idleCallout(member)` 等编辑器口吻文案函数）
  - 测试：`__tests__/copy.test.ts` 测 0/1/3/5 attention 时 H1 文案分支；hero fragment HTML 含 serif em
  - 提交：`feat(leadership-p2): editorial hero + KPI floating cards`

- **P-B4** Attention 段：`OverviewSnapshot.attention: AttentionItem[]` 派生字段（含 type/member|project、reason、tag、timestamp）；渲染为编辑器卡（serif headline + 行式 attention rows）；点击行 → 滑出抽屉
  - 文件：`leadership/aggregator.ts` 加 `deriveAttention(snap)`，`leadership/types.ts` 加 `AttentionItem`，`leadership/views/overview.html.ts` 加 `renderAttentionFragment`
  - 测试：aggregator 派生测（3 类 attention 各一例）+ fragment 渲染测
  - 视觉验收：attention 卡顶部 amber 渐变、衬线 headline、行 hover 微动
  - 提交：`feat(leadership-p2): attention section with editorial card`

- **P-B5** 成员网格 + 项目列表（v7 视觉）：成员 4 列 tile（avatar + 状态点 + 在做 + 3 stat + sparkline）；项目卡片行（icon + 名称 + 进度条 + ETA + avatar stack）；两段都支持排序切换（按需关注 / 活跃 / 字母 / token）
  - 文件：`leadership/views/overview.html.ts` 加 `renderMembersFragment` + `renderProjectsFragment`，排序写客户端 JS（`<details>` + data-sort-key）
  - 测试：fragment 含正确数据；排序 JS 单测（jsdom）
  - 视觉验收：tile hover 上浮 2px + shadow-lift；sparkline 1.2px 描边
  - 提交：`feat(leadership-p2): v7 member grid + project list with sortable lists`

- **P-B6** 滑出抽屉（替代旧 detail page）：520px scrim 抽屉，spring 动效，含 callout / stats / prompt 演变 / 项目列表 4 段；服务端 `/api/members/:id` 返回 JSON+_html fragments；点击成员 tile / attention 行 / 项目卡都打开抽屉；ESC + scrim click 关闭
  - 文件：删除 `leadership/views/member-detail.html.ts` 全页渲染器，新建 `leadership/views/_slideover.html.ts`（共用骨架，按 type 分支为 member/project 抽屉）；`leadership/routes.ts` 改 `/api/members/:id` 返回 `{ ...detail, _html: { callout, stats, evolve, projects } }`
  - 客户端 JS：抽屉打开/关闭/抽屉内 30s 轮询
  - P-A3 / P-A4 在旧渲染器加的逻辑迁到 fragment 渲染
  - 测试：`__tests__/slideover.test.ts` callout 文案分支 + 抽屉 JSON 结构
  - 视觉验收：抽屉滑入 spring 弹性、scrim blur(4px)、关闭后 query 清理
  - 提交：`feat(leadership-p2): slide-over detail panel replaces full detail pages`

### Milestone P-C · 动态数据（3 task）

- **P-C1** `/api/overview` 输出 ETag + 支持 304；在响应里加 `_html: { hero, kpis, attention, members, projects }` 字段
  - 文件：`leadership/routes.ts`、`leadership/views/overview.html.ts`（fragment 渲染函数已在 P-B3..P-B5 拆好）
  - 测试：`__tests__/routes.test.ts` 加 ETag 304 case + _html 字段存在
  - 提交：`feat(leadership-p2): ETag + per-section HTML fragments in overview API`

- **P-C2** Overview tab 客户端刷新脚本：每 30s fetch + ETag 节流 + 整段 outerHTML 替换 + KPI 变化角标
  - 文件：`leadership/views/_refresh.js.ts`（新建客户端脚本字符串常量），`overview.html.ts` 引用
  - 客户端 localStorage 存上次 KPI 值 + 上次抽屉 sort 状态
  - 浏览器烟测：30s 自动刷新真的动了（看右上 live 灯 pulse、改 jsonl mtime 看到数字变化）
  - 提交：`feat(leadership-p2): overview live polling with ETag + fragment swap`

- **P-C3** 滑出抽屉客户端实时轮询：抽屉打开时启动 second polling（30s + ETag）；抽屉内 callout / stats / evolve / projects 4 段独立 outerHTML 替换；抽屉关闭时 cancel polling
  - 文件：`_refresh.js.ts` 加抽屉 polling 函数；`leadership/routes.ts` `/api/members/:id` 也支持 ETag
  - 测试：抽屉打开 → mock fetch → 验证 4 段被替换、抽屉关闭后 setInterval 清掉
  - 提交：`feat(leadership-p2): slide-over live polling on open`

### Milestone P-D · 性能 + 收尾（2 task）

- **P-D1** 索引文件 `<collectorDir>/.leadership-index.json`：collector-server 启动时若不存在则后台构建（不阻塞监听）；POST `/v1/cc-sessions` 写盘后追加索引 entry；scan 优先用索引（命中走文件 stat 验证，miss 走全量扫）
  - 文件：新建 `leadership/index.ts`、改 `leadership/transcript-loader.ts` 走 index-first
  - 测试：单测 index 增量 + 集成测全量回退
  - 验证：再跑 `scripts/perf-leadership.mjs`，**冷启 < 2s**，warm < 50ms
  - 提交：`feat(leadership-p2): on-disk session index for sub-2s cold start`

- **P-D2** 浏览器烟测 + 性能验收 + 文档收尾
  - 启服务器，浏览器手测（要求都过）：
    1. Overview 首屏 v7 视觉到位（温暖背景、frosted nav、serif H1）
    2. 5 tab 切换（Activity/Insights 显示 stub 占位）
    3. KPI 卡 → 点击下钻
    4. attention 行 → 滑出抽屉
    5. 成员 tile → 滑出抽屉，含 callout / prompt 演变
    6. 排序切换工作
    7. 30s 后 KPI 自动变化 + 角标淡入淡出
    8. 抽屉打开后改 jsonl mtime → 抽屉内自动刷新
    9. ETag 304 命中率 > 50%（看 server access log）
  - 跑 `scripts/perf-leadership.mjs`，更新 `docs/superpowers/smoke/2026-05-17-leadership-p2-smoke.md`
  - 提交：`test(leadership-p2): final smoke + perf validation`

### Out of Phase 2（明确不做）

- LLM 总结摘要
- SSE / WebSocket（30s polling 已够）
- 多团队多 collector 聚合
- 移动端响应式（leader 桌面环境）
- 周报导出
- 反 surveillance 成员自查页
- Activity / Insights tab 的真实内容（Phase 2 只做 stub 占位）

---

## 6. 风险与开放问题

| 风险 | 严重度 | 缓解 |
|---|---|---|
| 通用名过滤伤到合法项目（团队真的有项目叫 `src`） | 低 | 过滤名做成配置 const，命中时附带"碰撞"标志便于人工 review |
| ETag 在 polling 模式下计算成本（每次 SHA1 整个 snapshot JSON） | 低 | 6 user/小数据集 SHA1 < 1ms；规模上去再换 hash-of-cache-key |
| 索引和写盘并发：POST 写 `.json` 后追加 index，并发 POST 可能覆盖 | 中 | 用文件锁（`writeFileSync` + `mkstemp + rename` 原子模式），同 uploader-client 那套 |
| 客户端 outerHTML 替换会丢用户的"展开"折叠状态 | 中 | 折叠状态写 localStorage，刷新后从 storage 恢复（P-B5 task 内附加） |
| `localStorage` 多 tab 写竞争（leader 开两个 tab 同时刷） | 低 | 写之前对比 timestamp，新覆盖旧；2 tab 都 30s 间隔，错峰可接受 |
| Google Fonts CDN 在墙内偶尔慢 | 中 | 字体退化到 system-ui（Inter）/ Georgia（Newsreader）/ ui-monospace（JetBrains Mono）；prod 部署考虑自托管 |
| frosted nav 在低端机 backdrop-filter 性能差 | 低 | 退化方案 `@supports not (backdrop-filter: blur(20px)) { 用纯白 95% }` |
| 滑出抽屉打开时背景 scroll 锁定遗漏 | 低 | 抽屉打开加 body.style.overflow='hidden'，关闭还原 |
| v7 字体加载未完成时闪烁（FOUT） | 低 | `font-display: swap`，Inter 退到 system-ui 时 letter-spacing 微调 |

---

## 7. 验收标准（Phase 2 完成的硬指标）

| # | 标准 | 验证方式 |
|---|---|---|
| 1 | 80 个项目折叠到 ≤15 个真项目 + 1 个折叠段 | snapshot 上 `/api/overview` 看 `projects.length` |
| 2 | 4 个未接信号在 MemberDetail/ProjectDetail JSON 可见 | `curl /api/members/<id>` 看新字段 |
| 3 | 首屏 v7 视觉达标：温暖背景 `#F7F6F2` + frosted nav + serif H1 + sage accent + 圆角 ≥20px + 软影非边框 | 浏览器肉眼对照 v7 参考 HTML |
| 4 | 5 tab 切换工作（Activity/Insights stub 也算通过） | 浏览器手测 |
| 5 | attention/成员/项目 任一点击 → 滑出 520px 抽屉（spring 动效 + scrim blur） | 浏览器肉眼 |
| 6 | Range 下拉切换工作（在抽屉或顶 nav 里），URL 同步 `?range=24h` | 浏览器手测 |
| 7 | Overview 页停留 30s 不动，KPI 数字自动变化 + 角标提示 | 浏览器肉眼 + 改一个 jsonl 文件 mtime |
| 8 | 滑出抽屉打开后停留 30s，sessions/prompt 演变自动出现新内容 | 同上 |
| 9 | ETag 304 命中率 > 50%（请求里 N-1 次"无变化"） | 服务端 access log（需加） |
| 10 | 冷启 < 2s（用 index），warm < 50ms | `node scripts/perf-leadership.mjs` |
| 11 | 全 monorepo 测试通过 > 720（基线 719） | `pnpm test --run` |
| 12 | 编辑器口吻文案模板覆盖 attention 0/1/N 三种分支 | `__tests__/copy.test.ts` 通过 |

任意一项不达标 → 那条 task 回炉。

---

## 8. 与 writing-plans 的衔接

本 spec 落地后下一步：

```
Skill: superpowers:writing-plans
输入: 本 spec
输出: docs/superpowers/plans/2026-05-17-leadership-phase2.md
     （15 个 task，每个 bite-sized TDD 步骤，含失败测/impl/commit）
然后: superpowers:subagent-driven-development 自动执行
```

如果 v7 视觉之外还有具体痛点，**先告诉我，加进本 spec 再生成 plan**；spec 一旦冻结，15 个 task 就按这里写的走。

---

## 9. 相关文档

- Phase 1 spec：[`2026-05-16-leadership-dashboard-design.md`](./2026-05-16-leadership-dashboard-design.md)
- Phase 1 plan：[`../plans/2026-05-16-leadership-dashboard.md`](../plans/2026-05-16-leadership-dashboard.md)
- Phase 1 smoke：[`../smoke/2026-05-16-leadership-smoke.md`](../smoke/2026-05-16-leadership-smoke.md)
- v7 视觉参考：`.superpowers/brainstorm/2613-1778952522/content/dashboard-redesign-v7-spatial.html`
- 上传机制（用户敏感的部分）：本仓库 `packages/shared/src/`、`packages/uploader-client/src/`
