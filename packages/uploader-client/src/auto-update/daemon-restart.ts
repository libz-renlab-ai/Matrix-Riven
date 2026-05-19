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

function readPid(path: string): number | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8').trim();
    // Existing uploader daemon writes JSON: {"pid":12345,"start_at":"..."}
    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw) as { pid?: unknown };
      if (typeof parsed.pid === 'number' && Number.isFinite(parsed.pid) && parsed.pid > 0) {
        return parsed.pid;
      }
      return null;
    }
    // Fallback: plain integer.
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  } catch {
    return null;
  }
  return null;
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
  const oldPid = readPid(opts.pidFile);
  let killedOld = false;
  if (oldPid !== null && pidAlive(oldPid)) {
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
