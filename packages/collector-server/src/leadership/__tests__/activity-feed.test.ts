import { describe, it, expect } from 'vitest';
import { buildActivityFeed } from '../activity-feed.js';
import type { ParsedSession, DateRange } from '../types.js';

function mkSession(opts: {
  user: string;
  project: string;
  startMs: number;
  prompt?: string;
  bashCommands?: string[];
}): ParsedSession {
  const startTs = new Date(opts.startMs);
  const userMsg = opts.prompt
    ? [
        {
          role: 'user' as const,
          ts: startTs,
          text: opts.prompt,
          toolUses: [],
          toolResults: [],
        },
      ]
    : [];
  const assistantWithBash = (opts.bashCommands ?? []).map((cmd, i) => ({
    role: 'assistant' as const,
    ts: new Date(startTs.getTime() + (i + 1) * 1000),
    text: '',
    toolUses: [{ name: 'Bash', input: { command: cmd } }],
    toolResults: [],
  }));
  return {
    envelope: {
      id: 'eid',
      userId: opts.user,
      machineId: 'm',
      sessionId: opts.user + '-' + opts.startMs,
      cwd: '/p/' + opts.project,
      projectName: opts.project,
      capturedAt: startTs.toISOString(),
      rivenVersion: '0',
      consentedAt: null,
    },
    l1RedactionCount: 0,
    messages: [...userMsg, ...assistantWithBash],
    durationMs: 60_000,
    startTs,
    endTs: new Date(startTs.getTime() + 60_000),
    tokens: { input: 100, output: 50, cacheRead: 0, cacheCreation: 0 },
  };
}

const NOW = new Date('2026-05-18T12:00:00Z');
const RANGE: DateRange = {
  start: new Date('2026-05-11T00:00:00Z'),
  end: NOW,
  label: '7d',
};

describe('buildActivityFeed', () => {
  it('emits a session event per ParsedSession', () => {
    const sessions = [
      mkSession({ user: 'a@x', project: 'p1', startMs: Date.parse('2026-05-18T10:00:00Z'), prompt: 'hello world' }),
      mkSession({ user: 'b@x', project: 'p1', startMs: Date.parse('2026-05-18T11:00:00Z'), prompt: 'modify it' }),
    ];
    const feed = buildActivityFeed({ collectorDir: '', range: RANGE, now: NOW, sessions });
    const sessionEvents = feed.events.filter((e) => e.type === 'session');
    expect(sessionEvents).toHaveLength(2);
    expect(sessionEvents[0]!.summary).toMatch(/modify it/);
    expect(sessionEvents[0]!.detail?.sessionId).toBeDefined();
  });

  it('extracts commit milestones from bash invocations', () => {
    const sessions = [
      mkSession({
        user: 'a@x',
        project: 'p1',
        startMs: Date.parse('2026-05-18T10:00:00Z'),
        bashCommands: [`git commit -m "feat: add thing"`],
      }),
    ];
    const feed = buildActivityFeed({ collectorDir: '', range: RANGE, now: NOW, sessions });
    const commits = feed.events.filter((e) => e.type === 'commit');
    expect(commits.length).toBeGreaterThanOrEqual(1);
    expect(commits[0]!.summary).toContain('feat: add thing');
  });

  it('sorts events time-descending', () => {
    const sessions = [
      mkSession({ user: 'a@x', project: 'p', startMs: Date.parse('2026-05-12T09:00:00Z'), prompt: 'old' }),
      mkSession({ user: 'a@x', project: 'p', startMs: Date.parse('2026-05-17T09:00:00Z'), prompt: 'newer' }),
      mkSession({ user: 'a@x', project: 'p', startMs: Date.parse('2026-05-18T09:00:00Z'), prompt: 'newest' }),
    ];
    const feed = buildActivityFeed({ collectorDir: '', range: RANGE, now: NOW, sessions });
    const sessionEvents = feed.events.filter((e) => e.type === 'session');
    expect(sessionEvents[0]!.summary).toContain('newest');
    expect(sessionEvents[sessionEvents.length - 1]!.summary).toContain('old');
  });

  it('honours focus filter', () => {
    const sessions = [
      mkSession({ user: 'alice@x.com', project: 'p', startMs: Date.parse('2026-05-18T09:00:00Z'), prompt: 'a' }),
      mkSession({ user: 'bob@x.com', project: 'p', startMs: Date.parse('2026-05-18T10:00:00Z'), prompt: 'b' }),
    ];
    const feed = buildActivityFeed({
      collectorDir: '',
      range: RANGE,
      filter: { range: '7d', focus: 'alice' },
      now: NOW,
      sessions,
    });
    const evs = feed.events;
    expect(evs.every((e) => !e.by || e.by.startsWith('alice'))).toBe(true);
    expect(feed.appliedFilter).toBeDefined();
  });

  it('returns empty when range excludes everything', () => {
    const sessions = [
      mkSession({ user: 'a@x', project: 'p', startMs: Date.parse('2026-04-01T09:00:00Z'), prompt: 'old' }),
    ];
    const feed = buildActivityFeed({ collectorDir: '', range: RANGE, now: NOW, sessions });
    expect(feed.events).toHaveLength(0);
    expect(feed.hasMore).toBe(false);
  });

  it('paginates with limit + nextCursor', () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      mkSession({
        user: 'a@x',
        project: 'p',
        startMs: Date.parse('2026-05-18T09:00:00Z') + i * 1000,
        prompt: 'p' + i,
      }),
    );
    const feed = buildActivityFeed({ collectorDir: '', range: RANGE, now: NOW, sessions, limit: 5 });
    expect(feed.events).toHaveLength(5);
    expect(feed.hasMore).toBe(true);
    expect(feed.nextCursor).toBeDefined();
  });

  it('beforeTs cursor skips newer events', () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      mkSession({
        user: 'a@x',
        project: 'p',
        startMs: Date.parse('2026-05-18T09:00:00Z') + i * 1000,
        prompt: 'p' + i,
      }),
    );
    const feed = buildActivityFeed({
      collectorDir: '',
      range: RANGE,
      now: NOW,
      sessions,
      beforeTs: new Date('2026-05-18T09:00:02Z'),
    });
    expect(feed.events.every((e) => e.ts < '2026-05-18T09:00:02.000Z')).toBe(true);
  });

  it('session-injected message gets filtered from preview', () => {
    const sessions = [
      mkSession({
        user: 'a@x',
        project: 'p',
        startMs: Date.parse('2026-05-18T10:00:00Z'),
        prompt: '<command-message>foo</command-message>',
      }),
    ];
    const feed = buildActivityFeed({ collectorDir: '', range: RANGE, now: NOW, sessions });
    expect(feed.events[0]!.summary).toBe('（无 user prompt）');
  });

  it('limit clamped to MAX_LIMIT', () => {
    const sessions = Array.from({ length: 3 }, (_, i) =>
      mkSession({ user: 'a@x', project: 'p', startMs: Date.parse('2026-05-18T09:00:00Z') + i, prompt: 'x' }),
    );
    const feed = buildActivityFeed({ collectorDir: '', range: RANGE, now: NOW, sessions, limit: 10000 });
    expect(feed.events).toHaveLength(3);
  });
});
