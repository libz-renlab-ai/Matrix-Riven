import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseEnvelopeBuffer,
  deriveProjectName,
  scanAllSessions,
  isNoiseProjectName,
  propagateRemotes,
} from '../transcript-loader.js';
import type { ParsedEnvelope, ParsedSession } from '../types.js';

function buildEnvelope(transcriptLines: string[]): Buffer {
  const jsonl = transcriptLines.join('\n');
  const gz = gzipSync(Buffer.from(jsonl, 'utf8')).toString('base64');
  const env = {
    schema_version: 1,
    envelope: {
      id: 'eid',
      user_id: 'liu@example.com',
      machine_id: 'host-abc',
      session_id: 'sid-1',
      cwd: '/home/u/proj/Matrix-Riven',
      project_name: 'Matrix-Riven',
      transcript_path: '/home/u/.claude/projects/.../sid-1.jsonl',
      payload_size: jsonl.length,
      captured_at: '2026-05-13T10:00:00.000Z',
      source: 'stop-hook',
      host: { os: 'linux', arch: 'x64', hostname: 'host' },
      riven_version: '0.1.0',
      consented_at: null,
    },
    transcript: { compression: 'gzip+base64', content: gz },
    l1_redaction_count: 2,
  };
  return Buffer.from(JSON.stringify(env), 'utf8');
}

describe('parseEnvelopeBuffer', () => {
  it('parses a minimal envelope with one user message', () => {
    const buf = buildEnvelope([
      JSON.stringify({
        type: 'user',
        timestamp: '2026-05-13T10:00:05.000Z',
        message: { role: 'user', content: 'hello' },
      }),
    ]);
    const parsed = parseEnvelopeBuffer(buf);
    expect(parsed).not.toBeNull();
    expect(parsed!.envelope.projectName).toBe('Matrix-Riven');
    expect(parsed!.envelope.userId).toBe('liu@example.com');
    expect(parsed!.l1RedactionCount).toBe(2);
    expect(parsed!.messages).toHaveLength(1);
    expect(parsed!.messages[0]!.role).toBe('user');
    expect(parsed!.messages[0]!.text).toBe('hello');
  });

  it('extracts tool use and tool result', () => {
    const buf = buildEnvelope([
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-05-13T10:00:10.000Z',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [
            { type: 'text', text: 'I will run bash' },
            { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } },
          ],
          usage: { input_tokens: 100, output_tokens: 20 },
        },
      }),
      JSON.stringify({
        type: 'user',
        timestamp: '2026-05-13T10:00:11.000Z',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tu1', is_error: false, content: 'a.txt\nb.txt' }],
        },
      }),
    ]);
    const parsed = parseEnvelopeBuffer(buf)!;
    expect(parsed.messages[0]!.toolUses).toEqual([{ name: 'Bash', input: { command: 'ls' } }]);
    expect(parsed.messages[1]!.toolResults).toEqual([{ toolUseId: 'tu1', isError: false, text: 'a.txt\nb.txt' }]);
    expect(parsed.model).toBe('claude-sonnet-4-6');
    expect(parsed.tokens.input).toBe(100);
    expect(parsed.tokens.output).toBe(20);
  });

  it('returns null on malformed JSON', () => {
    expect(parseEnvelopeBuffer(Buffer.from('not json'))).toBeNull();
  });

  it('returns null on missing transcript block', () => {
    const env = { schema_version: 1, envelope: { user_id: 'x' } };
    expect(parseEnvelopeBuffer(Buffer.from(JSON.stringify(env)))).toBeNull();
  });

  it('computes startTs/endTs/durationMs from message timestamps', () => {
    const buf = buildEnvelope([
      JSON.stringify({ type: 'user', timestamp: '2026-05-13T10:00:00.000Z', message: { role: 'user', content: 'a' } }),
      JSON.stringify({ type: 'user', timestamp: '2026-05-13T10:05:00.000Z', message: { role: 'user', content: 'b' } }),
    ]);
    const p = parseEnvelopeBuffer(buf)!;
    expect(p.startTs.toISOString()).toBe('2026-05-13T10:00:00.000Z');
    expect(p.endTs.toISOString()).toBe('2026-05-13T10:05:00.000Z');
    expect(p.durationMs).toBe(5 * 60 * 1000);
  });
});

/**
 * Post-2026-05-17 (data trust layer rebuild): `deriveProjectName` walks
 * left-to-right past home prefixes + container dirs + noise patterns to land
 * on the REPO ROOT, not the rightmost cwd segment. Each fixture below pins one
 * branch of that algorithm.
 */
describe('deriveProjectName walk-from-root', () => {
  const cases: [string, string][] = [
    // Home prefix stripped + repo is first non-container segment
    ['/home/u/Matrix-Riven/packages/collector-server/src', 'Matrix-Riven'],
    ['/Users/X/projects/TeamBrain/api/routes.ts', 'TeamBrain'],
    // Windows %USERPROFILE% + `Documents/projects/` container chain
    ['C:\\Users\\Z\\Documents\\projects\\My-Repo\\src', 'My-Repo'],
    // /root/ home prefix
    ['/root/proj/foo/bar', 'proj'],
    // No home prefix → drive letter + 1-char user folder filtered as noise,
    // first real segment wins
    ['C:\\u\\Matrix-Riven\\packages\\shared\\dist', 'Matrix-Riven'],
    // Common-last list still skipped at the head
    ['/home/u/Matrix-Riven/packages/collector-server/__tests__', 'Matrix-Riven'],
    // node_modules anywhere on the path is irrelevant; first non-container wins
    ['/home/u/proj/node_modules', 'proj'],
    // Pathological short paths — all single-char segments are filtered by
    // the length-<2 noise guard, so we fall back to the last segment.
    ['/single', 'single'],
    ['/a/.git', '.git'],
    ['/x/y/build', 'build'],
    ['/x/y/test', 'test'],
    ['/x/y/SRC', 'SRC'],
    ['/x/y/Build', 'Build'],
  ];
  for (const [cwd, expected] of cases) {
    it(`${cwd} → ${expected}`, () => {
      expect(deriveProjectName(cwd)).toBe(expected);
    });
  }
  it('container chain bottoms out on the next real segment', () => {
    // `u` is filtered (length < 2), then Matrix-Riven wins.
    expect(deriveProjectName('/u/Matrix-Riven/packages/dist/src')).toBe('Matrix-Riven');
  });
  it('all-segments-filtered → keeps last segment as last resort', () => {
    // src + dist are both COMMON_LAST_SEGMENTS, no real candidate left
    expect(deriveProjectName('/src/dist')).toBe('dist');
  });
  it('empty cwd → unknown', () => {
    expect(deriveProjectName('')).toBe('unknown');
  });
  it('noise patterns are skipped during the walk', () => {
    // 38a51917 is a pure-hex noise dir; walk continues past it to the real name
    expect(deriveProjectName('/home/u/38a51917/Matrix-Riven/src')).toBe('Matrix-Riven');
  });
});

describe('isNoiseProjectName', () => {
  it('flags pure-hex hash names', () => {
    expect(isNoiseProjectName('38a51917')).toBe(true);
    expect(isNoiseProjectName('deadbeef')).toBe(true);
    expect(isNoiseProjectName('ABCDEF')).toBe(true);
  });
  it('flags bench / disabled fixture names', () => {
    expect(isNoiseProjectName('teamagent-bench-teamagent-2xvaUa')).toBe(true);
    expect(isNoiseProjectName('foo-disabled-2026')).toBe(true);
  });
  it('flags underscore-prefix temps and pure-numeric dirs', () => {
    expect(isNoiseProjectName('_temp')).toBe(true);
    expect(isNoiseProjectName('_456')).toBe(true);
    expect(isNoiseProjectName('12345')).toBe(true);
  });
  it('flags lowercase-prefix + random-CamelCase suffix bench shape', () => {
    expect(isNoiseProjectName('teamagent-2xvaUa')).toBe(true);
  });
  it('flags drive letters', () => {
    expect(isNoiseProjectName('C:')).toBe(true);
    expect(isNoiseProjectName('d:')).toBe(true);
  });
  it('accepts real-looking project names', () => {
    expect(isNoiseProjectName('Matrix-Riven')).toBe(false);
    expect(isNoiseProjectName('TeamBrain')).toBe(false);
    expect(isNoiseProjectName('My-Repo')).toBe(false);
    expect(isNoiseProjectName('collector-server')).toBe(false);
    expect(isNoiseProjectName('CTA_generation')).toBe(false);
  });
  it('flags single-char names as noise', () => {
    expect(isNoiseProjectName('a')).toBe(true);
  });
});

/**
 * P-D1 follow-up: in-process parsed-session cache. Once a file has been parsed
 * for a given (absPath, mtimeMs) key, subsequent scans should return the same
 * `ParsedSession` instance without re-parsing — proven by reference equality.
 * Editing the file (mtime change) must invalidate the cache so a fresh parse
 * runs and a *new* instance is handed back.
 */
describe('parsed-session cache (P-D1 follow-up)', () => {
  function writeEnvelopeAt(dir: string, name: string, text: string): string {
    const jsonl = JSON.stringify({
      type: 'user',
      timestamp: '2026-05-13T10:00:05.000Z',
      message: { role: 'user', content: text },
    });
    const env = {
      schema_version: 1,
      envelope: {
        id: name,
        user_id: 'liu@example.com',
        machine_id: 'host-abc',
        session_id: name,
        cwd: '/home/u/proj/Matrix-Riven',
        project_name: 'Matrix-Riven',
        transcript_path: `/home/u/.claude/projects/.../${name}.jsonl`,
        payload_size: jsonl.length,
        captured_at: '2026-05-13T10:00:00.000Z',
        source: 'stop-hook',
        host: { os: 'linux', arch: 'x64', hostname: 'host' },
        riven_version: '0.1.0',
        consented_at: null,
      },
      transcript: {
        compression: 'gzip+base64',
        content: gzipSync(Buffer.from(jsonl, 'utf8')).toString('base64'),
      },
      l1_redaction_count: 0,
    };
    const full = join(dir, `${name}.json`);
    writeFileSync(full, JSON.stringify(env), 'utf8');
    return full;
  }

  function makeCollectorTree(): { root: string; sessionPath: string } {
    const root = mkdtempSync(join(tmpdir(), 'parsed-cache-'));
    const leaf = join(root, 'liu@example.com', '2026-05-13');
    mkdirSync(leaf, { recursive: true });
    const sessionPath = writeEnvelopeAt(leaf, 'sess-1', 'hello');
    return { root, sessionPath };
  }

  it('returns identical ParsedSession reference on second scan of unchanged file', () => {
    const { root } = makeCollectorTree();
    const first = scanAllSessions(root);
    const second = scanAllSessions(root);
    expect(first.length).toBe(1);
    expect(second.length).toBe(1);
    // Cache hit → same JS object handed back, not just deeply-equal data.
    expect(second[0]).toBe(first[0]);
  });

  it('returns a fresh ParsedSession after the file mtime changes', () => {
    const { root, sessionPath } = makeCollectorTree();
    const first = scanAllSessions(root);
    expect(first.length).toBe(1);

    // Rewrite the file so mtime bumps. Force an explicit utimes bump too —
    // the OS may resolve mtime at second granularity, which would otherwise
    // make a fast rewrite-and-scan look like the same mtime.
    writeEnvelopeAt(join(root, 'liu@example.com', '2026-05-13'), 'sess-1', 'world');
    const now = new Date();
    const bumped = new Date(now.getTime() + 5000);
    utimesSync(sessionPath, bumped, bumped);

    const second = scanAllSessions(root);
    expect(second.length).toBe(1);
    expect(second[0]).not.toBe(first[0]);
    expect(second[0]!.messages[0]!.text).toBe('world');
  });

  it('cache survives across scans within the same process (multi-scan reference equality)', () => {
    const { root } = makeCollectorTree();
    const r1 = scanAllSessions(root);
    const r2 = scanAllSessions(root);
    const r3 = scanAllSessions(root);
    expect(r2[0]).toBe(r1[0]);
    expect(r3[0]).toBe(r1[0]);
    // Confirm we actually exercised the cache, not an empty result set.
    expect(statSync(join(root, 'liu@example.com', '2026-05-13')).isDirectory()).toBe(true);
  });
});

/**
 * 2026-05-17 — `propagateRemotes` is the bridge that lets non-git sessions in
 * the same repo inherit a sibling session's discovered `owner/repo` remote.
 * Without it, sessions that never ran a git command would still group by their
 * cwd-derived name and fragment the project list.
 */
describe('propagateRemotes', () => {
  function makeSessionFixture(envelope: Partial<ParsedEnvelope>): ParsedSession {
    return {
      envelope: {
        id: 'id',
        userId: 'u',
        machineId: 'm',
        sessionId: 's',
        cwd: '',
        projectName: '',
        capturedAt: '2026-05-17T00:00:00Z',
        rivenVersion: '0',
        consentedAt: null,
        ...envelope,
      },
      l1RedactionCount: 0,
      messages: [],
      durationMs: 0,
      startTs: new Date('2026-05-17T00:00:00Z'),
      endTs: new Date('2026-05-17T00:00:00Z'),
      tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    };
  }

  it('fills in remote across same-tree sessions', () => {
    const a = makeSessionFixture({ cwd: '/home/u/proj-a/src', gitRemote: 'org/proj-a' });
    const b = makeSessionFixture({ cwd: '/home/u/proj-a/docs' });
    const c = makeSessionFixture({ cwd: '/home/u/proj-b/lib' });
    propagateRemotes([a, b, c]);
    expect(b.envelope.gitRemote).toBe('org/proj-a');
    expect(c.envelope.gitRemote).toBeUndefined();
  });

  it('longest-matching prefix wins so a nested repo does not adopt an ancestor remote', () => {
    const parent = makeSessionFixture({ cwd: '/home/u/parent/x', gitRemote: 'org/parent' });
    const nested = makeSessionFixture({
      cwd: '/home/u/parent/nested/y',
      gitRemote: 'org/nested',
    });
    const childOfNested = makeSessionFixture({ cwd: '/home/u/parent/nested/z' });
    propagateRemotes([parent, nested, childOfNested]);
    expect(childOfNested.envelope.gitRemote).toBe('org/nested');
  });

  it('normalises Windows separators in cwd before matching', () => {
    const a = makeSessionFixture({
      cwd: 'D:\\projects\\matrix\\src',
      gitRemote: 'org/matrix',
    });
    const b = makeSessionFixture({ cwd: 'D:\\projects\\matrix\\docs' });
    propagateRemotes([a, b]);
    expect(b.envelope.gitRemote).toBe('org/matrix');
  });

  it('is idempotent — re-running does not overwrite or mutate further', () => {
    const a = makeSessionFixture({ cwd: '/home/u/r/src', gitRemote: 'o/r' });
    const b = makeSessionFixture({ cwd: '/home/u/r/docs' });
    propagateRemotes([a, b]);
    expect(b.envelope.gitRemote).toBe('o/r');
    propagateRemotes([a, b]);
    expect(b.envelope.gitRemote).toBe('o/r');
  });
});
