# Phase 3-B Activity 活动流 Implementation Plan

**Spec**: [`../specs/2026-05-18-leadership-activity-design.md`](../specs/2026-05-18-leadership-activity-design.md)

**Dependencies**: Phase 3-A `FocusFilter` types + helpers (done).

## Task B1 — Types

- [ ] Add `ActivityEvent`, `ActivityEventType`, `ActivityFeedSnapshot` to `types.ts`
- [ ] tsc clean
- [ ] Commit: `feat(leadership-3b): ActivityEvent + ActivityFeedSnapshot types`

## Task B2 — activity-feed.ts

- [ ] Create `activity-feed.ts` with `buildActivityFeed({ collectorDir, range, filter, beforeTs, limit })`
- [ ] Tests: 8-10 cases covering session emit, milestone emit, sort desc, dedup, focus filter pass-through, pagination cursor, empty, tie-break, demo-friendly fixture
- [ ] Commit: `feat(leadership-3b): activity-feed builder + tests`

## Task B3 — Activity page view

- [ ] Create `views/activity.html.ts` with `renderActivityPage(snapshot, opts)`
- [ ] Group events by date header (今天 / 昨天 / 日期); within each date, time-desc
- [ ] Per-event row: icon + time HHMM + by + project + summary
- [ ] Tests: 5-6 cases (default range, focus filter, empty, date grouping, session expand)
- [ ] Commit: `feat(leadership-3b): activity page renderer + tests`

## Task B4 — Routes wire

- [ ] /activity stub → real handler in `routes.ts`
- [ ] Parse focus filter, call buildActivityFeed, render
- [ ] Filter bar shown on activity tab
- [ ] /api/activity JSON endpoint
- [ ] Demo mode: synthesize demo events from getDemoSnapshot()
- [ ] Tests: route tests
- [ ] Commit: `feat(leadership-3b): /activity route real impl + filter wire`

## Task B5 — Nav label update

- [ ] Drop "· soon" from Activity nav label (`_nav.html.ts`)
- [ ] Commit: `chore(leadership-3b): Activity nav label promoted from stub`

## Task B6 — Smoke

- [ ] Build + restart smoke server
- [ ] Curl /activity and assert basic structure
- [ ] Commit smoke doc

## Self-Review

- [ ] Activity feed sorts time-desc
- [ ] Event types: session + commit/push/pr/release/tag
- [ ] Focus filter applies
- [ ] No regression on Phase 3-A
