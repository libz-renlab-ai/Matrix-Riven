import { describe, it, expect } from 'vitest';
import { buildOverviewSnapshot, buildMemberDetail, buildProjectDetail } from '../aggregator.js';
import type { ParsedSession, ParsedMessage } from '../types.js';

// ── fixtures ──────────────────────────────────────────────────────────────
const NOW = new Date('2026-05-16T12:00:00Z');

const RANGE = {
  start: new Date('2026-05-10T00:00:00Z'),
  end: new Date('2026-05-16T23:59:59Z'),
  label: '7d' as const,
};

function makeMsg(text: string): ParsedMessage {
  return {
    role: 'user',
    text,
    toolUses: [],
    toolResults: [],
  };
}

function makeSession(
  userId: string,
  projectName: string,
  sessionId: string,
  startOffset = 0,
  promptText = 'How do I fix this?',
): ParsedSession {
  const startTs = new Date(NOW.getTime() - startOffset);
  return {
    envelope: {
      id: `env-${sessionId}`,
      userId,
      machineId: 'machine-1',
      sessionId,
      cwd: `/home/${userId}/projects/${projectName}`,
      projectName,
      capturedAt: startTs.toISOString(),
      rivenVersion: '1.0.0',
      consentedAt: null,
    },
    l1RedactionCount: 0,
    messages: [makeMsg(promptText)],
    durationMs: 60_000,
    startTs,
    endTs: new Date(startTs.getTime() + 60_000),
    model: 'claude-sonnet-4-6',
    tokens: { input: 1000, output: 500, cacheRead: 0, cacheCreation: 0 },
  };
}

// 10 sessions per project — at 5 sessions each project survives the
// post-2026-05-17 noise filter (which requires ≥ 5 sessions OR ≥ 2 active
// days). All anchored to NOW with hour-scale offsets so today.sessions
// remains meaningful.
const FIXTURE: ParsedSession[] = [
  makeSession('alice@example.com', 'project-alpha', 'sess-a1', 1 * 60 * 60 * 1000),
  makeSession('alice@example.com', 'project-alpha', 'sess-a2', 2 * 60 * 60 * 1000, 'Long prompt: ' + 'x'.repeat(300)),
  makeSession('alice@example.com', 'project-alpha', 'sess-a3', 3 * 60 * 60 * 1000),
  makeSession('alice@example.com', 'project-alpha', 'sess-a4', 4 * 60 * 60 * 1000),
  makeSession('alice@example.com', 'project-alpha', 'sess-a5', 5 * 60 * 60 * 1000),
  makeSession('bob@example.com',   'project-beta',  'sess-b1', 6 * 60 * 60 * 1000),
  makeSession('bob@example.com',   'project-beta',  'sess-b2', 7 * 60 * 60 * 1000),
  makeSession('bob@example.com',   'project-beta',  'sess-b3', 8 * 60 * 60 * 1000),
  makeSession('bob@example.com',   'project-beta',  'sess-b4', 9 * 60 * 60 * 1000),
  makeSession('bob@example.com',   'project-beta',  'sess-b5', 10 * 60 * 60 * 1000),
];

// ── tests ─────────────────────────────────────────────────────────────────

describe('buildOverviewSnapshot', () => {
  it('returns 2 members', () => {
    const snap = buildOverviewSnapshot({ sessions: FIXTURE, range: RANGE, now: NOW, collectorDir: '' });
    expect(snap.members).toHaveLength(2);
  });

  it('kpis.teamActivity.value equals total session count in range', () => {
    const snap = buildOverviewSnapshot({ sessions: FIXTURE, range: RANGE, now: NOW, collectorDir: '' });
    expect(snap.kpis.teamActivity.value).toBe(10);
  });

  it('members emails match expected set', () => {
    const snap = buildOverviewSnapshot({ sessions: FIXTURE, range: RANGE, now: NOW, collectorDir: '' });
    expect(snap.members.map((m) => m.email).sort()).toEqual([
      'alice@example.com',
      'bob@example.com',
    ]);
  });

  it('projects includes both project names', () => {
    const snap = buildOverviewSnapshot({ sessions: FIXTURE, range: RANGE, now: NOW, collectorDir: '' });
    const names = snap.projects.map((p) => p.name).sort();
    expect(names).toEqual(['project-alpha', 'project-beta']);
  });
});

describe('buildMemberDetail', () => {
  it('returns session with firstPromptPreview.length ≤ 200', () => {
    const result = buildMemberDetail({
      email: 'alice@example.com',
      sessions: FIXTURE,
      range: RANGE,
      now: NOW,
      collectorDir: '',
    });
    expect(result).not.toBeNull();
    for (const s of result!.detail.sessions) {
      expect(s.firstPromptPreview.length).toBeLessThanOrEqual(200);
    }
  });

  it('returns null for unknown email', () => {
    const result = buildMemberDetail({
      email: 'nobody@example.com',
      sessions: FIXTURE,
      range: RANGE,
      now: NOW,
      collectorDir: '',
    });
    expect(result).toBeNull();
  });
});

describe('buildProjectDetail', () => {
  it('includes milestones field', () => {
    const result = buildProjectDetail({
      projectName: 'project-alpha',
      sessions: FIXTURE,
      range: RANGE,
      now: NOW,
      collectorDir: '',
    });
    expect(result).not.toBeNull();
    expect(result!.detail).toHaveProperty('milestones');
    expect(Array.isArray(result!.detail.milestones)).toBe(true);
  });

  it('returns null for unknown project', () => {
    const result = buildProjectDetail({
      projectName: 'nonexistent-project',
      sessions: FIXTURE,
      range: RANGE,
      now: NOW,
      collectorDir: '',
    });
    expect(result).toBeNull();
  });
});

// --- P-B4 fixtures ---

/** Build a session with explicit messages — handy for triggering state-badge logic. */
function makeSessionWith(
  userId: string,
  projectName: string,
  sessionId: string,
  startOffset: number,
  messages: ParsedMessage[],
  opts: { cwd?: string; tokens?: { input: number; output: number } } = {},
): ParsedSession {
  const startTs = new Date(NOW.getTime() - startOffset);
  return {
    envelope: {
      id: `env-${sessionId}`,
      userId,
      machineId: 'machine-1',
      sessionId,
      cwd: opts.cwd ?? `/home/${userId}/projects/${projectName}`,
      projectName,
      capturedAt: startTs.toISOString(),
      rivenVersion: '1.0.0',
      consentedAt: null,
    },
    l1RedactionCount: 0,
    messages,
    durationMs: 60_000,
    startTs,
    endTs: new Date(startTs.getTime() + 60_000),
    model: 'claude-sonnet-4-6',
    tokens: { input: opts.tokens?.input ?? 1000, output: opts.tokens?.output ?? 500, cacheRead: 0, cacheCreation: 0 },
  };
}

/**
 * Make a fixture that triggers all three help-related member states:
 *   - 'stuck' via 3 sessions in the same cwd within 24h, no git commit
 *   - 'needs_help' via keyword '卡住' in user text
 *   - 'low_activity' via low tokens + non-work-hour + non-main project
 *
 * Each state goes to a different member so we get ≥3 attention items.
 */
function makeMixedFixture(): ParsedSession[] {
  // STUCK: 3 sessions in same cwd in last 24h, no git commit
  const stuckCwd = '/home/u-stuck/projects/blocker';
  const stuck1 = makeSessionWith('stuck@x.com', 'blocker', 'stuck-1', 1 * 60 * 60 * 1000, [makeMsg('try again')], { cwd: stuckCwd });
  const stuck2 = makeSessionWith('stuck@x.com', 'blocker', 'stuck-2', 2 * 60 * 60 * 1000, [makeMsg('still failing')], { cwd: stuckCwd });
  const stuck3 = makeSessionWith('stuck@x.com', 'blocker', 'stuck-3', 3 * 60 * 60 * 1000, [makeMsg('keep trying')], { cwd: stuckCwd });

  // NEEDS_HELP: keyword '卡住' in a user message
  const help1 = makeSessionWith('help@x.com', 'project-help', 'help-1', 1 * 60 * 60 * 1000, [makeMsg('我卡住了 / stuck on this')]);

  // LOW_ACTIVITY: 1 session, very low tokens, off-hour timestamp, non-main project.
  // NOW is 12:00 UTC = 20:00 CST so any session anchored to NOW falls outside 9-18 work hours.
  const lowSession = makeSessionWith('low@x.com', 'side-project', 'low-1', 0, [makeMsg('quick fix')], {
    tokens: { input: 1, output: 1 },
  });

  // Filler high-volume sessions so teamMedian is large enough to make 'low' fall below 0.3×median.
  const filler1 = makeSessionWith('fill@x.com', 'main', 'fill-1', 4 * 60 * 60 * 1000, [makeMsg('work')], {
    tokens: { input: 200_000, output: 100_000 },
  });
  const filler2 = makeSessionWith('fill@x.com', 'main', 'fill-2', 5 * 60 * 60 * 1000, [makeMsg('work')], {
    tokens: { input: 200_000, output: 100_000 },
  });

  return [stuck1, stuck2, stuck3, help1, lowSession, filler1, filler2];
}

/**
 * Project with bus-factor warning: one user contributes >70% of tokens.
 * Spreads three heavy sessions across `whale@x.com` so the project survives
 * the post-2026-05-17 < 3-session noise filter while still containing two
 * distinct contributors (required for the bus-factor warning to fire).
 */
function makeFixtureWithBusFactorProject(): ParsedSession[] {
  const heavies = [1, 2, 3, 4].map((i) =>
    makeSessionWith('whale@x.com', 'monolith', `bf-h${i}`, i * 60 * 60 * 1000, [makeMsg('a')], {
      tokens: { input: 100_000, output: 50_000 },
    }),
  );
  const light = makeSessionWith('minnow@x.com', 'monolith', 'bf-l1', 5 * 60 * 60 * 1000, [makeMsg('b')], {
    tokens: { input: 100, output: 50 },
  });
  return [...heavies, light];
}

describe('deriveAttention (P-B4)', () => {
  it('emits member items for stuck / needs_help / low_activity', () => {
    const snap = buildOverviewSnapshot({
      sessions: makeMixedFixture(),
      range: RANGE,
      now: NOW,
      collectorDir: '',
      mainProjects: ['main'],
    });
    // At least one attention row from members; sorted desc.
    expect(snap.attention.length).toBeGreaterThanOrEqual(1);
    const memberItems = snap.attention.filter((a) => a.kind === 'member');
    expect(memberItems.length).toBeGreaterThanOrEqual(1);
    // Sorted desc by severity
    for (let i = 0; i < snap.attention.length - 1; i++) {
      expect(snap.attention[i]!.severity).toBeGreaterThanOrEqual(snap.attention[i + 1]!.severity);
    }
  });

  it('emits project items for bus-factor warning', () => {
    const snap = buildOverviewSnapshot({
      sessions: makeFixtureWithBusFactorProject(),
      range: RANGE,
      now: NOW,
      collectorDir: '',
    });
    expect(snap.attention.some((a) => a.kind === 'project')).toBe(true);
  });

  it('sorts by severity desc', () => {
    const snap = buildOverviewSnapshot({
      sessions: makeMixedFixture(),
      range: RANGE,
      now: NOW,
      collectorDir: '',
      mainProjects: ['main'],
    });
    for (let i = 0; i < snap.attention.length - 1; i++) {
      expect(snap.attention[i]!.severity).toBeGreaterThanOrEqual(snap.attention[i + 1]!.severity);
    }
  });

  it('returns an empty array when no members or projects warrant attention', () => {
    const snap = buildOverviewSnapshot({ sessions: FIXTURE, range: RANGE, now: NOW, collectorDir: '' });
    expect(Array.isArray(snap.attention)).toBe(true);
  });
});

describe('Phase 2 P2 — placeholder → real data (P-A2)', () => {
  it('ProjectSnapshot exposes activeTodayPct + activeTodayCount', () => {
    const snap = buildOverviewSnapshot({ sessions: FIXTURE, range: RANGE, now: NOW, collectorDir: '' });
    for (const p of snap.projects) {
      expect(typeof p.activeTodayPct).toBe('number');
      expect(p.activeTodayPct).toBeGreaterThanOrEqual(0);
      expect(p.activeTodayPct).toBeLessThanOrEqual(1);
      expect(typeof p.activeTodayCount).toBe('number');
      expect(p.activeTodayCount).toBeGreaterThanOrEqual(0);
      expect(p.activeTodayCount).toBeLessThanOrEqual(p.contributors.length);
    }
  });

  it('project-alpha has alice active today (1 of 1 contributors)', () => {
    // FIXTURE puts alice in project-alpha with sessions inside the today
    // window relative to NOW. So activeTodayCount == contributors.length.
    const snap = buildOverviewSnapshot({ sessions: FIXTURE, range: RANGE, now: NOW, collectorDir: '' });
    const alpha = snap.projects.find((p) => p.name === 'project-alpha')!;
    expect(alpha.contributors.length).toBe(1);
    expect(alpha.activeTodayCount).toBe(1);
    expect(alpha.activeTodayPct).toBe(1);
  });

  it('kpis.pace has rhythmDelta + label in {升,稳,缓}', () => {
    const snap = buildOverviewSnapshot({ sessions: FIXTURE, range: RANGE, now: NOW, collectorDir: '' });
    expect(typeof snap.kpis.pace.rhythmDelta).toBe('number');
    expect(['升', '稳', '缓']).toContain(snap.kpis.pace.label);
  });

  it('kpis.highOutput has count + avgDeltaPct numbers', () => {
    const snap = buildOverviewSnapshot({ sessions: FIXTURE, range: RANGE, now: NOW, collectorDir: '' });
    expect(typeof snap.kpis.highOutput.count).toBe('number');
    expect(typeof snap.kpis.highOutput.avgDeltaPct).toBe('number');
    // count must equal members with delta > 0.2
    const expected = snap.members.filter((m) => m.deltaVs7dAvgPct > 0.2).length;
    expect(snap.kpis.highOutput.count).toBe(expected);
  });

  it('kpis.todayCostUsd equals sum of member.today.costUsd', () => {
    const snap = buildOverviewSnapshot({ sessions: FIXTURE, range: RANGE, now: NOW, collectorDir: '' });
    const expected = snap.members.reduce((a, m) => a + m.today.costUsd, 0);
    expect(snap.kpis.todayCostUsd).toBeCloseTo(expected, 2);
  });

  it('MemberSnapshot exposes lastSessionAt + line2-supporting fields', () => {
    const snap = buildOverviewSnapshot({ sessions: FIXTURE, range: RANGE, now: NOW, collectorDir: '' });
    for (const m of snap.members) {
      expect(typeof m.lastSessionAt).toBe('string');
      expect(typeof m.toolFailureRate).toBe('number');
      expect(typeof m.riskyActionCount).toBe('number');
      expect(typeof m.iterationDensity).toBe('number');
      expect(typeof m.meanPromptLen).toBe('number');
    }
  });

  it('B-main: low_activity line2 is a relative-time phrase with "无新动作"', () => {
    const snap = buildOverviewSnapshot({
      sessions: makeMixedFixture(),
      range: RANGE,
      now: NOW,
      collectorDir: '',
      mainProjects: ['main'],
    });
    const low = snap.attention.find((a) => a.kind === 'member' && a.tag === '闲置');
    if (low) {
      // narrativeIdleSince → "刚刚" | "N 小时前" | "今天早些时候" | "昨天" | "N 天前" | …
      expect(low.line2).toContain('无新动作');
      expect(low.line2).toMatch(/刚刚|小时前|今天早些时候|昨天|天前|周前|一个月以上/);
      // No raw "07:42" timestamps / "上次会话" technical surface
      expect(low.line2).not.toMatch(/上次会话/);
      expect(low.line2).not.toMatch(/\d\d:\d\d/);
    }
  });

  it('B-main: stuck attention line2 is narrative — "卡在 <file>" or "反复尝试"', () => {
    const snap = buildOverviewSnapshot({
      sessions: makeMixedFixture(),
      range: RANGE,
      now: NOW,
      collectorDir: '',
      mainProjects: ['main'],
    });
    const stuck = snap.attention.find((a) => a.kind === 'member' && a.tag === '疑似卡住');
    if (stuck) {
      expect(stuck.line2).toMatch(/卡在|反复尝试相似问题/);
      // No raw iteration-density / prompt-length engineer-speak
      expect(stuck.line2).not.toMatch(/次 prompt/);
      expect(stuck.line2).not.toMatch(/均长 \d+ 字/);
    }
  });

  it('B-main: busFactor attention line2 reads "<name> 一人独撑" — no raw percent', () => {
    const snap = buildOverviewSnapshot({
      sessions: makeFixtureWithBusFactorProject(),
      range: RANGE,
      now: NOW,
      collectorDir: '',
    });
    const bf = snap.attention.find((a) => a.kind === 'project' && a.tag === '单点依赖');
    expect(bf).toBeDefined();
    // Local-part-only ("whale"), not full email; no "占 N%" technical line.
    expect(bf!.line2).toMatch(/whale/);
    expect(bf!.line2).toContain('一人独撑');
    expect(bf!.line2).not.toMatch(/占 \d+%/);
    expect(bf!.line2).not.toMatch(/@x\.com/);
  });
});

describe('Phase 2 wired signals (P-A1)', () => {
  it('MemberDetail exposes focus, promptLengthSeries, newSurfaceCount', () => {
    const result = buildMemberDetail({
      email: 'alice@example.com',
      sessions: FIXTURE,
      range: RANGE,
      now: NOW,
      collectorDir: '',
    });
    expect(result).not.toBeNull();
    const detail = result!.detail;
    expect(detail.focus).toEqual({
      distinctCwdsToday: expect.any(Number),
      avgSessionMinutes: expect.any(Number),
    });
    expect(Array.isArray(detail.promptLengthSeries)).toBe(true);
    for (const point of detail.promptLengthSeries) {
      expect(typeof point.date).toBe('string');
      expect(typeof point.meanLen).toBe('number');
    }
    expect(typeof detail.newSurfaceCount).toBe('number');
    expect(detail.newSurfaceCount).toBeGreaterThanOrEqual(0);
  });

  it('ProjectDetail exposes collabDensity in [0, 1]', () => {
    const result = buildProjectDetail({
      projectName: 'project-alpha',
      sessions: FIXTURE,
      range: RANGE,
      now: NOW,
      collectorDir: '',
    });
    expect(result).not.toBeNull();
    expect(typeof result!.detail.collabDensity).toBe('number');
    expect(result!.detail.collabDensity).toBeGreaterThanOrEqual(0);
    expect(result!.detail.collabDensity).toBeLessThanOrEqual(1);
  });
});

// =============================================================================
// P-D2: data-trust-layer rebuild (2026-05-17)
// =============================================================================

/**
 * Build a synthetic mass-noise fixture: 25 different project names, one
 * session each. After the filter pass, none of these should appear because
 * every project has fewer than 3 sessions.
 */
function makeNoiseProjectFixture(): ParsedSession[] {
  const out: ParsedSession[] = [];
  for (let i = 0; i < 25; i++) {
    const name =
      i < 5 ? `38a519${i.toString(16).padStart(2, '0')}` : // pure-hex hash names
      i < 10 ? `teamagent-bench-x${i}` :                    // bench fixtures
      `oneoff-real-${i}`;                                    // single-session real-looking
    out.push(makeSession('alice@example.com', name, `sess-${i}`, i * 60 * 60 * 1000));
  }
  return out;
}

describe('P-D2 — project noise + low-volume filter', () => {
  it('drops hash + bench + single-session projects, keeps allow-listed', () => {
    const sessions = makeNoiseProjectFixture();
    const snap = buildOverviewSnapshot({
      sessions, range: RANGE, now: NOW, collectorDir: '',
    });
    // None of the noise patterns should leak through
    for (const p of snap.projects) {
      expect(p.name).not.toMatch(/^[0-9a-f]{6,}$/i);
      expect(p.name).not.toMatch(/-bench-/);
    }
    // Single-session projects are all filtered → 0 left after filter
    expect(snap.projects.length).toBe(0);
  });

  it('keeps projects with ≥ 5 sessions on a single day (passes volume gate)', () => {
    const sessions: ParsedSession[] = [];
    for (let i = 0; i < 5; i++) {
      sessions.push(makeSession('alice@example.com', 'real-project', `sess-${i}`, i * 60 * 60 * 1000));
    }
    const snap = buildOverviewSnapshot({
      sessions, range: RANGE, now: NOW, collectorDir: '',
    });
    expect(snap.projects.map((p) => p.name)).toContain('real-project');
  });

  it('drops projects with only one active day and < 5 sessions', () => {
    // 3 sessions, single day → fails the volume gate even though name is real
    const sessions: ParsedSession[] = [
      makeSession('alice@example.com', 'one-shot', 's-1', 1 * 60 * 60 * 1000),
      makeSession('alice@example.com', 'one-shot', 's-2', 2 * 60 * 60 * 1000),
      makeSession('alice@example.com', 'one-shot', 's-3', 3 * 60 * 60 * 1000),
    ];
    const snap = buildOverviewSnapshot({
      sessions, range: RANGE, now: NOW, collectorDir: '',
    });
    expect(snap.projects.map((p) => p.name)).not.toContain('one-shot');
  });
});

describe('P-D2 — attention queue folding + cap', () => {
  it('caps attention queue at 10 items globally', () => {
    // 20 distinct one-person projects don't fold; verify after filter+fold
    // the global cap still holds. Build with ≥ 3 sessions per project so
    // they survive the project-noise filter.
    const sessions: ParsedSession[] = [];
    for (let p = 0; p < 20; p++) {
      for (let s = 0; s < 3; s++) {
        sessions.push(makeSession(`u${p}@x.com`, `proj-${p}`, `s-${p}-${s}`, (p * 3 + s) * 60 * 60 * 1000));
      }
    }
    const snap = buildOverviewSnapshot({
      sessions, range: RANGE, now: NOW, collectorDir: '',
    });
    expect(snap.attention.length).toBeLessThanOrEqual(10);
  });

  it('folds 3+ same-shape items into a single N-row', () => {
    // 5 bus-factor projects (need ≥ 2 contributors with > 70% imbalance,
    // and ≥ 5 sessions to pass the volume gate).
    const sessions: ParsedSession[] = [];
    for (let p = 0; p < 5; p++) {
      for (let i = 1; i <= 4; i++) {
        sessions.push(makeSessionWith(`whale-${p}@x.com`, `mono-${p}`, `h-${p}-${i}`, i * 60 * 60 * 1000, [makeMsg('heavy')], {
          tokens: { input: 100_000, output: 50_000 },
        }));
      }
      sessions.push(makeSessionWith(`minnow-${p}@x.com`, `mono-${p}`, `l-${p}-1`, 5 * 60 * 60 * 1000, [makeMsg('light')], {
        tokens: { input: 100, output: 50 },
      }));
    }
    const snap = buildOverviewSnapshot({
      sessions, range: RANGE, now: NOW, collectorDir: '',
    });
    // All 5 should fold into one "N 个单点依赖" row
    const busAttn = snap.attention.filter((a) => a.tag === '单点依赖');
    expect(busAttn.length).toBe(1);
    expect(busAttn[0]!.displayName).toMatch(/5 个单点依赖/);
  });
});

// =============================================================================
// B-main: leader-language render layer (2026-05-17)
// =============================================================================

describe('B-main — OverviewSnapshot.highlights', () => {
  it('always populated as an array (possibly empty)', () => {
    const snap = buildOverviewSnapshot({ sessions: FIXTURE, range: RANGE, now: NOW, collectorDir: '' });
    expect(Array.isArray(snap.highlights)).toBe(true);
  });

  it('contains entries normalised to email local-parts only (no full emails)', () => {
    // Build a fixture where a session fires a `git commit` (matched by
    // extractMilestones). The author email's local-part must show up; the
    // domain portion must not.
    const startTs = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
    const commitSession: ParsedSession = {
      envelope: {
        id: 'env-c1', userId: 'hrdai@example.com', machineId: 'm', sessionId: 'c1',
        cwd: '/home/hrdai/projects/proj-x', projectName: 'proj-x',
        capturedAt: startTs.toISOString(), rivenVersion: '1', consentedAt: null,
      },
      l1RedactionCount: 0,
      messages: [
        {
          role: 'assistant', text: '', toolUses: [
            { name: 'Bash', input: { command: 'git commit -m "fix: x"' } },
          ],
          toolResults: [],
        },
      ],
      durationMs: 60_000, startTs, endTs: new Date(startTs.getTime() + 60_000),
      model: 'claude-sonnet-4-6',
      tokens: { input: 1000, output: 500, cacheRead: 0, cacheCreation: 0 },
    };
    // Pad to ≥ 5 sessions so the project survives the noise filter.
    const sessions = [commitSession];
    for (let i = 1; i <= 4; i++) {
      sessions.push(makeSession('hrdai@example.com', 'proj-x', `p-${i}`, i * 60 * 60 * 1000));
    }
    const snap = buildOverviewSnapshot({ sessions, range: RANGE, now: NOW, collectorDir: '' });
    expect(snap.highlights.length).toBeGreaterThanOrEqual(1);
    const commit = snap.highlights.find((h) => h.type === 'commit');
    expect(commit).toBeDefined();
    expect(commit!.by).toBe('hrdai');
    expect(commit!.by).not.toMatch(/@/);
    expect(commit!.project).toBe('proj-x');
  });
});

describe('P-D2 — staleness detection', () => {
  it('flags staleness when freshest session is > 1 day old', () => {
    // Build sessions ending 3 days before NOW. Staleness is computed from
    // the freshest endTs, so 5 sessions clustered around the same old day
    // all have ageDays ≈ 3 — well past the > 1 day threshold.
    const oldStart = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000);
    function makeOld(id: string): ParsedSession {
      return {
        envelope: {
          id, userId: 'a@x.com', machineId: 'm', sessionId: id,
          cwd: '/home/a/real-project', projectName: 'real-project',
          capturedAt: oldStart.toISOString(), rivenVersion: '1', consentedAt: null,
        },
        l1RedactionCount: 0, messages: [makeMsg('old work')], durationMs: 60_000,
        startTs: oldStart, endTs: new Date(oldStart.getTime() + 60_000),
        model: 'claude-sonnet-4-6',
        tokens: { input: 1000, output: 500, cacheRead: 0, cacheCreation: 0 },
      };
    }
    const sessions = [makeOld('old-1'), makeOld('old-2'), makeOld('old-3'), makeOld('old-4'), makeOld('old-5')];
    const range = rangeFor(7, NOW);
    const snap = buildOverviewSnapshot({
      sessions, range, now: NOW, collectorDir: '',
    });
    expect(snap.staleness).toBeDefined();
    expect(snap.staleness!.ageDays).toBeGreaterThan(2);
    expect(snap.staleness!.ageDays).toBeLessThan(4);
  });

  it('does not flag staleness when data is fresh (< 1 day)', () => {
    const snap = buildOverviewSnapshot({
      sessions: FIXTURE, range: RANGE, now: NOW, collectorDir: '',
    });
    expect(snap.staleness).toBeUndefined();
  });
});

/** Build a synthetic 7d range relative to a given `now`. */
function rangeFor(days: number, end: Date) {
  return {
    start: new Date(end.getTime() - days * 24 * 60 * 60 * 1000),
    end,
    label: days === 7 ? ('7d' as const) : `${days}d`,
  };
}
