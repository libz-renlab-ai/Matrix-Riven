# Phase 3-A 聚焦过滤器 Implementation Plan

**Spec**: [`../specs/2026-05-18-leadership-focus-filter-design.md`](../specs/2026-05-18-leadership-focus-filter-design.md)

**Goal**: Add a chip-based filter bar to Overview/People/Projects tabs supporting 4 dimensions (focus/project/range/state) with single-select, page-scoped behaviour, URL persistence.

**Conventions**:
- Test files at `<dir>/__tests__/<name>.test.ts`
- Commit per task. Never amend. Never push. Never `--no-verify`.
- Run tests: `pnpm --filter @matrix-riven/collector-server test -- <path>`

---

## Task 1: Types — FocusFilter + RangeLabel

**Files**:
- Modify: `packages/collector-server/src/leadership/types.ts`

- [ ] Add `FocusFilter` interface and extend `RangeLabel`:
  - Add `'today'` `'yesterday'` `'custom'` to existing RangeLabel
  - Add `FocusFilter { focus?, project?, range, state?, from?, to? }`
- [ ] Run `pnpm --filter @matrix-riven/collector-server exec tsc --noEmit` — expect 0 errors
- [ ] Commit: `feat(leadership-3a): FocusFilter type + RangeLabel extension`

---

## Task 2: Filter parser + applier

**Files**:
- Create: `packages/collector-server/src/leadership/focus-filter.ts`
- Create: `packages/collector-server/src/leadership/__tests__/focus-filter.test.ts`

- [ ] Write failing test (15 cases): parseFocusFromQuery covers all dimensions, invalid values fall back, custom range parsing; applyFocusFilter covers single-axis + multi-axis + empty-filter pass-through
- [ ] Implement `focus-filter.ts`:
  - `parseFocusFromQuery(query: URLSearchParams, now: Date): FocusFilter`
  - `applyFocusFilter(sessions, filter, opts?): ParsedSession[]` — focus/project/range only (state handled in aggregator stage 2)
  - `resolveRange(filter, now): { start: Date; end: Date }`
- [ ] All 15 tests pass
- [ ] Commit: `feat(leadership-3a): focus-filter parser + applier`

---

## Task 3: Aggregator filter integration — overview

**Files**:
- Modify: `packages/collector-server/src/leadership/aggregator.ts`

- [ ] Add `filter?: FocusFilter` to `BuildOverviewInput`
- [ ] Inside `buildOverviewSnapshot`: after range slice, apply `applyFocusFilter(sessions, filter)` if filter present
- [ ] After member-state computation: filter member list by `filter.state` if set; then drop sessions belonging to filtered-out members and recompute
- [ ] Pass `filter` through `cacheKey` computation
- [ ] Snapshot includes `appliedFilter: FocusFilter` field for view rendering
- [ ] Test: 6 cases (each dimension affects output correctly + combined + state two-stage)
- [ ] Commit: `feat(leadership-3a): aggregator filter integration for overview`

---

## Task 4: Aggregator filter integration — member detail

**Files**:
- Modify: `packages/collector-server/src/leadership/aggregator.ts`

- [ ] `buildMemberDetail` accepts `filter` (focus is implicit from `email` arg; project/range/state apply)
- [ ] Filter sessions inside member detail computation
- [ ] Test: 4 cases (project filter, range filter, custom range, state ignored when focus=member)
- [ ] Commit: `feat(leadership-3a): member detail filter integration`

---

## Task 5: Aggregator filter integration — project detail

**Files**:
- Modify: `packages/collector-server/src/leadership/aggregator.ts`

- [ ] `buildProjectDetail` accepts `filter` (project is implicit; focus/range/state apply)
- [ ] Filter sessions inside project detail computation
- [ ] Test: 4 cases
- [ ] Commit: `feat(leadership-3a): project detail filter integration`

---

## Task 6: Filter bar view — server-side render

**Files**:
- Create: `packages/collector-server/src/leadership/views/_filter-bar.html.ts`
- Create: `packages/collector-server/src/leadership/views/__tests__/_filter-bar.test.ts`

- [ ] `renderFilterBar(snapshot, opts: { tab, members, projects, demo })`: returns HTML string of the chip bar
- [ ] 4 chips: focus/project/range/state; each with current value + ▾
- [ ] When any chip ≠ default → bar has `data-active="true"` + orange accent + `↻ 清空` link
- [ ] When `tab === 'retro'` → returns empty string
- [ ] Each chip is `<button data-chip="focus" data-value="blake">` with hidden `<datalist>` of options below for the client menu
- [ ] Tests: 8 cases (default render, each chip active, retro skip, demo mode, member list rendering, etc.)
- [ ] Commit: `feat(leadership-3a): filter bar server-side renderer`

---

## Task 7: Filter bar client JS — dropdown menu + URL writing

**Files**:
- Create: `packages/collector-server/src/leadership/views/_filter-bar.client.ts`
- Modify: `packages/collector-server/src/leadership/views/_refresh.js.ts` (append script)

- [ ] Client JS exports `FILTER_BAR_SCRIPT: string` — a self-contained inline script
- [ ] Click chip → open simple `<ul>` dropdown of options
- [ ] Click option → update URL query param and `location.assign`
- [ ] Click chip `✕` → remove that param + reload
- [ ] Click `↻ 清空` → remove all filter params + reload
- [ ] Persists across page refresh (URL is the source of truth — no localStorage needed)
- [ ] Tests: 6 cases (mostly DOM structure assertions on output)
- [ ] Commit: `feat(leadership-3a): filter bar client interactions`

---

## Task 8: Routes wire-up

**Files**:
- Modify: `packages/collector-server/src/leadership/routes.ts`

- [ ] In `/overview`, `/people`, `/projects` handlers: parse query via `parseFocusFromQuery`, pass to aggregator
- [ ] Cache key extended: `${pathname}|${range}|${focus}|${project}|${state}|${from?}|${to?}`
- [ ] In `/api/overview`, `/api/members/:id`, `/api/projects/:name` same treatment
- [ ] Render the filter bar via `renderFilterBar` inside each page (overview/people/projects)
- [ ] `/retro` does NOT render filter bar
- [ ] Tests: 8 cases — 200/HTML structure, JSON parity, retro absence, demo flag combo
- [ ] Commit: `feat(leadership-3a): routes wire focus filter + render bar`

---

## Task 9: KPI title + dimmed class

**Files**:
- Modify: `packages/collector-server/src/leadership/views/_overview-fragments.ts`

- [ ] Hero title: read `snapshot.appliedFilter`; if any non-default, render `${focus||''} · ${project||''} · ${rangeLabel}` (skip empty parts)
- [ ] Member tile: read `snapshot.appliedFilter.focus`; non-matching members get class `dimmed` (CSS sets opacity:0.3)
- [ ] Project row: read `snapshot.appliedFilter.project`; non-matching projects dimmed
- [ ] CSS `.dimmed { opacity: 0.3; }` added to `_css.ts`
- [ ] Tests: 5 cases (titles for each filter combo, dimmed members, dimmed projects, no filter → no dim)
- [ ] Commit: `feat(leadership-3a): KPI title + dimmed class for filtered subset`

---

## Task 10: Demo mode — focus filter on demo fixture

**Files**:
- Modify: `packages/collector-server/src/leadership/views/_demo-fixture.ts`

- [ ] Demo snapshot honors filter (slice demo members/projects per filter)
- [ ] Tests: 3 cases (demo + focus + project + range)
- [ ] Commit: `feat(leadership-3a): demo fixture honors focus filter`

---

## Task 11: Full test suite + manual smoke

- [ ] Run `pnpm --filter @matrix-riven/collector-server test` — full suite green
- [ ] Build: `pnpm --filter @matrix-riven/collector-server build`
- [ ] Start a fresh server on port 18938 with empty collector + demo flag enabled
- [ ] Curl `http://127.0.0.1:18938/overview?demo=1&focus=blake&range=7d` — assert chip bar HTML, KPI title, dimmed members
- [ ] Stop server
- [ ] Commit smoke evidence to `docs/superpowers/smoke/2026-05-19-leadership-3a-smoke.md`

---

## Task 12: Push + handover update

- [ ] `git push origin worktree-enumerated-roaming-engelbart`
- [ ] Update `docs/superpowers/smoke/2026-05-19-overnight-handover.md` with A done

---

## Self-Review Checklist

- [ ] All 4 dimensions implemented (focus/project/range/state)
- [ ] URL persistence works (refresh → state retained)
- [ ] No filter bar on /retro
- [ ] Cache key extension correct (no cross-filter pollution)
- [ ] Test count ≥ 50 (matches spec §8.1 estimate)
- [ ] Full suite still 812+ tests green (no regression)
- [ ] Demo mode works with filter
