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
  // 2026-06-03: this scan is now an ORIGIN-ONLY fallback (the authoritative
  // path is the client-supplied envelope.git_remote). It must NOT attribute a
  // session to a repo it merely cloned, fetched, or mentioned — only to
  // evidence that a github URL is THIS working dir's origin. Previously it
  // grabbed the first github.com URL anywhere (command, WebFetch URL, prose
  // tool-result), which mis-attributed work to foreign repos.

  it('returns null when no github URL appears anywhere', () => {
    expect(extractRemoteFromSession(makeSessionWithBash('git push origin main'))).toBeNull();
  });

  // ── what it MUST ignore (the mis-attribution bug) ──────────────────────────
  it('ignores a `git clone` of another repo', () => {
    expect(
      extractRemoteFromSession(makeSessionWithBash('git clone https://github.com/torvalds/linux.git')),
    ).toBeNull();
  });

  it('ignores a github URL in a non-Bash tool input (WebFetch, etc.)', () => {
    const s = makeBlankSession();
    s.messages.push({
      role: 'assistant',
      text: '',
      toolUses: [{ name: 'WebFetch', input: { url: 'https://github.com/facebook/react' } }],
      toolResults: [],
    });
    expect(extractRemoteFromSession(s)).toBeNull();
  });

  it('ignores a github link merely mentioned in tool-result text', () => {
    expect(
      extractRemoteFromSession(
        makeSessionWithToolResult('npm warn deprecated; see https://github.com/vercel/next.js/issues/999'),
      ),
    ).toBeNull();
  });

  it("ignores `git remote add upstream <url>` (a fork's parent is a different repo)", () => {
    expect(
      extractRemoteFromSession(makeSessionWithBash('git remote add upstream https://github.com/other/parent')),
    ).toBeNull();
  });

  // ── what it MUST still capture (genuine origin evidence) ───────────────────
  it('captures the origin from `git remote -v` output', () => {
    expect(
      extractRemoteFromSession(
        makeSessionWithToolResult(
          'origin\tgit@github.com:Anthropic/matrix-riven.git (fetch)\norigin\tgit@github.com:Anthropic/matrix-riven.git (push)',
        ),
      ),
    ).toBe('Anthropic/matrix-riven');
  });

  it('captures the origin from `git remote add origin <url>`', () => {
    expect(
      extractRemoteFromSession(makeSessionWithBash('git remote add origin https://github.com/myorg/myrepo.git')),
    ).toBe('myorg/myrepo');
  });

  it('captures the origin from a .git/config [remote "origin"] block', () => {
    expect(
      extractRemoteFromSession(
        makeSessionWithToolResult(
          '[remote "origin"]\n\turl = https://github.com/myorg/myrepo.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*',
        ),
      ),
    ).toBe('myorg/myrepo');
  });

  it('skips a placeholder origin slug', () => {
    expect(
      extractRemoteFromSession(makeSessionWithBash('git remote add origin https://github.com/owner/repo')),
    ).toBeNull();
  });

  it('strips a trailing sentence period from the captured slug (findGithubRemote)', () => {
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
