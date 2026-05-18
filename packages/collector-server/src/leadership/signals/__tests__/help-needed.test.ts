import { describe, it, expect } from 'vitest';
import { detectHelpNeeded } from '../help-needed.js';
import type { ParsedSession, ParsedMessage } from '../../types.js';

function mkSession(messages: ParsedMessage[]): ParsedSession {
  const startTs = new Date('2026-05-14T01:00:00Z');
  return {
    envelope: { id: 'e', userId: 'u', machineId: 'm', sessionId: 's', cwd: '/r/x', projectName: 'x', capturedAt: '2026-05-14T01:00:00Z', rivenVersion: '0', consentedAt: null },
    l1RedactionCount: 0,
    messages,
    durationMs: 60_000,
    startTs, endTs: new Date(startTs.getTime() + 60_000),
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
  };
}
function userMsg(text: string): ParsedMessage {
  return { role: 'user', ts: new Date('2026-05-14T01:00:00Z'), text, toolUses: [], toolResults: [] };
}
function assistantMsg(text: string): ParsedMessage {
  return { role: 'assistant', ts: new Date('2026-05-14T01:00:00Z'), text, toolUses: [], toolResults: [] };
}
function webSearchMsg(): ParsedMessage {
  return {
    role: 'assistant', ts: new Date('2026-05-14T01:00:00Z'), text: '',
    toolUses: [{ name: 'WebSearch', input: { query: 'foo' } }],
    toolResults: [],
  };
}

describe('detectHelpNeeded', () => {
  it('flags when user text contains Chinese 卡 keyword', () => {
    const s = mkSession([userMsg('我卡住了')]);
    const r = detectHelpNeeded([s], 1);
    expect(r.isNeeded).toBe(true);
    expect(r.keywordHits.some((h) => h.includes('卡'))).toBe(true);
  });

  it('flags when user text contains English help keyword', () => {
    const s = mkSession([userMsg('help! the tests are failing')]);
    const r = detectHelpNeeded([s], 1);
    expect(r.isNeeded).toBe(true);
  });

  it('does NOT flag when only assistant text contains keywords (false positive guard)', () => {
    const s = mkSession([assistantMsg('You said you were stuck, let me help.')]);
    const r = detectHelpNeeded([s], 1);
    expect(r.isNeeded).toBe(false);
  });

  it('does NOT match the word 不会议 (false positive 不会 inside another compound)', () => {
    const s = mkSession([userMsg('我准备参加不会议')]);
    const r = detectHelpNeeded([s], 1);
    expect(r.keywordHits.some((h) => h.includes('不会'))).toBe(false);
  });

  it('flags when WebSearch usage exceeds 2x team average', () => {
    const s = mkSession([webSearchMsg(), webSearchMsg(), webSearchMsg()]);
    const r = detectHelpNeeded([s], 1);
    expect(r.isNeeded).toBe(true);
    expect(r.webSearchRatio).toBeGreaterThan(2);
  });

  it('computes webSearchRatio against teamAvg', () => {
    const s = mkSession([webSearchMsg(), webSearchMsg()]);
    const r = detectHelpNeeded([s], 2);
    expect(r.webSearchRatio).toBe(1);
  });
});
