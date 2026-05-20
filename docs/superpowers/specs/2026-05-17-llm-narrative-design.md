# LLM Narrative Layer — Design Spec

**Date:** 2026-05-17
**Goal:** Translate dashboard's numeric/event signals into leader-readable narrative
using the user's local Claude Code subscription as the LLM API. Replace template
fallback strings with model-authored one-liners where it materially raises info
density. Never block render; always cache; budget-bounded.

## Background — concrete density failures we're solving

Live `/api/overview` shows: 4 KPI cards (2 empty / 1 boilerplate), 4 People rows
all displaying identical "0 会话 / 在做 — / 推进新功能 / ↘ 近期已收尾", 9 projects
mostly tagged "推进新功能 · 近期已收尾", 10 highlights pasting raw shell
pipelines (`git push origin ... 2>&1 | tail -4`). No team-level story anywhere.

## Architecture

### Tiers

| Tier | Output | Input | Batch | Cache TTL | Model |
|---|---|---|---|---|---|
| T1 session digest | 1 line ≤15 字 | first user prompt + 3 changed files + tool counts | 50 sessions/call | forever (keyed on `sessionId+endTs`) | haiku |
| T2 member-week | 2 lines | weekly T1 list + topFiles + state | all members/call | 4h | haiku |
| T3 project-week | 2 lines | weekly T1 list scoped to project | all projects/call | 4h | haiku |
| T4 attention rewrite | 1 line urgent | T1 + risky-actions snippet + warnings | all attention/call | until evidence changes | haiku |
| T5 daily brief | 3 lines | top highlights + attention + top projects T3 | 1 call | 1h | sonnet |

### Local Claude subscription as API

Spawn `claude -p` with these flags:
```
--tools ""                                   # no agentic loop needed, just completion
--system-prompt "<terse summarizer prompt>"
--no-session-persistence
--disable-slash-commands
--output-format json
--model claude-haiku-4-5-20251001            # T1-T4; T5 swaps to claude-sonnet-4-6
```
Auth: subscription via OS keychain (do NOT pass `--bare` — it disables keychain).

Parse stdout JSON, extract `.result` (the answer string), `.total_cost_usd`,
`.is_error`, `.duration_ms`. On error log + return undefined → caller uses
template fallback.

### Cost discipline

- **Batch hard**: each tier issues ≤1 LLM call per refresh cycle by packing
  many items into a JSON array request. Empirically `~$0.017` fixed overhead
  per call dwarfs marginal token cost; batching is the only way to scale.
- **Cache aggressively**: T1 is keyed by `sha1(sessionId+endTs)` — once a session
  ends, its summary never re-computes. T2/T3/T4 cache by `sha1` of their packed
  input list, so unchanged inputs → free reads. T5 by date+top-N-hash.
- **Background only**: every LLM call runs in the background scan worker.
  `/api/overview` reads cache, never blocks on LLM.
- **Budget gate**: `LLM_DAILY_BUDGET_USD` default $5. Worker tracks running
  daily cost; once exceeded, skip remaining calls and log.

### Privacy

Pre-LLM redaction via existing `packages/shared/src/pii/redactor.ts`. We strip
emails, secrets, absolute paths, private IPs before constructing prompts.
Subscription auth stays on the host machine; same trust boundary as the rest of
the dashboard (which already reads the same transcripts). No outbound network
beyond what `claude -p` itself makes.

### File layout

```
packages/collector-server/src/leadership/
  llm/
    local-claude-client.ts    # spawn + JSON parse + error handling
    cache.ts                  # disk JSONL + in-memory Map
    redact.ts                 # thin wrapper over shared/pii/redactor
    summarizer.ts             # tier orchestration + composition
    worker.ts                 # background loop
    prompts/
      t1-session.ts
      t2-member.ts
      t3-project.ts
      t4-attention.ts
      t5-brief.ts
    __tests__/
      *.test.ts
  types.ts                    # add llmText fields
  transcript-loader.ts        # no change to parse path; worker reads externally
  aggregator.ts               # read cache → attach llmText fields
  views/_overview-fragments.ts# prefer llmText over template fallback
  views/_slideover.html.ts    # use member.llmWeekly when present
  index.ts                    # start worker on boot (if enabled)
```

### Cache file

`~/.matrix-riven/llm-cache/v1.jsonl` — JSON-lines `{key, value, costUsd, ts}`.
Append-only; loaded into a Map at startup. On startup the loader compacts duplicates
(last-write-wins per key). Max disk size soft-capped at 50MB; oldest keys evicted
on overflow.

### Rendering surface

| Current | Replaced by |
|---|---|
| Hero greeting | hero unchanged + new `briefBox` below it with T5 (3 lines) |
| Attention `line2` template "卡在 status/page.tsx" | T4 rewrite if cached, else current template |
| Member tile sub-line "推进新功能 · ↘ 近期已收尾" | T2 sentence 1 if cached |
| Project narrative line 2 (file/user/time) | T3 sentence 1 if cached |
| Highlight detail (raw command) | T1 of that session if cached, else first 80 chars |
| Slide-over callout | T2 (member) / T3 (project) if cached |

### Opt-out / config

- `LLM_ENABLED` env: `false` disables module entirely (worker not started, all
  fields stay undefined, templates render as today).
- `LLM_DAILY_BUDGET_USD` env: default `5`.
- `LLM_TIER1_MODEL` / `LLM_TIER5_MODEL` env: overrides for testing.
- Worker is OFF by default in unit tests; explicit `startWorker({enabled})` API.

### Acceptance criteria

1. With `LLM_ENABLED=false`, dashboard renders byte-identical to current main.
2. With `LLM_ENABLED=true`, after one worker cycle:
   - All visible Member rows show a T2-derived sentence.
   - All visible Project rows show a T3-derived sentence.
   - Top 3 Highlights show T1 rather than raw commands.
   - Attention items show T4 rewrites.
   - Hero shows a 3-line T5 brief.
3. Cold start `/api/overview` latency ≤ existing baseline + 0ms (cache-only path).
4. Cost per refresh cycle (all tiers, ~50 new sessions worst case) ≤ $0.15.
5. Repeated worker cycles with no new data ≤ $0.02 (T5 hourly only).
6. Real-snapshot test asserts cache hit path + fallback path both work.
