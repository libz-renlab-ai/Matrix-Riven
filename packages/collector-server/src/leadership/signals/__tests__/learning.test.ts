import { describe, it, expect } from 'vitest';
import { computeWebResearch, computeNewSurfaceCount } from '../learning.js';
import type { ParsedSession, ParsedMessage } from '../../types.js';

function mkSession(opts: {
  user?: string;
  start?: string;
  cwd?: string;
  messages?: ParsedMessage[];
  l1?: number;
  model?: string;
  tokens?: { input: number; output: number };
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
    model: opts.model,
    tokens: {
      input: opts.tokens?.input ?? 0,
      output: opts.tokens?.output ?? 0,
      cacheRead: 0,
      cacheCreation: 0,
    },
  };
}

function mkMsg(
  role: 'user' | 'assistant' | 'tool',
  toolUses: Array<{ name: string; input: Record<string, unknown> }> = [],
): ParsedMessage {
  return {
    role,
    text: '',
    toolUses,
    toolResults: [],
  };
}

// ─── computeWebResearch ───────────────────────────────────────────────────

describe('computeWebResearch', () => {
  it('returns 0 when no sessions', () => {
    expect(computeWebResearch([])).toBe(0);
  });

  it('returns 0 when no web tool calls', () => {
    const sessions = [
      mkSession({
        messages: [
          mkMsg('assistant', [{ name: 'Bash', input: { command: 'ls' } }]),
          mkMsg('assistant', [{ name: 'Read', input: { file_path: '/foo.ts' } }]),
        ],
      }),
    ];
    expect(computeWebResearch(sessions)).toBe(0);
  });

  it('counts WebSearch and WebFetch calls', () => {
    const sessions = [
      mkSession({
        messages: [
          mkMsg('assistant', [
            { name: 'WebSearch', input: { query: 'typescript generics' } },
            { name: 'WebSearch', input: { query: 'vitest mocking' } },
            { name: 'WebFetch', input: { url: 'https://example.com' } },
          ]),
        ],
      }),
    ];
    // 2 WebSearch + 1 WebFetch = 3
    expect(computeWebResearch(sessions)).toBe(3);
  });

  it('accumulates across multiple sessions', () => {
    const s1 = mkSession({
      messages: [mkMsg('assistant', [{ name: 'WebSearch', input: { query: 'foo' } }])],
    });
    const s2 = mkSession({
      messages: [mkMsg('assistant', [{ name: 'WebFetch', input: { url: 'https://bar.com' } }])],
    });
    expect(computeWebResearch([s1, s2])).toBe(2);
  });
});

// ─── computeNewSurfaceCount ───────────────────────────────────────────────

describe('computeNewSurfaceCount', () => {
  it('returns 0 when no file_path tool uses', () => {
    const current = [
      mkSession({
        messages: [mkMsg('assistant', [{ name: 'Bash', input: { command: 'ls' } }])],
      }),
    ];
    expect(computeNewSurfaceCount(current, [])).toBe(0);
  });

  it('counts .rs as novel extension when historical only had .ts', () => {
    const historical = [
      mkSession({
        messages: [
          mkMsg('assistant', [{ name: 'Read', input: { file_path: '/src/main.ts' } }]),
          mkMsg('assistant', [{ name: 'Edit', input: { file_path: '/src/utils.ts' } }]),
        ],
      }),
    ];
    const current = [
      mkSession({
        messages: [
          mkMsg('assistant', [{ name: 'Read', input: { file_path: '/src/lib.rs' } }]),
        ],
      }),
    ];
    expect(computeNewSurfaceCount(current, historical)).toBe(1);
  });

  it('returns 0 when all current extensions already appear in historical', () => {
    const historical = [
      mkSession({
        messages: [
          mkMsg('assistant', [{ name: 'Read', input: { file_path: '/a.ts' } }]),
        ],
      }),
    ];
    const current = [
      mkSession({
        messages: [
          mkMsg('assistant', [{ name: 'Edit', input: { file_path: '/b.ts' } }]),
        ],
      }),
    ];
    expect(computeNewSurfaceCount(current, historical)).toBe(0);
  });

  it('handles multiple novel extensions', () => {
    const historical = [
      mkSession({
        messages: [
          mkMsg('assistant', [{ name: 'Read', input: { file_path: '/src/a.ts' } }]),
        ],
      }),
    ];
    const current = [
      mkSession({
        messages: [
          mkMsg('assistant', [
            { name: 'Read', input: { file_path: '/src/main.rs' } },
            { name: 'Edit', input: { file_path: '/Dockerfile' } },   // no extension → skip
            { name: 'Write', input: { file_path: '/config.toml' } },
          ]),
        ],
      }),
    ];
    // .rs and .toml are novel (no extension for Dockerfile)
    expect(computeNewSurfaceCount(current, historical)).toBe(2);
  });

  it('treats extension comparison as case-insensitive', () => {
    const historical = [
      mkSession({
        messages: [mkMsg('assistant', [{ name: 'Read', input: { file_path: '/src/A.TS' } }])],
      }),
    ];
    const current = [
      mkSession({
        messages: [mkMsg('assistant', [{ name: 'Read', input: { file_path: '/src/b.ts' } }])],
      }),
    ];
    // .ts (lowercase) already seen in historical as .TS → no novel extensions
    expect(computeNewSurfaceCount(current, historical)).toBe(0);
  });
});
