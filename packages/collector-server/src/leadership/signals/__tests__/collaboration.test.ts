import { describe, it, expect } from 'vitest';
import { detectCollabHits } from '../collaboration.js';
import type { ParsedSession, ParsedMessage } from '../../types.js';

function editMsg(file: string, ts: string): ParsedMessage {
  return {
    role: 'assistant', ts: new Date(ts), text: '',
    toolUses: [{ name: 'Edit', input: { file_path: file, old_string: 'a', new_string: 'b' } }],
    toolResults: [],
  };
}
function mkSession(user: string, msgs: ParsedMessage[], ts: string): ParsedSession {
  const start = new Date(ts);
  return {
    envelope: { id: 'e' + user + ts, userId: user, machineId: 'm', sessionId: 's' + user + ts, cwd: '/r', projectName: 'r', capturedAt: ts, rivenVersion: '0', consentedAt: null },
    l1RedactionCount: 0, messages: msgs, durationMs: 60_000,
    startTs: start, endTs: new Date(start.getTime() + 60_000),
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
  };
}

describe('detectCollabHits', () => {
  it('emits a hit when two users edit the same file', () => {
    const s1 = mkSession('alice@x', [editMsg('/p/shared.ts', '2026-05-13T01:00:00Z')], '2026-05-13T01:00:00Z');
    const s2 = mkSession('bob@x',   [editMsg('/p/shared.ts', '2026-05-14T02:00:00Z')], '2026-05-14T02:00:00Z');
    const hits = detectCollabHits([s1, s2]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.filePath).toBe('/p/shared.ts');
    expect(hits[0]!.members.sort()).toEqual(['alice@x', 'bob@x']);
    expect(hits[0]!.lastTouched).toBe('2026-05-14T02:00:00.000Z');
  });

  it('emits no hit when only one user touched the file', () => {
    const s1 = mkSession('alice@x', [editMsg('/p/solo.ts', '2026-05-14T01:00:00Z')], '2026-05-14T01:00:00Z');
    expect(detectCollabHits([s1])).toHaveLength(0);
  });

  it('handles Write and MultiEdit tools too', () => {
    const writeMsg: ParsedMessage = {
      role: 'assistant', ts: new Date('2026-05-14T01:00:00Z'), text: '',
      toolUses: [{ name: 'Write', input: { file_path: '/p/new.ts', content: 'x' } }],
      toolResults: [],
    };
    const multiEditMsg: ParsedMessage = {
      role: 'assistant', ts: new Date('2026-05-14T02:00:00Z'), text: '',
      toolUses: [{ name: 'MultiEdit', input: { file_path: '/p/new.ts', edits: [] } }],
      toolResults: [],
    };
    const s1 = mkSession('alice@x', [writeMsg], '2026-05-14T01:00:00Z');
    const s2 = mkSession('bob@x',   [multiEditMsg], '2026-05-14T02:00:00Z');
    expect(detectCollabHits([s1, s2])).toHaveLength(1);
  });
});
