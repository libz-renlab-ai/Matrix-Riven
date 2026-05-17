import { describe, it, expect } from 'vitest';
import {
  findGithubRemote,
  extractRemoteFromSession,
  resolveProjectIdentity,
} from '../transcript-loader.js';
import type { ParsedEnvelope, ParsedSession, ParsedMessage } from '../types.js';

/**
 * Reusable empty envelope for resolveProjectIdentity branch tests. Every
 * field set to a "minimum valid" value so individual cases can spread + tweak
 * only the field under test.
 */
const emptyEnvelope: ParsedEnvelope = {
  id: 'id',
  userId: 'u@example.com',
  machineId: 'm',
  sessionId: 's',
  cwd: '',
  projectName: '',
  capturedAt: '2026-05-17T00:00:00Z',
  rivenVersion: '0',
  consentedAt: null,
};

function makeBlankSession(): ParsedSession {
  return {
    envelope: { ...emptyEnvelope },
    l1RedactionCount: 0,
    messages: [],
    durationMs: 0,
    startTs: new Date('2026-05-17T00:00:00Z'),
    endTs: new Date('2026-05-17T00:00:00Z'),
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
  };
}

function makeSessionWithBash(command: string): ParsedSession {
  const msg: ParsedMessage = {
    role: 'assistant',
    text: '',
    toolUses: [{ name: 'Bash', input: { command } }],
    toolResults: [],
  };
  const s = makeBlankSession();
  s.messages.push(msg);
  return s;
}

function makeSessionWithToolResult(text: string): ParsedSession {
  const msg: ParsedMessage = {
    role: 'user',
    text: '',
    toolUses: [],
    toolResults: [{ isError: false, text }],
  };
  const s = makeBlankSession();
  s.messages.push(msg);
  return s;
}

describe('findGithubRemote', () => {
  it.each<[string | undefined | null, string | null]>([
    ['git remote -v\norigin\tgit@github.com:anthropics/claude-code.git (fetch)', 'anthropics/claude-code'],
    ['https://github.com/foo/bar.git', 'foo/bar'],
    ['https://github.com/foo/bar/issues/42', 'foo/bar'],
    ['git clone https://github.com/owner/repo', 'owner/repo'],
    ['git@github.com:org/proj-name.git', 'org/proj-name'],
    ['some random text', null],
    ['', null],
    [undefined, null],
    [null, null],
  ])('extracts %s → %s', (input, expected) => {
    expect(findGithubRemote(input)).toBe(expected);
  });

  it('handles a trailing dot/slash on the HTTPS form', () => {
    expect(findGithubRemote('see https://github.com/owner/repo, for details')).toBe('owner/repo');
    expect(findGithubRemote('https://github.com/owner/repo/')).toBe('owner/repo');
  });
});

describe('extractRemoteFromSession', () => {
  it('returns null when no github URL appears anywhere', () => {
    const session = makeSessionWithBash('git push origin main');
    expect(extractRemoteFromSession(session)).toBeNull();
  });

  it('finds remote in Bash command tool_use input', () => {
    const session = makeSessionWithBash('git clone https://github.com/anthropics/claude-code.git');
    expect(extractRemoteFromSession(session)).toBe('anthropics/claude-code');
  });

  it('finds remote in tool_result text', () => {
    const session = makeSessionWithToolResult(
      'origin\tgit@github.com:Anthropic/matrix-riven.git (fetch)',
    );
    expect(extractRemoteFromSession(session)).toBe('Anthropic/matrix-riven');
  });

  it('finds remote in a non-Bash tool input string field', () => {
    const s = makeBlankSession();
    s.messages.push({
      role: 'assistant',
      text: '',
      toolUses: [{ name: 'WebFetch', input: { url: 'https://github.com/anthropics/sdk' } }],
      toolResults: [],
    });
    expect(extractRemoteFromSession(s)).toBe('anthropics/sdk');
  });

  it('skips placeholder example slugs and falls through to a real remote', () => {
    // foo/bar appears first (documentation example), real remote follows.
    const s = makeBlankSession();
    s.messages.push({
      role: 'assistant',
      text: '',
      toolUses: [
        { name: 'Bash', input: { command: 'echo https://github.com/foo/bar' } },
        { name: 'Bash', input: { command: 'git clone https://github.com/real-org/real-repo' } },
      ],
      toolResults: [],
    });
    expect(extractRemoteFromSession(s)).toBe('real-org/real-repo');
  });

  it('returns null when only placeholder slugs are mentioned', () => {
    const s = makeSessionWithBash('cp from https://github.com/owner/repo to https://github.com/user/repo');
    expect(extractRemoteFromSession(s)).toBeNull();
  });

  it('strips a trailing sentence period from the captured slug', () => {
    // findGithubRemote's regex captures up to the lookahead; normalisation
    // then trims trailing `.` so `vhs.` reduces to `vhs`.
    expect(findGithubRemote('see https://github.com/charmbracelet/vhs.')).toBe('charmbracelet/vhs');
  });
});

describe('resolveProjectIdentity', () => {
  it('prefers gitRemote when set', () => {
    expect(
      resolveProjectIdentity({
        ...emptyEnvelope,
        gitRemote: 'owner/repo',
        projectName: 'OTHER',
        cwd: '/home/u/y',
      }),
    ).toBe('owner/repo');
  });

  it('falls back to projectName when no gitRemote', () => {
    expect(
      resolveProjectIdentity({ ...emptyEnvelope, projectName: 'Foo', cwd: '/home/u/y' }),
    ).toBe('Foo');
  });

  it('falls back to deriveProjectName when projectName is empty or "unknown"', () => {
    expect(
      resolveProjectIdentity({
        ...emptyEnvelope,
        projectName: 'unknown',
        cwd: '/home/u/Real-Project/sub',
      }),
    ).toBe('Real-Project');
    expect(
      resolveProjectIdentity({ ...emptyEnvelope, projectName: '', cwd: '/home/u/Another' }),
    ).toBe('Another');
  });
});
