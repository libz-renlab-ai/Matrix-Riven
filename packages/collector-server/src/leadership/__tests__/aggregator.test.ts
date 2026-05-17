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
