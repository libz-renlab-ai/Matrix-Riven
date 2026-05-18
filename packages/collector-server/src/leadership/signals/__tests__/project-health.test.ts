import { describe, it, expect } from 'vitest';
import type { ParsedSession, ParsedMessage } from '../../types.js';
import { computeHealthScore, extractMilestones } from '../project-health.js';

function mkSession(opts: {
  user?: string;
  cwd?: string;
  messages?: ParsedMessage[];
  start?: string;
}): ParsedSession {
  const s = new Date(opts.start ?? '2026-05-14T01:00:00Z');
  return {
    envelope: {
      id: 'e',
      userId: opts.user ?? 'u@x',
      machineId: 'm',
      sessionId: 's',
      cwd: opts.cwd ?? '/p/X',
      projectName: 'X',
      capturedAt: s.toISOString(),
      rivenVersion: '0',
      consentedAt: null,
    },
    l1RedactionCount: 0,
    messages: opts.messages ?? [],
    durationMs: 60_000,
    startTs: s,
    endTs: new Date(s.getTime() + 60_000),
    tokens: { input: 1000, output: 100, cacheRead: 0, cacheCreation: 0 },
  };
}

function toolOk(): ParsedMessage {
  return {
    role: 'tool',
    ts: new Date('2026-05-14T01:00:00Z'),
    text: '',
    toolUses: [],
    toolResults: [{ isError: false, text: 'ok' }],
  };
}

function toolFail(): ParsedMessage {
  return {
    role: 'tool',
    ts: new Date('2026-05-14T01:00:00Z'),
    text: '',
    toolUses: [],
    toolResults: [{ isError: true, text: 'err' }],
  };
}

function overflowMsg(): ParsedMessage {
  return {
    role: 'user',
    ts: new Date('2026-05-14T01:00:00Z'),
    text: 'OVER_200K context overflow detected',
    toolUses: [],
    toolResults: [],
  };
}

function editMsg(file: string): ParsedMessage {
  return {
    role: 'assistant',
    ts: new Date('2026-05-14T01:00:00Z'),
    text: '',
    toolUses: [{ name: 'Edit', input: { file_path: file, old_string: 'a', new_string: 'b' } }],
    toolResults: [],
  };
}

function bashMsg(cmd: string, ts?: string): ParsedMessage {
  return {
    role: 'assistant',
    ts: new Date(ts ?? '2026-05-14T01:00:00Z'),
    text: '',
    toolUses: [{ name: 'Bash', input: { command: cmd } }],
    toolResults: [],
  };
}

// ─── computeHealthScore ────────────────────────────────────────────────────

describe('computeHealthScore', () => {
  it('returns 10 for clean sessions with no errors, no overflows, no hot files', () => {
    const sessions = [
      mkSession({
        messages: [toolOk(), toolOk(), editMsg('/src/a.ts'), editMsg('/src/b.ts')],
      }),
    ];
    expect(computeHealthScore(sessions)).toBe(10);
  });

  it('returns 5 when 50% of tool results are errors', () => {
    // 1 fail + 1 ok => failRate 0.5 => penalty = min(6, 0.5*10) = 5 => score = 10 - 5 = 5.0
    const sessions = [
      mkSession({ messages: [toolFail(), toolOk()] }),
    ];
    expect(computeHealthScore(sessions)).toBe(5);
  });

  it('reduces score by 2 when 2 OVER_200K overflow markers are present', () => {
    // No tool errors, 2 overflows => penalty = 0 + min(3,2) + 0 = 2 => score = 8.0
    const sessions = [
      mkSession({ messages: [overflowMsg(), overflowMsg()] }),
    ];
    expect(computeHealthScore(sessions)).toBe(8);
  });

  it('reduces score by 1 when 1 hot file (5 edits to same file) exists', () => {
    // 5 edits to same file => hotFiles = 1 => penalty = 0 + 0 + min(3,1) = 1 => score = 9.0
    const sessions = [
      mkSession({
        messages: [
          editMsg('/src/hot.ts'),
          editMsg('/src/hot.ts'),
          editMsg('/src/hot.ts'),
          editMsg('/src/hot.ts'),
          editMsg('/src/hot.ts'),
        ],
      }),
    ];
    expect(computeHealthScore(sessions)).toBe(9);
  });

  it('caps fail-rate penalty at 6 (100% error rate)', () => {
    // All tool results are errors => failRate = 1.0 => penalty = min(6, 10) = 6 => score = 4.0
    const sessions = [
      mkSession({ messages: [toolFail(), toolFail(), toolFail(), toolFail()] }),
    ];
    expect(computeHealthScore(sessions)).toBe(4);
  });

  it('clamps score to 0 when all penalties combined exceed 10', () => {
    // failRate penalty = 6, overflow = 3, hotFiles = 3 => total penalty = 12 => score clamped to 0
    const overflowMsgs = [overflowMsg(), overflowMsg(), overflowMsg()];
    const hotFileMsgs = Array.from({ length: 5 }, () => editMsg('/src/hot1.ts'));
    const hotFileMsgs2 = Array.from({ length: 5 }, () => editMsg('/src/hot2.ts'));
    const hotFileMsgs3 = Array.from({ length: 5 }, () => editMsg('/src/hot3.ts'));
    const failMsgs = Array.from({ length: 4 }, () => toolFail());
    const sessions = [
      mkSession({
        messages: [
          ...overflowMsgs,
          ...hotFileMsgs,
          ...hotFileMsgs2,
          ...hotFileMsgs3,
          ...failMsgs,
        ],
      }),
    ];
    expect(computeHealthScore(sessions)).toBe(0);
  });

  it('returns 10 for empty sessions', () => {
    expect(computeHealthScore([])).toBe(10);
  });
});

// ─── extractMilestones ─────────────────────────────────────────────────────

describe('extractMilestones', () => {
  it('extracts git commit milestones from bash commands', () => {
    const sessions = [
      mkSession({
        user: 'dev@example.com',
        messages: [bashMsg('git commit -m "initial"', '2026-05-14T02:00:00Z')],
      }),
    ];
    const milestones = extractMilestones(sessions);
    expect(milestones).toHaveLength(1);
    expect(milestones[0]!.type).toBe('commit');
    expect(milestones[0]!.by).toBe('dev@example.com');
  });

  it('extracts git push milestones', () => {
    const sessions = [
      mkSession({
        messages: [bashMsg('git push origin main')],
      }),
    ];
    const milestones = extractMilestones(sessions);
    expect(milestones.some((m) => m.type === 'push')).toBe(true);
  });

  it('extracts gh pr create milestones', () => {
    const sessions = [
      mkSession({
        messages: [bashMsg('gh pr create --title "feat: add feature"')],
      }),
    ];
    const milestones = extractMilestones(sessions);
    expect(milestones.some((m) => m.type === 'pr')).toBe(true);
  });

  it('extracts git tag milestones', () => {
    const sessions = [
      mkSession({
        messages: [bashMsg('git tag v1.0.0')],
      }),
    ];
    const milestones = extractMilestones(sessions);
    expect(milestones.some((m) => m.type === 'tag')).toBe(true);
  });

  it('extracts npm publish milestones as release type', () => {
    const sessions = [
      mkSession({
        messages: [bashMsg('npm publish --access public')],
      }),
    ];
    const milestones = extractMilestones(sessions);
    expect(milestones.some((m) => m.type === 'release')).toBe(true);
  });

  it('sorts milestones by ts ascending', () => {
    const sessions = [
      mkSession({
        start: '2026-05-14T00:00:00Z',
        messages: [
          bashMsg('git push origin main', '2026-05-14T03:00:00Z'),
          bashMsg('git commit -m "done"', '2026-05-14T01:00:00Z'),
          bashMsg('gh pr create', '2026-05-14T02:00:00Z'),
        ],
      }),
    ];
    const milestones = extractMilestones(sessions);
    expect(milestones.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < milestones.length; i++) {
      expect(milestones[i]!.ts >= milestones[i - 1]!.ts).toBe(true);
    }
  });

  it('returns empty array when no Bash tool uses exist', () => {
    const sessions = [
      mkSession({ messages: [editMsg('/src/a.ts'), toolOk()] }),
    ];
    expect(extractMilestones(sessions)).toEqual([]);
  });

  it('truncates detail to 200 chars with ellipsis for long commands', () => {
    const longCmd = 'git commit -m "' + 'x'.repeat(300) + '"';
    const sessions = [mkSession({ messages: [bashMsg(longCmd)] })];
    const milestones = extractMilestones(sessions);
    expect(milestones).toHaveLength(1);
    expect(milestones[0]!.detail.length).toBeLessThanOrEqual(201); // 200 chars + ellipsis char
    expect(milestones[0]!.detail.endsWith('…')).toBe(true);
  });
});
