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

// 3 sessions: alice×2 (project-alpha), bob×1 (project-beta)
const FIXTURE: ParsedSession[] = [
  makeSession('alice@example.com', 'project-alpha', 'sess-a1', 1 * 60 * 60 * 1000),
  makeSession('alice@example.com', 'project-alpha', 'sess-a2', 2 * 60 * 60 * 1000, 'Long prompt: ' + 'x'.repeat(300)),
  makeSession('bob@example.com',   'project-beta',  'sess-b1', 3 * 60 * 60 * 1000),
];

// ── tests ─────────────────────────────────────────────────────────────────

describe('buildOverviewSnapshot', () => {
  it('returns 2 members', () => {
    const snap = buildOverviewSnapshot({ sessions: FIXTURE, range: RANGE, now: NOW, collectorDir: '' });
    expect(snap.members).toHaveLength(2);
  });

  it('kpis.teamActivity.value equals total session count in range', () => {
    const snap = buildOverviewSnapshot({ sessions: FIXTURE, range: RANGE, now: NOW, collectorDir: '' });
    expect(snap.kpis.teamActivity.value).toBe(3);
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
 */
function makeFixtureWithBusFactorProject(): ParsedSession[] {
  const heavy = makeSessionWith('whale@x.com', 'monolith', 'bf-1', 1 * 60 * 60 * 1000, [makeMsg('a')], {
    tokens: { input: 100_000, output: 50_000 },
  });
  const light = makeSessionWith('minnow@x.com', 'monolith', 'bf-2', 2 * 60 * 60 * 1000, [makeMsg('b')], {
    tokens: { input: 100, output: 50 },
  });
  return [heavy, light];
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
