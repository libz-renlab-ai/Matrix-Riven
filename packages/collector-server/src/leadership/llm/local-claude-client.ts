/**
 * local-claude-client — thin one-shot wrapper around the local `claude -p` CLI.
 *
 * The user's Claude Code subscription is our LLM API: we spawn the CLI, pipe a
 * single user prompt to stdin, and parse the JSON object printed on stdout.
 * Returned `{ok, result, costUsd, durationMs, error}` is what the summarizer
 * layer consumes.
 *
 * Two operational invariants worth knowing:
 *   1. A process-wide FIFO mutex serialises calls. `claude -p` has heavy
 *      startup cost (and the JSON output assumes nothing else is contending
 *      for the auth/keychain handshake), so N concurrent callers would just
 *      pile up startup overhead. One at a time, in order.
 *   2. Windows quirk: `claude` is delivered as a `.cmd` shim, which Node's
 *      `spawn` won't resolve without a shell. We set `shell: true` so PATH
 *      resolution behaves identically on Windows and POSIX.
 */
import { spawn } from 'node:child_process';

export interface LocalClaudeRequest {
  systemPrompt: string;
  userPrompt: string;
  model: string;
  timeoutMs?: number;
}

export interface LocalClaudeResponse {
  ok: boolean;
  result?: string;
  costUsd: number;
  durationMs: number;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;

// ---- FIFO mutex --------------------------------------------------------------
const queue: Array<() => void> = [];
let busy = false;

function acquire(): Promise<void> {
  if (!busy) {
    busy = true;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    queue.push(resolve);
  });
}

function release(): void {
  const next = queue.shift();
  if (next) {
    // `busy` stays true; we hand the baton directly to the next waiter.
    next();
  } else {
    busy = false;
  }
}

// ---- main --------------------------------------------------------------------
export async function runLocalClaude(req: LocalClaudeRequest): Promise<LocalClaudeResponse> {
  await acquire();
  try {
    return await runOnce(req);
  } finally {
    release();
  }
}

function runOnce(req: LocalClaudeRequest): Promise<LocalClaudeResponse> {
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();
  const args: string[] = [
    '-p',
    '--tools',
    '',
    '--system-prompt',
    req.systemPrompt,
    '--no-session-persistence',
    '--disable-slash-commands',
    '--output-format',
    'json',
    '--model',
    req.model,
  ];

  return new Promise<LocalClaudeResponse>((resolve) => {
    let settled = false;
    let timedOut = false;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const child = spawn('claude', args, { shell: true });

    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      try {
        child.kill();
      } catch {
        // ignore — child may have already exited
      }
    }, timeoutMs);

    const settle = (res: LocalClaudeResponse): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res);
    };

    // Pipe user prompt to stdin, then close.
    if (child.stdin) {
      try {
        child.stdin.write(req.userPrompt);
        child.stdin.end();
      } catch {
        // If stdin already errored, the 'close' handler will resolve.
      }
      // Swallow EPIPE etc; we don't want an uncaught error if the child died
      // before reading stdin.
      const stdinErrTarget = child.stdin as unknown as {
        on?: (event: string, listener: (...args: unknown[]) => void) => void;
      };
      stdinErrTarget.on?.('error', () => {});
    }

    if (child.stdout) {
      child.stdout.on('data', (chunk: Buffer | string) => {
        stdoutChunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
      });
    }
    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer | string) => {
        stderrChunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
      });
    }

    child.on('error', (err: Error) => {
      settle({
        ok: false,
        error: `spawn_error: ${err.message}`,
        costUsd: 0,
        durationMs: Date.now() - startedAt,
      });
    });

    child.on('close', () => {
      const durationMs = Date.now() - startedAt;
      if (timedOut) {
        settle({ ok: false, error: 'timeout', costUsd: 0, durationMs });
        return;
      }
      const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
      if (!stdout) {
        const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
        settle({
          ok: false,
          error: `empty_stdout: ${stderr.slice(0, 200)}`,
          costUsd: 0,
          durationMs,
        });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        settle({
          ok: false,
          error: `parse_error: ${stdout.slice(0, 200)}`,
          costUsd: 0,
          durationMs,
        });
        return;
      }
      const obj = (parsed ?? {}) as {
        result?: unknown;
        total_cost_usd?: unknown;
        duration_ms?: unknown;
        is_error?: unknown;
      };
      const result = typeof obj.result === 'string' ? obj.result : '';
      const costUsd = typeof obj.total_cost_usd === 'number' ? obj.total_cost_usd : 0;
      const cliDurationMs =
        typeof obj.duration_ms === 'number' ? obj.duration_ms : durationMs;
      const isError = obj.is_error === true;
      if (isError) {
        settle({ ok: false, error: result, costUsd: 0, durationMs: cliDurationMs });
        return;
      }
      settle({ ok: true, result, costUsd, durationMs: cliDurationMs });
    });
  });
}
