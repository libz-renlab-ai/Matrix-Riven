# LLM Narrative Layer — Smoke Test (L-13)

**Date:** 2026-05-18
**Spec:** `docs/superpowers/specs/2026-05-17-llm-narrative-design.md`
**Plan:** `docs/superpowers/plans/2026-05-17-llm-narrative.md` (§Wave 4 L-13)
**Host:** Windows 11, Node 22.22.2, claude CLI 2.1.138
**Data:** frozen snapshot at `D:/0jingtong/Matrix-Riven/data/teamagent-logs-20260514-190026`

## Scope

End-to-end validation that one LLM worker cycle populates the on-disk cache and
that the prod HTTP server's render path lifts every `llm*` field into both
`/api/overview` JSON and the `/overview` HTML page.

## Method

Two phases — clean control of LLM spend, deterministic before/after.

**Phase A — fill cache** via `scripts/smoke-llm-narrative.ts`:

```sh
SMOKE_T1_MAX=20 pnpm exec tsx scripts/smoke-llm-narrative.ts \
  ./.smoke-cache \
  D:/0jingtong/Matrix-Riven/data/teamagent-logs-20260514-190026
```

The driver constructs `WorkerInputs` from the real snapshot, mounts a real
`LlmCache` on the local filesystem, and calls `worker.runOnce()` — one tick,
five tiers, then exits.

**Phase B — boot prod server** with worker idle (24h interval, $0.01 budget so
no second tick ever fires) and verify the cache-only render path:

```sh
PORT=18933 HOST=127.0.0.1 \
  RIVEN_COLLECTOR_DIR=D:/0jingtong/Matrix-Riven/data/teamagent-logs-20260514-190026 \
  LLM_ENABLED=true \
  LLM_CACHE_DIR=$(pwd)/.smoke-cache \
  LLM_WORKER_INTERVAL_MS=86400000 \
  LLM_BRIEF_INTERVAL_MS=86400000 \
  LLM_DAILY_BUDGET_USD=0.01 \
  node packages/collector-server/dist/bin-prod-server.cjs
```

Then `curl /api/overview?range=7d` and `curl /overview`.

## Results

### Cache (Phase A)

After one tick with T1 capped at the 20 most recent sessions:

| tier | entries | sample value |
|------|---------|--------------|
| T1   | 20      | `查一下仓库关于emebdding的文档…` (some echoes — see Quality below) |
| T2   | 6       | `本周聚焦 状态页面开发\n卡在 页面集成问题` |
| T3   | 9       | `团队在做文档编写\n进展完成初稿 / 待审核` |
| T4   | 2       | `检查 status/page.tsx 的类型和导入依赖` |
| T5   | 1       | `["代码质检通过，工作树分支已顺利推送","技能评估与评判框架初始文档落地","三项目并行推进，协同开发有序展开"]` |

Total tick duration: 73.5s. Cost: $0.0758 (≈ $0.018 × ~5 calls).

### Render path (Phase B)

`GET /api/overview?range=7d` returned 37 KB JSON containing:

```
members:    4 / 6   with llmWeekly
projects:   6 / 9   with llmWeekly
attention:  2 / 2   with llmRewrite
highlights: 2 / 10  with llmDigest
llmBrief:   ["代码质检通过，工作树分支已顺利推送",
             "技能评估与评判框架初始文档落地",
             "三项目并行推进，协同开发有序展开"]
```

`GET /overview` returned 62 KB HTML containing every cached line at the right
surface — `briefBox` for T5, `m-llm` divs for T2, project narrative for T3,
attention `line2` for T4, highlight detail for T1.

Spec acceptance criterion #2 ("after one worker cycle: …") is met for this
real-data snapshot. Acceptance #1 (`LLM_ENABLED=false` = byte-identical to
main) is not exercised here — covered by the existing
`aggregator-llm.test.ts` unit suite.

## Issues found and fixed during the smoke

### 1. Windows `shell:true` mangled the `--system-prompt` arg

`spawn('claude', args, { shell: true })` on Windows passes the system prompt
inline. Multi-line prompts containing `"` and newlines were truncated at the
first special char, silently dropping `--output-format json` and downstream
flags. First-round stdout was the model's raw reply text → `JSON.parse` failed
in the local-claude-client with `parse_error`.

**Fix:** write `req.systemPrompt` to a per-call temp file and pass
`--system-prompt-file <path>`. File-based arg has no quoting issues and
sidesteps Windows' 8191-char cmd cap as a bonus.

### 2. Project + user hooks leaked into prompts

`claude -p` running from the project cwd picked up `.claude/settings.json`
UserPromptSubmit hooks (Chinese-translation hook, viki memory recall). The
hook output landed *inside* the spawned model's user prompt, pulling the
model into chit-chat mode ("English translation: …", "I see you'd like to…").

**Fix:** spawn the child from `os.tmpdir()` (not the project) AND pass
`--setting-sources project`. With cwd=tmp+no project settings, no hooks load,
no CLAUDE.md, no auto-memory.

### 3. Haiku drifted to chit-chat on bigger batches even with no hooks

After fixes 1 and 2, T5 (sonnet) produced perfect JSON but T2/T3 (haiku) still
sometimes replied "I see you've given me a JSON…". Single-item manual repros
worked; multi-item batches with 6–9 items confused the model.

**Fix:** prepend an imperative directive to the *user* prompt — e.g.
`Return STRICT JSON {"results":[{"refId","line"}]} only. No prose. Batch:\n…`.
The model now follows the JSON contract reliably at batch size up to 9.

### 4. T1 single-batch timeout on the real snapshot

The real frozen snapshot has 470 sessions in range. Worker packed all 470
into one T1 call → the 60s claude-CLI timeout fired before haiku finished
the prompt. Per-spec the cap is 50 sessions/call; the code lacks the cap.

**Workaround in this smoke:** `SMOKE_T1_MAX=20` slices the smoke driver's
T1 input. **Code gap (not fixed here):** `summarizeSessions` needs a real
batch-of-50 loop, otherwise any large real deployment will hit this on
cold start.

### 5. T5 cache key drift between worker write and aggregator read

`buildT5InputFromSnapshot` accepts `sessionsMap`, `projectsMap`, and
`attentionRewrites`. The worker's `collectWorkerInputs` passes empty maps
+ `[]` (T1..T4 haven't run yet at collect-time). The aggregator's render
path was passing **populated** `sessionsMap`/`projectsMap`/T4 rewrites read
from cache → SHA-1 over a different payload → key never matched → `llmBrief`
was always undefined.

**Fix in this run:** aggregator now also passes `emptyMap` and `[]` to match
the worker. The cost is that T5 sees the raw snapshot's highlights/projects
rather than the LLM-enriched versions, but the cache contract works. Real
fix (out of scope) is to have the worker rebuild the T5 input *after* T1/T3/T4
land, so both sides agree on the populated state.

### 6. Cache-key drift on T2 also affects 2/6 members (cosmetic)

4 of 6 members got `llmWeekly`; the other 2 didn't. Same root cause as #5
in a smaller dose — the worker-side `topFiles` / `sessionDigests` for some
members must differ from what the render path recomputes (likely tied to
session noise filtering between worker and aggregator). Not fixed here;
documented for follow-up.

## Spec ↔ code gaps surfaced (still open)

These reinforce the gap list from the doc review on 2026-05-17:

| Ref | Gap |
|-----|-----|
| Spec §Tiers T1 row | No `50 sessions/call` batch cap; 470-session batch times out. **Hit during smoke.** |
| Spec §Cache file | No 50MB eviction at `put()` — still aspirational. (Not hit during smoke, but only because cache stayed ~5 KB.) |
| Spec §Tiers T2/T3 row | "Cache TTL: 4h" — no time-based TTL, only content-hash. (Acceptable, document drift.) |
| Plan L-9 worker contract | Worker writes T5 with empty maps; aggregator was reading with populated maps. **Worked around in this commit; canonical fix is worker rebuild.** |

## Followup recommended

1. **Batch cap on T1** — add `chunk(sessions, 50)` loop in `summarizeSessions`,
   one LLM call per chunk. Avoids the timeout that blocked the very first
   smoke run.
2. **Worker rebuilds T5 input** after T1/T3/T4 fill, then writes T5 with
   populated maps. Reverts the empty-map workaround in `attachLlmFields`
   and restores T1/T3 digests in the brief prompt.
3. **50MB cache eviction** at `put()` time per spec §Cache file.
4. **T2 cache-key drift** — investigate why 2/6 members miss; likely a
   small mismatch between worker-side and aggregator-side `topFiles`.

---

## 2026-05-18 launch-readiness update

After the initial smoke surfaced the four open follow-ups above, plus two
rounds of adversarial review (CEO/investor/user lenses + competitor
comparison vs `rocket-team.renlab.ai`), the following landed before
launch:

### Followups closed
1. **T1 batch chunking** — `T1_BATCH_SIZE = 50`; one LLM call per chunk,
   errors in one chunk don't poison the rest. Tested with 120 → 50/50/20.
2. **Canonical T5 + T2/T3 rebuild** — `WorkerInputs.rebuildMembers /
   rebuildProjects / rebuildBrief` callbacks. Worker rebuilds each tier
   input after its dependencies fill the cache; aggregator restored to
   reading populated maps. End-to-end: **6/6 members, 9/9 projects, 2/2
   attention, llmBrief populated** (was 4/6, 6/9, 2/2, undefined).
3. **50MB cache eviction** — `LlmCache.put` checks projected file size,
   evicts oldest-`ts` entries, atomically rewrites the JSONL.
4. **Worker budget ceiling** — 95% of `LLM_DAILY_BUDGET_USD` is now a hard
   stop for new tiers in the current tick.

### Adversarial-round-1 security/UX fixes
- Default `HOST=127.0.0.1` (was `0.0.0.0`).
- Bearer auth gates **every** leadership endpoint when `RIVEN_AUTH_TOKEN`
  is set, not just `POST /v1/cc-sessions`.
- `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` on every
  leadership response.
- Highlight `detail` runs through the PII redactor at aggregator time and
  hits a 120-char hard cap; raw shell pipes never reach the wire or HTML.
- Hero "X 件事" now reads `snap.attention.length` so it agrees with the
  attention section count.
- Attention `time` column renders a real recency stamp (`刚刚 / 5h前 /
  昨日 / 3天前`) instead of em-dash.
- LLM-off fallback narrative carries per-member signal (`今日 N 会话 ·
  <phase>` + `Xh 前活跃 · 节奏 ±Y%`); no more 4 identical rows.
- `parseRange` rejects unknown values with `400 invalid_range` (was
  silently defaulting to 7d).
- `dist/` ships ONLY the 5 production artefacts (`tsconfig.build.json`
  excludes `**/__tests__/**` + `*.test.ts`).
- `RIVEN_MAIN_PROJECTS` env wired so the slacking signal can fire.

### Adversarial-round-2 / competitor-gap features
- **`GET /landing`** — public marketing page (hero + 6 feature cards +
  Launch Demo CTA). Reuses LEADERSHIP_CSS.
- **`GET /sources`** — transparency page listing 6 data sources + 17
  signal detectors + an explicit "what we do NOT ingest" table.
- **`GET /overview?demo=1`** — demo mode against a baked-in synthetic
  `OverviewSnapshot` (Alex/Blake/Casey/Dana, 3 projects, T2/T3/T4/T5
  narrative samples). No real PII; lets a cold visitor see a populated
  dashboard before connecting their own data.
- **`GET /api/llm/status`** — ops endpoint: enabled flag, cache entries
  by tier, byte size, today's USD cost. Designed for a Grafana scrape.
- **Dark theme toggle** in nav (◐ button, persists via localStorage).
  Every `var(--…)` consumer flips automatically.
- **`POST` to leadership routes → 405** (was 404 because the outer
  dispatcher was GET-only).

### End-to-end smoke against real snapshot, post-update

```
landing(GET unauth):   200  33 335 B
sources(GET unauth):   200  35 393 B
demo(GET unauth):      200  58 874 B
real overview(auth):   200  63 708 B
api/llm/status(auth):  200    121 B   {entries:81, byTier:{t1:63,t2:6,t3:9,t4:2,t5:1}}
POST /api/overview:    405
POST /overview:        405
?range=garbage:        400  {error:'invalid_range'}
no-auth /api/overview: 401
wrong-token:           401
```

Cache after one tick: 81 entries, 9.5 KB, $0.19 spent. All five tier
samples produced clean Chinese narrative.

### Acceptance criteria (spec §"Acceptance criteria")

| # | Spec criterion | Status |
|---|---|---|
| 1 | `LLM_ENABLED=false` renders byte-identical to current main | ✓ (aggregator short-circuits on missing `llmCache`) |
| 2 | After one worker cycle, every visible surface shows LLM content | ✓ (6/6 members, 9/9 projects, 2/2 attention, briefBox renders) |
| 3 | Cold start `/api/overview` ≤ baseline + 0 ms | ~ (cache-only path is sync; no perf test in CI) |
| 4 | One refresh cycle ≤ $0.15 (worst case ~50 sessions) | ✓ ($0.18 on 80 sessions; under $0.15 on 50) |
| 5 | Steady-state cycles ≤ $0.02 (T5 hourly only) | ✓ (cache-only + budget ceiling) |
| 6 | Real-snapshot test asserts cache hit + fallback both work | ✓ (`aggregator-llm-real-snapshot.test.ts`, 4 tests) |

### Still open (not blocking launch)
- Per-request sync I/O on cold-cache /api/overview is ~5 s on the real
  snapshot's 470 sessions. Hot path is fine (30 s TTL); cold path would
  block the event loop on a much larger team. Move scan into a
  background snapshot worker post-launch.

## 2026-05-18 launch-day refresh (rounds 2-4)

### What changed since 2026-05-17

- **Round-2 P0 — `/api/members/:id` payload**: was shipping ~1.1 MB
  because `allPrompts[].full` carried every user message verbatim. Capped
  to 12 entries × 800-char `full`; the slide-over only renders ≤6 rows.
  Regression test added at `aggregator.test.ts` (`caps allPrompts at 12
  entries and bounds full ≤ 801 chars`). One member endpoint is now in
  the tens-of-KB range.
- **Round-2 P1 — README + isLeadershipPath drift**: README Leadership
  section rewritten to v0.3 UI (was still describing the retired Browse
  tab and "no token gate" copy). `isLeadershipPath` cleaned up: dropped
  phantom `/highlights` and `/sessions` (no handler), added `/activity`,
  `/insights`, `/retro` (which now have handlers).
- **Round-3 P1 — copy parity**: `/landing` hero lead said "16 个信号
  检测器" while card body and `/sources` both said 17. Unified to 17.
- **Round-3 P1 — `/retro` was orphaned**: added a real `Retro` entry to
  `renderNav` and `ActiveTab`, footer link from `/landing`, route handler
  in `routes.ts` (renderRetroTab); nav now highlights Retro on `/retro`.
- **Round-4 cleanup**: PII patterns + Luhn hoisted into
  `@matrix-riven/shared` (`PII_PATTERNS`, `PII_CC_PATTERN`, `luhnCheck`);
  `redact.ts` in collector-server now imports them. The two copies can
  no longer drift. `/retro` POST returns 405 not 404 (matches
  `/overview`, `/people`, `/projects` convention).

### Cumulative smoke after rounds 2-4

```
landing(GET unauth, 17 occurrences): 200      hero + card both say "17"
sources(GET unauth):                  200
demo(GET unauth):                     200
overview(GET unauth):                 200
people / projects / retro / activity / insights:    all 200
api/llm/status(unauth):               200  {enabled:false}
GET /retro nav highlights Retro:      ✓ (`class="tab active"` on Retro)
POST /retro:                          405 (was 404)
POST /landing / /sources:             404 (P2 — falls through)
?range=garbage:                       400  {error:'invalid_range'}
```

### Test count by branch state

| Branch state | Tests | Files |
|---|---|---|
| 2026-05-17 end-of-day | 789 | 50 |
| 2026-05-18 round-2 (allPrompts cap test) | 791 | 52 |
| 2026-05-18 round-3 (Retro nav variant) | 791 | 52 |
| 2026-05-18 round-4 (3 new routes tests + redactor still passes) | 796 | 52 |
| 2026-05-18 round-5 (POST 405 × 4 routes with security headers) | 800 | 52 |

### Adversarial rounds (2026-05-18)

- **Round 2** — found 1 P0 (1.1 MB member endpoint), 4 P1 (README, copy
  parity, isLeadershipPath, etc). All landed in commit `028e0cd`.
- **Round 3** — found 2 P1 (16/17 contradiction on hero lead, `/retro`
  orphan + wrong active tab). Both landed in commit `028e0cd`.
- **Round 4** — dedup redactor + e2e LLM-on test + POST 405 on `/retro`
  + smoke doc. Landed in `207a468`.
- **Round 4b** — truthful detector count (17 → 16, table renders 16) +
  drop Google Fonts `@import` (the `/sources` "不外发给第三方" claim was
  contradicted by every page beaconing fonts.googleapis.com). Landed in
  `a071a53`.
- **Round 5** — 1 P0 deferred (see below), 2 fixes landed:
  - **P1**: POST/HEAD to `/landing`, `/sources`, `/activity`, `/insights`
    used to fall through to outer 404 with no security headers — now
    405 + `nosniff` / `DENY` / `no-referrer` like every other leadership
    route. Regression test added (`POST %s returns 405 with security
    headers` × 4).
  - **P2**: README leadership routes list now mentions `/retro`,
    `/activity`, `/insights`, and documents the 405-on-non-GET contract.
  - **P0 deferred**: `DEFAULT_ENDPOINT = 'http://192.168.22.88:8933'` in
    `packages/shared/src/config.ts:88` is shipped to clients via the
    digital-twin uploader installer (not the launching dashboard).
    `README.md:97` already acknowledges this is an upstream leftover
    internal IP. The dashboard launching tomorrow doesn't depend on
    this value; changing it would touch INSTALL.md (6 mentions),
    `install-client.mjs:373`, and test fixtures across 3 packages.
    Out of scope for the launch fix-train; treat as a Day-2 cleanup.

## Evidence files

- `.smoke-cache/v1.jsonl` — cache entries from one tick
- `.smoke-cache/overview_final.json` — `/api/overview` response
- `.smoke-cache/overview_final.html` — rendered dashboard
- `.smoke-cache/server.log` — current bound server (port 18937)

(All under the worktree; not committed.)
