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
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

  // The system prompt is written to a one-shot temp file and passed via
  // `--system-prompt-file`. Two reasons:
  //   1. Windows `shell:true` + an inline `--system-prompt "<multi-line text>"`
  //      mangles newlines / quotes inside the prompt — they terminate the cmd
  //      command early, silently dropping `--output-format json` and other
  //      flags. With a file path argument no quoting matters.
  //   2. A multi-kilobyte prompt would push the command line past Windows'
  //      8191-char `cmd.exe` cap.
  const tmpRoot = mkdtempSync(join(tmpdir(), 'mr-llm-'));
  const promptFile = join(tmpRoot, 'system.txt');
  writeFileSync(promptFile, req.systemPrompt, 'utf8');

  // Round-2 QA P0 (security): the child process is spawned with shell:true
  // (needed on Windows to resolve the `claude.cmd` shim) and `req.model`
  // flows directly into the arg vector. When the model name comes from an
  // env var (LLM_TIER1_MODEL etc.), an attacker who can influence env could
  // inject shell metacharacters and get RCE.
  //
  // Defense-in-depth: gate model against a permissive-but-safe charset
  // allowlist before we hand it to spawn. Accepts all real Anthropic model
  // IDs (modern `claude-opus-4-7-...` AND legacy `claude-3-5-sonnet-...`)
  // by requiring the `claude-` prefix and then [A-Za-z0-9._-] only.
  // Rejects: shell metacharacters (`&;$()|<>'"\\`, space, newline), path
  // traversal, empty / overlong strings.
  const MODEL_PATTERN = /^claude-[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/;
  if (!MODEL_PATTERN.test(req.model)) {
    return Promise.resolve({
      ok: false,
      costUsd: 0,
      durationMs: 0,
      error: `invalid model id: ${req.model.slice(0, 40)}`,
    });
  }
  const args: string[] = [
    '-p',
    '--tools',
    '',
    '--system-prompt-file',
    promptFile,
    '--no-session-persistence',
    '--disable-slash-commands',
    // Only load project-level settings. Combined with cwd=tmpRoot (no
    // .claude/) this means NO hooks, NO CLAUDE.md, NO auto-memory — the
    // model sees exactly our system prompt + user prompt and nothing else.
    // Without this, the user's `~/.claude/settings.json` UserPromptSubmit
    // hooks prepend chat-style preambles ("English translation: …",
    // memory recall, etc.) that derail the model from producing JSON.
    '--setting-sources',
    'project',
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

    // Spawn from the OS temp dir, NOT the matrix-riven project. Otherwise the
    // child inherits this repo's `.claude/settings.json` hooks (UserPromptSubmit
    // translators, viki/superpowers memory recall, etc.) which prepend stray
    // chat-style preambles to the model input and pollute the output JSON.
    const child = spawn('claude', args, { shell: true, cwd: tmpRoot });

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
      try {
        rmSync(tmpRoot, { recursive: true, force: true });
      } catch {
        // best-effort — the OS cleans up tmpdir eventually
      }
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
