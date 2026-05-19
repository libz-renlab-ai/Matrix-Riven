# Leadership Dashboard — Snapshot Smoke (2026-05-16)

**Snapshot:** `D:/0jingtong/Matrix-Riven/data/teamagent-logs-20260514-190026`
**Server:** `127.0.0.1:6066` (localhost only)
**Mode:** read-only

## Fix Applied Before Smoke

`scanAllSessions` in `transcript-loader.ts` only read `.json` (envelope-wrapped) files, but the
snapshot contains raw Claude Code `.jsonl` transcripts. Added `parseRawJsonlBuffer()` to parse the
native JSONL format and extended `scanAllSessions` to dispatch on extension: `.json` → envelope
path, `.jsonl` → raw JSONL path. Rebuilt `dist/bin-prod-server.cjs` (tsup, 153 KB CJS bundle).

## Results

- HTTP `/` — 200 · 20429B · 0.130s
- `/api/overview?range=7d` — members: 6 · projects: 80 · KPI team_activity: 480
- `/overview` HTML — 64109B · DOCTYPE present: yes
- `/api/members/hrdai` — detail keys: toolFailureRate, overContext200kCount, iterationDensity, riskyActions, collaborators, modelMix, webResearchCount, sessions, heatmap7x24, topFiles · sessions: 14 · first prompt preview len: ≤200 = yes (len=1, single-char first user turn)
- `/api/projects/38a51917` — state: maintaining · health: 10 · contributors: 1 · milestones: 0
- 404 for unknown member: 404
- Cold/warm: 13.498s / 0.080s (warm 80ms — just above 50ms budget; cold is expected ~14s for 488 JSONL files)

## Member display names in snapshot

hrdai, javana00, julielua, liboze2026, liusy, zhangziyi

## KPI attention breakdown

attention.value: 9 · stuck: 0 · needsHelp: 0 · riskyAction: 9

## Health verdict

PASS — all 6 expected members returned, 80 projects detected, cache works (80ms warm),
404 for unknown member correct, HTML tab present with DOCTYPE. Cold parse of 488 raw JSONL
files takes ~14s which is within expected range for a first uncached read.

Note: warm cache at 80ms is slightly above the ≤50ms budget from the plan; this is an
inheritable fix for Task 22 (performance budget script) but does not constitute a blocking failure.

## Perf budget (2026-05-16)

- Cold: 12669ms (target <2000)  ❌ over budget
- Warm p50: 2ms (target <50) ✅ under budget
- Warm p95: 54ms

**Verdict:** Budget exceeded. Cold scan reads the full 281 MB snapshot per request when the cache misses. Two follow-ups for a future task (NOT in this plan):
1. Persist an index file at `<collectorDir>/.leadership-index.json` updated on POST /v1/cc-sessions and invalidated periodically.
2. Or extend the TTL cache to also retain the parsed `ParsedSession[]` array so re-aggregation skips re-parsing the JSONL files.

For demo on this snapshot, the 30s TTL keeps subsequent fetches fast (~2ms p50). Acceptable for human-paced refresh; not for high-frequency polling.
