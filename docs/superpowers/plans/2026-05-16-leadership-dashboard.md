# Leadership Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the collector-server Overview tab into a leadership dashboard with three-KPI first screen, member detail pages, and project detail pages; serve 18 member signals + 14 project signals computed from existing transcript snapshots.

**Architecture:** New `packages/collector-server/src/leadership/` module with pure-function signal computers, a single in-memory aggregator with 30s TTL, and server-rendered HTML pages styled as Modern Card (浅色 SaaS). Reads from `RIVEN_COLLECTOR_DIR` via existing `overview/disk-scan.ts`. Read-only — never writes back. Port 6066 by default for demo.

**Tech Stack:** TypeScript, Node ≥22.5, Vitest, tsup (existing toolchain). Zero new runtime deps. Pure server-rendered HTML + minimal vanilla JS for auto-refresh.

**Spec:** [`docs/superpowers/specs/2026-05-16-leadership-dashboard-design.md`](../specs/2026-05-16-leadership-dashboard-design.md)

**Conventions:**
- Test files live at `<dir>/__tests__/<name>.test.ts` (existing pattern; see `packages/shared/src/cc-status/__tests__/store.test.ts`)
- Import style: `import { ... } from '@matrix-riven/shared'` for cross-package, relative path within package
- Commit per task. Never amend. Never push. Never `--no-verify`.
- Run tests from worktree root: `pnpm --filter @matrix-riven/collector-server test -- <path>`
- No emoji in code; emoji in user-facing HTML OK (matches existing Overview tab)

---

## Milestone 1 — Foundation (Tasks 1-3)

### Task 1: Types & interfaces

**Files:**
- Create: `packages/collector-server/src/leadership/types.ts`

- [ ] **Step 1: Create the types module**

```typescript
// packages/collector-server/src/leadership/types.ts

/**
 * Parsed shape of one cc-session envelope-on-disk, with the gzipped+base64
 * transcript decoded back into a JSONL message stream. Pure data — no I/O.
 * Built once per session by transcript-loader.ts and consumed by every
 * signal computer in leadership/signals/.
 */
export interface ParsedSession {
  envelope: ParsedEnvelope;
  l1RedactionCount: number;
  messages: ParsedMessage[];
  /** First-message ts → last-message ts, in ms. 0 if undecidable. */
  durationMs: number;
  /** First message ts. Falls back to envelope.captured_at on parse trouble. */
  startTs: Date;
  /** Last message ts. */
  endTs: Date;
  /** First non-null model seen in messages (proxy for "the model used"). */
  model?: string;
  tokens: { input: number; output: number; cacheRead: number; cacheCreation: number };
}

export interface ParsedEnvelope {
  id: string;
  userId: string;
  machineId: string;
  sessionId: string;
  cwd: string;
  projectName: string;          // populated; falls back to cwd-last-segment if envelope.project_name empty
  capturedAt: string;
  rivenVersion: string;
  consentedAt: string | null;
}

export type ParsedMessageRole = 'user' | 'assistant' | 'tool';

export interface ParsedMessage {
  role: ParsedMessageRole;
  ts?: Date;
  /** Plain text content (user/assistant). Empty string when only tool-use. */
  text: string;
  /** Tool calls the assistant invoked in this message. */
  toolUses: ParsedToolUse[];
  /** Tool results returned (role === 'tool' OR embedded inside a user message). */
  toolResults: ParsedToolResult[];
  /** Token usage on this message, if reported by the API response. */
  tokens?: { input?: number; output?: number; cacheRead?: number; cacheCreation?: number };
  /** Model id, if reported. */
  model?: string;
}

export interface ParsedToolUse {
  name: string;            // 'Bash', 'Edit', 'Read', 'WebSearch', etc.
  input: Record<string, unknown>;
}

export interface ParsedToolResult {
  toolUseId?: string;
  isError: boolean;
  /** Concatenated text content. May be very large; signals should sample, not iterate fully when avoidable. */
  text: string;
}

// =====================================================================
// Signal output shapes — what aggregator.ts assembles for HTTP responses
// =====================================================================

export type SignalLevel = 'strong' | 'medium' | 'weak';
export type MemberStateBadge = 'active' | 'quiet' | 'stuck' | 'needs_help' | 'low_activity';
export type ProjectState = 'active' | 'maintaining' | 'dormant' | 'revived';
export type ProjectPhase = 'implement' | 'debug' | 'refactor' | 'test' | 'docs' | 'plan' | 'mixed';

export interface MemberSnapshot {
  email: string;
  displayName: string;           // email local-part
  stateBadge: MemberStateBadge;
  today: { sessions: number; tokens: number; estMinutes: number; costUsd: number };
  trend7d: number[];             // length 7, oldest first; sessions per day
  deltaVs7dAvgPct: number;       // (-1, +∞)
  warnings: string[];            // short strings shown next to the avatar
  topProject?: string;           // most-active project today; undefined if none
  // Detail-page-only fields below; aggregator includes them for /api/members/:id
  detail?: MemberDetail;
}

export interface MemberDetail {
  toolFailureRate: number;
  overContext200kCount: number;
  iterationDensity: number;      // mean user-msgs per "task"
  riskyActions: RiskyAction[];
  collaborators: CollaboratorHit[];
  modelMix: Record<string, number>; // model → token share
  webResearchCount: number;
  sessions: SessionSummary[];
  heatmap7x24: number[][];       // 7 rows × 24 cols; tokens
  topFiles: { path: string; edits: number }[];
}

export interface RiskyAction {
  ts: string;
  sessionId: string;
  pattern: 'rm -rf' | 'force push' | 'reset --hard' | 'drop table' | 'other';
  snippet: string;
}

export interface CollaboratorHit {
  withEmail: string;
  sharedFiles: string[];
}

export interface SessionSummary {
  sessionId: string;
  capturedAt: string;
  projectName: string;
  totalTokens: number;
  /** First user prompt, truncated to 200 chars (the L1-privacy preview). */
  firstPromptPreview: string;
  firstPromptFull: string;       // included so the UI can do client-side expand without another fetch
}

export interface ProjectSnapshot {
  name: string;
  state: ProjectState;
  contributors: { email: string; sharePct: number }[];
  busFactorWarning: boolean;     // top contributor share > 0.7
  trend7d: number[];             // 7 entries, sessions per day
  phaseGuess: ProjectPhase;
  healthScore: number;           // 0-10
  etaDays: number | null;        // null = insufficient data
  etaConfidence: 'low';          // always 'low' per spec
  detail?: ProjectDetail;
}

export interface ProjectDetail {
  todayFiles: string[];
  weekFiles: string[];
  extensionMix: Record<string, number>;
  testRatio: number;             // edits to test files / edits to source
  milestones: Milestone[];
  webResearchShare: number;
  heatmap7x24: number[][];
  recentFiles: { path: string; touches: number }[];
}

export interface Milestone {
  ts: string;
  type: 'commit' | 'push' | 'pr' | 'release' | 'tag';
  by: string;                    // member email
  detail: string;                // e.g., command snippet
}

export interface CollabHit {
  filePath: string;
  members: string[];
  lastTouched: string;
}

export interface KpiCards {
  teamActivity: { value: number; deltaVsAvg: number };
  attention: { value: number; deltaToday: number; breakdown: { stuck: number; needsHelp: number; riskyAction: number } };
  projects: { active: number; maintaining: number; dormant: number };
}

export interface OverviewSnapshot {
  schemaVersion: 1;
  range: { start: string; end: string; label: string };
  computedAt: string;
  kpis: KpiCards;
  members: MemberSnapshot[];
  projects: ProjectSnapshot[];
  collaboration: CollabHit[];
}

// =====================================================================
// Range / query types
// =====================================================================

export type RangeLabel = 'today' | '24h' | '7d' | '30d' | 'custom';

export interface DateRange {
  start: Date;
  end: Date;
  label: RangeLabel | string;
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `pnpm --filter @matrix-riven/collector-server exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/collector-server/src/leadership/types.ts
git commit -m "feat(leadership): types module"
```

---

### Task 2: In-memory TTL cache

**Files:**
- Create: `packages/collector-server/src/leadership/cache.ts`
- Test: `packages/collector-server/src/leadership/__tests__/cache.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/collector-server/src/leadership/__tests__/cache.test.ts
import { describe, it, expect, vi } from 'vitest';
import { TtlCache } from '../cache.js';

describe('TtlCache', () => {
  it('returns cached value within TTL', () => {
    const now = vi.fn(() => 0);
    const c = new TtlCache<string>(30_000, now);
    c.set('k', 'hello');
    now.mockReturnValue(29_000);
    expect(c.get('k')).toBe('hello');
  });

  it('returns undefined after TTL', () => {
    const now = vi.fn(() => 0);
    const c = new TtlCache<string>(30_000, now);
    c.set('k', 'hello');
    now.mockReturnValue(30_001);
    expect(c.get('k')).toBeUndefined();
  });

  it('overwrite resets TTL', () => {
    const now = vi.fn(() => 0);
    const c = new TtlCache<string>(30_000, now);
    c.set('k', 'a');
    now.mockReturnValue(20_000);
    c.set('k', 'b');
    now.mockReturnValue(40_000);
    expect(c.get('k')).toBe('b');
  });

  it('different keys are independent', () => {
    const c = new TtlCache<string>(30_000);
    c.set('a', '1');
    c.set('b', '2');
    expect(c.get('a')).toBe('1');
    expect(c.get('b')).toBe('2');
  });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `pnpm --filter @matrix-riven/collector-server test -- cache.test`
Expected: FAIL (`Cannot find module '../cache.js'`)

- [ ] **Step 3: Implement**

```typescript
// packages/collector-server/src/leadership/cache.ts

/**
 * Process-local TTL cache. Used by the leadership aggregator so that
 * many polling clients refreshing every 30s only trigger one disk-scan
 * per window. Not concurrent-safe across processes; collector-server
 * is a single Node process so that's fine.
 */
export class TtlCache<T> {
  private store = new Map<string, { value: T; expiresAt: number }>();
  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (this.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  clear(): void {
    this.store.clear();
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @matrix-riven/collector-server test -- cache.test`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/collector-server/src/leadership/cache.ts packages/collector-server/src/leadership/__tests__/cache.test.ts
git commit -m "feat(leadership): TtlCache (30s in-memory, single-process)"
```

---

### Task 3: Transcript loader

**Files:**
- Create: `packages/collector-server/src/leadership/transcript-loader.ts`
- Test: `packages/collector-server/src/leadership/__tests__/transcript-loader.test.ts`
- Reference: `packages/collector-server/src/overview/disk-scan.ts` (existing; we reuse its scanning, not its parsing)

- [ ] **Step 1: Inspect existing disk-scan to confirm reusable shape**

Run: `grep -n "export" packages/collector-server/src/overview/disk-scan.ts`
Expected: at least one exported scan function returning a list of envelope file paths grouped by user/date.

If the export shape doesn't match, write a thin wrapper in this task; do not modify the existing module.

- [ ] **Step 2: Write the failing test**

```typescript
// packages/collector-server/src/leadership/__tests__/transcript-loader.test.ts
import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { parseEnvelopeBuffer } from '../transcript-loader.js';

function buildEnvelope(transcriptLines: string[]): Buffer {
  const jsonl = transcriptLines.join('\n');
  const gz = gzipSync(Buffer.from(jsonl, 'utf8')).toString('base64');
  const env = {
    schema_version: 1,
    envelope: {
      id: 'eid',
      user_id: 'liu@example.com',
      machine_id: 'host-abc',
      session_id: 'sid-1',
      cwd: '/home/u/proj/Matrix-Riven',
      project_name: 'Matrix-Riven',
      transcript_path: '/home/u/.claude/projects/.../sid-1.jsonl',
      payload_size: jsonl.length,
      captured_at: '2026-05-13T10:00:00.000Z',
      source: 'stop-hook',
      host: { os: 'linux', arch: 'x64', hostname: 'host' },
      riven_version: '0.1.0',
      consented_at: null,
    },
    transcript: { compression: 'gzip+base64', content: gz },
    l1_redaction_count: 2,
  };
  return Buffer.from(JSON.stringify(env), 'utf8');
}

describe('parseEnvelopeBuffer', () => {
  it('parses a minimal envelope with one user message', () => {
    const buf = buildEnvelope([
      JSON.stringify({
        type: 'user',
        timestamp: '2026-05-13T10:00:05.000Z',
        message: { role: 'user', content: 'hello' },
      }),
    ]);
    const parsed = parseEnvelopeBuffer(buf);
    expect(parsed).not.toBeNull();
    expect(parsed!.envelope.projectName).toBe('Matrix-Riven');
    expect(parsed!.envelope.userId).toBe('liu@example.com');
    expect(parsed!.l1RedactionCount).toBe(2);
    expect(parsed!.messages).toHaveLength(1);
    expect(parsed!.messages[0]!.role).toBe('user');
    expect(parsed!.messages[0]!.text).toBe('hello');
  });

  it('extracts tool use and tool result', () => {
    const buf = buildEnvelope([
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-05-13T10:00:10.000Z',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [
            { type: 'text', text: 'I will run bash' },
            { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } },
          ],
          usage: { input_tokens: 100, output_tokens: 20 },
        },
      }),
      JSON.stringify({
        type: 'user',
        timestamp: '2026-05-13T10:00:11.000Z',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tu1', is_error: false, content: 'a.txt\nb.txt' }],
        },
      }),
    ]);
    const parsed = parseEnvelopeBuffer(buf)!;
    expect(parsed.messages[0]!.toolUses).toEqual([{ name: 'Bash', input: { command: 'ls' } }]);
    expect(parsed.messages[1]!.toolResults).toEqual([{ toolUseId: 'tu1', isError: false, text: 'a.txt\nb.txt' }]);
    expect(parsed.model).toBe('claude-sonnet-4-6');
    expect(parsed.tokens.input).toBe(100);
    expect(parsed.tokens.output).toBe(20);
  });

  it('returns null on malformed JSON', () => {
    expect(parseEnvelopeBuffer(Buffer.from('not json'))).toBeNull();
  });

  it('returns null on missing transcript block', () => {
    const env = { schema_version: 1, envelope: { user_id: 'x' } };
    expect(parseEnvelopeBuffer(Buffer.from(JSON.stringify(env)))).toBeNull();
  });

  it('computes startTs/endTs/durationMs from message timestamps', () => {
    const buf = buildEnvelope([
      JSON.stringify({ type: 'user', timestamp: '2026-05-13T10:00:00.000Z', message: { role: 'user', content: 'a' } }),
      JSON.stringify({ type: 'user', timestamp: '2026-05-13T10:05:00.000Z', message: { role: 'user', content: 'b' } }),
    ]);
    const p = parseEnvelopeBuffer(buf)!;
    expect(p.startTs.toISOString()).toBe('2026-05-13T10:00:00.000Z');
    expect(p.endTs.toISOString()).toBe('2026-05-13T10:05:00.000Z');
    expect(p.durationMs).toBe(5 * 60 * 1000);
  });
});
```

- [ ] **Step 3: Run test, verify fail**

Run: `pnpm --filter @matrix-riven/collector-server test -- transcript-loader.test`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement**

```typescript
// packages/collector-server/src/leadership/transcript-loader.ts
import { gunzipSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import type {
  ParsedSession,
  ParsedEnvelope,
  ParsedMessage,
  ParsedToolUse,
  ParsedToolResult,
} from './types.js';

/**
 * Parse one on-disk envelope JSON (the format collector-server writes).
 * Returns null when the envelope is unparseable; callers skip-and-continue
 * because one corrupt file must not stop the scan.
 */
export function parseEnvelopeBuffer(buf: Buffer): ParsedSession | null {
  let raw: unknown;
  try {
    raw = JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const envBlock = obj.envelope as Record<string, unknown> | undefined;
  const tBlock = obj.transcript as { compression?: string; content?: string } | undefined;
  if (!envBlock || !tBlock || typeof tBlock.content !== 'string') return null;

  let jsonl: string;
  try {
    jsonl = gunzipSync(Buffer.from(tBlock.content, 'base64')).toString('utf8');
  } catch {
    return null;
  }

  const envelope: ParsedEnvelope = {
    id: str(envBlock.id, 'unknown'),
    userId: str(envBlock.user_id, 'unknown'),
    machineId: str(envBlock.machine_id, 'unknown'),
    sessionId: str(envBlock.session_id, 'unknown'),
    cwd: str(envBlock.cwd, ''),
    projectName: str(envBlock.project_name, '') || cwdLastSegment(str(envBlock.cwd, '')),
    capturedAt: str(envBlock.captured_at, new Date(0).toISOString()),
    rivenVersion: str(envBlock.riven_version, 'unknown'),
    consentedAt: envBlock.consented_at == null ? null : String(envBlock.consented_at),
  };

  const messages: ParsedMessage[] = [];
  let firstTs: Date | undefined;
  let lastTs: Date | undefined;
  let firstModel: string | undefined;
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (!rec || typeof rec !== 'object') continue;
    const msg = parseMessageRecord(rec as Record<string, unknown>);
    if (!msg) continue;
    messages.push(msg);
    if (msg.ts) {
      if (!firstTs || msg.ts < firstTs) firstTs = msg.ts;
      if (!lastTs || msg.ts > lastTs) lastTs = msg.ts;
    }
    if (!firstModel && msg.model) firstModel = msg.model;
    if (msg.tokens) {
      tokens.input += msg.tokens.input ?? 0;
      tokens.output += msg.tokens.output ?? 0;
      tokens.cacheRead += msg.tokens.cacheRead ?? 0;
      tokens.cacheCreation += msg.tokens.cacheCreation ?? 0;
    }
  }

  const startTs = firstTs ?? new Date(envelope.capturedAt);
  const endTs = lastTs ?? startTs;

  return {
    envelope,
    l1RedactionCount: typeof obj.l1_redaction_count === 'number' ? obj.l1_redaction_count : 0,
    messages,
    durationMs: Math.max(0, endTs.getTime() - startTs.getTime()),
    startTs,
    endTs,
    model: firstModel,
    tokens,
  };
}

function parseMessageRecord(rec: Record<string, unknown>): ParsedMessage | null {
  // Accept either Claude Code's native JSONL ({type,message,timestamp})
  // or a raw message object. Be permissive — real data has both shapes.
  const ts = typeof rec.timestamp === 'string' ? new Date(rec.timestamp) : undefined;
  const inner = (rec.message as Record<string, unknown> | undefined) ?? rec;
  const roleRaw = String(inner.role ?? rec.type ?? '');
  let role: 'user' | 'assistant' | 'tool';
  if (roleRaw === 'assistant') role = 'assistant';
  else if (roleRaw === 'tool') role = 'tool';
  else role = 'user';

  const content = inner.content;
  let text = '';
  const toolUses: ParsedToolUse[] = [];
  const toolResults: ParsedToolResult[] = [];

  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const p = part as Record<string, unknown>;
      switch (p.type) {
        case 'text':
          text += (text ? '\n' : '') + String(p.text ?? '');
          break;
        case 'tool_use':
          toolUses.push({
            name: String(p.name ?? 'unknown'),
            input: (p.input as Record<string, unknown>) ?? {},
          });
          break;
        case 'tool_result': {
          const c = p.content;
          let resultText = '';
          if (typeof c === 'string') resultText = c;
          else if (Array.isArray(c)) {
            for (const x of c) {
              if (x && typeof x === 'object' && (x as Record<string, unknown>).type === 'text') {
                resultText += String((x as Record<string, unknown>).text ?? '');
              }
            }
          }
          toolResults.push({
            toolUseId: typeof p.tool_use_id === 'string' ? p.tool_use_id : undefined,
            isError: p.is_error === true,
            text: resultText,
          });
          break;
        }
      }
    }
  }

  const usage = inner.usage as Record<string, unknown> | undefined;
  const tokens = usage
    ? {
        input: numOrUndef(usage.input_tokens),
        output: numOrUndef(usage.output_tokens),
        cacheRead: numOrUndef(usage.cache_read_input_tokens),
        cacheCreation: numOrUndef(usage.cache_creation_input_tokens),
      }
    : undefined;

  return {
    role,
    ts,
    text,
    toolUses,
    toolResults,
    tokens,
    model: typeof inner.model === 'string' ? inner.model : undefined,
  };
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}
function numOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function cwdLastSegment(cwd: string): string {
  const parts = cwd.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? 'unknown';
}

// =====================================================================
// Disk scan — list every envelope under collectorDir, return parsed
// sessions. Uses streaming reads so a corrupt file does not abort.
// =====================================================================

export interface ScanOptions {
  /** Inclusive UTC date string YYYY-MM-DD. Files outside are skipped. */
  fromDate?: string;
  /** Inclusive UTC date string YYYY-MM-DD. */
  toDate?: string;
}

export function scanAllSessions(collectorDir: string, opts: ScanOptions = {}): ParsedSession[] {
  if (!existsSync(collectorDir)) return [];
  let users: string[];
  try {
    users = readdirSync(collectorDir);
  } catch {
    return [];
  }
  const out: ParsedSession[] = [];
  for (const userDir of users) {
    const userPath = path.join(collectorDir, userDir);
    let s: ReturnType<typeof statSync> | null;
    try {
      s = statSync(userPath);
    } catch {
      continue;
    }
    if (!s.isDirectory()) continue;

    let dateDirs: string[];
    try {
      dateDirs = readdirSync(userPath);
    } catch {
      continue;
    }
    for (const dateDir of dateDirs) {
      if (opts.fromDate && dateDir < opts.fromDate) continue;
      if (opts.toDate && dateDir > opts.toDate) continue;
      const datePath = path.join(userPath, dateDir);
      let files: string[];
      try {
        files = readdirSync(datePath);
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const filePath = path.join(datePath, f);
        let buf: Buffer;
        try {
          buf = readFileSync(filePath);
        } catch {
          continue;
        }
        const parsed = parseEnvelopeBuffer(buf);
        if (parsed) out.push(parsed);
      }
    }
  }
  return out;
}
```

- [ ] **Step 5: Run test, verify pass**

Run: `pnpm --filter @matrix-riven/collector-server test -- transcript-loader.test`
Expected: 5 passing.

- [ ] **Step 6: Commit**

```bash
git add packages/collector-server/src/leadership/transcript-loader.ts packages/collector-server/src/leadership/__tests__/transcript-loader.test.ts
git commit -m "feat(leadership): transcript-loader + envelope parser"
```

---

## Milestone 2 — Member Signals (Tasks 4-9)

> **Pattern for every signals/*.ts task:** each file exports pure functions taking `ParsedSession[]` (already filtered to the relevant range/member) and any options. Tests use small in-memory `ParsedSession` fixtures built via a shared helper. Do not introduce a shared fixture module yet — duplicate small fixtures per test file; we extract only if Milestone 2 ends with >3 copies.

### Task 4: signals/activity.ts (#6 #7 #9)

**Files:**
- Create: `packages/collector-server/src/leadership/signals/activity.ts`
- Test: `packages/collector-server/src/leadership/signals/__tests__/activity.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/collector-server/src/leadership/signals/__tests__/activity.test.ts
import { describe, it, expect } from 'vitest';
import { computeActivity, computeFocus, computeRhythmDelta } from '../activity.js';
import type { ParsedSession } from '../../types.js';

function mkSession(opts: { start: string; end: string; tokens?: number; cwd?: string }): ParsedSession {
  const startTs = new Date(opts.start);
  const endTs = new Date(opts.end);
  return {
    envelope: {
      id: 'e', userId: 'u', machineId: 'm', sessionId: 's' + opts.start,
      cwd: opts.cwd ?? '/x/Matrix-Riven',
      projectName: 'Matrix-Riven',
      capturedAt: opts.start,
      rivenVersion: '0.1', consentedAt: null,
    },
    l1RedactionCount: 0,
    messages: [],
    durationMs: endTs.getTime() - startTs.getTime(),
    startTs, endTs,
    tokens: { input: opts.tokens ?? 1000, output: 0, cacheRead: 0, cacheCreation: 0 },
  };
}

describe('computeActivity', () => {
  it('sums sessions/tokens and estimates minutes', () => {
    const sessions = [
      mkSession({ start: '2026-05-14T01:00:00Z', end: '2026-05-14T01:30:00Z', tokens: 2000 }),
      mkSession({ start: '2026-05-14T03:00:00Z', end: '2026-05-14T03:10:00Z', tokens: 500 }),
    ];
    const a = computeActivity(sessions);
    expect(a.sessions).toBe(2);
    expect(a.tokens).toBe(2500);
    expect(a.estMinutes).toBe(40);
  });

  it('truncates intra-session idle gaps at 30 min', () => {
    // A 90-min session counts as 30 min (one long idle gap inferred from
    // first-to-last only when continuous; here we pretend a long span)
    const s = mkSession({ start: '2026-05-14T00:00:00Z', end: '2026-05-14T03:00:00Z' });
    const a = computeActivity([s]);
    expect(a.estMinutes).toBeLessThanOrEqual(30);
  });
});

describe('computeFocus', () => {
  it('counts distinct cwds per day', () => {
    const sessions = [
      mkSession({ start: '2026-05-14T01:00:00Z', end: '2026-05-14T01:30:00Z', cwd: '/p/A' }),
      mkSession({ start: '2026-05-14T02:00:00Z', end: '2026-05-14T02:30:00Z', cwd: '/p/B' }),
      mkSession({ start: '2026-05-14T03:00:00Z', end: '2026-05-14T03:30:00Z', cwd: '/p/A' }),
    ];
    const f = computeFocus(sessions);
    expect(f.distinctCwdsToday).toBe(2);
    expect(f.avgSessionMinutes).toBe(30);
  });
});

describe('computeRhythmDelta', () => {
  it('returns positive delta when today exceeds 7d avg', () => {
    const today = [mkSession({ start: '2026-05-14T01:00:00Z', end: '2026-05-14T01:30:00Z', tokens: 10000 })];
    const past7 = [mkSession({ start: '2026-05-10T01:00:00Z', end: '2026-05-10T01:30:00Z', tokens: 1000 })];
    const d = computeRhythmDelta(today, past7);
    expect(d).toBeGreaterThan(0);
  });

  it('returns 0 when past7 has no data', () => {
    const today = [mkSession({ start: '2026-05-14T01:00:00Z', end: '2026-05-14T01:30:00Z', tokens: 5000 })];
    expect(computeRhythmDelta(today, [])).toBe(0);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `pnpm --filter @matrix-riven/collector-server test -- activity.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// packages/collector-server/src/leadership/signals/activity.ts
import type { ParsedSession } from '../types.js';

const MAX_GAP_MS = 30 * 60 * 1000;

/**
 * #6 — sessions / tokens / estimated minutes for this list of sessions.
 * estMinutes truncates each session's duration at 30 min (single-session
 * cap) to keep idle "background" sessions from inflating the number.
 */
export function computeActivity(sessions: ParsedSession[]): {
  sessions: number;
  tokens: number;
  estMinutes: number;
} {
  let tokens = 0;
  let ms = 0;
  for (const s of sessions) {
    tokens += s.tokens.input + s.tokens.output;
    ms += Math.min(s.durationMs, MAX_GAP_MS);
  }
  return { sessions: sessions.length, tokens, estMinutes: Math.round(ms / 60_000) };
}

/**
 * #7 — focus signal: distinct cwd switches and avg session length.
 */
export function computeFocus(sessions: ParsedSession[]): {
  distinctCwdsToday: number;
  avgSessionMinutes: number;
} {
  const cwds = new Set(sessions.map((s) => s.envelope.cwd));
  const totalMin = sessions.reduce((acc, s) => acc + Math.min(s.durationMs, MAX_GAP_MS) / 60_000, 0);
  const avg = sessions.length === 0 ? 0 : Math.round(totalMin / sessions.length);
  return { distinctCwdsToday: cwds.size, avgSessionMinutes: avg };
}

/**
 * #9 — rhythm delta: (today total token - past 7d daily avg) / past 7d daily avg.
 * Returns 0 when past7 is empty (no baseline).
 */
export function computeRhythmDelta(today: ParsedSession[], past7: ParsedSession[]): number {
  const todayTok = today.reduce((a, s) => a + s.tokens.input + s.tokens.output, 0);
  if (past7.length === 0) return 0;
  const pastTok = past7.reduce((a, s) => a + s.tokens.input + s.tokens.output, 0);
  const dailyAvg = pastTok / 7;
  if (dailyAvg === 0) return todayTok > 0 ? 1 : 0;
  return (todayTok - dailyAvg) / dailyAvg;
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @matrix-riven/collector-server test -- activity.test`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/collector-server/src/leadership/signals/activity.ts packages/collector-server/src/leadership/signals/__tests__/activity.test.ts
git commit -m "feat(leadership): activity/focus/rhythm signals"
```

---

### Task 5: signals/slacking.ts (#1)

**Files:**
- Create: `packages/collector-server/src/leadership/signals/slacking.ts`
- Test: `packages/collector-server/src/leadership/signals/__tests__/slacking.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/collector-server/src/leadership/signals/__tests__/slacking.test.ts
import { describe, it, expect } from 'vitest';
import { detectLowActivity } from '../slacking.js';
import type { ParsedSession } from '../../types.js';

function mk(start: string, tokens: number, cwd: string): ParsedSession {
  const s = new Date(start);
  return {
    envelope: { id: 'e', userId: 'u', machineId: 'm', sessionId: start, cwd, projectName: cwd.split('/').pop()!, capturedAt: start, rivenVersion: '0', consentedAt: null },
    l1RedactionCount: 0,
    messages: [],
    durationMs: 60_000,
    startTs: s, endTs: new Date(s.getTime() + 60_000),
    tokens: { input: tokens, output: 0, cacheRead: 0, cacheCreation: 0 },
  };
}

describe('detectLowActivity', () => {
  it('flags when 7d tokens < 0.3 × team median and no work-hour activity', () => {
    const memberSessions = [mk('2026-05-14T22:00:00Z', 100, '/sandbox/playground')];
    const teamMedian = 10000;
    const r = detectLowActivity(memberSessions, teamMedian, { mainProjects: ['Matrix-Riven'] });
    expect(r.isLow).toBe(true);
    expect(r.reasons).toContain('low_tokens');
    expect(r.reasons).toContain('non_main_project_only');
  });

  it('does not flag a low-token member who works in main project', () => {
    const memberSessions = [mk('2026-05-14T10:00:00Z', 100, '/repo/Matrix-Riven')];
    const r = detectLowActivity(memberSessions, 10000, { mainProjects: ['Matrix-Riven'] });
    expect(r.isLow).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `pnpm --filter @matrix-riven/collector-server test -- slacking.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// packages/collector-server/src/leadership/signals/slacking.ts
import type { ParsedSession } from '../types.js';

/**
 * #1 — low-activity / slacking detector. Conjunctive heuristic:
 *   (7d_tokens < 0.3 * team_median_7d_tokens)
 *   AND (no_session_in_work_hours_local OR all_sessions_in_non_main_project)
 *
 * "Local work hours" = 09:00..18:00 in the captured_at timestamp's UTC+8
 * conversion (CST default; the system is single-team).
 *
 * Returns reasons[] so the UI can show why; never bare-true.
 */
const LOW_TOKEN_FRACTION = 0.3;

export interface SlackingResult {
  isLow: boolean;
  reasons: ('low_tokens' | 'no_work_hour_activity' | 'non_main_project_only')[];
}

export function detectLowActivity(
  sessions: ParsedSession[],
  teamMedian7dTokens: number,
  opts: { mainProjects: string[] },
): SlackingResult {
  const totalTokens = sessions.reduce((a, s) => a + s.tokens.input + s.tokens.output, 0);
  const lowTokens = teamMedian7dTokens > 0 && totalTokens < LOW_TOKEN_FRACTION * teamMedian7dTokens;

  const cstOffsetMs = 8 * 60 * 60 * 1000;
  const inWorkHours = sessions.some((s) => {
    const cst = new Date(s.startTs.getTime() + cstOffsetMs);
    const h = cst.getUTCHours();
    return h >= 9 && h < 18;
  });

  const main = new Set(opts.mainProjects.map((p) => p.toLowerCase()));
  const nonMainOnly =
    sessions.length > 0 && sessions.every((s) => !main.has(s.envelope.projectName.toLowerCase()));

  const reasons: SlackingResult['reasons'] = [];
  if (lowTokens) reasons.push('low_tokens');
  if (!inWorkHours && sessions.length > 0) reasons.push('no_work_hour_activity');
  if (nonMainOnly) reasons.push('non_main_project_only');

  const isLow = lowTokens && (!inWorkHours || nonMainOnly);
  return { isLow, reasons };
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @matrix-riven/collector-server test -- slacking.test`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/collector-server/src/leadership/signals/slacking.ts packages/collector-server/src/leadership/signals/__tests__/slacking.test.ts
git commit -m "feat(leadership): slacking detector (#1)"
```

---

### Task 6: signals/blockers.ts (#2 #3)

**Files:**
- Create: `packages/collector-server/src/leadership/signals/blockers.ts`
- Test: `packages/collector-server/src/leadership/signals/__tests__/blockers.test.ts`

Implementation pattern:
- `detectDifficulty(session)`: counts repeated read/edit of same file ≥5 within one session AND high tool-failure rate.
- `detectBlocker(sessions, opts)`: same cwd ≥3 sessions in 24h AND zero git commit (scan bash invocations) AND/OR OVER_200K count ≥2.
- See spec §2.1 rows 2 & 3 for exact thresholds.

- [ ] **Step 1: Write failing tests** (mirror Task 5 pattern; cover: file-repeat detection, tool-failure rate detection, blocker conjunction, git-commit short-circuit).
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** with these exports: `detectDifficulty(session: ParsedSession): { isDifficult: boolean; hotFiles: string[]; toolFailureRate: number }` and `detectBlocker(sessions: ParsedSession[], cwd: string, now: Date): { isBlocked: boolean; reasons: string[] }`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** `feat(leadership): difficulty + blocker signals (#2 #3)`.

---

### Task 7: signals/help-needed.ts (#4)

**Files:**
- Create: `packages/collector-server/src/leadership/signals/help-needed.ts`
- Test: `packages/collector-server/src/leadership/signals/__tests__/help-needed.test.ts`

Implementation:
- Export `detectHelpNeeded(sessions: ParsedSession[], teamAvgWebSearch: number): { isNeeded: boolean; keywordHits: string[]; webSearchRatio: number }`.
- Keyword regex (apply only to messages with `role==='user'`, only to `.text`): `/卡住|不会(?!议)|为什么[\s\S]{0,8}不|help[\s,!?]|stuck|求助|救命|怎么办/i`.
- WebSearch over-use: count tool_use where name === 'WebSearch' OR 'WebFetch' across all sessions, divide by sessions.length; if > teamAvg × 2, flag.

- [ ] **Step 1: Write failing tests** covering: keyword hit on user text, no false-positive on assistant text or tool_result, WebSearch-overuse trigger.
- [ ] **Step 2-5:** as Task 6 pattern.

Commit message: `feat(leadership): help-needed detector (#4)`.

---

### Task 8: signals/collaboration.ts (#5)

**Files:**
- Create: `packages/collector-server/src/leadership/signals/collaboration.ts`
- Test: `packages/collector-server/src/leadership/signals/__tests__/collaboration.test.ts`

Implementation:
- Export `detectCollabHits(allSessions: ParsedSession[]): CollabHit[]` (see types.ts).
- Algorithm: collect every file path edited (from Edit/Write/MultiEdit tool_use.input.file_path) per (user, ts). Build a map `filePath → Set<userEmail>`. Emit a CollabHit for every path with ≥2 distinct users in the window. `lastTouched` = most recent ts among contributors.

- [ ] **Step 1: Write failing tests** with 2 users editing the same file → emits hit; single-user file → no hit.
- [ ] **Step 2-5:** standard.

Commit: `feat(leadership): collaboration hit detector (#5)`.

---

### Task 9: signals/quality.ts, signals/risk.ts, signals/cost.ts, signals/learning.ts

**Files:** 4 new files + 4 test files; one commit per file (4 commits total). Same TDD pattern.

| File | Exports | Algorithm |
|---|---|---|
| `quality.ts` (#10 #11 #12 #13) | `computeToolFailureRate(s) → number`, `countContextOverflow(s) → number`, `computeIterationDensity(s) → number`, `promptLengthSeries(s, dailyBuckets) → number[]` | failure-rate = `toolResults.filter(isError).length / toolResults.length`; overflow = scan messages for text containing `OVER_200K` marker or transcript marker; iteration = mean user-msg count per cwd-grouped run; prompt-len-series = mean user text length per day bucket. |
| `risk.ts` (#14 #15) | `extractRiskyActions(s) → RiskyAction[]`, `sumRedactions(s) → number` | match bash command text against patterns from spec §2.1 row 14; redactions just sum `l1RedactionCount`. |
| `cost.ts` (#16 #17) | `computeCostUsd(s) → number`, `computeModelMix(s) → Record<string, number>` | unit prices constant table (Opus $15/$75 per Mtok, Sonnet $3/$15, Haiku $0.8/$4); falls back to "unknown" model with sonnet pricing. Mix = token share by model. |
| `learning.ts` (#18) | `computeWebResearch(s) → number`, `computeNewSurfaceCount(s, historical) → number` | count WebSearch+WebFetch tool_use; new-surface = files/extensions in current period not seen in historical period. |

For each file:
- [ ] Write failing tests (3-5 assertions each)
- [ ] Run, fail
- [ ] Implement
- [ ] Run, pass
- [ ] Commit `feat(leadership): <name> signals (#X #Y)`

---

## Milestone 3 — Project Signals (Tasks 10-13)

Same TDD-per-file pattern. Group as below; one commit per file.

### Task 10: project-status.ts (P1 P2 P11) + project-eta.ts (P3)

- `project-status.ts` exports `classifyProject(sessions, now) → ProjectState`, `getRecentFiles(sessions) → string[]`.
- `project-eta.ts` exports `projectEta(sessions14d, now) → { etaDays: number|null; confidence: 'low' }`. Heuristic: count milestone events (commits + PRs) in past 14 days; if <2, return null. Else extrapolate at current rate to a target of "double current commit count" (rough "100%" — explicit in spec §2.2 row 3 as approximate).

Tests + commits standard.

### Task 11: project-collab.ts (P4 P5) + project-stack.ts (P6 P8) + project-phase.ts (P7)

- `project-collab.ts`: `computeContributors(sessions) → { email; sharePct }[]`, `computeCollabDensity(sessions) → number`.
- `project-stack.ts`: `computeExtensionMix(sessions) → Record<string, number>`, `computeTestRatio(sessions) → number`.
- `project-phase.ts`: `guessPhase(sessions) → ProjectPhase`. Phase heuristics from message keywords + tool patterns:
  - 'debug' if tool failure rate > 0.2 OR user text matches `/bug|broken|error|why.{0,10}not/i` > 30% of msgs
  - 'test' if test-file edit ratio > 0.5
  - 'docs' if ≥50% of edits target `*.md`
  - 'refactor' if rename/move bash patterns dominate
  - 'plan' if `/plan|design|spec|brainstorm/i` keywords dominate
  - 'implement' otherwise
  - 'mixed' if no single category exceeds 0.4

Tests + commits standard.

### Task 12: project-health.ts (P9 P10)

- `computeHealthScore(sessions) → number` 0-10: starts 10, subtract for tool-fail-rate (× 10), subtract for OVER_200K count, subtract for repeat-edit-without-progress.
- `extractMilestones(sessions) → Milestone[]`: scan bash for `git commit`, `git push`, `gh pr create`, `npm publish`, `git tag`.

Tests + commit `feat(leadership): project health + milestones`.

### Task 13: project-rhythm.ts (P12 P13 P14)

- `computeWebResearchShare(sessions) → number`
- `computeTrend7d(sessionsByDay) → number[]`
- `computeHeatmap7x24(sessions) → number[][]` (rows = days, cols = hours)

Tests + commit standard.

---

## Milestone 4 — Aggregator + Routes (Tasks 14-15)

### Task 14: aggregator.ts

**Files:**
- Create: `packages/collector-server/src/leadership/aggregator.ts`
- Test: `packages/collector-server/src/leadership/__tests__/aggregator.test.ts`

- [ ] **Step 1: Write failing tests** that build a synthetic 3-session fixture (2 users, 2 projects) and assert:
  - `buildOverviewSnapshot` returns 2 members, 2 projects, KPI counts match
  - `buildMemberDetail('alice@x.com')` includes session list with `firstPromptPreview ≤ 200 chars`
  - `buildProjectDetail('Matrix-Riven')` includes contributors and milestones

- [ ] **Step 2: Run, fail.**

- [ ] **Step 3: Implement** the aggregator. It composes every signal computer from Milestones 2-3 into the snapshot shapes from `types.ts`. Pseudo-structure:

```typescript
// packages/collector-server/src/leadership/aggregator.ts
import type { OverviewSnapshot, MemberSnapshot, ProjectSnapshot, ParsedSession, DateRange } from './types.js';
import { scanAllSessions } from './transcript-loader.js';
import { computeActivity, computeFocus, computeRhythmDelta } from './signals/activity.js';
import { detectLowActivity } from './signals/slacking.js';
import { detectBlocker, detectDifficulty } from './signals/blockers.js';
import { detectHelpNeeded } from './signals/help-needed.js';
import { detectCollabHits } from './signals/collaboration.js';
import { computeToolFailureRate, countContextOverflow, computeIterationDensity, promptLengthSeries } from './signals/quality.js';
import { extractRiskyActions, sumRedactions } from './signals/risk.js';
import { computeCostUsd, computeModelMix } from './signals/cost.js';
import { computeWebResearch } from './signals/learning.js';
import { classifyProject } from './signals/project-status.js';
import { projectEta } from './signals/project-eta.js';
import { computeContributors, computeCollabDensity } from './signals/project-collab.js';
import { computeExtensionMix, computeTestRatio } from './signals/project-stack.js';
import { guessPhase } from './signals/project-phase.js';
import { computeHealthScore, extractMilestones } from './signals/project-health.js';
import { computeWebResearchShare, computeTrend7d, computeHeatmap7x24 } from './signals/project-rhythm.js';

export function buildOverviewSnapshot(opts: {
  collectorDir: string;
  range: DateRange;
  now: Date;
  mainProjects: string[];
}): OverviewSnapshot { /* ... */ }

export function buildMemberDetail(opts: {
  collectorDir: string;
  email: string;
  range: DateRange;
  now: Date;
}): MemberSnapshot | null { /* ... */ }

export function buildProjectDetail(opts: {
  collectorDir: string;
  projectName: string;
  range: DateRange;
  now: Date;
}): ProjectSnapshot | null { /* ... */ }
```

Filter sessions by range (`s.startTs ∈ range`), group by `envelope.userId` and `envelope.projectName`, run signals, assemble.

For `firstPromptPreview`, find first message with `role === 'user'` and slice text to 200 chars.

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** `feat(leadership): aggregator wiring all signals`.

### Task 15: routes.ts + wire into bin-prod-server

**Files:**
- Create: `packages/collector-server/src/leadership/routes.ts`
- Test: `packages/collector-server/src/leadership/__tests__/routes.test.ts`
- Modify: `packages/collector-server/src/bin-prod-server.ts` (register routes)

- [ ] **Step 1: Write failing route tests** — start an http server with a mock collector dir, hit `GET /api/overview`, `GET /api/members/alice`, `GET /api/projects/Matrix-Riven`, assert 200 + shape, then 404 for missing member.

- [ ] **Step 2: Run, fail.**

- [ ] **Step 3: Implement routes** as a registrar `registerLeadershipRoutes(server, { collectorDir, cache })` that adds 3 JSON endpoints + 3 HTML endpoints (HTML routes hand off to view modules from Milestone 5; until those exist, return `<p>placeholder</p>`).

Use existing http server primitive in bin-prod-server (inspect first to match style).

- [ ] **Step 4: Wire into bin-prod-server.ts**:

Locate the route registration block. Add:
```typescript
import { registerLeadershipRoutes } from './leadership/routes.js';
import { TtlCache } from './leadership/cache.js';
import type { OverviewSnapshot } from './leadership/types.js';
// ...
const leadershipCache = new TtlCache<OverviewSnapshot>(30_000);
registerLeadershipRoutes(server, { collectorDir, cache: leadershipCache });
```

- [ ] **Step 5: Run, verify pass.**

- [ ] **Step 6: Commit** `feat(leadership): API routes wired into bin-prod-server`.

---

## Milestone 5 — Frontend (Tasks 16-19)

### Task 16: views/styles.css.ts

**Files:**
- Create: `packages/collector-server/src/leadership/views/styles.css.ts`

- [ ] **Step 1: Create the styles module exporting `LEADERSHIP_CSS: string`** — a single CSS string string with all Modern Card rules from spec §5.1-5.2. Include: `:root` color tokens, `.kpi-card`, `.member-card`, `.project-card`, `.badge.*`, `.sparkline`, `.heatmap`, layout grids, typography.

  About 300 lines. No CSS frameworks. System font stack with Chinese font fallbacks. Sparkline = 7 divs height-mapped via CSS vars.

- [ ] **Step 2: Commit** `feat(leadership): Modern Card stylesheet`. No test (CSS-only).

### Task 17: views/overview.html.ts

**Files:**
- Create: `packages/collector-server/src/leadership/views/overview.html.ts`
- Test: `packages/collector-server/src/leadership/views/__tests__/overview.html.test.ts`

- [ ] **Step 1: Write failing test**: feed `renderOverview(snapshot)` a fixture snapshot, assert the returned HTML string contains:
  - `<h1>团队 leadership 视图</h1>` (or current title)
  - All 6 member display names
  - All KPI values
  - `<style>` tag with `.kpi-card` class
  - No `<script src=` (only inline `<script>` for auto-refresh)
  - Closing `</html>`

- [ ] **Step 2: Run, fail.**

- [ ] **Step 3: Implement** `renderOverview(snapshot: OverviewSnapshot): string` returning a full self-contained HTML document (because dashboard-html.ts pattern is whole-page strings). Include inline `<style>` with `LEADERSHIP_CSS`, inline `<script>` doing `setInterval(() => fetch('/api/overview').then(r => r.json()).then(updateDom), 30_000)` and a minimal `updateDom` that re-renders the few changing numeric nodes.

  Escape all user-controlled fields with `escapeHtml()` to prevent injection.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** `feat(leadership): overview page renderer`.

### Task 18: views/member-detail.html.ts

Same shape as Task 17. Implements §5.4 layout from spec.

Key UI elements: hero card with totals + delta, 5 signal-group cards (status/工作量/效率/风险/学习), 7×24 heatmap as CSS-grid div tiles, top-files list, sessions list with `firstPromptPreview` plus `<details><summary>展开</summary>...</details>` for full prompt (200-char preview clickable to L2/L3 per §5.6).

Test asserts: heatmap rendered with 7×24=168 cells, sessions show 200-char preview, link back to `/overview`.

Commit: `feat(leadership): member detail page renderer`.

### Task 19: views/project-detail.html.ts

Same shape; renders contributors list, technical stack pie (CSS conic-gradient — no chart lib), phase badge, milestone timeline, heatmap, recent files, ETA disclaimer.

Test asserts: ETA always shown with "基于节奏估算" disclaimer, bus-factor warning shows when contributor share > 0.7.

Commit: `feat(leadership): project detail page renderer`.

---

## Milestone 6 — Integration (Tasks 20-22)

### Task 20: Wire dashboard-html.ts → new overview, hide old Overview tab

**Files:**
- Modify: `packages/collector-server/src/dashboard-html.ts`
- Modify (already done in Task 15): `packages/collector-server/src/bin-prod-server.ts`

- [ ] **Step 1: Read** `dashboard-html.ts` to locate the Overview tab definition.

- [ ] **Step 2: Modify** the Overview tab so its link points to `/overview` (the new page served by `registerLeadershipRoutes`) instead of inlining the old aggregator HTML. The old `overview/` module's HTML generator is kept as `?raw=1` query param fallback for one release cycle — implement by passing `raw` through to the route and serving the legacy HTML when set.

  In `dashboard-html.ts`:
  ```html
  <a class="tab" href="/overview">Overview</a>
  ```
  (replace whatever the current Overview link is — preserve `active` class logic).

- [ ] **Step 3: Build the package**:

Run: `pnpm --filter @matrix-riven/collector-server build`
Expected: `Build success` and `dist/bin-prod-server.cjs` exists.

- [ ] **Step 4: Run the full test suite**:

Run: `pnpm --filter @matrix-riven/collector-server test`
Expected: all pre-existing tests still pass + new tests pass.

- [ ] **Step 5: Commit** `feat(leadership): wire dashboard-html Overview tab to new renderer`.

### Task 21: Snapshot smoke test (manual but recorded)

**Goal:** Prove the dashboard works against the real `D:\0jingtong\Matrix-Riven\data\teamagent-logs-20260514-190026` snapshot. **Read-only — does NOT modify or upload anything.**

- [ ] **Step 1: Set env + start server in background**:

```powershell
$env:RIVEN_COLLECTOR_DIR = "D:\0jingtong\Matrix-Riven\data\teamagent-logs-20260514-190026"
$env:PORT = "6066"
$env:HOST = "127.0.0.1"
```

Then start in background:
```bash
node packages/collector-server/dist/bin-prod-server.cjs
```
(Use Bash tool's `run_in_background: true`.)

- [ ] **Step 2: Curl the JSON API** (no browser needed):

```powershell
Invoke-WebRequest -Uri "http://127.0.0.1:6066/api/overview?range=7d" -UseBasicParsing |
  Select-Object -ExpandProperty Content | ConvertFrom-Json |
  Select-Object -ExpandProperty kpis | Format-List
```

Expected: KPI values populated from 6-member, 6-day snapshot. `team_activity.value` should be the total session count across all members (488 envelopes minus parse failures).

- [ ] **Step 3: Curl members + projects**:

```powershell
(Invoke-WebRequest -Uri "http://127.0.0.1:6066/api/overview?range=7d" -UseBasicParsing).Content |
  ConvertFrom-Json | Select-Object -ExpandProperty members | ForEach-Object { $_.displayName }
```

Expected output: 6 names (hrdai, javana00, julielua, liboze2026, liusy, zhangziyi).

- [ ] **Step 4: HTML smoke**:

```powershell
(Invoke-WebRequest -Uri "http://127.0.0.1:6066/overview" -UseBasicParsing).Content.Length
```

Expected: positive number > 5000 (full HTML page).

- [ ] **Step 5: Save smoke output** as evidence:

Write the curl outputs to `docs/superpowers/smoke/2026-05-16-leadership-smoke.md` (a one-page markdown listing the API response sizes, member names, and KPI numbers).

- [ ] **Step 6: Stop background server** with the process kill (use the background process ID returned by the Bash tool).

- [ ] **Step 7: Commit** the smoke evidence:

```bash
git add docs/superpowers/smoke/
git commit -m "test(leadership): smoke against teamagent-logs-20260514 snapshot"
```

### Task 22: Performance budget check

**Files:**
- Create: `scripts/perf-leadership.mjs`

- [ ] **Step 1: Write a perf script**:

```javascript
// scripts/perf-leadership.mjs
import http from 'node:http';

async function timeRequest(url) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ ms: Date.now() - start, status: res.statusCode, bytes: Buffer.concat(chunks).length }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  const url = process.argv[2] ?? 'http://127.0.0.1:6066/api/overview?range=7d';
  // Cold hit
  const cold = await timeRequest(url);
  console.log(`cold: ${cold.ms}ms (${cold.bytes}B, status ${cold.status})`);
  // Warm hits
  const warm = [];
  for (let i = 0; i < 20; i++) warm.push((await timeRequest(url)).ms);
  warm.sort((a, b) => a - b);
  const p50 = warm[10], p95 = warm[19];
  console.log(`warm p50: ${p50}ms, p95: ${p95}ms`);
  if (cold.ms > 2000) process.exit(2);
  if (p50 > 50) process.exit(3);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run server in background** (as Task 21), then run:

```bash
node scripts/perf-leadership.mjs
```

Expected: cold < 2000ms, warm p50 < 50ms. If not, document the breach and propose a fix (likely: precompute on startup or persist index).

- [ ] **Step 3: Stop server.**

- [ ] **Step 4: Commit**:

```bash
git add scripts/perf-leadership.mjs
git commit -m "test(leadership): perf budget script (cold <2s, warm <50ms)"
```

---

## Self-Review Checklist (run at end of plan)

- [ ] Every spec §2.1 row (18 member signals) maps to a Task 4-9 file
- [ ] Every spec §2.2 row (14 project signals) maps to a Task 10-13 file
- [ ] §3.1 module layout matches Task 1's `types.ts` and Tasks 14-15's aggregator + routes
- [ ] §4 API endpoints (`/api/overview`, `/api/members/:id`, `/api/projects/:name`, `/overview`, `/members/:id`, `/projects/:name`) all live in Task 15 and Tasks 17-19
- [ ] §5 visual design covered by Tasks 16-19
- [ ] §6 deployment path covered by Task 21 smoke test
- [ ] §5.6 privacy three-tier (L0/L1/L2/L3) baked into Task 18's member detail (200-char preview + `<details>` expand)
- [ ] Port 6066 used in Tasks 21-22 smoke + perf scripts
- [ ] No placeholders (`TBD`, `TODO`, "implement later") — Tasks 6, 7, 8, 9 use compressed format but reference exact algorithms from spec
- [ ] No subagent dispatches inside plan steps (the executing skill handles that)
