import { describe, it, expect, beforeEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  renameSync as realRenameSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ulid } from 'ulid';
import { main, resolveDaemonBin } from '../bin-digital-twin-tap.js';
import {
  defaultConfig,
  saveConfig,
  digitalTwinPaths,
  TEAM_SHARED_TOKEN,
} from '@matrix-riven/shared';
import { projectDirForCwd } from '../index.js';

function freshHome(): string {
  const home = join(tmpdir(), `dt-tap-bin-${ulid()}`);
  mkdirSync(home, { recursive: true });
  return home;
}

function makeStdinReader(payload: string): () => Promise<string> {
  return async () => payload;
}

function writeTranscript(home: string, cwd: string, sessionId: string, body: string): void {
  const dir = join(home, '.claude', 'projects', projectDirForCwd(cwd));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sessionId}.jsonl`), body, 'utf-8');
}

function enableConfigInHome(home: string): void {
  const cfg = defaultConfig({ user_id: 'u@h', machine_id: 'm-1' });
  cfg.uploader.token = 't';
  saveConfig(cfg, digitalTwinPaths(home).configFile);
}

// Issue #283 — most existing tests pre-date the hourly orchestrator and
// assert exact queue counts after the single-session tap. They must mock
// out runHourlyScanIfDue so it doesn't ALSO enqueue based on real-fs walks
// over the tmp home. Tests that exercise the orchestrator pass their own.
const noopHourly = async () =>
  ({ kind: 'skipped' as const, reason: 'too-soon' as const });

async function mainQuiet(stdin: () => Promise<string>, home: string): Promise<void> {
  await main({
    stdinReader: stdin,
    homedir: () => home,
    runHourlyScanIfDue: noopHourly,
  });
}

describe('bin-digital-twin-tap main', () => {
  let home: string;
  beforeEach(() => {
    home = freshHome();
  });

  it('auto-creates default config when missing and proceeds to tap (zero-touch onboarding)', async () => {
    const cwd = '/proj/zero-touch';
    const sessionId = 'sess-1';
    writeTranscript(home, cwd, sessionId, 'x');

    const paths = digitalTwinPaths(home);
    expect(existsSync(paths.configFile)).toBe(false);

    const stdin = makeStdinReader(
      JSON.stringify({ session_id: sessionId, transcript_path: '', cwd }),
    );
    await mainQuiet(stdin, home);

    // Config file was auto-created with the team-shared sentinel token.
    expect(existsSync(paths.configFile)).toBe(true);
    const persisted = JSON.parse(readFileSync(paths.configFile, 'utf-8'));
    expect(persisted.uploader.enabled).toBe(true);
    expect(persisted.uploader.token).toBe(TEAM_SHARED_TOKEN);
    expect(persisted.uploader.endpoint).toBe('http://192.168.22.88:8080');

    // tap-session ran: a queue payload + metadata were written.
    const entries = readdirSync(paths.pendingDir);
    expect(entries.filter((e) => e.endsWith('.payload')).length).toBe(1);
    expect(entries.filter((e) => e.endsWith('.json')).length).toBe(1);
  });

  it('respects user-paused config (enabled=false) and does not tap', async () => {
    const cwd = '/proj/paused';
    const sessionId = 'sess-paused';
    writeTranscript(home, cwd, sessionId, 'x');

    const paused = defaultConfig({ user_id: 'paused@x', machine_id: 'paused-host' });
    paused.uploader.enabled = false;
    const paths = digitalTwinPaths(home);
    saveConfig(paused, paths.configFile);
    const before = readFileSync(paths.configFile, 'utf-8');

    const stdin = makeStdinReader(
      JSON.stringify({ session_id: sessionId, transcript_path: '', cwd }),
    );
    await mainQuiet(stdin, home);

    // Config file untouched.
    expect(readFileSync(paths.configFile, 'utf-8')).toBe(before);
    // No queue write.
    let queueEntries: string[] = [];
    try {
      queueEntries = readdirSync(paths.pendingDir);
    } catch {
      queueEntries = [];
    }
    expect(queueEntries.length).toBe(0);
  });

  it('patches missing token (enabled=true, token=null) and proceeds to tap', async () => {
    const cwd = '/proj/patch';
    const sessionId = 'sess-patch';
    writeTranscript(home, cwd, sessionId, 'x');

    const cfg = defaultConfig({ user_id: 'patch@x', machine_id: 'patch-host' });
    // enabled=true (default), token=null (default) — first-run patch case.
    const paths = digitalTwinPaths(home);
    saveConfig(cfg, paths.configFile);

    const stdin = makeStdinReader(
      JSON.stringify({ session_id: sessionId, transcript_path: '', cwd }),
    );
    await mainQuiet(stdin, home);

    const persisted = JSON.parse(readFileSync(paths.configFile, 'utf-8'));
    expect(persisted.uploader.token).toBe(TEAM_SHARED_TOKEN);
    // Identity preserved.
    expect(persisted.identity.user_id).toBe('patch@x');
    expect(persisted.identity.machine_id).toBe('patch-host');

    const entries = readdirSync(paths.pendingDir);
    expect(entries.filter((e) => e.endsWith('.payload')).length).toBe(1);
  });

  it('returns silently and does not rewrite a malformed config file', async () => {
    const cwd = '/proj/malformed';
    const sessionId = 'sess-malformed';
    writeTranscript(home, cwd, sessionId, 'x');

    const paths = digitalTwinPaths(home);
    mkdirSync(paths.dataRootDir, { recursive: true });
    writeFileSync(paths.configFile, '{not json', 'utf-8');
    const before = readFileSync(paths.configFile, 'utf-8');

    const stdin = makeStdinReader(
      JSON.stringify({ session_id: sessionId, transcript_path: '', cwd }),
    );
    await mainQuiet(stdin, home);

    // File untouched.
    expect(readFileSync(paths.configFile, 'utf-8')).toBe(before);
    // No tap.
    let queueEntries: string[] = [];
    try {
      queueEntries = readdirSync(paths.pendingDir);
    } catch {
      queueEntries = [];
    }
    expect(queueEntries.length).toBe(0);
  });

  it('returns silently when stdin is empty', async () => {
    const cwd = '/proj/empty';
    const sessionId = 'sess-2';
    writeTranscript(home, cwd, sessionId, 'x');
    enableConfigInHome(home);

    await mainQuiet(makeStdinReader(''), home);

    const paths = digitalTwinPaths(home);
    let entries: string[] = [];
    try {
      entries = readdirSync(paths.pendingDir);
    } catch {
      entries = [];
    }
    expect(entries.length).toBe(0);
  });

  it('returns silently when stdin is invalid JSON', async () => {
    const cwd = '/proj/bad';
    const sessionId = 'sess-3';
    writeTranscript(home, cwd, sessionId, 'x');
    enableConfigInHome(home);

    await mainQuiet(makeStdinReader('not-json'), home);

    const paths = digitalTwinPaths(home);
    let entries: string[] = [];
    try {
      entries = readdirSync(paths.pendingDir);
    } catch {
      entries = [];
    }
    expect(entries.length).toBe(0);
  });

  it('taps the session into the queue when config is enabled and transcript exists', async () => {
    const cwd = '/proj/ok';
    const sessionId = 'sess-4';
    writeTranscript(home, cwd, sessionId, 'session-body');
    enableConfigInHome(home);

    const stdin = makeStdinReader(
      JSON.stringify({ session_id: sessionId, transcript_path: '', cwd }),
    );
    await mainQuiet(stdin, home);

    const paths = digitalTwinPaths(home);
    const entries = readdirSync(paths.pendingDir);
    const payloads = entries.filter((e) => e.endsWith('.payload'));
    const metas = entries.filter((e) => e.endsWith('.json'));
    expect(payloads.length).toBe(1);
    expect(metas.length).toBe(1);
  });

  it('stays silent (no queue write) when transcript file does not exist', async () => {
    const cwd = '/proj/missing-transcript';
    const sessionId = 'sess-5';
    enableConfigInHome(home);

    const stdin = makeStdinReader(
      JSON.stringify({ session_id: sessionId, transcript_path: '', cwd }),
    );
    await mainQuiet(stdin, home);

    const paths = digitalTwinPaths(home);
    let entries: string[] = [];
    try {
      entries = readdirSync(paths.pendingDir);
    } catch {
      entries = [];
    }
    expect(entries.length).toBe(0);
  });

  it('rejects payloads missing required fields', async () => {
    const cwd = '/proj/badfields';
    const sessionId = 'sess-6';
    writeTranscript(home, cwd, sessionId, 'x');
    enableConfigInHome(home);

    // Missing session_id
    const stdin = makeStdinReader(JSON.stringify({ transcript_path: '', cwd }));
    await mainQuiet(stdin, home);

    const paths = digitalTwinPaths(home);
    let entries: string[] = [];
    try {
      entries = readdirSync(paths.pendingDir);
    } catch {
      entries = [];
    }
    expect(entries.length).toBe(0);
  });

  // Issue #283 — Stop hook tap kicks off the hourly orchestrator AFTER the
  // current-session tapSession completes. Verified through dep injection.
  it('invokes runHourlyScanIfDue after the current-session tap', async () => {
    const cwd = '/proj/hourly';
    const sessionId = 'sess-hourly';
    writeTranscript(home, cwd, sessionId, 'x');
    enableConfigInHome(home);

    const calls: { home: string; user_id: string }[] = [];
    const stdin = makeStdinReader(
      JSON.stringify({ session_id: sessionId, transcript_path: '', cwd }),
    );
    await main({
      stdinReader: stdin,
      homedir: () => home,
      runHourlyScanIfDue: async (input) => {
        calls.push({ home: input.home, user_id: input.config.identity.user_id });
        return { kind: 'skipped', reason: 'too-soon' };
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.home).toBe(home);
    expect(calls[0]!.user_id).toBe('u@h');
  });

  it('swallows hourly orchestrator throws — never blocks Stop hook close', async () => {
    const cwd = '/proj/hourly-boom';
    const sessionId = 'sess-boom';
    writeTranscript(home, cwd, sessionId, 'x');
    enableConfigInHome(home);

    const stdin = makeStdinReader(
      JSON.stringify({ session_id: sessionId, transcript_path: '', cwd }),
    );

    // Must not reject.
    await expect(
      main({
        stdinReader: stdin,
        homedir: () => home,
        runHourlyScanIfDue: async () => {
          throw new Error('hourly boom');
        },
      }),
    ).resolves.toBeUndefined();
  });

  it('does not invoke hourly orchestrator when config disables uploader', async () => {
    const cwd = '/proj/paused';
    const sessionId = 'sess-paused';
    writeTranscript(home, cwd, sessionId, 'x');
    const cfg = defaultConfig({ user_id: 'u@h', machine_id: 'm-1' });
    cfg.uploader.enabled = false;
    cfg.uploader.token = 't';
    saveConfig(cfg, digitalTwinPaths(home).configFile);

    let called = false;
    const stdin = makeStdinReader(
      JSON.stringify({ session_id: sessionId, transcript_path: '', cwd }),
    );
    await main({
      stdinReader: stdin,
      homedir: () => home,
      runHourlyScanIfDue: async () => {
        called = true;
        return { kind: 'skipped', reason: 'paused' };
      },
    });
    // isEnabled short-circuit means we don't reach the orchestrator.
    expect(called).toBe(false);
  });
});

describe('resolveDaemonBin', () => {
  let home: string;
  beforeEach(() => {
    home = freshHome();
  });

  function makeFakeMonorepo(rootHome: string): { selfDir: string; daemonAt: string } {
    // Mirror the Matrix-Riven monorepo layout: resolveDaemonBin walks
    // `selfDirname → ../../uploader-client/dist/bin-uploader.cjs`.
    // selfDir must be two path segments below the monorepo root (e.g.
    // packages/some-bin/dist) so the relative walk lands at
    // packages/uploader-client/dist/bin-uploader.cjs.
    const selfDir = join(rootHome, 'packages', 'cli', 'dist');
    const daemonDir = join(rootHome, 'packages', 'uploader-client', 'dist');
    mkdirSync(selfDir, { recursive: true });
    mkdirSync(daemonDir, { recursive: true });
    const daemonAt = join(daemonDir, 'bin-uploader.cjs');
    writeFileSync(daemonAt, '// fake daemon bundle\n', 'utf-8');
    return { selfDir, daemonAt };
  }

  it('returns the user-installed path when present (no monorepo lookup)', () => {
    const paths = digitalTwinPaths(home);
    mkdirSync(paths.digitalTwinDir, { recursive: true });
    const userInstalled = join(paths.digitalTwinDir, 'bin-uploader.cjs');
    writeFileSync(userInstalled, '// existing user-installed bundle\n', 'utf-8');

    // selfDirname is irrelevant here because the user-installed path wins.
    const result = resolveDaemonBin(home, {
      selfDirname: () => '/nonexistent/cli/dist',
    });
    expect(result).toBe(userInstalled);
  });

  it('atomically self-installs via tmp+rename and ends up with the monorepo bytes', () => {
    const fakeRoot = join(tmpdir(), `dt-mono-${ulid()}`);
    mkdirSync(fakeRoot, { recursive: true });
    const { selfDir, daemonAt } = makeFakeMonorepo(fakeRoot);

    const paths = digitalTwinPaths(home);
    const userInstalled = join(paths.digitalTwinDir, 'bin-uploader.cjs');
    expect(existsSync(userInstalled)).toBe(false);

    const renameTargets: Array<[string, string]> = [];
    const result = resolveDaemonBin(home, {
      selfDirname: () => selfDir,
      renameSync: (oldPath, newPath) => {
        renameTargets.push([oldPath, newPath]);
        realRenameSync(oldPath, newPath);
      },
    });

    expect(result).toBe(userInstalled);
    expect(existsSync(userInstalled)).toBe(true);
    // The atomic path was used: rename was invoked exactly once with a
    // <userInstalled>.tmp.* source and the final userInstalled destination.
    expect(renameTargets.length).toBe(1);
    const [tmpSrc, finalDest] = renameTargets[0]!;
    expect(tmpSrc).toMatch(/bin-uploader\.cjs\.tmp\.\d+\.\d+$/);
    expect(finalDest).toBe(userInstalled);
    // Bytes copied from the monorepo bundle.
    expect(readFileSync(userInstalled, 'utf-8')).toBe(
      readFileSync(daemonAt, 'utf-8'),
    );
  });

  it('falls back to direct copyFileSync when rename throws EXDEV (cross-FS)', () => {
    const fakeRoot = join(tmpdir(), `dt-mono-exdev-${ulid()}`);
    mkdirSync(fakeRoot, { recursive: true });
    const { selfDir, daemonAt } = makeFakeMonorepo(fakeRoot);

    const paths = digitalTwinPaths(home);
    const userInstalled = join(paths.digitalTwinDir, 'bin-uploader.cjs');

    let renameAttempts = 0;
    const result = resolveDaemonBin(home, {
      selfDirname: () => selfDir,
      renameSync: () => {
        renameAttempts++;
        const err = new Error('EXDEV: cross-device link not permitted');
        // Real Node attaches an errno code; mimic it.
        (err as NodeJS.ErrnoException).code = 'EXDEV';
        throw err;
      },
    });

    expect(renameAttempts).toBe(1);
    // Direct copy fallback ran: userInstalled exists with daemon bytes.
    expect(result).toBe(userInstalled);
    expect(existsSync(userInstalled)).toBe(true);
    expect(readFileSync(userInstalled, 'utf-8')).toBe(
      readFileSync(daemonAt, 'utf-8'),
    );
  });

  it('logs to deps.log and returns monorepo path when both atomic + direct copy fail', () => {
    const fakeRoot = join(tmpdir(), `dt-mono-fail-${ulid()}`);
    mkdirSync(fakeRoot, { recursive: true });
    const { selfDir, daemonAt } = makeFakeMonorepo(fakeRoot);

    const logs: string[] = [];
    const result = resolveDaemonBin(home, {
      selfDirname: () => selfDir,
      // Simulate read-only HOME or EACCES on every copy attempt.
      copyFileSync: () => {
        throw new Error('EACCES');
      },
      log: (msg) => logs.push(msg),
    });

    expect(result).toBe(daemonAt);
    expect(logs.length).toBe(1);
    expect(logs[0]).toMatch(/resolveDaemonBin self-install failed/);
    expect(logs[0]).toMatch(/EACCES/);
  });

  it('returns null when neither user-installed nor monorepo dist exists', () => {
    // Fresh tmpdir with no bin-uploader.cjs anywhere.
    const result = resolveDaemonBin(home, {
      selfDirname: () => '/nonexistent/cli/dist',
    });
    expect(result).toBeNull();
  });
});
