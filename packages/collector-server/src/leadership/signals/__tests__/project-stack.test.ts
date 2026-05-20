import { describe, it, expect } from 'vitest';
import type { ParsedSession, ParsedMessage } from '../../types.js';
import { computeExtensionMix, computeTestRatio } from '../project-stack.js';

function mkSession(opts: { user?: string; cwd?: string; messages?: ParsedMessage[]; start?: string }): ParsedSession {
  const s = new Date(opts.start ?? '2026-05-14T01:00:00Z');
  return {
    envelope: { id: 'e', userId: opts.user ?? 'u@x', machineId: 'm', sessionId: 's', cwd: opts.cwd ?? '/p/X', projectName: 'X', capturedAt: s.toISOString(), rivenVersion: '0', consentedAt: null },
    l1RedactionCount: 0, messages: opts.messages ?? [], durationMs: 60_000,
    startTs: s, endTs: new Date(s.getTime() + 60_000),
    tokens: { input: 1000, output: 100, cacheRead: 0, cacheCreation: 0 },
  };
}
function editMsg(file: string): ParsedMessage {
  return { role: 'assistant', ts: new Date('2026-05-14T01:00:00Z'), text: '',
    toolUses: [{ name: 'Edit', input: { file_path: file, old_string: 'a', new_string: 'b' } }], toolResults: [] };
}
function userText(text: string): ParsedMessage {
  return { role: 'user', ts: new Date('2026-05-14T01:00:00Z'), text, toolUses: [], toolResults: [] };
}
function bashCmd(cmd: string): ParsedMessage {
  return { role: 'assistant', ts: new Date('2026-05-14T01:00:00Z'), text: '',
    toolUses: [{ name: 'Bash', input: { command: cmd } }], toolResults: [] };
}
function toolFail(): ParsedMessage {
  return { role: 'tool', ts: new Date('2026-05-14T01:00:00Z'), text: '',
    toolUses: [], toolResults: [{ isError: true, text: 'err' }] };
}

describe('computeExtensionMix', () => {
  it('returns empty object when no sessions', () => {
    expect(computeExtensionMix([])).toEqual({});
  });

  it('returns empty object when no file edits', () => {
    const sessions = [mkSession({ messages: [userText('hello')] })];
    expect(computeExtensionMix(sessions)).toEqual({});
  });

  it('computes .ts and .py mixed shares that sum to ~1', () => {
    // 2 .ts edits and 2 .py edits => each 0.5
    const sessions = [mkSession({ messages: [
      editMsg('/p/a.ts'),
      editMsg('/p/b.ts'),
      editMsg('/p/c.py'),
      editMsg('/p/d.py'),
    ]})];
    const mix = computeExtensionMix(sessions);
    expect(mix['.ts']).toBeCloseTo(0.5, 2);
    expect(mix['.py']).toBeCloseTo(0.5, 2);
    const total = Object.values(mix).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1, 2);
  });

  it('normalizes extensions to lowercase', () => {
    const sessions = [mkSession({ messages: [
      editMsg('/p/a.TS'),
      editMsg('/p/b.ts'),
    ]})];
    const mix = computeExtensionMix(sessions);
    expect(mix['.ts']).toBe(1);
    expect(Object.keys(mix)).toHaveLength(1);
  });

  it('handles files without extension with <none> key', () => {
    const sessions = [mkSession({ messages: [editMsg('/p/Makefile')] })];
    const mix = computeExtensionMix(sessions);
    expect(mix['<none>']).toBe(1);
  });

  it('counts Write and MultiEdit tool uses in addition to Edit', () => {
    const writeMsg: ParsedMessage = {
      role: 'assistant', ts: new Date(), text: '',
      toolUses: [{ name: 'Write', input: { file_path: '/p/a.ts' } }], toolResults: []
    };
    const multiEditMsg: ParsedMessage = {
      role: 'assistant', ts: new Date(), text: '',
      toolUses: [{ name: 'MultiEdit', input: { file_path: '/p/b.ts' } }], toolResults: []
    };
    const sessions = [mkSession({ messages: [writeMsg, multiEditMsg] })];
    const mix = computeExtensionMix(sessions);
    expect(mix['.ts']).toBe(1);
  });
});

describe('computeTestRatio', () => {
  it('returns 0 when no sessions', () => {
    expect(computeTestRatio([])).toBe(0);
  });

  it('returns 0 when no edits', () => {
    const sessions = [mkSession({ messages: [userText('hi')] })];
    expect(computeTestRatio(sessions)).toBe(0);
  });

  it('returns 0.5 with 1 test edit and 2 src edits', () => {
    const sessions = [mkSession({ messages: [
      editMsg('/p/src/app.ts'),
      editMsg('/p/src/utils.ts'),
      editMsg('/p/src/__tests__/app.test.ts'),
    ]})];
    expect(computeTestRatio(sessions)).toBe(0.5);
  });

  it('returns Infinity when only test file edits exist', () => {
    const sessions = [mkSession({ messages: [
      editMsg('/p/src/app.test.ts'),
      editMsg('/p/src/utils.spec.ts'),
    ]})];
    expect(computeTestRatio(sessions)).toBe(Number.POSITIVE_INFINITY);
  });

  it('returns 0 when only source file edits exist', () => {
    const sessions = [mkSession({ messages: [
      editMsg('/p/src/app.ts'),
      editMsg('/p/src/utils.ts'),
    ]})];
    expect(computeTestRatio(sessions)).toBe(0);
  });
});
