/**
 * Single-flight lock for the auto-updater. Without it, two SessionStart hooks
 * firing in quick succession would race on downloading and renaming the same
 * .cjs files.
 *
 * Format: two lines of "KEY=VALUE":
 *   PID=<int>
 *   TS=<iso-8601>
 *
 * Stale handling: a PID whose process is dead → strong-arm acquire. A PID
 * whose process is alive but TS > MAX_HOLD_MS old → treated as wedged,
 * strong-arm acquire. Otherwise refuse and let the holder finish.
 */
import { existsSync, openSync, writeSync, closeSync, readFileSync, unlinkSync } from 'node:fs';

const STALE_AFTER_MS = 60 * 60 * 1000; // 1 hour

export interface LockHolder {
  release(): void;
}

export interface LockAcquireResult {
  ok: boolean;
  holder?: LockHolder;
  reason?: 'held-fresh' | 'held-stale-broken';
}

function pidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    // Signal 0 doesn't actually send, just probes. Cross-platform in Node.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // EPERM = process exists but we can't signal it (different user). Still alive.
    if (code === 'EPERM') return true;
    return false;
  }
}

function parseLock(text: string): { pid: number; ts: number } | null {
  const lines = text.split('\n');
  let pid = NaN;
  let ts = NaN;
  for (const line of lines) {
    if (line.startsWith('PID=')) {
      const n = Number(line.slice(4).trim());
      if (Number.isFinite(n)) pid = n;
    } else if (line.startsWith('TS=')) {
      const t = Date.parse(line.slice(3).trim());
      if (Number.isFinite(t)) ts = t;
    }
  }
  if (!Number.isFinite(pid) || !Number.isFinite(ts)) return null;
  return { pid, ts };
}

/**
 * Atomically acquire the lock. Returns ok=false if a fresh holder owns it.
 *
 * `now` is injectable for tests.
 */
export function acquireLock(
  path: string,
  now: () => Date = () => new Date(),
): LockAcquireResult {
  const body = `PID=${process.pid}\nTS=${now().toISOString()}\n`;
  for (let attempt = 0; attempt < 2; attempt++) {
    let fd: number;
    try {
      // O_CREAT | O_EXCL | O_WRONLY — Node maps 'wx'
      fd = openSync(path, 'wx');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        // Disk full, permission denied, etc. Refuse to proceed.
        return { ok: false, reason: 'held-fresh' };
      }
      // Lock exists — inspect it.
      let raw = '';
      try {
        raw = readFileSync(path, 'utf8');
      } catch {
        // Race: holder unlinked between open and read. Retry once.
        continue;
      }
      const parsed = parseLock(raw);
      const nowMs = now().getTime();
      const stale =
        parsed === null ||
        !pidAlive(parsed.pid) ||
        nowMs - parsed.ts > STALE_AFTER_MS;
      if (!stale) {
        return { ok: false, reason: 'held-fresh' };
      }
      // Stale — strong-arm: unlink and retry.
      try {
        unlinkSync(path);
      } catch {
        // Race: someone else just unlinked. Retry will succeed.
      }
      continue;
    }
    try {
      writeSync(fd, body);
    } finally {
      closeSync(fd);
    }
    return {
      ok: true,
      holder: {
        release(): void {
          try {
            unlinkSync(path);
          } catch {
            // ignore — release is best-effort
          }
        },
      },
    };
  }
  return { ok: false, reason: 'held-stale-broken' };
}
