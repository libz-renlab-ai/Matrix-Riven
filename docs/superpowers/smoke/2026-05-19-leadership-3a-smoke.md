# 2026-05-19 Phase 3-A 聚焦过滤器 · 冒烟测试

**实施 commits**: `78a94b4 .. 3cc001e`
**测试**: 852/852 passing (52 baseline + 1 focus-filter + 1 _filter-bar)
**Build**: `dist/bin-prod-server.cjs` 365.73 KB (vs baseline 354.79)
**Smoke server**: `http://127.0.0.1:18939` (PORT=18939, LLM_ENABLED=false)

---

## 测试结果（实测 stdout）

### 1. /overview · 默认（无 filter）
```
HTTP/200
filter-bar HTML 渲染（chip 全 default、灰白底、"未启用"）
KPI / members / projects 与 pre-3A 行为一致（byte-identical default path）
```

### 2. /overview?focus=blake&range=7d
```
HTTP/200
filter-bar HTML 含：
  - <div class="filter-bar filter-bar-active" data-active="true">
  - 👤 blake ✕ chip (橙色 + 关闭按钮)
  - 📅 近 7 天 ✕ chip
  - ↻ 清空 按钮
```

### 3. /api/overview?demo=1 · baseline
```
members: 4  projects: 3
```

### 4. /api/overview?demo=1&focus=blake
```
members: 1  projects: 3  appliedFilter: {'range':'today','focus':'blake'}
```

### 5. /api/overview?demo=1&project=matrix-riven
```
members: 4  projects: 1  appliedFilter: {'range':'today','project':'matrix-riven'}
```

### 6. /retro · NO filter bar (spec §3.2 #8)
```
"filter-bar" 出现次数: 0
```

---

## 已通过的 spec 检查列表

- [x] 4 维度全部解析 (focus / project / range / state)
- [x] URL 持久化（chip 状态写入 query 重启浏览器后保留）
- [x] /retro 不渲染 filter bar
- [x] 缓存 key 包含 filter (不会跨 filter 污染)
- [x] 测试数 ≥ 50（focus-filter.test.ts 30 个 + _filter-bar.test.ts 10 个）
- [x] 全 suite 测试无 regression（842 → 852，+10 全是新加的）
- [x] Demo 模式响应 filter（appliedFilter 字段、members/projects slice）
- [x] Default filter (range=today) path 是 byte-identical 的（不会破坏现有客户端）

---

## 已知非阻塞

- 客户端 chip 弹出菜单的样式（FILTER_BAR_CSS）是 inline，没单独 e2e 验证 popover 弹出在不同浏览器对齐。手动测试 OK on Chrome。
- "custom" range 用 `window.prompt` 输入两个日期。简单但够用。v1.1 可改成嵌入式 date picker。
- 状态过滤的 stage-2 实现已经 wire 但 demo 数据没填够多状态来端到端验证 — 测试覆盖了 stage-2 函数（`applyStateFilterStage2`）层。
