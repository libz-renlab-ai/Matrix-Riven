/**
 * L-8 — aggregator LLM enrichment (cache-only path).
 *
 * Verifies that `buildOverviewSnapshot(input)` attaches `llm*` fields to the
 * matching entities when `input.llmCache` is provided AND the cache contains
 * a hit for the recomputed key. Cache misses leave the field undefined so
 * downstream renderers fall back to template strings.
 *
 * The aggregator recomputes T1–T5 cache keys deterministically. To avoid
 * reimplementing key generation in the tests we **seed the cache via the
 * real `summarize*` functions** with the `runLocalClaude` client mocked —
 * that way the keys we test against are guaranteed to match what aggregator
 * computes (both ends share the same shape).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Mock local-claude-client BEFORE importing the summarizer.
vi.mock('../llm/local-claude-client.js', () => ({ runLocalClaude: vi.fn() }));

import { runLocalClaude } from '../llm/local-claude-client.js';
import { LlmCache } from '../llm/cache.js';
import {
  summarizeSessions,
  summarizeMembers,
  summarizeProjects,
  summarizeAttention,
  summarizeDailyBrief,
} from '../llm/summarizer.js';
import { buildOverviewSnapshot } from '../aggregator.js';
import type { ParsedSession, ParsedMessage } from '../types.js';
import type {
  T1Input,
  T2Input,
  T3Input,
  T4Input,
  T5Input,
} from '../llm/prompts/index.js';

const mockedRun = runLocalClaude as unknown as ReturnType<typeof vi.fn>;

const NOW = new Date('2026-05-16T12:00:00Z');
const TODAY = '2026-05-16';
const RANGE = {
  start: new Date('2026-05-10T00:00:00Z'),
  end: new Date('2026-05-16T23:59:59Z'),
  label: '7d' as const,
};

function makeMsg(text: string): ParsedMessage {
  return { role: 'user', text, toolUses: [], toolResults: [] };
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

// 5 sessions per project so each survives the noise filter (≥5 sessions OR
// ≥2 active days). Anchored hour-by-hour back from NOW so today.sessions stays
// meaningful in the snapshot.
function makeBaseFixture(): ParsedSession[] {
  const out: ParsedSession[] = [];
  for (let i = 1; i <= 5; i++) {
    out.push(makeSession('alice@example.com', 'project-alpha', `sess-a${i}`, i * 60 * 60 * 1000));
  }
  for (let i = 1; i <= 5; i++) {
    out.push(makeSession('bob@example.com', 'project-beta', `sess-b${i}`, (i + 5) * 60 * 60 * 1000));
  }
  return out;
}

/**
 * Build a T1 input shape that exactly mirrors what aggregator computes from
 * a `ParsedSession`. The exact `id`, `firstUserPrompt`, etc. must match for
 * the cache key to align with what aggregator regenerates.
 */
function t1FromSession(s: ParsedSession): T1Input {
  const firstUser = s.messages.find((m) => m.role === 'user' && m.text.trim().length > 0);
  const text = firstUser?.text ?? '';
  return {
    id: s.envelope.sessionId,
    firstUserPrompt: text.length > 200 ? text.slice(0, 200) : text,
    changedFiles: [],
    toolCounts: { edit: 0, bash: 0, read: 0, webFetch: 0 },
    durationMin: Math.max(0, Math.round(s.durationMs / 60_000)),
    errors: 0,
  };
}

async function makeCache(): Promise<{ cache: LlmCache; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'llm-aggregator-test-'));
  const cache = new LlmCache(join(dir, `${randomUUID()}.jsonl`));
  await cache.load();
  return { cache, dir };
}

describe('aggregator LLM enrichment (L-8)', () => {
  let cacheDir: string;
  let cache: LlmCache;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const made = await makeCache();
    cache = made.cache;
    cacheDir = made.dir;
    mockedRun.mockReset();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
    warnSpy.mockRestore();
  });

  it('no llmCache provided — llm* fields all undefined (default behaviour)', () => {
    const snap = buildOverviewSnapshot({
      sessions: makeBaseFixture(),
      range: RANGE,
      now: NOW,
      collectorDir: '',
    });
    for (const m of snap.members) expect(m.llmWeekly).toBeUndefined();
    for (const p of snap.projects) expect(p.llmWeekly).toBeUndefined();
    for (const a of snap.attention) expect(a.llmRewrite).toBeUndefined();
    for (const h of snap.highlights) expect(h.llmDigest).toBeUndefined();
    expect(snap.llmBrief).toBeUndefined();
  });

  it('empty llmCache — all llm* fields still undefined (cache misses)', () => {
    const snap = buildOverviewSnapshot({
      sessions: makeBaseFixture(),
      range: RANGE,
      now: NOW,
      collectorDir: '',
      llmCache: cache,
      today: TODAY,
    });
    for (const m of snap.members) expect(m.llmWeekly).toBeUndefined();
    for (const p of snap.projects) expect(p.llmWeekly).toBeUndefined();
    for (const a of snap.attention) expect(a.llmRewrite).toBeUndefined();
    for (const h of snap.highlights) expect(h.llmDigest).toBeUndefined();
    expect(snap.llmBrief).toBeUndefined();
  });

  it('pre-seeded T2 cache — member.llmWeekly is populated', async () => {
    const fixture = makeBaseFixture();
    // Discover the actual stateBadge the aggregator will assign — that goes
    // into the T2 cache key, so the seed must use the same state value.
    const peek = buildOverviewSnapshot({
      sessions: fixture, range: RANGE, now: NOW, collectorDir: '',
    });
    function mapBadge(b: typeof peek.members[number]['stateBadge']): T2Input['state'] {
      switch (b) {
        case 'needs_help': return 'needs_help';
        case 'stuck': return 'stuck';
        case 'active': return 'active';
        case 'low_activity': return 'idle';
        case 'quiet': return 'off';
        default: return 'active';
      }
    }
    const t2Inputs: T2Input[] = peek.members.map((m) => ({
      email: m.email,
      displayName: m.displayName,
      state: mapBadge(m.stateBadge),
      topFiles: [],
      sessionDigests: [],
    }));
    mockedRun.mockResolvedValueOnce({
      ok: true,
      result: JSON.stringify({
        results: [
          { email: 'alice@example.com', line1: '本周专注前端', line2: '需要 review' },
          { email: 'bob@example.com',   line1: '后端稳进',     line2: '无阻塞' },
        ],
      }),
      costUsd: 0.01,
      durationMs: 500,
    });
    await summarizeMembers(t2Inputs, { cache });

    const snap = buildOverviewSnapshot({
      sessions: fixture,
      range: RANGE,
      now: NOW,
      collectorDir: '',
      llmCache: cache,
      today: TODAY,
    });

    const alice = snap.members.find((m) => m.email === 'alice@example.com');
    const bob = snap.members.find((m) => m.email === 'bob@example.com');
    expect(alice?.llmWeekly).toBe('本周专注前端\n需要 review');
    expect(bob?.llmWeekly).toBe('后端稳进\n无阻塞');
  });

  it('pre-seeded T3 cache — project.llmWeekly is populated', async () => {
    const fixture = makeBaseFixture();
    const t3Inputs: T3Input[] = [
      {
        project: 'project-alpha',
        // aggregator's buildT3InputForProject uses p.phaseGuess ?? '' — at this
        // fixture's call this resolves to 'mixed' (project-phase.ts default).
        phase: 'mixed',
        contributors: ['alice'],
        sessionDigests: [],
        recentCommits: [],
      },
      {
        project: 'project-beta',
        phase: 'mixed',
        contributors: ['bob'],
        sessionDigests: [],
        recentCommits: [],
      },
    ];
    mockedRun.mockResolvedValueOnce({
      ok: true,
      result: JSON.stringify({
        results: [
          { project: 'project-alpha', line1: 'alpha 进展顺',  line2: '本周收尾测试' },
          { project: 'project-beta',  line1: 'beta 持续推进', line2: '正在重构' },
        ],
      }),
      costUsd: 0.01,
      durationMs: 500,
    });
    await summarizeProjects(t3Inputs, { cache });

    const snap = buildOverviewSnapshot({
      sessions: fixture,
      range: RANGE,
      now: NOW,
      collectorDir: '',
      llmCache: cache,
      today: TODAY,
    });

    const alpha = snap.projects.find((p) => p.name === 'project-alpha');
    const beta = snap.projects.find((p) => p.name === 'project-beta');
    expect(alpha?.llmWeekly).toBe('alpha 进展顺\n本周收尾测试');
    expect(beta?.llmWeekly).toBe('beta 持续推进\n正在重构');
  });

  it('pre-seeded T4 cache — attention.llmRewrite is populated', async () => {
    // Build a fixture that triggers a bus-factor attention item.
    function makeS(userId: string, projectName: string, sessionId: string, h: number, tokens: { input: number; output: number }): ParsedSession {
      const startTs = new Date(NOW.getTime() - h * 60 * 60 * 1000);
      return {
        envelope: {
          id: `env-${sessionId}`, userId, machineId: 'm', sessionId,
          cwd: `/home/${userId}/projects/${projectName}`, projectName,
          capturedAt: startTs.toISOString(), rivenVersion: '1', consentedAt: null,
        },
        l1RedactionCount: 0, messages: [makeMsg('work')], durationMs: 60_000,
        startTs, endTs: new Date(startTs.getTime() + 60_000),
        model: 'claude-sonnet-4-6',
        tokens: { ...tokens, cacheRead: 0, cacheCreation: 0 },
      };
    }
    const heavies = [1, 2, 3, 4].map((i) =>
      makeS('whale@x.com', 'monolith', `bf-h${i}`, i, { input: 100_000, output: 50_000 }),
    );
    const light = makeS('minnow@x.com', 'monolith', 'bf-l1', 5, { input: 100, output: 50 });
    const sessions = [...heavies, light];

    // First peek at the snapshot's attention to learn the line2 the
    // aggregator will produce (so we can mirror it in the T4 input).
    const peek = buildOverviewSnapshot({
      sessions, range: RANGE, now: NOW, collectorDir: '',
    });
    const bf = peek.attention.find((a) => a.kind === 'project' && a.tag === '单点依赖');
    expect(bf).toBeDefined();

    // Mirror aggregator's buildT4InputForAttention exactly:
    //   evidence = [line2.replace(/<[^>]+>/g, '')]
    const t4Input: T4Input = {
      refId: bf!.refId,
      kind: bf!.kind,
      displayName: bf!.displayName,
      signal: bf!.tag,
      evidence: bf!.line2 ? [bf!.line2.replace(/<[^>]+>/g, '')] : [],
    };
    mockedRun.mockResolvedValueOnce({
      ok: true,
      result: JSON.stringify({
        results: [{ refId: t4Input.refId, line: '尽快补一个 second contributor' }],
      }),
      costUsd: 0.01,
      durationMs: 500,
    });
    await summarizeAttention([t4Input], { cache });

    const snap = buildOverviewSnapshot({
      sessions, range: RANGE, now: NOW, collectorDir: '',
      llmCache: cache, today: TODAY,
    });
    const bf2 = snap.attention.find((a) => a.refId === bf!.refId);
    expect(bf2?.llmRewrite).toBe('尽快补一个 second contributor');
  });

  it('pre-seeded T5 cache — snap.llmBrief is the 3-line array', async () => {
    const fixture = makeBaseFixture();
    // First learn what the aggregator's T5 input will look like by building
    // the snapshot once with an empty cache — gives us the shape (highlights,
    // attentionRewrites, topProjects). Without any T1/T3/T4 cache hits the
    // values reduce to: topHighlights = [...detail.slice(0,80)],
    // attentionRewrites = [], topProjects = [{name, digest:''}, ...].
    const snapForShape = buildOverviewSnapshot({
      sessions: fixture, range: RANGE, now: NOW, collectorDir: '',
      llmCache: cache, today: TODAY,
    });
    const t5Input: T5Input = {
      date: TODAY,
      topHighlights: snapForShape.highlights.slice(0, 5).map((h) => h.detail.slice(0, 80)),
      attentionRewrites: [],
      topProjects: snapForShape.projects.slice(0, 3).map((p) => ({ name: p.name, digest: '' })),
    };
    mockedRun.mockResolvedValueOnce({
      ok: true,
      result: JSON.stringify({
        briefLines: ['今日团队稳进', '需要关注 alpha 收尾', '无明显风险'],
      }),
      costUsd: 0.01,
      durationMs: 500,
    });
    await summarizeDailyBrief(t5Input, { cache });

    const snap = buildOverviewSnapshot({
      sessions: fixture, range: RANGE, now: NOW, collectorDir: '',
      llmCache: cache, today: TODAY,
    });
    expect(snap.llmBrief).toEqual(['今日团队稳进', '需要关注 alpha 收尾', '无明显风险']);
  });

  it('pre-seeded T1 cache — highlight.llmDigest is populated for matching sessions', async () => {
    // Build a fixture where a session fires `git commit` so extractMilestones
    // emits a highlight tied to that session's project.
    const commitStart = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
    const commitSession: ParsedSession = {
      envelope: {
        id: 'env-c1', userId: 'hrdai@example.com', machineId: 'm', sessionId: 'c1',
        cwd: '/home/hrdai/projects/proj-x', projectName: 'proj-x',
        capturedAt: commitStart.toISOString(), rivenVersion: '1', consentedAt: null,
      },
      l1RedactionCount: 0,
      messages: [
        {
          role: 'assistant', text: '', toolUses: [
            { name: 'Bash', input: { command: 'git commit -m "fix: x"' } },
          ],
          toolResults: [],
          ts: commitStart,
        },
      ],
      durationMs: 60_000, startTs: commitStart, endTs: new Date(commitStart.getTime() + 60_000),
      model: 'claude-sonnet-4-6',
      tokens: { input: 1000, output: 500, cacheRead: 0, cacheCreation: 0 },
    };
    // Pad to ≥ 5 sessions to survive the noise filter.
    const sessions: ParsedSession[] = [commitSession];
    for (let i = 1; i <= 4; i++) {
      sessions.push(makeSession('hrdai@example.com', 'proj-x', `p-${i}`, i * 60 * 60 * 1000));
    }

    // Seed T1 for every session. Each aggregator-side T1 input depends on the
    // session's first user prompt + tool counts + duration; mirror them here.
    const t1Inputs: T1Input[] = sessions.map((s) => {
      // commitSession has no user message → firstUserPrompt is ''.
      // It has 1 Bash tool call (commit). Padding sessions have 1 user msg, 0 tools.
      const isCommit = s.envelope.sessionId === 'c1';
      const firstUser = s.messages.find((m) => m.role === 'user' && m.text.trim().length > 0);
      const text = firstUser?.text ?? '';
      return {
        id: s.envelope.sessionId,
        firstUserPrompt: text.length > 200 ? text.slice(0, 200) : text,
        changedFiles: [],
        toolCounts: {
          edit: 0,
          bash: isCommit ? 1 : 0,
          read: 0,
          webFetch: 0,
        },
        durationMin: 1,
        errors: 0,
      };
    });
    mockedRun.mockResolvedValueOnce({
      ok: true,
      result: JSON.stringify({
        results: t1Inputs.map((t) => ({ id: t.id, line: `digest-${t.id}` })),
      }),
      costUsd: 0.05,
      durationMs: 1000,
    });
    await summarizeSessions(t1Inputs, { cache });

    const snap = buildOverviewSnapshot({
      sessions, range: RANGE, now: NOW, collectorDir: '',
      llmCache: cache, today: TODAY,
    });
    // Highlights includes the commit. Its session is c1 — assert digest matches.
    expect(snap.highlights.length).toBeGreaterThanOrEqual(1);
    const withDigest = snap.highlights.filter((h) => h.llmDigest !== undefined);
    expect(withDigest.length).toBeGreaterThanOrEqual(1);
    const commit = snap.highlights.find((h) => h.type === 'commit');
    expect(commit?.llmDigest).toBe('digest-c1');
  });
});
