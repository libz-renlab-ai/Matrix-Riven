# LLM Narrative Layer — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-05-17-llm-narrative-design.md`
**Toolchain:** TypeScript / Node ≥22 / Vitest / pnpm

## Wave 1 (parallel, independent)

### L-1 · LLM client (`llm/local-claude-client.ts`)
Spawn `claude -p` with `--tools "" --system-prompt … --no-session-persistence
--disable-slash-commands --output-format json --model <m>`. Pipe `userPrompt` to
stdin. Parse stdout, extract `{result, costUsd, durationMs, ok, error}`. Throttle
to max 1 concurrent call (mutex). Timeout 60s.

Tests:
- Mock `child_process.spawn`; assert flags built correctly per options.
- Stdout JSON success path → returns `result`.
- `is_error:true` → returns `{ok:false, error}`.
- Stdin written then closed.
- Timeout kicks in on hang.

### L-2 · Cache (`llm/cache.ts`)
Disk JSONL at `~/.matrix-riven/llm-cache/v1.jsonl`. API:
```ts
load(): Promise<void>  // populate in-mem Map
get(key: string): string | undefined
put(key: string, value: string, costUsd: number): Promise<void>  // append + Map set
stats(): { entries: number; bytes: number; todayCostUsd: number }
```
Compaction on load (last-write-wins). Per-day cost accounting via `ts` field.

Tests:
- Round-trip get/put.
- Compaction merges duplicate keys.
- `todayCostUsd` sums today's entries by ts.

### L-3 · Redactor (`llm/redact.ts`)
Thin wrapper over `packages/shared/src/pii/redactor.ts`. Export
`redactForLLM(s: string): string` that replaces matches with their kind tag
(`<email>`, `<path>`, `<secret>` …). Tests: roundtrip on representative inputs.

### L-4 · Prompts (`llm/prompts/*.ts`)
Five files exporting `buildPrompt(input) → {system, user, model}` for each tier.
Each prompt must instruct strict JSON output (array of `{id, line}` or
`{briefLines: [...]}`). Include 1–2 few-shot examples. Hard-cap line length in
the instruction. No tests beyond snapshot of one prompt string.

### L-5 · Types (`types.ts` patch)
Add optional fields:
- `MemberSnapshot.llmWeekly?: string` (2-line `\n` joined)
- `ProjectSnapshot.llmWeekly?: string`
- `HighlightEvent.llmDigest?: string` (1 line, replaces raw command)
- `AttentionItem.llmRewrite?: string`
- `OverviewSnapshot.llmBrief?: string[]` (3 lines)

No tests; type-only change.

### L-6 · Config (`llm/config.ts`)
Read env: `LLM_ENABLED` (default `false` — opt-in), `LLM_DAILY_BUDGET_USD`
(default `5`), `LLM_TIER1_MODEL` (default `claude-haiku-4-5-20251001`),
`LLM_TIER5_MODEL` (default `claude-sonnet-4-6`), `LLM_CACHE_DIR` (default
`$HOME/.matrix-riven/llm-cache`). Pure-function `readConfig(env)` for testability.

## Wave 2 (after Wave 1)

### L-7 · Summarizer (`llm/summarizer.ts`)
Five exported async functions:
```ts
summarizeSessions(sessions, ctx) → Map<sessionId, string>
summarizeMembers(memberInputs, ctx) → Map<email, string>
summarizeProjects(projectInputs, ctx) → Map<name, string>
summarizeAttention(items, ctx) → Map<refId, string>
summarizeDailyBrief(briefInput, ctx) → string[]
```
Each:
1. For each input compute cache key → split into hit/miss.
2. If all hits → return map of cached values, no LLM call.
3. Else build single batched prompt with miss items, call `localClaudeClient.run`.
4. Parse JSON response; for each result, validate then `cache.put`.
5. Return composed map (hits + new).

Tests: mock client; verify (a) all-hit short-circuit, (b) misses get batched,
(c) malformed JSON falls back to per-item undefined without throwing.

## Wave 3 (after Wave 2, parallel)

### L-8 · Aggregator integration (`aggregator.ts`)
After existing snapshot composition, before serialization, read cache via
`summarizer` synchronously (cache-only mode flag — no LLM calls) and attach
`llmText` fields. **Never** trigger LLM from this path — only the worker does.

Tests:
- With empty cache: snapshot equals current behavior.
- With pre-populated cache: snapshot includes llmText fields on right entities.

### L-9 · Worker (`llm/worker.ts`)
```ts
startWorker({getSnapshot, intervalMs, cfg}) → stopFn
```
On interval:
1. `getSnapshot()` → current snapshot + sessions.
2. Call `summarizer.summarizeSessions` on all sessions (cache fills).
3. Call `summarizeMembers`, `summarizeProjects`, `summarizeAttention`.
4. Every Nth tick (~hourly) call `summarizeDailyBrief`.
5. Respect `LLM_DAILY_BUDGET_USD` — abort cycle if exceeded.

Tests: mock summarizer; assert call ordering, budget gate, interval.

### L-10 · View integration
- `views/_overview-fragments.ts`: prefer `member.llmWeekly` over phase/trend
  template; prefer `project.llmWeekly` over project narrative line 2; prefer
  `highlight.llmDigest` over `detail` field; prefer `attention.llmRewrite`
  over `line2`.
- `views/_overview-fragments.ts` (hero): if `snapshot.llmBrief?.length`,
  render a 3-line `briefBox` between hero text and KPI row.
- `views/_slideover.html.ts`: prefer `llmWeekly` in callout.

Tests: render with/without llm fields, verify swap behavior.

### L-11 · Boot integration (`index.ts` + `routes.ts`)
- `index.ts`: after server starts, if `cfg.enabled` call `cache.load()` then
  `startWorker(...)`. Stop on shutdown signal.
- `routes.ts`: no change needed (snapshot already includes llm fields).

Tests: covered by aggregator + worker tests.

## Wave 4 (after Wave 3)

### L-12 · Real-snapshot validation test
Skip-if-no-real-data test that:
1. Loads real envelopes via `loadEnvelopes()`.
2. Builds snapshot.
3. Asserts snapshot fields are present with correct types when cache is empty
   (no LLM fields) and when cache is pre-seeded.

### L-13 · Manual smoke
Boot server with `LLM_ENABLED=true`, wait for one worker cycle, hit `/`, screenshot
showing T1–T5 rendering. Document in
`docs/superpowers/smoke/2026-05-17-llm-narrative-smoke.md`.

## Out of scope (not in this plan)

- Streaming LLM output (we always read final JSON).
- User-controlled "explain this row" button (Phase 4 idea).
- Cross-week trend narratives.
- Auto-prompt-tuning.
