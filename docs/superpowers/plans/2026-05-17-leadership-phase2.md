# Leadership Dashboard Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close 6 Phase-1 gaps (4 unwired signals, project name collisions, sessions expand, view-raw link), rebuild the front-end with v7 Spatial visual + 5-tab IA + 520px slide-over detail panel, add ETag-throttled 30s live polling on Overview + slide-over, and add an on-disk session index for sub-2s cold start.

**Architecture:** Continue under `packages/collector-server/src/leadership/`. Phase 2 adds: `views/_css.ts` (design tokens), `views/_nav.html.ts` (5-tab frosted nav), `views/_copy.ts` (editorial copy templates), `views/_slideover.html.ts` (drawer renderer), `views/_refresh.js.ts` (client polling script), `index.ts` (on-disk session index). The old full-page `member-detail.html.ts` / `project-detail.html.ts` renderers are retired in P-B6 — their content moves into slide-over fragments served by the existing JSON detail APIs (which now also return `_html: {...}`).

**Tech Stack:** TypeScript, Node ≥22.5, Vitest, tsup (existing toolchain). Zero new runtime deps. Server-rendered HTML, minimal vanilla JS for polling and slide-over.

**Spec:** [`docs/superpowers/specs/2026-05-17-leadership-phase2-design.md`](../specs/2026-05-17-leadership-phase2-design.md)

**v7 Visual Reference:** `.superpowers/brainstorm/2613-1778952522/content/dashboard-redesign-v7-spatial.html` — every CSS variable, every shadow, every spacing constant, every animation curve is locked here. P-B tasks MUST copy verbatim, not invent.

**Conventions:**
- Test files live at `<dir>/__tests__/<name>.test.ts` (Phase 1 pattern)
- Run tests from worktree root: `pnpm --filter @matrix-riven/collector-server test -- <path>`
- Commit per task. Never amend. Never push. Never `--no-verify`.
- Worktree discipline: `cd D:/0jingtong/Matrix-Riven/.claude/worktrees/enumerated-roaming-engelbart` before any git/commit. Verify with `git rev-parse --show-toplevel`.
- No emoji in code; restrained emoji in user-facing HTML OK (matches Phase 1 conventions)
- All client JS lives in `views/_refresh.js.ts` as a string export `CLIENT_REFRESH_SCRIPT`, injected via `<script>${CLIENT_REFRESH_SCRIPT}</script>`

---

## Milestone P-A — Close Phase 1 gaps (4 tasks)

### Task 1 (P-A1): Wire 4 unused signals into snapshot

**Files:**
- Modify: `packages/collector-server/src/leadership/types.ts` — extend `MemberDetail` + `ProjectDetail`
- Modify: `packages/collector-server/src/leadership/aggregator.ts` — call the 4 signal functions
- Test: `packages/collector-server/src/leadership/__tests__/aggregator.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `aggregator.test.ts`:

```typescript
describe('Phase 2 wired signals', () => {
  it('MemberDetail exposes focus, promptLengthSeries, newSurfaceCount', () => {
    const snap = buildOverviewSnapshot(fixtureSessions, fixtureRange);
    const m = snap.members[0]!;
    expect(m.detail).toBeDefined();
    expect(m.detail!.focus).toEqual({
      distinctCwdsToday: expect.any(Number),
      avgSessionMinutes: expect.any(Number),
    });
    expect(Array.isArray(m.detail!.promptLengthSeries)).toBe(true);
    expect(typeof m.detail!.newSurfaceCount).toBe('number');
  });

  it('ProjectDetail exposes collabDensity', () => {
    const snap = buildOverviewSnapshot(fixtureSessions, fixtureRange);
    const p = snap.projects[0]!;
    expect(p.detail).toBeDefined();
    expect(typeof p.detail!.collabDensity).toBe('number');
    expect(p.detail!.collabDensity).toBeGreaterThanOrEqual(0);
    expect(p.detail!.collabDensity).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @matrix-riven/collector-server test -- aggregator`
Expected: FAIL — `m.detail.focus` is undefined.

- [ ] **Step 3: Extend types**

In `types.ts`, after the existing `MemberDetail` fields and before `RiskyAction`:

```typescript
export interface MemberDetail {
  toolFailureRate: number;
  overContext200kCount: number;
  iterationDensity: number;
  riskyActions: RiskyAction[];
  collaborators: CollaboratorHit[];
  modelMix: Record<string, number>;
  webResearchCount: number;
  sessions: SessionSummary[];
  heatmap7x24: number[][];
  topFiles: { path: string; edits: number }[];
  // ─── Phase 2 additions ───
  focus: { distinctCwdsToday: number; avgSessionMinutes: number };
  promptLengthSeries: { date: string; meanLen: number }[];
  newSurfaceCount: number;
}
```

And `ProjectDetail`:

```typescript
export interface ProjectDetail {
  todayFiles: string[];
  weekFiles: string[];
  extensionMix: Record<string, number>;
  testRatio: number;
  milestones: Milestone[];
  webResearchShare: number;
  heatmap7x24: number[][];
  recentFiles: { path: string; touches: number }[];
  // ─── Phase 2 additions ───
  collabDensity: number;
}
```

- [ ] **Step 4: Wire signals in aggregator**

In `aggregator.ts`, add imports:

```typescript
import { computeFocus } from './signals/activity.js';
import { promptLengthSeries } from './signals/quality.js';
import { computeNewSurfaceCount } from './signals/learning.js';
import { computeCollabDensity } from './signals/project-collab.js';
```

In `buildMemberDetail()`, populate the new fields from the member's sessions in the current window and historical window:

```typescript
return {
  // ...existing fields...
  focus: computeFocus(todaySessions),
  promptLengthSeries: promptLengthSeries(memberSessions),
  newSurfaceCount: computeNewSurfaceCount(memberSessions, historicalSessions),
};
```

In `buildProjectDetail()`, add:

```typescript
return {
  // ...existing fields...
  collabDensity: computeCollabDensity(projectSessions),
};
```

If `todaySessions` / `historicalSessions` aren't already computed in `buildMemberDetail`, derive them by filtering `memberSessions` against `range.start`/`range.end` and the 7-day window preceding `range.start`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @matrix-riven/collector-server test -- aggregator`
Expected: PASS.

Also run: `pnpm --filter @matrix-riven/collector-server test --run` — full test suite, expect no regressions (≥ 719 baseline).

- [ ] **Step 6: Commit**

```bash
git add packages/collector-server/src/leadership/types.ts \
        packages/collector-server/src/leadership/aggregator.ts \
        packages/collector-server/src/leadership/__tests__/aggregator.test.ts
git commit -m "$(cat <<'EOF'
feat(leadership-p2): wire 4 unused signals into snapshot

P-A1: computeFocus, promptLengthSeries, computeNewSurfaceCount,
computeCollabDensity were built in Phase 1 but never reached the
snapshot. Extend MemberDetail/ProjectDetail and call them from the
aggregator.
EOF
)"
```

---

### Task 2 (P-A2): Collapse cwd common-name project collisions

**Files:**
- Modify: `packages/collector-server/src/leadership/transcript-loader.ts` — refine `projectName` derivation
- Test: `packages/collector-server/src/leadership/__tests__/transcript-loader.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `transcript-loader.test.ts`:

```typescript
import { deriveProjectName } from '../transcript-loader.js';

describe('deriveProjectName common-name collapse', () => {
  const cases: [string, string][] = [
    // [cwd, expected projectName]
    ['/home/u/Matrix-Riven/packages/collector-server/src', 'collector-server'],
    ['C:\\u\\Matrix-Riven\\packages\\shared\\dist', 'shared'],
    ['/home/u/Matrix-Riven/packages/collector-server/__tests__', 'collector-server'],
    ['/home/u/proj/node_modules', 'proj'],
    ['/single', 'single'],          // single segment, keep as-is
    ['/a/.git', 'a'],
    ['/x/y/build', 'y'],
    ['/x/y/test', 'y'],
  ];
  for (const [cwd, expected] of cases) {
    it(`${cwd} → ${expected}`, () => {
      expect(deriveProjectName(cwd)).toBe(expected);
    });
  }

  it('compound fallback when both last and second-to-last are common', () => {
    // dist + src both common → use third-to-last
    expect(deriveProjectName('/u/Matrix-Riven/packages/dist/src')).toBe('packages');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @matrix-riven/collector-server test -- transcript-loader`
Expected: FAIL — `deriveProjectName` is not exported or returns the last segment.

- [ ] **Step 3: Implement `deriveProjectName`**

In `transcript-loader.ts`, add and export:

```typescript
const COMMON_LAST_SEGMENTS = new Set([
  'src', 'dist', 'test', 'tests', '__tests__',
  'node_modules', '.claude', '.git', 'build', 'out', 'target',
  'lib', 'bin', 'public', 'static',
]);

export function deriveProjectName(cwd: string): string {
  const parts = cwd.replace(/\\/g, '/').split('/').filter(p => p.length > 0);
  if (parts.length === 0) return 'unknown';
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!COMMON_LAST_SEGMENTS.has(parts[i]!.toLowerCase())) return parts[i]!;
  }
  return parts[parts.length - 1]!;
}
```

Then, in both `parseEnvelopeBuffer` and `parseRawJsonlBuffer`, replace the existing `projectName` derivation (currently last-segment) with:

```typescript
const projectName = envelope.project_name?.trim() || deriveProjectName(envelope.cwd ?? '');
```

(Preserve `envelope.project_name` as the primary source when populated by uploader; only fall back to derivation when missing.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @matrix-riven/collector-server test -- transcript-loader`
Expected: PASS (all 9 cases).

Also run the full suite: `pnpm --filter @matrix-riven/collector-server test --run`.

- [ ] **Step 5: Snapshot smoke check**

Run `node scripts/perf-leadership.mjs` (or the `curl /api/overview` step from Phase 1 smoke doc). The reported `projects.length` should drop from ~80 to ≤15. If higher than 15, add the offending segment names to `COMMON_LAST_SEGMENTS` and re-run.

- [ ] **Step 6: Commit**

```bash
git add packages/collector-server/src/leadership/transcript-loader.ts \
        packages/collector-server/src/leadership/__tests__/transcript-loader.test.ts
git commit -m "$(cat <<'EOF'
fix(leadership-p2): collapse common-name cwd last-segment collisions

P-A2: cwd last-segment like src/dist/test/node_modules/.git was being
treated as the project name, giving 80+ phantom projects. Walk back
toward root until a non-common segment is found.
EOF
)"
```

---

### Task 3 (P-A3): Expand-all-prompts on sessions list

**Files:**
- Modify: `packages/collector-server/src/leadership/views/member-detail.html.ts` — `renderSessionRow` + `<details>` expand
- Modify: `packages/collector-server/src/leadership/types.ts` — extend `SessionSummary` to carry all user prompts
- Modify: `packages/collector-server/src/leadership/aggregator.ts` — populate the new field
- Test: `packages/collector-server/src/leadership/views/__tests__/member-detail.html.test.ts`

- [ ] **Step 1: Write the failing test**

Append:

```typescript
it('expand renders all user prompts, not just first', () => {
  const detail = makeDetailFixture({
    sessions: [{
      sessionId: 'abc',
      capturedAt: '2026-05-17T03:12:00Z',
      projectName: 'mr',
      totalTokens: 100,
      firstPromptPreview: 'first prompt preview',
      firstPromptFull: 'first prompt full',
      allPrompts: [
        { ts: '2026-05-17T03:12:00Z', preview: 'first preview', full: 'first full' },
        { ts: '2026-05-17T03:15:00Z', preview: 'second preview', full: 'second full' },
        { ts: '2026-05-17T03:20:00Z', preview: 'third preview', full: 'third full' },
      ],
    }],
  });
  const html = renderMemberDetail(makeMemberFixture(), detail);
  expect(html).toContain('first preview');
  expect(html).toContain('second preview');
  expect(html).toContain('third preview');
  expect(html).toContain('first full');
  expect(html).toContain('second full');
  expect(html).toContain('third full');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @matrix-riven/collector-server test -- member-detail`
Expected: FAIL — `allPrompts` field not in type / not rendered.

- [ ] **Step 3: Extend `SessionSummary`**

In `types.ts`, add to `SessionSummary`:

```typescript
export interface SessionSummary {
  sessionId: string;
  capturedAt: string;
  projectName: string;
  totalTokens: number;
  firstPromptPreview: string;
  firstPromptFull: string;
  // ─── Phase 2 addition ───
  allPrompts: { ts: string; preview: string; full: string }[];
}
```

- [ ] **Step 4: Populate in aggregator**

In `aggregator.ts` `buildSessionSummary` (or wherever `SessionSummary` is assembled), iterate user messages and produce `allPrompts`:

```typescript
const allPrompts = session.messages
  .filter(m => m.role === 'user' && m.text.trim().length > 0)
  .map(m => ({
    ts: (m.ts ?? session.startTs).toISOString(),
    preview: m.text.slice(0, 200),
    full: m.text,
  }));
```

- [ ] **Step 5: Render all prompts in expand**

In `views/member-detail.html.ts`, replace the existing `<details>` block (which currently shows only `firstPromptFull`) with:

```typescript
function renderPrompts(s: SessionSummary): string {
  return s.allPrompts.map((p, idx) => `
    <div class="prompt-row">
      <div class="prompt-ts">${escapeHtml(p.ts.slice(11, 19))}</div>
      <div class="prompt-body">
        <div class="prompt-preview">${escapeHtml(p.preview)}${p.full.length > 200 ? '…' : ''}</div>
        ${p.full.length > 200 ? `
        <details>
          <summary>全文</summary>
          <pre class="prompt-full">${escapeHtml(p.full)}</pre>
        </details>` : ''}
      </div>
    </div>
  `).join('');
}
```

And invoke it inside the `<details>` per-session expand block.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @matrix-riven/collector-server test -- member-detail`
Expected: PASS.

Full suite: `pnpm --filter @matrix-riven/collector-server test --run`.

- [ ] **Step 7: Commit**

```bash
git add packages/collector-server/src/leadership/types.ts \
        packages/collector-server/src/leadership/aggregator.ts \
        packages/collector-server/src/leadership/views/member-detail.html.ts \
        packages/collector-server/src/leadership/views/__tests__/member-detail.html.test.ts
git commit -m "$(cat <<'EOF'
fix(leadership-p2): expand button shows all session prompts per spec

P-A3: Phase 1 expand only revealed firstPromptFull. Spec §5.6 L2 says
all user prompts in the session. Carry allPrompts on SessionSummary
and render each with 200-char preview + per-prompt full toggle.
EOF
)"
```

---

### Task 4 (P-A4): View-raw link to Browse tab

**Files:**
- Modify: `packages/collector-server/src/leadership/views/member-detail.html.ts` — add `<a class="view-raw">` per session row
- Test: `packages/collector-server/src/leadership/views/__tests__/member-detail.html.test.ts`

- [ ] **Step 1: Check current Browse tab deep-link convention**

Run: `grep -n "sid=" packages/collector-server/src/**/*.ts | head -20`

Confirm Browse tab uses `?sid=<sessionId>` at root. (Phase 1 spec §5.4 says "/?sid=...".)

- [ ] **Step 2: Write the failing test**

```typescript
it('each session row renders a view-raw link with sid query', () => {
  const detail = makeDetailFixture({
    sessions: [{
      sessionId: '01JXYZ',
      capturedAt: '2026-05-17T03:12:00Z',
      projectName: 'mr', totalTokens: 100,
      firstPromptPreview: 'p', firstPromptFull: 'p', allPrompts: [],
    }],
  });
  const html = renderMemberDetail(makeMemberFixture(), detail);
  expect(html).toMatch(/href="\/\?sid=01JXYZ"/);
  expect(html).toContain('查看 raw');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @matrix-riven/collector-server test -- member-detail`
Expected: FAIL.

- [ ] **Step 4: Add the link**

In `views/member-detail.html.ts` session row markup, add:

```typescript
<a class="view-raw" href="/?sid=${escapeHtml(s.sessionId)}" title="到 Browse tab 查看完整原始记录">查看 raw ↗</a>
```

(Place after the session meta line, before the prompts `<details>`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @matrix-riven/collector-server test -- member-detail`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/collector-server/src/leadership/views/member-detail.html.ts \
        packages/collector-server/src/leadership/views/__tests__/member-detail.html.test.ts
git commit -m "$(cat <<'EOF'
feat(leadership-p2): session "view raw" link to Browse tab

P-A4: each session row in member detail now links to /?sid=<id> which
deep-links into the existing Browse tab for the raw transcript.
EOF
)"
```

---

## Milestone P-B — v7 Spatial visual + new IA (6 tasks)

> **P-B implementation discipline:** Every CSS variable, shadow, color, animation curve, and font stack must be **copied verbatim** from `.superpowers/brainstorm/2613-1778952522/content/dashboard-redesign-v7-spatial.html`. Do not invent new values. If something isn't in v7 reference, ask before adding.

### Task 5 (P-B1): v7 Spatial design tokens in CSS

**Files:**
- Create: `packages/collector-server/src/leadership/views/_css.ts` — exports `LEADERSHIP_CSS_V2`
- Modify: `packages/collector-server/src/leadership/views/styles.css.ts` — re-export from `_css.ts` (preserve `LEADERSHIP_CSS` named export for back-compat during P-B rollout)
- Test: `packages/collector-server/src/leadership/views/__tests__/css.test.ts`

- [ ] **Step 1: Write the failing test**

Create `views/__tests__/css.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { LEADERSHIP_CSS } from '../styles.css.js';

describe('v7 Spatial design tokens', () => {
  const css = LEADERSHIP_CSS;

  it.each([
    '--bg: #F7F6F2',
    '--surface: #FFFFFF',
    '--ink-1: #1C1B19',
    '--ink-3: #7A776F',
    '--accent: #6F8B5E',
    '--accent-soft:#E8EEDF',
    '--warn: #C8924B',
    '--danger: #B0625A',
    '--calm: #8A9AAA',
    '--hairline: #ECEAE2',
    '--r-xl: 28px',
    '--r-lg: 20px',
    '--ease: cubic-bezier(.2,.7,.2,1)',
    '--spring: cubic-bezier(.34,1.56,.64,1)',
  ])('contains token %s', (token) => {
    expect(css.replace(/\s+/g, ' ')).toContain(token.replace(/\s+/g, ' '));
  });

  it('imports Inter, JetBrains Mono, and Newsreader from Google Fonts', () => {
    expect(css).toContain('fonts.googleapis.com');
    expect(css).toContain('Inter');
    expect(css).toContain('JetBrains+Mono');
    expect(css).toContain('Newsreader');
  });

  it('applies three-layer radial mesh on body::before', () => {
    expect(css).toMatch(/body::before[\s\S]*radial-gradient/);
    expect((css.match(/radial-gradient/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('uses tabular-nums by default', () => {
    expect(css).toContain("font-feature-settings:");
    expect(css).toContain('tnum');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @matrix-riven/collector-server test -- css.test`
Expected: FAIL — old CSS lacks these tokens.

- [ ] **Step 3: Create `_css.ts` with the full v7 stylesheet**

Copy the entire `<style>...</style>` block from `dashboard-redesign-v7-spatial.html` into a TypeScript template-literal export. Prepend a `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;450;500;600;700&family=JetBrains+Mono:wght@400;500&family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap');` line.

```typescript
// packages/collector-server/src/leadership/views/_css.ts
export const LEADERSHIP_CSS_V2 = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;450;500;600;700&family=JetBrains+Mono:wght@400;500&family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap');

:root {
  --bg: #F7F6F2;
  --bg-elev: #FAFAF7;
  --surface: #FFFFFF;
  --surface-2: #FBFBF8;
  --ink-1: #1C1B19;
  --ink-2: #45433E;
  --ink-3: #7A776F;
  --ink-4: #A8A59C;
  --ink-5: #D8D5CB;
  --hairline: #ECEAE2;
  --accent: #6F8B5E;
  --accent-soft:#E8EEDF;
  --accent-ink: #3F5736;
  --warn: #C8924B;
  --warn-soft: #F4E9D6;
  --danger: #B0625A;
  --danger-soft:#F1DCD7;
  --calm: #8A9AAA;
  --calm-soft: #E5EBF0;
  --shadow-1: 0 1px 2px rgba(28,27,25,.04), 0 4px 16px rgba(28,27,25,.04);
  --shadow-2: 0 1px 3px rgba(28,27,25,.05), 0 12px 32px rgba(28,27,25,.06);
  --shadow-3: 0 2px 6px rgba(28,27,25,.06), 0 24px 64px rgba(28,27,25,.10);
  --shadow-lift: 0 1px 2px rgba(28,27,25,.04), 0 8px 28px rgba(28,27,25,.08);
  --r-sm: 10px;
  --r-md: 14px;
  --r-lg: 20px;
  --r-xl: 28px;
  --ease: cubic-bezier(.2,.7,.2,1);
  --spring: cubic-bezier(.34,1.56,.64,1);
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  background: var(--bg);
  color: var(--ink-1);
  font-size: 14px;
  line-height: 1.5;
  font-feature-settings: 'cv11', 'ss01', 'tnum';
  -webkit-font-smoothing: antialiased;
  letter-spacing: -0.005em;
}
body::before {
  content:'';
  position: fixed; inset: 0;
  background:
    radial-gradient(800px 600px at 10% -10%, rgba(111,139,94,.06), transparent 60%),
    radial-gradient(700px 500px at 100% 0%, rgba(200,146,75,.04), transparent 55%),
    radial-gradient(900px 700px at 50% 110%, rgba(138,154,170,.04), transparent 60%);
  pointer-events: none;
  z-index: 0;
}
.tnum { font-feature-settings: 'tnum'; font-variant-numeric: tabular-nums; }
.mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
.serif { font-family: 'Newsreader', 'Iowan Old Style', Georgia, serif; }

/* … paste remaining CSS rules from v7 reference HTML (nav, hero, kpi, attention,
   members, projects, slideover, avatar utilities, animations) verbatim … */
`;
```

> **Reminder:** Copy the *entire* CSS from v7. Do not truncate. The block above only sketches the prefix; finish with every rule from the reference file.

- [ ] **Step 4: Re-export from `styles.css.ts`**

Replace `styles.css.ts` content with:

```typescript
export { LEADERSHIP_CSS_V2 as LEADERSHIP_CSS } from './_css.js';
// Re-export helpers that other views still import from this module
export { avatarColor, emailInitials } from './_helpers.js';
```

If `avatarColor` and `emailInitials` are currently inside `styles.css.ts`, extract them into a new `views/_helpers.ts` first.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @matrix-riven/collector-server test -- css.test`
Expected: PASS.

Full suite: `pnpm --filter @matrix-riven/collector-server test --run`. Expect existing view tests to still pass (CSS changes don't break HTML assertions).

- [ ] **Step 6: Visual smoke**

Start the server (env vars per Phase 1 smoke doc), open `http://localhost:6066/overview`. Verify background is warm off-white (#F7F6F2), Inter font loads, Newsreader available via `.serif` class.

- [ ] **Step 7: Commit**

```bash
git add packages/collector-server/src/leadership/views/_css.ts \
        packages/collector-server/src/leadership/views/_helpers.ts \
        packages/collector-server/src/leadership/views/styles.css.ts \
        packages/collector-server/src/leadership/views/__tests__/css.test.ts
git commit -m "$(cat <<'EOF'
feat(leadership-p2): v7 spatial design tokens in CSS

P-B1: lock CSS variables (--bg #F7F6F2, --accent #6F8B5E sage, soft
shadows replacing borders, 28px max radius), three-layer radial mesh,
Google Fonts (Inter / JetBrains Mono / Newsreader). Copied verbatim
from v7 reference HTML.
EOF
)"
```

---

### Task 6 (P-B2): Frosted top nav with 5 tabs

**Files:**
- Create: `packages/collector-server/src/leadership/views/_nav.html.ts` — exports `renderNav(activeTab)`
- Modify: `packages/collector-server/src/leadership/routes.ts` — add handlers for `/people`, `/projects`, `/activity`, `/insights`
- Modify: `packages/collector-server/src/leadership/views/overview.html.ts` — inject nav
- Test: `packages/collector-server/src/leadership/views/__tests__/nav.test.ts` + `__tests__/routes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `views/__tests__/nav.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { renderNav } from '../_nav.html.js';

describe('renderNav', () => {
  const html = renderNav('overview');
  it.each(['Overview', 'People', 'Projects', 'Activity', 'Insights'])('contains tab %s', (label) => {
    expect(html).toContain(label);
  });
  it('marks active tab', () => {
    expect(renderNav('people')).toMatch(/class="tab active"[^>]*>[^<]*People/);
  });
  it('uses frosted glass via backdrop-filter', () => {
    expect(html).toContain('backdrop-filter');
    expect(html).toContain('blur(20px)');
  });
  it('has a live pulse dot', () => {
    expect(html).toMatch(/class="live-dot"/);
  });
});
```

Append to `__tests__/routes.test.ts`:

```typescript
it.each(['/people', '/projects', '/activity', '/insights'])('GET %s returns 200 HTML with nav', async (path) => {
  const res = await request(app).get(path);
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/text\/html/);
  expect(res.text).toContain('class="tab"');
  expect(res.text).toContain('Overview');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @matrix-riven/collector-server test -- nav routes`
Expected: FAIL — `_nav.html.ts` doesn't exist, new routes 404.

- [ ] **Step 3: Implement `_nav.html.ts`**

```typescript
// packages/collector-server/src/leadership/views/_nav.html.ts
export type ActiveTab = 'overview' | 'people' | 'projects' | 'activity' | 'insights';

const TABS: { id: ActiveTab; label: string; href: string }[] = [
  { id: 'overview',  label: 'Overview',  href: '/overview'  },
  { id: 'people',    label: 'People',    href: '/people'    },
  { id: 'projects',  label: 'Projects',  href: '/projects'  },
  { id: 'activity',  label: 'Activity',  href: '/activity'  },
  { id: 'insights',  label: 'Insights',  href: '/insights'  },
];

export function renderNav(active: ActiveTab, opts: { computedAt?: string; rangeLabel?: string } = {}): string {
  const tabs = TABS.map(t => `<a class="tab${t.id === active ? ' active' : ''}" href="${t.href}">${t.label}</a>`).join('');
  return `
    <nav class="nav fade-in">
      <div class="brand"><div class="brand-mark"></div><span>Matrix·Riven</span></div>
      <div class="tabs">${tabs}</div>
      <div class="nav-meta">
        <span class="live-dot"></span>
        <span>实时 · ${opts.rangeLabel ?? '7 日窗口'}</span>
        <div class="avatar-me">YL</div>
      </div>
    </nav>
  `;
}
```

The nav-specific CSS (`.nav`, `.brand`, `.tab`, `.live-dot`, etc.) is already in `_css.ts` from P-B1 — verbatim from v7.

- [ ] **Step 4: Wire new routes**

In `routes.ts`, in the dispatch switch:

```typescript
if (req.method === 'GET' && (path === '/overview' || path === '/people' || path === '/projects'
    || path === '/activity' || path === '/insights' || path === '/')) {
  const active = path === '/' ? 'overview' : path.slice(1) as ActiveTab;
  const html = renderTabShell(active, snapshotCache.get());
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
  return true;
}
```

For `activity` and `insights`, render a stub page:

```typescript
function renderStub(active: ActiveTab): string {
  return `
    <!doctype html><html lang="zh"><head><meta charset="utf-8"><title>${active}</title>
    <style>${LEADERSHIP_CSS}</style></head><body><div class="shell">
    ${renderNav(active)}
    <div class="stub-empty" style="padding:80px 40px;text-align:center;color:var(--ink-3);">
      <div class="serif" style="font-size:24px;color:var(--ink-2);margin-bottom:8px;">尚未实现</div>
      <div>${active} tab 计划在 Phase 3 上线</div>
    </div></div></body></html>
  `;
}
```

For `overview` and `people` and `projects`, delegate to existing renderers (which will be wired in P-B3..P-B5 for overview; people/projects can also stub for now and be filled in P-B5 as a "full-list" variant — keep this scope tight: P-B2 only adds nav + stub routes).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @matrix-riven/collector-server test -- nav routes`
Expected: PASS.

- [ ] **Step 6: Visual smoke**

Open `http://localhost:6066/`, `/people`, `/projects`, `/activity`, `/insights`. Verify:
- Nav is sticky-top, frosted (translucent over warm background)
- Active tab darker pill
- Live dot pulses
- Avatar in top right

- [ ] **Step 7: Commit**

```bash
git add packages/collector-server/src/leadership/views/_nav.html.ts \
        packages/collector-server/src/leadership/views/__tests__/nav.test.ts \
        packages/collector-server/src/leadership/routes.ts \
        packages/collector-server/src/leadership/__tests__/routes.test.ts
git commit -m "$(cat <<'EOF'
feat(leadership-p2): frosted top nav with 5 tabs

P-B2: sticky frosted-glass navbar (backdrop-filter blur 20px) hosting
Overview/People/Projects/Activity/Insights tabs. Activity and Insights
ship as stub pages — content lands in Phase 3.
EOF
)"
```

---

### Task 7 (P-B3): Editorial hero + KPI floating cards

**Files:**
- Create: `packages/collector-server/src/leadership/views/_copy.ts` — exports `heroHeadline`, `attentionLead`, `idleCallout`
- Create: `packages/collector-server/src/leadership/views/_overview-fragments.ts` — exports `renderHeroFragment`, `renderKpisFragment`
- Modify: `packages/collector-server/src/leadership/views/overview.html.ts` — compose new fragments
- Test: `packages/collector-server/src/leadership/views/__tests__/copy.test.ts` + `__tests__/overview-fragments.test.ts`

- [ ] **Step 1: Write the failing test (copy templates)**

Create `views/__tests__/copy.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { heroHeadline } from '../_copy.js';

describe('heroHeadline', () => {
  it('praises when 0 attention items', () => {
    const out = heroHeadline({ attentionCount: 0, highOutputCount: 4 });
    expect(out).toMatch(/平稳|顺利|没有/);
    expect(out).toContain('<em>');
  });
  it('mentions count when 1+', () => {
    const out = heroHeadline({ attentionCount: 3, highOutputCount: 2 });
    expect(out).toMatch(/三件|3 件|三/);
    expect(out).toContain('<em>');
  });
  it('escalates urgency when 5+', () => {
    const out = heroHeadline({ attentionCount: 6, highOutputCount: 1 });
    expect(out).toMatch(/需要|留意|多/);
  });
});
```

Create `views/__tests__/overview-fragments.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { renderHeroFragment, renderKpisFragment } from '../_overview-fragments.js';
import { makeSnapshotFixture } from './_fixtures.js';

describe('renderHeroFragment', () => {
  it('wraps in <header id="hero">', () => {
    const html = renderHeroFragment(makeSnapshotFixture());
    expect(html).toMatch(/^<header[^>]*id="hero"/);
  });
  it('uses serif H1 with em', () => {
    expect(renderHeroFragment(makeSnapshotFixture())).toMatch(/<h1[^>]*>[\s\S]*<em>[\s\S]*<\/em>/);
  });
});

describe('renderKpisFragment', () => {
  it('renders 4 kpi cards', () => {
    const html = renderKpisFragment(makeSnapshotFixture());
    expect((html.match(/class="kpi /g) ?? []).length).toBe(4);
  });
  it('each card has an SVG sparkline', () => {
    expect((renderKpisFragment(makeSnapshotFixture()).match(/<svg class="kpi-spark"/g) ?? []).length).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @matrix-riven/collector-server test -- copy overview-fragments`
Expected: FAIL.

- [ ] **Step 3: Implement copy templates**

```typescript
// packages/collector-server/src/leadership/views/_copy.ts
export function heroHeadline(ctx: { attentionCount: number; highOutputCount: number }): string {
  if (ctx.attentionCount === 0) {
    return `今天，团队 <em>一切顺利</em>。<br/>没有需要立即处理的事。`;
  }
  if (ctx.attentionCount === 1) {
    return `今天，团队总体 <em>平稳</em>。<br/>但有 <em>一件事</em> 值得你看一眼。`;
  }
  if (ctx.attentionCount < 5) {
    const cn = ['', '一', '两', '三', '四'][ctx.attentionCount];
    return `今天，团队总体 <em>平稳</em>。<br/>但有 <em>${cn}件事</em> 值得你看一眼。`;
  }
  return `今天有 <em>${ctx.attentionCount} 件事</em> 需要你留意。<br/>建议先看红色那条。`;
}

export function attentionLead(count: number): string {
  if (count === 1) return `一件事在等你 — <em>看一眼，决定要不要插手</em>。`;
  if (count < 5) return `${count} 件事在等你 — <em>看一眼，决定要不要插手</em>。`;
  return `${count} 件事需要你留意 — <em>按红/黄/灰排序，先处理最上面那条</em>。`;
}

export function idleCallout(ctx: { displayName: string; idleHours: number; lastFile?: string }): string {
  const file = ctx.lastFile ? `最后一次停在 <em>${ctx.lastFile}</em>` : '没有最近活动文件';
  if (ctx.idleHours < 4)  return `${ctx.displayName} 现在没在打字，但 ${ctx.idleHours} 小时不算异常。${file}。`;
  if (ctx.idleHours < 12) return `${ctx.displayName} 已经 ${ctx.idleHours} 小时没动了。${file}。<em>不像是卡住，更像是没开工</em>。`;
  return `${ctx.displayName} 已经 ${ctx.idleHours} 小时没动了 — 比平常长得多。${file}。<em>建议主动问一句</em>。`;
}
```

- [ ] **Step 4: Implement fragment renderers**

```typescript
// packages/collector-server/src/leadership/views/_overview-fragments.ts
import type { OverviewSnapshot } from '../types.js';
import { heroHeadline } from './_copy.js';

export function renderHeroFragment(snap: OverviewSnapshot): string {
  const attentionCount = snap.kpis.attention.value;
  const highOutputCount = snap.members.filter(m => m.deltaVs7dAvgPct > 0.2).length;
  const headline = heroHeadline({ attentionCount, highOutputCount });
  const now = new Date(snap.computedAt);
  const date = `${now.getMonth() + 1} 月 ${now.getDate()} 日`;
  return `
    <header id="hero" class="hero fade-in">
      <div>
        <h1 class="serif">${headline}</h1>
        <div class="sub">${date} · 数据每 30 秒刷新</div>
      </div>
      <div class="hero-meta">
        <div><strong>${snap.members.length}</strong> 位成员 · <strong>${snap.projects.length}</strong> 个项目</div>
      </div>
    </header>`;
}

export function renderKpisFragment(snap: OverviewSnapshot): string {
  const cards: { cls: string; label: string; num: string; unit: string; trend: string; color: string }[] = [
    { cls: 'kpi-warn',  label: '需要关注', num: String(snap.kpis.attention.value), unit: '项',
      trend: snap.kpis.attention.deltaToday > 0 ? `↑${snap.kpis.attention.deltaToday} 较昨日` : '与昨日持平',
      color: '#C8924B' },
    { cls: 'kpi-good',  label: '高产出',   num: String(snap.members.filter(m => m.deltaVs7dAvgPct > 0.2).length), unit: '人',
      trend: '对比 7 日均值', color: '#6F8B5E' },
    { cls: 'kpi-spend', label: '本周消耗', num: '¥' + Math.round(snap.members.reduce((a, m) => a + (m.today?.costUsd ?? 0) * 7.2, 0)), unit: '',
      trend: '按预算节奏', color: '#8A9AAA' },
    { cls: 'kpi-pace',  label: '整体节奏', num: snap.kpis.attention.value === 0 ? '顺' : '稳', unit: '健',
      trend: '多数项目按期', color: '#45433E' },
  ];
  const path = 'M0 14 Q 12 10, 20 12 T 40 8 T 64 4';
  const html = cards.map(c => `
    <div class="kpi ${c.cls}">
      <div class="kpi-label"><span class="kpi-dot"></span>${c.label}</div>
      <div class="kpi-num">${c.num}<span class="unit">${c.unit}</span></div>
      <div class="kpi-trend">${c.trend}</div>
      <svg class="kpi-spark" viewBox="0 0 64 22"><path d="${path}" stroke="${c.color}" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>
    </div>`).join('');
  return `<section id="kpis" class="kpis fade-in">${html}</section>`;
}
```

- [ ] **Step 5: Compose in overview**

In `views/overview.html.ts`, replace the existing KPI block with `${renderHeroFragment(snapshot)}${renderKpisFragment(snapshot)}`.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @matrix-riven/collector-server test -- copy overview-fragments`
Expected: PASS. Full suite still green.

- [ ] **Step 7: Commit**

```bash
git add packages/collector-server/src/leadership/views/_copy.ts \
        packages/collector-server/src/leadership/views/_overview-fragments.ts \
        packages/collector-server/src/leadership/views/overview.html.ts \
        packages/collector-server/src/leadership/views/__tests__/copy.test.ts \
        packages/collector-server/src/leadership/views/__tests__/overview-fragments.test.ts
git commit -m "$(cat <<'EOF'
feat(leadership-p2): editorial hero + KPI floating cards

P-B3: Newsreader-serif H1 with templated copy ('今天，团队总体平稳…'),
4 KPI cards (need-attention / high-output / spend / pace) each with
its own SVG sparkline. Pulled from v7 reference.
EOF
)"
```

---

### Task 8 (P-B4): Attention section with editorial card

**Files:**
- Modify: `packages/collector-server/src/leadership/types.ts` — add `AttentionItem` + `OverviewSnapshot.attention`
- Modify: `packages/collector-server/src/leadership/aggregator.ts` — `deriveAttention(snap)`
- Modify: `packages/collector-server/src/leadership/views/_overview-fragments.ts` — `renderAttentionFragment`
- Test: extend aggregator + fragment tests

- [ ] **Step 1: Write the failing test**

Append to `aggregator.test.ts`:

```typescript
describe('deriveAttention', () => {
  it('includes stuck / needs_help / low_activity members', () => {
    const snap = buildOverviewSnapshot(makeFixtureWithStates(['stuck', 'needs_help', 'low_activity']), fixtureRange);
    expect(snap.attention.length).toBe(3);
    expect(snap.attention.every(a => a.kind === 'member')).toBe(true);
  });
  it('includes projects with bus-factor warning or no activity 48h', () => {
    const snap = buildOverviewSnapshot(makeFixtureWithBusFactorProject(), fixtureRange);
    expect(snap.attention.some(a => a.kind === 'project')).toBe(true);
  });
  it('sorts by severity desc', () => {
    const snap = buildOverviewSnapshot(makeMixedFixture(), fixtureRange);
    for (let i = 0; i < snap.attention.length - 1; i++) {
      expect(snap.attention[i]!.severity).toBeGreaterThanOrEqual(snap.attention[i + 1]!.severity);
    }
  });
});
```

Append to `overview-fragments.test.ts`:

```typescript
describe('renderAttentionFragment', () => {
  it('renders attention rows with avatar + tag + line2', () => {
    const html = renderAttentionFragment({ ...makeSnapshotFixture(), attention: [{
      kind: 'member', refId: 'u@x.com', displayName: 'liboze', initials: 'li',
      tag: '闲置 11h', tagSeverity: 'urgent', line2: '上一次停在 api/overview.test.ts',
      time: '03:12', severity: 8,
    }]});
    expect(html).toMatch(/class="att-row"/);
    expect(html).toContain('闲置 11h');
    expect(html).toMatch(/class="att-tag urgent"/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @matrix-riven/collector-server test -- aggregator overview-fragments`
Expected: FAIL.

- [ ] **Step 3: Add `AttentionItem` type**

In `types.ts`:

```typescript
export interface AttentionItem {
  kind: 'member' | 'project';
  refId: string;                  // email or project name
  displayName: string;
  initials: string;
  tag: string;                    // pill text, e.g., "闲置 11h"
  tagSeverity: 'urgent' | 'normal' | 'calm';
  line2: string;                  // descriptive sentence, may contain <span class="mono">
  time: string;                   // 'HH:MM' or arrow glyph
  severity: number;               // 0–10 for sort
}

export interface OverviewSnapshot {
  // ... existing fields ...
  attention: AttentionItem[];     // Phase 2 addition
}
```

- [ ] **Step 4: Implement `deriveAttention` in aggregator**

```typescript
function deriveAttention(members: MemberSnapshot[], projects: ProjectSnapshot[]): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const m of members) {
    if (m.stateBadge === 'stuck') items.push({
      kind: 'member', refId: m.email, displayName: m.displayName, initials: m.displayName.slice(0, 2),
      tag: '疑似卡住', tagSeverity: 'urgent',
      line2: `连续多次问同一类问题`, time: '—', severity: 9,
    });
    if (m.stateBadge === 'needs_help') items.push({
      kind: 'member', refId: m.email, displayName: m.displayName, initials: m.displayName.slice(0, 2),
      tag: '求助', tagSeverity: 'urgent',
      line2: m.warnings[0] ?? `多次失败`, time: '—', severity: 8,
    });
    if (m.stateBadge === 'low_activity') items.push({
      kind: 'member', refId: m.email, displayName: m.displayName, initials: m.displayName.slice(0, 2),
      tag: `闲置`, tagSeverity: 'normal',
      line2: `7 日活跃低于均值`, time: '—', severity: 5,
    });
  }
  for (const p of projects) {
    if (p.busFactorWarning) items.push({
      kind: 'project', refId: p.name, displayName: p.name, initials: p.name.slice(0, 2).toUpperCase(),
      tag: '单点依赖', tagSeverity: 'calm', line2: `顶贡献者份额 > 70%`, time: '—', severity: 4,
    });
    if (p.state === 'dormant' && p.contributors.length > 0) items.push({
      kind: 'project', refId: p.name, displayName: p.name, initials: p.name.slice(0, 2).toUpperCase(),
      tag: '沉睡', tagSeverity: 'calm', line2: `48 小时无活动`, time: '—', severity: 3,
    });
  }
  return items.sort((a, b) => b.severity - a.severity);
}
```

Call it in `buildOverviewSnapshot` and assign to `snap.attention`.

- [ ] **Step 5: Implement `renderAttentionFragment`**

Add to `_overview-fragments.ts`:

```typescript
import { attentionLead } from './_copy.js';
import { avatarColor, emailInitials } from './_helpers.js';

export function renderAttentionFragment(snap: OverviewSnapshot): string {
  if (snap.attention.length === 0) return `<section id="attention"></section>`;
  const lead = attentionLead(snap.attention.length);
  const rows = snap.attention.map(a => `
    <div class="att-row" data-ref="${escapeHtml(a.kind)}:${escapeHtml(a.refId)}" onclick="window.openSO('${a.kind}', '${escapeHtml(a.refId)}')">
      <div class="att-avatar ${avatarColor(a.refId)}">${escapeHtml(a.initials)}</div>
      <div class="att-body">
        <div class="att-line1"><strong>${escapeHtml(a.displayName)}</strong><span class="att-tag ${a.tagSeverity}">${escapeHtml(a.tag)}</span></div>
        <div class="att-line2">${a.line2}</div>
      </div>
      <div class="att-time">${escapeHtml(a.time)}</div>
      <div class="att-arrow">›</div>
    </div>`).join('');
  return `
    <section id="attention" class="section fade-in">
      <div class="section-head">
        <div class="section-title">需要你看一眼 <span class="section-count">${snap.attention.length}</span></div>
      </div>
      <div class="attention">
        <div class="attention-head">
          <div class="attention-icon">⚠</div>
          <div class="attention-headline serif">${lead}</div>
        </div>
        <div class="attention-list">${rows}</div>
      </div>
    </section>`;
}
```

- [ ] **Step 6: Run tests + Commit**

```bash
git add packages/collector-server/src/leadership/types.ts \
        packages/collector-server/src/leadership/aggregator.ts \
        packages/collector-server/src/leadership/views/_overview-fragments.ts \
        packages/collector-server/src/leadership/__tests__/aggregator.test.ts \
        packages/collector-server/src/leadership/views/__tests__/overview-fragments.test.ts
git commit -m "$(cat <<'EOF'
feat(leadership-p2): attention section with editorial card

P-B4: derive AttentionItem[] in aggregator (stuck / needs_help /
low_activity members + bus-factor / dormant projects), sort by
severity, render as editorial card with serif lead and click-to-
slideover rows.
EOF
)"
```

---

### Task 9 (P-B5): v7 member grid + project list with sortable lists

**Files:**
- Modify: `packages/collector-server/src/leadership/views/_overview-fragments.ts` — `renderMembersFragment`, `renderProjectsFragment`
- Create: `packages/collector-server/src/leadership/views/_refresh.js.ts` — exports `CLIENT_REFRESH_SCRIPT` (initial version: only sort handlers; polling added in P-C2)
- Modify: `packages/collector-server/src/leadership/views/overview.html.ts` — compose
- Test: `views/__tests__/overview-fragments.test.ts`

- [ ] **Step 1: Write the failing test**

Append:

```typescript
describe('renderMembersFragment', () => {
  const snap = makeSnapshotFixture({ members: 6 });
  it('renders a tile per member', () => {
    expect((renderMembersFragment(snap).match(/class="member-tile"/g) ?? []).length).toBe(6);
  });
  it('includes sort buttons', () => {
    const html = renderMembersFragment(snap);
    expect(html).toContain('data-sort="attention"');
    expect(html).toContain('data-sort="activity"');
    expect(html).toContain('data-sort="alpha"');
  });
  it('each tile has 3 stats + SVG sparkline', () => {
    const html = renderMembersFragment(snap);
    const tileCount = (html.match(/class="member-tile"/g) ?? []).length;
    expect((html.match(/class="mt-stat-num"/g) ?? []).length).toBe(tileCount * 3);
    expect((html.match(/class="mt-spark"/g) ?? []).length).toBe(tileCount);
  });
});

describe('renderProjectsFragment', () => {
  it('renders a row per project + avatar stack', () => {
    const snap = makeSnapshotFixture({ projects: 5 });
    const html = renderProjectsFragment(snap);
    expect((html.match(/class="proj-row"/g) ?? []).length).toBe(5);
    expect(html).toContain('proj-people-stack');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @matrix-riven/collector-server test -- overview-fragments`
Expected: FAIL.

- [ ] **Step 3: Implement member tile renderer**

Add to `_overview-fragments.ts` (copy markup verbatim from v7 reference, just fill data):

```typescript
export function renderMembersFragment(snap: OverviewSnapshot): string {
  const tiles = snap.members.map(m => {
    const initials = emailInitials(m.email);
    const status = m.stateBadge === 'active' ? 'active' : m.stateBadge === 'low_activity' ? 'idle' : 'warn';
    const sparkPath = sparkFromTrend(m.trend7d);
    return `
      <div class="member-tile" onclick="window.openSO('member', '${escapeHtml(m.email)}')">
        <div class="mt-head">
          <div class="mt-avatar ${avatarColor(m.email)}">${initials}<div class="mt-status ${status}"></div></div>
          <div><div class="mt-name">${escapeHtml(m.displayName)}</div><div class="mt-sub">${escapeHtml(memberSubLabel(m))}</div></div>
        </div>
        <div class="mt-where">
          <span class="where-label">在做</span>
          <span class="where-val">${escapeHtml(m.topProject ?? '—')}</span>
        </div>
        <div class="mt-stats">
          <div><div class="mt-stat-num">${m.today.sessions}</div><div class="mt-stat-label">会话</div></div>
          <div><div class="mt-stat-num">¥${Math.round(m.today.tokens / 100) / 10}k</div><div class="mt-stat-label">消耗</div></div>
          <div><div class="mt-stat-num">${Math.round((1 - (m.detail?.toolFailureRate ?? 0)) * 100)}%</div><div class="mt-stat-label">健康</div></div>
        </div>
        <svg class="mt-spark" viewBox="0 0 48 16"><path d="${sparkPath}" stroke="${status === 'idle' ? '#C8924B' : '#6F8B5E'}" stroke-width="1.2" fill="none" stroke-linecap="round"/></svg>
      </div>`;
  }).join('');
  return `
    <section id="members" class="section fade-in">
      <div class="section-head">
        <div class="section-title">团队 <span class="section-count">${snap.members.length}</span></div>
        <div class="sort-toggle">
          <button data-sort="attention">需关注</button>
          <button data-sort="activity">活跃</button>
          <button data-sort="alpha">字母</button>
        </div>
      </div>
      <div class="members">${tiles}</div>
    </section>`;
}

function sparkFromTrend(trend: number[]): string {
  if (trend.length === 0) return 'M0 8 L48 8';
  const max = Math.max(...trend, 1);
  const pts = trend.map((v, i) => {
    const x = (i / (trend.length - 1)) * 48;
    const y = 14 - (v / max) * 12;
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  return 'M' + pts.join(' L');
}

function memberSubLabel(m: MemberSnapshot): string {
  if (m.deltaVs7dAvgPct > 0.2) return `高产出 ↑${Math.round(m.deltaVs7dAvgPct * 100)}%`;
  if (m.stateBadge === 'low_activity') return `闲置`;
  return `${m.today.sessions} 会话`;
}
```

- [ ] **Step 4: Implement project row renderer**

Same pattern — copy `proj-row` HTML from v7, fill from `ProjectSnapshot`. Include progress bar via `(p.detail?.recentFiles.length ?? 0)` over a placeholder total, avatar stack from `p.contributors[0..3]`.

- [ ] **Step 5: Sort handler script**

```typescript
// packages/collector-server/src/leadership/views/_refresh.js.ts
export const CLIENT_REFRESH_SCRIPT = `
(function () {
  function sortTiles(section, key) {
    const root = section.querySelector('.members, .proj-list, .projects');
    if (!root) return;
    const items = Array.from(root.children);
    items.sort((a, b) => (parseFloat(b.dataset[key] || '0') - parseFloat(a.dataset[key] || '0')));
    items.forEach(el => root.appendChild(el));
  }
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sort]');
    if (!btn) return;
    sortTiles(btn.closest('section'), btn.dataset.sort);
  });
  // openSO/closeSO live here too (will be expanded in P-B6 + P-C)
  window.openSO = window.openSO || function (kind, id) {
    window.location.hash = '#detail=' + kind + ':' + id;
  };
})();
`;
```

Add `data-attention="<severity>"`, `data-activity="<sessions>"`, `data-alpha="<name>"` attributes onto each tile and row in render functions.

- [ ] **Step 6: Run tests + Commit**

```bash
git add packages/collector-server/src/leadership/views/_overview-fragments.ts \
        packages/collector-server/src/leadership/views/_refresh.js.ts \
        packages/collector-server/src/leadership/views/overview.html.ts \
        packages/collector-server/src/leadership/views/__tests__/overview-fragments.test.ts
git commit -m "$(cat <<'EOF'
feat(leadership-p2): v7 member grid + project list with sortable lists

P-B5: 4-column member tiles (avatar+state+where+3 stats+sparkline) and
project rows (icon+name+progress+ETA+avatar stack). Client sort
toggles by needAttention/activity/alpha. Copied from v7 reference.
EOF
)"
```

---

### Task 10 (P-B6): Slide-over detail panel replaces full detail pages

**Files:**
- Create: `packages/collector-server/src/leadership/views/_slideover.html.ts` — exports `renderSlideoverShell()` (static markup) + `renderMemberSlideoverFragments(detail)` + `renderProjectSlideoverFragments(detail)`
- Delete: `packages/collector-server/src/leadership/views/member-detail.html.ts` + `project-detail.html.ts` (or replace their bodies with deprecation stubs)
- Modify: `packages/collector-server/src/leadership/routes.ts` — `/api/members/:id` returns `{ ...detail, _html: { callout, stats, evolve, projects } }`; remove the HTML routes `/members/:id`, `/projects/:name` (or redirect to `/people`/`/projects` with `?detail=` query)
- Modify: `packages/collector-server/src/leadership/views/overview.html.ts` — inject `renderSlideoverShell()`
- Modify: `packages/collector-server/src/leadership/views/_refresh.js.ts` — full `openSO`/`closeSO` with fetch + DOM swap
- Test: `views/__tests__/slideover.test.ts` + extend `routes.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
describe('renderSlideoverShell', () => {
  it('contains scrim + slideover + close button', () => {
    const html = renderSlideoverShell();
    expect(html).toContain('id="scrim"');
    expect(html).toContain('id="so"');
    expect(html).toContain('so-close');
  });
});

describe('renderMemberSlideoverFragments', () => {
  it('produces callout, stats, evolve, projects fragments', () => {
    const f = renderMemberSlideoverFragments(makeMemberDetailFixture());
    expect(f).toHaveProperty('callout');
    expect(f).toHaveProperty('stats');
    expect(f).toHaveProperty('evolve');
    expect(f).toHaveProperty('projects');
    expect(f.callout).toContain('so-callout-text serif');
  });
});
```

In `routes.test.ts`:

```typescript
it('GET /api/members/:id returns _html fragments', async () => {
  const res = await request(app).get('/api/members/liboze');
  expect(res.status).toBe(200);
  expect(res.body._html).toBeDefined();
  expect(typeof res.body._html.callout).toBe('string');
  expect(typeof res.body._html.stats).toBe('string');
  expect(typeof res.body._html.evolve).toBe('string');
  expect(typeof res.body._html.projects).toBe('string');
});

it('GET /members/:id no longer renders full HTML page (returns 410 or redirects)', async () => {
  const res = await request(app).get('/members/liboze');
  expect([301, 302, 410]).toContain(res.status);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @matrix-riven/collector-server test -- slideover routes`
Expected: FAIL.

- [ ] **Step 3: Implement `_slideover.html.ts`**

Copy the `<aside class="slideover">` block from v7 reference verbatim into `renderSlideoverShell()`. Then:

```typescript
export function renderMemberSlideoverFragments(member: MemberSnapshot, detail: MemberDetail): {
  callout: string; stats: string; evolve: string; projects: string;
} {
  const idleHours = computeIdleHours(member);
  const lastFile = detail.sessions[0]?.firstPromptPreview;
  return {
    callout: `<div id="so-callout" class="so-callout"><div class="so-callout-icon">!</div><div class="so-callout-text serif">${idleCallout({ displayName: member.displayName, idleHours, lastFile })}</div></div>`,
    stats:   `<div id="so-stats" class="so-stats"><div class="so-stat"><div class="so-stat-num">${member.today.sessions}</div><div class="so-stat-label">会话总数</div></div><div class="so-stat"><div class="so-stat-num">¥${(member.today.costUsd * 7.2).toFixed(1)}k</div><div class="so-stat-label">本周消耗</div></div><div class="so-stat"><div class="so-stat-num">${Math.round((1 - detail.toolFailureRate) * 100)}%</div><div class="so-stat-label">健康分</div></div></div>`,
    evolve:  `<div id="so-evolve" class="so-evolve">${renderEvolveTimeline(detail.sessions)}</div>`,
    projects: `<div id="so-projects">${renderProjectChips(member, detail)}</div>`,
  };
}
```

`renderProjectSlideoverFragments` follows the same shape but with project-specific content.

- [ ] **Step 4: Wire API**

In `routes.ts`:

```typescript
if (req.method === 'GET' && /^\/api\/members\/[^/]+$/.test(path)) {
  const id = path.split('/')[3]!;
  const member = snap.members.find(m => m.email.startsWith(id + '@') || m.displayName === id);
  if (!member) { res.writeHead(404).end(); return true; }
  const detail = buildMemberDetail(member.email);
  const _html = renderMemberSlideoverFragments(member, detail);
  const body = JSON.stringify({ ...member, detail, _html });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(body);
  return true;
}
```

Remove the old `/members/:id` HTML route entirely. Return 410 Gone for those paths or redirect to `/people?detail=member:<id>`.

- [ ] **Step 5: Migrate P-A3/P-A4 logic**

The "all-prompts expand" (P-A3) and "view-raw link" (P-A4) live in the deleted `member-detail.html.ts`. Move both into `renderEvolveTimeline` / per-session row inside the slide-over's `evolve` fragment. Their existing tests should still pass after import-path updates.

- [ ] **Step 6: Inject shell into overview**

In `views/overview.html.ts`, before `</body>`, add `${renderSlideoverShell()}`.

- [ ] **Step 7: Implement open/close JS**

Extend `_refresh.js.ts`:

```javascript
window.openSO = async function (kind, id) {
  document.getElementById('scrim').classList.add('open');
  const so = document.getElementById('so');
  so.classList.add('open');
  const url = '/api/' + (kind === 'member' ? 'members' : 'projects') + '/' + encodeURIComponent(id);
  const resp = await fetch(url);
  const data = await resp.json();
  // Update head
  document.querySelector('#so .so-name').textContent = data.displayName ?? data.name;
  document.querySelector('#so .so-meta').textContent = data.warnings?.[0] ?? '';
  // Swap fragments
  document.getElementById('so-callout').outerHTML  = data._html.callout;
  document.getElementById('so-stats').outerHTML    = data._html.stats;
  document.getElementById('so-evolve').outerHTML   = data._html.evolve;
  document.getElementById('so-projects').outerHTML = data._html.projects;
  document.body.style.overflow = 'hidden';
};
window.closeSO = function () {
  document.getElementById('scrim').classList.remove('open');
  document.getElementById('so').classList.remove('open');
  document.body.style.overflow = '';
};
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.closeSO(); });
document.getElementById('scrim')?.addEventListener('click', () => window.closeSO());
```

- [ ] **Step 8: Run tests + Commit**

```bash
git add packages/collector-server/src/leadership/views/_slideover.html.ts \
        packages/collector-server/src/leadership/views/_refresh.js.ts \
        packages/collector-server/src/leadership/views/overview.html.ts \
        packages/collector-server/src/leadership/routes.ts \
        packages/collector-server/src/leadership/views/__tests__/slideover.test.ts \
        packages/collector-server/src/leadership/__tests__/routes.test.ts
git rm packages/collector-server/src/leadership/views/member-detail.html.ts \
       packages/collector-server/src/leadership/views/project-detail.html.ts || true
git commit -m "$(cat <<'EOF'
feat(leadership-p2): slide-over detail panel replaces full detail pages

P-B6: 520px slide-over with scrim + spring animation. /api/members/:id
and /api/projects/:name now return JSON + _html fragments (callout,
stats, evolve, projects). The full-page member-detail/project-detail
HTML renderers are removed; the old /members/:id route returns 410.
EOF
)"
```

---

## Milestone P-C — Dynamic data (3 tasks)

### Task 11 (P-C1): ETag + per-section HTML fragments in overview API

**Files:**
- Modify: `packages/collector-server/src/leadership/routes.ts` — ETag + `_html` on `/api/overview`
- Test: `__tests__/routes.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { createHash } from 'node:crypto';

it('GET /api/overview returns _html for all sections', async () => {
  const res = await request(app).get('/api/overview');
  expect(res.status).toBe(200);
  expect(res.body._html.hero).toBeDefined();
  expect(res.body._html.kpis).toBeDefined();
  expect(res.body._html.attention).toBeDefined();
  expect(res.body._html.members).toBeDefined();
  expect(res.body._html.projects).toBeDefined();
});

it('GET /api/overview returns ETag and 304 on If-None-Match match', async () => {
  const first = await request(app).get('/api/overview');
  const etag = first.headers.etag;
  expect(etag).toMatch(/^"[a-f0-9]{16}"$/);
  const second = await request(app).get('/api/overview').set('If-None-Match', etag);
  expect(second.status).toBe(304);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @matrix-riven/collector-server test -- routes`
Expected: FAIL.

- [ ] **Step 3: Implement ETag + fragments**

In `routes.ts`:

```typescript
import { createHash } from 'node:crypto';
import { renderHeroFragment, renderKpisFragment, renderAttentionFragment, renderMembersFragment, renderProjectsFragment } from './views/_overview-fragments.js';

function etagFor(obj: unknown): string {
  return '"' + createHash('sha1').update(JSON.stringify(obj)).digest('hex').slice(0, 16) + '"';
}

// In the /api/overview branch:
const snap = snapshotCache.get();
const etag = etagFor(snap);
if (req.headers['if-none-match'] === etag) {
  res.writeHead(304, { etag });
  res.end();
  return true;
}
const _html = {
  hero: renderHeroFragment(snap),
  kpis: renderKpisFragment(snap),
  attention: renderAttentionFragment(snap),
  members: renderMembersFragment(snap),
  projects: renderProjectsFragment(snap),
};
res.writeHead(200, { 'content-type': 'application/json', etag });
res.end(JSON.stringify({ ...snap, _html }));
return true;
```

- [ ] **Step 4: Run tests + Commit**

```bash
git add packages/collector-server/src/leadership/routes.ts \
        packages/collector-server/src/leadership/__tests__/routes.test.ts
git commit -m "$(cat <<'EOF'
feat(leadership-p2): ETag + per-section HTML fragments in overview API

P-C1: /api/overview returns _html: { hero, kpis, attention, members,
projects } and an ETag. Requests with If-None-Match matching the
current ETag receive 304 with no body.
EOF
)"
```

---

### Task 12 (P-C2): Overview live polling with ETag + fragment swap

**Files:**
- Modify: `packages/collector-server/src/leadership/views/_refresh.js.ts` — add polling loop + KPI change badges

- [ ] **Step 1: Extend `CLIENT_REFRESH_SCRIPT`**

```javascript
(function () {
  let etag = null;
  let lastKpis = JSON.parse(localStorage.getItem('lh.lastKpis') || 'null');

  async function poll() {
    try {
      const resp = await fetch('/api/overview', { headers: etag ? { 'If-None-Match': etag } : {} });
      if (resp.status === 304) return;
      etag = resp.headers.get('etag');
      const snap = await resp.json();
      document.getElementById('hero').outerHTML       = snap._html.hero;
      document.getElementById('kpis').outerHTML       = snap._html.kpis;
      document.getElementById('attention').outerHTML  = snap._html.attention;
      document.getElementById('members').outerHTML    = snap._html.members;
      document.getElementById('projects').outerHTML   = snap._html.projects;
      // KPI delta badges
      if (lastKpis) showDeltas(lastKpis, snap.kpis);
      lastKpis = snap.kpis;
      localStorage.setItem('lh.lastKpis', JSON.stringify(snap.kpis));
      document.querySelector('.live-dot')?.classList.add('pulse');
      setTimeout(() => document.querySelector('.live-dot')?.classList.remove('pulse'), 1500);
    } catch (e) { /* swallow */ }
  }

  function showDeltas(prev, curr) {
    const fields = ['attention', 'teamActivity'];
    for (const k of fields) {
      const delta = (curr[k]?.value ?? 0) - (prev[k]?.value ?? 0);
      if (delta === 0) continue;
      const card = document.querySelector('[data-kpi="' + k + '"]');
      if (!card) continue;
      const badge = document.createElement('span');
      badge.className = 'kpi-badge ' + (delta > 0 ? 'up' : 'down');
      badge.textContent = (delta > 0 ? '↑' : '↓') + Math.abs(delta);
      card.appendChild(badge);
      setTimeout(() => badge.remove(), 5000);
    }
  }

  setInterval(poll, 30000);
  // First poll is unnecessary on initial page load (HTML already rendered with current data);
  // setInterval ensures the first poll happens at 30s.
})();
```

- [ ] **Step 2: Browser smoke**

Start server, open `/overview`, leave for 35 s. Verify:
- Right-side `.live-dot` pulses once around the 30 s mark
- If you touch a `.jsonl` file in `RIVEN_COLLECTOR_DIR` (force snapshot rebuild), KPI numbers update + delta badge appears for ~5 s then fades

- [ ] **Step 3: Commit**

```bash
git add packages/collector-server/src/leadership/views/_refresh.js.ts
git commit -m "$(cat <<'EOF'
feat(leadership-p2): overview live polling with ETag + fragment swap

P-C2: setInterval(30s) fetch /api/overview with If-None-Match; on 200
swap 5 fragments via outerHTML; track KPI deltas in localStorage and
flash ±N badges that fade after 5s.
EOF
)"
```

---

### Task 13 (P-C3): Slide-over live polling on open

**Files:**
- Modify: `packages/collector-server/src/leadership/views/_refresh.js.ts` — second-polling on open
- Modify: `packages/collector-server/src/leadership/routes.ts` — ETag on detail endpoints
- Test: `__tests__/routes.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it('GET /api/members/:id supports ETag/304', async () => {
  const first = await request(app).get('/api/members/liboze');
  const etag = first.headers.etag;
  expect(etag).toMatch(/^"[a-f0-9]{16}"$/);
  const second = await request(app).get('/api/members/liboze').set('If-None-Match', etag);
  expect(second.status).toBe(304);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @matrix-riven/collector-server test -- routes`
Expected: FAIL.

- [ ] **Step 3: Implement ETag in detail handler**

Same `etagFor` pattern, applied to the full detail JSON response (including `_html`).

- [ ] **Step 4: Extend `openSO` with polling**

```javascript
let soInterval = null;
let soEtag = null;
let soKind = null;
let soId = null;

window.openSO = async function (kind, id) {
  soKind = kind; soId = id; soEtag = null;
  document.getElementById('scrim').classList.add('open');
  document.getElementById('so').classList.add('open');
  document.body.style.overflow = 'hidden';
  await refreshSO();
  if (soInterval) clearInterval(soInterval);
  soInterval = setInterval(refreshSO, 30000);
};
window.closeSO = function () {
  document.getElementById('scrim').classList.remove('open');
  document.getElementById('so').classList.remove('open');
  document.body.style.overflow = '';
  if (soInterval) clearInterval(soInterval);
  soInterval = null;
};
async function refreshSO() {
  if (!soKind || !soId) return;
  const url = '/api/' + (soKind === 'member' ? 'members' : 'projects') + '/' + encodeURIComponent(soId);
  const headers = soEtag ? { 'If-None-Match': soEtag } : {};
  const resp = await fetch(url, { headers });
  if (resp.status === 304) return;
  soEtag = resp.headers.get('etag');
  const data = await resp.json();
  document.querySelector('#so .so-name').textContent = data.displayName ?? data.name;
  document.getElementById('so-callout').outerHTML  = data._html.callout;
  document.getElementById('so-stats').outerHTML    = data._html.stats;
  document.getElementById('so-evolve').outerHTML   = data._html.evolve;
  document.getElementById('so-projects').outerHTML = data._html.projects;
}
```

- [ ] **Step 5: Run tests + smoke + Commit**

Smoke: open slide-over, leave 35 s, change a `.jsonl` mtime, observe fragments update inside the open drawer.

```bash
git add packages/collector-server/src/leadership/views/_refresh.js.ts \
        packages/collector-server/src/leadership/routes.ts \
        packages/collector-server/src/leadership/__tests__/routes.test.ts
git commit -m "$(cat <<'EOF'
feat(leadership-p2): slide-over live polling on open

P-C3: opening a slide-over starts a 30s polling loop with ETag/304 on
/api/members/:id or /api/projects/:name; closing the drawer clears the
interval. Updates only the 4 inner fragments, leaves head intact.
EOF
)"
```

---

## Milestone P-D — Performance + smoke (2 tasks)

### Task 14 (P-D1): On-disk session index for sub-2s cold start

**Files:**
- Create: `packages/collector-server/src/leadership/index.ts` — `loadIndex`, `appendIndex`, `rebuildIndex`
- Modify: `packages/collector-server/src/leadership/transcript-loader.ts` — `scanAllSessions` consults index first
- Modify: collector POST handler — append index entry on successful `.json` write
- Test: `packages/collector-server/src/leadership/__tests__/index.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { rebuildIndex, loadIndex, appendIndex } from '../index.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('leadership index', () => {
  it('rebuildIndex scans dir and writes .leadership-index.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'idx-'));
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ sessionId: 'a', captured_at: '2026-05-17T00:00:00Z' }));
    writeFileSync(join(dir, 'b.jsonl'), '{"sessionId":"b","ts":"2026-05-17T01:00:00Z"}\n');
    await rebuildIndex(dir);
    const idx = await loadIndex(dir);
    expect(idx.entries.length).toBe(2);
  });

  it('appendIndex adds an entry idempotently', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'idx-'));
    await rebuildIndex(dir);
    await appendIndex(dir, { sessionId: 'c', file: 'c.json', mtime: 0, capturedAt: '2026-05-17T02:00:00Z' });
    await appendIndex(dir, { sessionId: 'c', file: 'c.json', mtime: 0, capturedAt: '2026-05-17T02:00:00Z' });
    const idx = await loadIndex(dir);
    expect(idx.entries.filter(e => e.sessionId === 'c').length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @matrix-riven/collector-server test -- index.test`
Expected: FAIL.

- [ ] **Step 3: Implement `index.ts`**

```typescript
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export interface IndexEntry {
  sessionId: string;
  file: string;        // relative to collectorDir
  mtime: number;
  capturedAt: string;
}

export interface SessionIndex { version: 1; builtAt: string; entries: IndexEntry[]; }

const FILE = '.leadership-index.json';

export async function loadIndex(dir: string): Promise<SessionIndex> {
  try {
    const buf = await fs.readFile(join(dir, FILE), 'utf-8');
    return JSON.parse(buf);
  } catch {
    return { version: 1, builtAt: new Date().toISOString(), entries: [] };
  }
}

export async function rebuildIndex(dir: string): Promise<SessionIndex> {
  const names = (await fs.readdir(dir)).filter(n => n.endsWith('.json') || n.endsWith('.jsonl'));
  const entries: IndexEntry[] = [];
  for (const name of names) {
    if (name === FILE) continue;
    const st = await fs.stat(join(dir, name));
    // Lazy: only the first line / first object for capturedAt + sessionId
    const buf = await fs.readFile(join(dir, name), 'utf-8');
    const firstLine = buf.split('\n')[0] ?? '{}';
    let meta: any = {};
    try { meta = JSON.parse(firstLine); } catch {}
    entries.push({
      sessionId: meta.sessionId ?? meta.session_id ?? name.replace(/\.(json|jsonl)$/, ''),
      file: name,
      mtime: st.mtimeMs,
      capturedAt: meta.captured_at ?? meta.ts ?? new Date(st.mtimeMs).toISOString(),
    });
  }
  const idx: SessionIndex = { version: 1, builtAt: new Date().toISOString(), entries };
  // Atomic write: tmp + rename
  const tmp = join(dir, FILE + '.tmp.' + process.pid);
  await fs.writeFile(tmp, JSON.stringify(idx));
  await fs.rename(tmp, join(dir, FILE));
  return idx;
}

export async function appendIndex(dir: string, e: IndexEntry): Promise<void> {
  const idx = await loadIndex(dir);
  if (idx.entries.some(x => x.sessionId === e.sessionId)) return;
  idx.entries.push(e);
  const tmp = join(dir, FILE + '.tmp.' + process.pid);
  await fs.writeFile(tmp, JSON.stringify(idx));
  await fs.rename(tmp, join(dir, FILE));
}
```

- [ ] **Step 4: Wire index-first scan**

In `transcript-loader.ts` `scanAllSessions`:

```typescript
export async function scanAllSessions(dir: string): Promise<ParsedSession[]> {
  let idx = await loadIndex(dir);
  if (idx.entries.length === 0) idx = await rebuildIndex(dir);
  const sessions: ParsedSession[] = [];
  for (const e of idx.entries) {
    try {
      const st = await fs.stat(join(dir, e.file));
      if (st.mtimeMs !== e.mtime) continue; // stale — fall back to full scan path below
      const buf = await fs.readFile(join(dir, e.file));
      sessions.push(e.file.endsWith('.jsonl') ? parseRawJsonlBuffer(buf) : parseEnvelopeBuffer(buf));
    } catch { /* file gone, skip */ }
  }
  return sessions;
}
```

- [ ] **Step 5: Append on POST**

In the existing `POST /v1/cc-sessions` handler (collector ingest path), after the successful `fs.writeFileSync`, call:

```typescript
appendIndex(collectorDir, {
  sessionId: envelope.session_id,
  file: relativePath,
  mtime: Date.now(),
  capturedAt: envelope.captured_at,
}).catch(() => {});
```

- [ ] **Step 6: Server startup: rebuild in background if missing**

In `mock-server.ts` (or wherever the leadership module is mounted), after listen starts:

```typescript
(async () => {
  const idx = await loadIndex(collectorDir);
  if (idx.entries.length === 0) {
    setImmediate(() => rebuildIndex(collectorDir).catch(() => {}));
  }
})();
```

- [ ] **Step 7: Perf validation**

Run `node scripts/perf-leadership.mjs`. Expect cold start < 2 s, warm < 50 ms. If still > 2 s, profile: probably first-line parse is too slow on large `.jsonl`s — bail out of full file read in `rebuildIndex` and use a streaming first-line reader.

- [ ] **Step 8: Commit**

```bash
git add packages/collector-server/src/leadership/index.ts \
        packages/collector-server/src/leadership/transcript-loader.ts \
        packages/collector-server/src/mock-server.ts \
        packages/collector-server/src/leadership/__tests__/index.test.ts
git commit -m "$(cat <<'EOF'
feat(leadership-p2): on-disk session index for sub-2s cold start

P-D1: .leadership-index.json built on first scan (or async at server
startup), appended after every POST /v1/cc-sessions write, atomic
rename for safety. scanAllSessions consults the index first and only
hits the disk for sessions whose mtime matches the index entry.
EOF
)"
```

---

### Task 15 (P-D2): Final smoke + perf validation

**Files:**
- Create: `docs/superpowers/smoke/2026-05-17-leadership-p2-smoke.md`
- Update: `scripts/perf-leadership.mjs` if needed for new endpoint

- [ ] **Step 1: Full test suite**

Run: `pnpm --filter @matrix-riven/collector-server test --run`
Expected: > 720 tests passing (baseline 719 + new tests added through P-A..P-C).

- [ ] **Step 2: Perf script**

Run: `node scripts/perf-leadership.mjs`
Capture cold and warm latencies.
Expected: cold < 2000 ms, warm < 50 ms.

- [ ] **Step 3: Browser smoke checklist**

Start server. In a fresh browser tab, run through:

1. `http://localhost:6066/overview` — v7 visual: warm `#F7F6F2` background, frosted nav, serif H1 with em, sage accent, 28px rounded major cards, soft shadows, no hard borders
2. Click `People` / `Projects` tabs — both render with nav + stub or content (depending on what's implemented in P-B5)
3. Click `Activity` / `Insights` — both show "尚未实现" stub
4. KPI cards — each has SVG sparkline, hover lifts -2px
5. Attention rows — clickable, open slide-over
6. Member tile — click opens slide-over
7. Slide-over — 520px wide, spring entrance, scrim has blur backdrop, ESC closes, scrim click closes
8. Sort toggles — `需关注` / `活跃` / `字母` reorder member tiles
9. Wait 35 s on Overview without interaction — live dot pulses, KPI numbers may update with ±N badge
10. Open slide-over, wait 35 s — drawer fragments refresh
11. Touch a `.jsonl` file (`touch RIVEN_COLLECTOR_DIR/some.jsonl`) — within 30 s, the page reflects the change

- [ ] **Step 4: ETag 304 ratio check**

Tail the access log for one minute on a stable session:

```bash
node packages/collector-server/dist/server.js 2>&1 | tee /tmp/server.log &
# Wait, observe, then count
grep '304' /tmp/server.log | wc -l
grep '200 /api/overview' /tmp/server.log | wc -l
```

304 count should be > 50% of total `/api/overview` requests.

- [ ] **Step 5: Write smoke doc**

Create `docs/superpowers/smoke/2026-05-17-leadership-p2-smoke.md`:

```markdown
# Leadership Phase 2 Smoke Report

**Date:** 2026-05-17
**Branch:** worktree-enumerated-roaming-engelbart
**Build:** $(git rev-parse --short HEAD)

## Test suite

- Total tests: <fill>
- Phase 2 new tests: <fill>
- All green

## Perf (perf-leadership.mjs)

- Cold start: <fill> ms (target < 2000)
- Warm start: <fill> ms (target < 50)

## Browser smoke — 11 items

[checklist with screenshots]

## ETag 304 ratio

- 200 responses: <fill>
- 304 responses: <fill>
- 304 ratio: <fill>% (target > 50%)

## Known limitations

- Activity / Insights tabs are stubs (deliberate, Phase 3)
- ...
```

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/smoke/2026-05-17-leadership-p2-smoke.md \
        scripts/perf-leadership.mjs
git commit -m "$(cat <<'EOF'
test(leadership-p2): final smoke + perf validation

P-D2: full test suite green, perf script confirms cold < 2s / warm
< 50ms, browser smoke walks 11 items including v7 visual, slide-over,
sort, live polling, ETag 304 ratio.
EOF
)"
```

---

## Done criteria

All 15 task commits exist; full test suite is green; smoke doc records perf numbers and 304 ratio; browser walks the 11 checklist items.
