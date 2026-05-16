import { describe, it, expect } from 'vitest';
import type { ParsedSession, ParsedMessage } from '../../types.js';
import { guessPhase } from '../project-phase.js';

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
function toolOk(): ParsedMessage {
  return { role: 'tool', ts: new Date('2026-05-14T01:00:00Z'), text: '',
    toolUses: [], toolResults: [{ isError: false, text: 'ok' }] };
}

describe('guessPhase', () => {
  it('returns mixed when no sessions', () => {
    expect(guessPhase([])).toBe('mixed');
  });

  it('returns implement when normal source edits exist with no other signals', () => {
    const sessions = [mkSession({ messages: [
      editMsg('/p/src/app.ts'),
      editMsg('/p/src/utils.ts'),
      editMsg('/p/src/index.ts'),
    ]})];
    expect(guessPhase(sessions)).toBe('implement');
  });

  it('returns debug when 50% of toolResults are errors', () => {
    // 1 fail out of 2 total => 50% fail rate > 20% threshold
    const sessions = [mkSession({ messages: [
      toolFail(),
      toolOk(),
    ]})];
    expect(guessPhase(sessions)).toBe('debug');
  });

  it('returns test when 60% of edits are *.test.ts files', () => {
    // 3 test edits, 2 src edits => testEdits/total = 3/5 = 60%
    const sessions = [mkSession({ messages: [
      editMsg('/p/src/__tests__/a.test.ts'),
      editMsg('/p/src/__tests__/b.test.ts'),
      editMsg('/p/src/__tests__/c.test.ts'),
      editMsg('/p/src/app.ts'),
      editMsg('/p/src/utils.ts'),
    ]})];
    expect(guessPhase(sessions)).toBe('test');
  });

  it('returns docs when 60% of edits are *.md files', () => {
    // 3 md edits, 2 src edits => mdEdits/total = 3/5 = 60%
    const sessions = [mkSession({ messages: [
      editMsg('/p/README.md'),
      editMsg('/p/docs/GUIDE.md'),
      editMsg('/p/docs/API.md'),
      editMsg('/p/src/app.ts'),
      editMsg('/p/src/utils.ts'),
    ]})];
    expect(guessPhase(sessions)).toBe('docs');
  });

  it('returns plan when >40% of user messages match plan/spec/design keywords', () => {
    // 3 of 5 user messages contain plan keywords => 60% > 40% threshold
    const sessions = [mkSession({ messages: [
      userText('let us plan the new feature'),
      userText('I need to design the API'),
      userText('write a spec for the module'),
      userText('fix this bug'),
      userText('check the output'),
    ]})];
    expect(guessPhase(sessions)).toBe('plan');
  });

  it('returns debug when >30% of user messages match debug keywords', () => {
    // 2 of 4 user msgs = 50% > 30% threshold
    const sessions = [mkSession({ messages: [
      userText('this is broken, why does it fail'),
      userText('there is an error in the output'),
      userText('add a new feature'),
      userText('update the config'),
    ]})];
    expect(guessPhase(sessions)).toBe('debug');
  });

  it('returns mixed when no clear dominant phase signal', () => {
    // No edits, no user messages => mixed
    const sessions = [mkSession({ messages: [] })];
    expect(guessPhase(sessions)).toBe('mixed');
  });
});
