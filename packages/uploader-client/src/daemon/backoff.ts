/**
 * Exponential backoff schedule for the uploader retry loop.
 *
 * Per plan §1.4: 30s → 60s → 120s → ... → 24h cap.
 *
 * Issue #266 F7: the original count-based dead-letter rule
 * (`MAX_FAILURES_BEFORE_DEAD_LETTER = 10`) lived in a per-process RAM Map
 * that got wiped every time the daemon idle-self-exited (every 15 min of
 * inactivity). A pathologically failing entry could therefore never reach
 * the cap, because each new daemon process started counting from zero. We
 * replace the rule with a wall-clock window: an entry whose first failure
 * is more than 24h ago is moved to dead-letter, regardless of how many
 * daemon restarts happened in between. The first-failure timestamp lives
 * in the queue metadata file so it survives daemon restarts.
 */

export const BASE_BACKOFF_MS = 30_000;
export const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000; // 24h

/** Issue #266 F7: dead-letter window in ms (24h). */
export const DEAD_LETTER_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Compute the next retry delay (ms) given the failure count.
 * `failures` is 1-based: the FIRST failure returns 30s, the second 60s, etc.
 */
export function backoffMs(failures: number): number {
  if (failures < 1) return 0;
  const exp = Math.min(failures - 1, 30); // guard against >2^30 overflow
  const ms = BASE_BACKOFF_MS * Math.pow(2, exp);
  return Math.min(ms, MAX_BACKOFF_MS);
}

/**
 * True iff the entry should be moved to dead-letter.
 *
 * Issue #266 F7: input is now the persisted ISO timestamp of the *first*
 * failure (or `null` for an entry that has not yet failed) plus the
 * current clock. Returns true once at least `DEAD_LETTER_AFTER_MS` has
 * elapsed since that first failure.
 */
export function shouldDeadLetter(firstFailedAt: string | null, now: Date): boolean {
  if (!firstFailedAt) return false;
  const startedMs = Date.parse(firstFailedAt);
  if (!Number.isFinite(startedMs)) return false;
  return now.getTime() - startedMs >= DEAD_LETTER_AFTER_MS;
}
