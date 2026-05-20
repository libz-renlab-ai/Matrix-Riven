/**
 * Tests for `local-claude-client.ts`. We mock `node:child_process.spawn` with a
 * controllable fake whose stdout/stderr/exit can be driven from the test body.
 *
 * Why this looks weird: vitest hoists `vi.mock` factory above imports, so the
 * factory cannot close over module-scope test variables. We instead expose a
 * mutable registry inside the factory and read it via the mocked module's
 * exports.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

interface FakeChildHandle {
  stdoutData: (chunk: string) => void;
  stderrData: (chunk: string) => void;
  close: (code: number) => void;
  stdinChunks: string[];
  stdinEnded: boolean;
  killed: boolean;
  killSpy: ReturnType<typeof vi.fn>;
  args: { cmd: string; args: ReadonlyArray<string>; opts: unknown };
}

interface SpawnRegistry {
  spawnCalls: FakeChildHandle[];
  /** Optional hook that fires synchronously inside spawn(); useful to defer close. */
  onSpawn?: (handle: FakeChildHandle) => void;
}

vi.mock('node:child_process', () => {
  const registry: SpawnRegistry = { spawnCalls: [] };

  function spawn(cmd: string, args: ReadonlyArray<string>, opts: unknown) {
    const stdin = {
      _chunks: [] as string[],
      _ended: false,
      write(chunk: string | Buffer): boolean {
        this._chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
        return true;
      },
      end(chunk?: string | Buffer): void {
        if (chunk !== undefined) this.write(chunk);
        this._ended = true;
      },
    };
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const child = new EventEmitter() as EventEmitter & {
      stdin: typeof stdin;
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: (sig?: string) => boolean;
      killed: boolean;
    };
    child.stdin = stdin;
    child.stdout = stdout;
    child.stderr = stderr;
    child.killed = false;
    const killSpy = vi.fn((_sig?: string) => {
      child.killed = true;
      return true;
    });
    child.kill = killSpy as unknown as (sig?: string) => boolean;

    const handle: FakeChildHandle = {
      stdoutData: (chunk: string) => stdout.emit('data', Buffer.from(chunk, 'utf8')),
      stderrData: (chunk: string) => stderr.emit('data', Buffer.from(chunk, 'utf8')),
      close: (code: number) => child.emit('close', code),
      stdinChunks: stdin._chunks,
      get stdinEnded() {
        return stdin._ended;
      },
      get killed() {
        return child.killed;
      },
      killSpy,
      args: { cmd, args, opts },
    };
    registry.spawnCalls.push(handle);
    registry.onSpawn?.(handle);
    return child;
  }

  return { spawn, __registry: registry };
});

// Import after mock; we also pull the registry via the mocked module.
const cpModule = await import('node:child_process');
const registry = (cpModule as unknown as { __registry: SpawnRegistry }).__registry;
const { runLocalClaude } = await import('../local-claude-client.js');

function resetRegistry(): void {
  registry.spawnCalls.length = 0;
  registry.onSpawn = undefined;
}

describe('runLocalClaude', () => {
  beforeEach(() => {
    resetRegistry();
  });

  it('builds spawn args correctly and parses success JSON', async () => {
    const promise = runLocalClaude({
      systemPrompt: 'sys',
      userPrompt: 'hello world',
      model: 'claude-haiku-4-5-20251001',
    });

    // The mutex acquires synchronously, but spawn runs on the next microtask.
    // Flush microtasks until the spawn has happened.
    await Promise.resolve();
    await Promise.resolve();

    expect(registry.spawnCalls.length).toBe(1);
    const h = registry.spawnCalls[0]!;
    // The system prompt is written to a temp file and passed as
    // `--system-prompt-file <path>`. The path is host-specific; assert the
    // surrounding flags exactly and the file flag's *shape*.
    const args = h.args.args as string[];
    const idx = args.indexOf('--system-prompt-file');
    expect(idx).toBeGreaterThan(0);
    const promptFile = args[idx + 1]!;
    expect(promptFile).toMatch(/mr-llm-[^/\\]+[/\\]system\.txt$/);
    const before = args.slice(0, idx);
    const after = args.slice(idx + 2);
    expect(before).toEqual(['-p', '--tools', '']);
    expect(after).toEqual([
      '--no-session-persistence',
      '--disable-slash-commands',
      '--setting-sources',
      'project',
      '--output-format',
      'json',
      '--model',
      'claude-haiku-4-5-20251001',
    ]);
    // The system prompt's content must live in the temp file.
    const fs = await import('node:fs');
    expect(fs.readFileSync(promptFile, 'utf8')).toBe('sys');
    // Stdin received the user prompt and was closed.
    expect(h.stdinChunks.join('')).toBe('hello world');
    expect(h.stdinEnded).toBe(true);

    h.stdoutData(
      JSON.stringify({
        result: 'the answer',
        total_cost_usd: 0.0123,
        duration_ms: 543,
        is_error: false,
      }),
    );
    h.close(0);
    const res = await promise;
    expect(res.ok).toBe(true);
    expect(res.result).toBe('the answer');
    expect(res.costUsd).toBe(0.0123);
    expect(res.durationMs).toBe(543);
    expect(res.error).toBeUndefined();
  });

  it('returns ok:false when is_error:true', async () => {
    const promise = runLocalClaude({
      systemPrompt: 's',
      userPrompt: 'u',
      model: 'claude-haiku-4-5-20251001',
    });
    await Promise.resolve();
    await Promise.resolve();
    const h = registry.spawnCalls[0]!;
    h.stdoutData(
      JSON.stringify({
        result: 'rate limited',
        total_cost_usd: 0,
        duration_ms: 200,
        is_error: true,
      }),
    );
    h.close(0);
    const res = await promise;
    expect(res.ok).toBe(false);
    expect(res.error).toBe('rate limited');
    expect(res.costUsd).toBe(0);
    expect(res.durationMs).toBe(200);
  });

  it('returns parse_error when stdout is not JSON', async () => {
    const promise = runLocalClaude({
      systemPrompt: 's',
      userPrompt: 'u',
      model: 'claude-haiku-4-5-20251001',
    });
    await Promise.resolve();
    await Promise.resolve();
    const h = registry.spawnCalls[0]!;
    h.stdoutData('not json at all, this is garbage from the CLI');
    h.close(0);
    const res = await promise;
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/^parse_error: /);
    expect(res.error).toContain('not json at all');
    expect(res.costUsd).toBe(0);
    expect(typeof res.durationMs).toBe('number');
  });

  it('kills the child and returns timeout error when timeoutMs exceeded', async () => {
    const promise = runLocalClaude({
      systemPrompt: 's',
      userPrompt: 'u',
      model: 'claude-haiku-4-5-20251001',
      timeoutMs: 25,
    });
    await Promise.resolve();
    await Promise.resolve();
    const h = registry.spawnCalls[0]!;
    // Wait past timeout; do NOT call close().
    await new Promise((r) => setTimeout(r, 60));
    // The timeout fires kill(), which our fake hooks into emitting 'close'.
    // Emit close to allow the awaiter to resolve (real CLI would emit close
    // after kill; we model that explicitly).
    if (!h.killed) {
      // Shouldn't happen — kill should fire first.
    }
    h.close(143);
    const res = await promise;
    expect(res.ok).toBe(false);
    expect(res.error).toBe('timeout');
    expect(h.killSpy).toHaveBeenCalled();
  });

  it('serialises concurrent calls — second waits for first to finish', async () => {
    // Hold the first call's close until we explicitly fire it.
    const handles: FakeChildHandle[] = [];
    registry.onSpawn = (h) => {
      handles.push(h);
    };

    const p1 = runLocalClaude({ systemPrompt: 's', userPrompt: 'u1', model: 'claude-haiku-4-5-20251001' });
    const p2 = runLocalClaude({ systemPrompt: 's', userPrompt: 'u2', model: 'claude-haiku-4-5-20251001' });

    // Flush a few microtasks to let p1's spawn run.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Only the first spawn should have fired so far.
    expect(handles.length).toBe(1);
    expect(handles[0]!.stdinChunks.join('')).toBe('u1');

    // Finish call 1.
    handles[0]!.stdoutData(
      JSON.stringify({ result: 'r1', total_cost_usd: 0.001, duration_ms: 10, is_error: false }),
    );
    handles[0]!.close(0);
    const r1 = await p1;
    expect(r1.result).toBe('r1');

    // Now call 2 should spawn.
    await Promise.resolve();
    await Promise.resolve();
    expect(handles.length).toBe(2);
    expect(handles[1]!.stdinChunks.join('')).toBe('u2');

    handles[1]!.stdoutData(
      JSON.stringify({ result: 'r2', total_cost_usd: 0.002, duration_ms: 20, is_error: false }),
    );
    handles[1]!.close(0);
    const r2 = await p2;
    expect(r2.result).toBe('r2');
  });
});
