import { describe, it, expect } from 'vitest';
import { extractRiskyActions, sumRedactions } from '../risk.js';
import type { ParsedSession, ParsedMessage } from '../../types.js';

function mkSession(opts: {
  user?: string;
  start?: string;
  cwd?: string;
  messages?: ParsedMessage[];
  l1?: number;
}): ParsedSession {
  const start = new Date(opts.start ?? '2026-05-14T01:00:00Z');
  return {
    envelope: {
      id: 'e',
      userId: opts.user ?? 'u@x',
      machineId: 'm',
      sessionId: 's',
      cwd: opts.cwd ?? '/r/Matrix-Riven',
      projectName: 'Matrix-Riven',
      capturedAt: start.toISOString(),
      rivenVersion: '0',
      consentedAt: null,
    },
    l1RedactionCount: opts.l1 ?? 0,
    messages: opts.messages ?? [],
    durationMs: 60_000,
    startTs: start,
    endTs: new Date(start.getTime() + 60_000),
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
  };
}

function mkBashMsg(command: string, ts?: Date): ParsedMessage {
  return {
    role: 'assistant',
    text: '',
    toolUses: [{ name: 'Bash', input: { command } }],
    toolResults: [],
    ts,
  };
}

// ─── extractRiskyActions ──────────────────────────────────────────────────

describe('extractRiskyActions', () => {
  it('detects rm -rf command', () => {
    const sessions = [
      mkSession({
        messages: [mkBashMsg('rm -rf /tmp/foo')],
      }),
    ];
    const actions = extractRiskyActions(sessions);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.pattern).toBe('rm -rf');
    expect(actions[0]!.snippet).toContain('rm -rf');
  });

  it('detects git push --force', () => {
    const sessions = [
      mkSession({
        messages: [mkBashMsg('git push --force origin main')],
      }),
    ];
    const actions = extractRiskyActions(sessions);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.pattern).toBe('force push');
  });

  it('detects git push -f shorthand', () => {
    const sessions = [
      mkSession({
        messages: [mkBashMsg('git push -f origin main')],
      }),
    ];
    const actions = extractRiskyActions(sessions);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.pattern).toBe('force push');
  });

  it('does NOT flag git push origin main (no force)', () => {
    const sessions = [
      mkSession({
        messages: [mkBashMsg('git push origin main')],
      }),
    ];
    const actions = extractRiskyActions(sessions);
    expect(actions).toHaveLength(0);
  });

  it('detects DROP TABLE case-insensitively', () => {
    const sessions = [
      mkSession({
        messages: [mkBashMsg('psql -c "drop table users"')],
      }),
    ];
    const actions = extractRiskyActions(sessions);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.pattern).toBe('drop table');
  });

  it('detects git reset --hard', () => {
    const sessions = [
      mkSession({
        messages: [mkBashMsg('git reset --hard HEAD~1')],
      }),
    ];
    const actions = extractRiskyActions(sessions);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.pattern).toBe('reset --hard');
  });

  it('returns empty array when no risky commands', () => {
    const sessions = [
      mkSession({
        messages: [mkBashMsg('git status'), mkBashMsg('ls -la')],
      }),
    ];
    expect(extractRiskyActions(sessions)).toHaveLength(0);
  });

  it('includes sessionId and snippet in output', () => {
    const sessions = [
      mkSession({
        messages: [mkBashMsg('rm -rf ./dist')],
      }),
    ];
    const actions = extractRiskyActions(sessions);
    expect(actions[0]!.sessionId).toBe('s');
    expect(actions[0]!.snippet).toBe('rm -rf ./dist');
  });

  it('truncates long snippets to 200 chars + ellipsis', () => {
    const longCmd = 'rm -rf ' + 'a'.repeat(300);
    const sessions = [
      mkSession({
        messages: [mkBashMsg(longCmd)],
      }),
    ];
    const actions = extractRiskyActions(sessions);
    expect(actions[0]!.snippet.length).toBeLessThanOrEqual(204); // 200 + '…'
    expect(actions[0]!.snippet.endsWith('…')).toBe(true);
  });
});

// ─── sumRedactions ────────────────────────────────────────────────────────

describe('sumRedactions', () => {
  it('returns 0 for empty sessions', () => {
    expect(sumRedactions([])).toBe(0);
  });

  it('accumulates l1RedactionCount across sessions', () => {
    const sessions = [
      mkSession({ l1: 3 }),
      mkSession({ l1: 5 }),
      mkSession({ l1: 2 }),
    ];
    expect(sumRedactions(sessions)).toBe(10);
  });

  it('returns 0 when all sessions have 0 redactions', () => {
    const sessions = [mkSession({ l1: 0 }), mkSession({ l1: 0 })];
    expect(sumRedactions(sessions)).toBe(0);
  });
});
