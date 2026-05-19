/**
 * Gracefully stop the running uploader daemon (if any) and spawn a fresh one
 * using the freshly-replaced .cjs bundle.
 *
 * Approach:
 *   1. Read uploader.pid. If absent → daemon wasn't running, just spawn.
 *   2. If process.kill(pid, 0) confirms alive:
 *      - Send graceful terminate (Node maps to SIGTERM on POSIX, TerminateProcess
 *        immediately on Windows — same outcome semantically).
 *      - Poll for exit up to 10s.
 *      - If still alive: SIGKILL (POSIX) / taskkill /F (Windows).
 *   3. Spawn the new daemon detached with stdio pointed at uploader.log.
 */
import { existsSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { platform } from 'node:os';

const GRACEFUL_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 250;

function pidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'EPERM';
  }
}

function readPidRecord(path: string): { pid: number; start_at?: string } | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8').trim();
    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw) as { pid?: unknown; start_at?: unknown };
      if (typeof parsed.pid === 'number' && Number.isFinite(parsed.pid) && parsed.pid > 0) {
        return {
          pid: parsed.pid,
          ...(typeof parsed.start_at === 'string' ? { start_at: parsed.start_at } : {}),
        };
      }
      return null;
    }
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return { pid: n };
  } catch {
    return null;
  }
  return null;
}

/**
 * Read PID — kept for backward compat with earlier signatures.
 */
function readPid(path: string): number | null {
  return readPidRecord(path)?.pid ?? null;
}

/**
 * Defensive check: refuse to kill if `start_at` says the recorded process is
 * older than 30 days. PID has almost certainly been recycled by the OS to a
 * completely unrelated process (Chrome, VS Code, …). Without start_at field
 * (e.g. legacy plain-integer pid file) we proceed but log a caution.
 */
const STALE_PID_RECORD_MS = 30 * 24 * 60 * 60 * 1000;
function pidLooksRecycled(record: { pid: number; start_at?: string }): boolean {
  if (!record.start_at) return false; // no signal — assume valid
  const t = Date.parse(record.start_at);
  if (!Number.isFinite(t)) return true; // garbage timestamp — refuse
  return Date.now() - t > STALE_PID_RECORD_MS;
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!pidAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

function forceKill(pid: number): void {
  if (platform() === 'win32') {
    try {
      spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
    } catch {}
  } else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
}

export interface DaemonRestartResult {
  ok: boolean;
  detail?: string;
  killedOld?: boolean;
  newPid?: number;
}

export async function restartUploader(opts: {
  uploaderBinPath: string;
  pidFile: string;
  logFile: string;
}): Promise<DaemonRestartResult> {
  const pidRecord = readPidRecord(opts.pidFile);
  const oldPid = pidRecord?.pid ?? null;
  let killedOld = false;
  // CTO review: refuse to kill a recycled-looking PID (record older than 30
  // days → PID is almost certainly a different process now).
  if (
    pidRecord !== null &&
    oldPid !== null &&
    pidAlive(oldPid) &&
    !pidLooksRecycled(pidRecord)
  ) {
    try {
      process.kill(oldPid); // default SIGTERM on POSIX; Windows: kills immediately
    } catch (err) {
      // Already dead between read and kill — fine.
    }
    const exited = await waitForExit(oldPid, GRACEFUL_TIMEOUT_MS);
    if (!exited) {
      forceKill(oldPid);
      // give kernel a moment
      await new Promise((r) => setTimeout(r, 200));
    }
    killedOld = true;
  }
  // Clean stale pid file regardless
  if (existsSync(opts.pidFile)) {
    try {
      unlinkSync(opts.pidFile);
    } catch {
      // best-effort
    }
  }
  // Spawn fresh
  let logFd: number;
  try {
    logFd = openSync(opts.logFile, 'a');
  } catch (err) {
    return {
      ok: false,
      killedOld,
      detail: `cannot open log file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  try {
    const child = spawn(process.execPath, ['--no-warnings', opts.uploaderBinPath], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
    });
    child.unref();
    return { ok: true, killedOld, newPid: child.pid ?? undefined };
  } catch (err) {
    return {
      ok: false,
      killedOld,
      detail: `spawn failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
