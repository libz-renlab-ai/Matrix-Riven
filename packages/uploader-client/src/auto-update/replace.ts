/**
 * Atomic swap: for each new file path `<name>.cjs.new`, back up the current
 * `<name>.cjs` to `<name>.cjs.old` (if it exists), then rename the `.new` into
 * place. `rollback()` reverses the swap from .old files if a probe fails.
 *
 * Windows note: renameSync over an existing file is supported on Node ≥17;
 * we use unlink+rename as fallback for the unusual cases where it isn't.
 */
import { existsSync, copyFileSync, renameSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';

export interface ReplacePlan {
  /** Absolute path of the live staged bin (without .new / .old suffixes). */
  livePath: string;
  /** Absolute path of the downloaded candidate (with `.new` suffix). */
  newPath: string;
  /** Absolute path where the live file is backed up before replacement. */
  oldPath: string;
}

export interface ReplaceResult {
  ok: boolean;
  /** plans completed before the failure, for rollback */
  completed: ReplacePlan[];
  failed?: { plan: ReplacePlan; error: string };
}

export function buildReplacePlans(stageDir: string, newPaths: string[]): ReplacePlan[] {
  return newPaths.map((newPath) => {
    const name = basename(newPath).replace(/\.new$/, '');
    const livePath = join(stageDir, name);
    return {
      livePath,
      newPath,
      oldPath: `${livePath}.old`,
    };
  });
}

function safeRename(src: string, dst: string): void {
  try {
    renameSync(src, dst);
  } catch {
    try {
      unlinkSync(dst);
    } catch {}
    renameSync(src, dst);
  }
}

export function applyReplacements(plans: ReplacePlan[]): ReplaceResult {
  const completed: ReplacePlan[] = [];
  for (const plan of plans) {
    try {
      if (existsSync(plan.livePath)) {
        // Use copyFileSync, not rename, because the running uploader-daemon
        // process on Windows can hold the file handle (rename to .old would
        // EBUSY). Copy + rename allows the next swap of livePath to succeed.
        copyFileSync(plan.livePath, plan.oldPath);
      }
      safeRename(plan.newPath, plan.livePath);
      completed.push(plan);
    } catch (err) {
      return {
        ok: false,
        completed,
        failed: { plan, error: err instanceof Error ? err.message : String(err) },
      };
    }
  }
  return { ok: true, completed };
}

/**
 * Restore each completed swap from its .old backup. Best-effort.
 */
export function rollbackReplacements(completed: ReplacePlan[]): void {
  for (const plan of completed) {
    if (!existsSync(plan.oldPath)) continue;
    try {
      safeRename(plan.oldPath, plan.livePath);
    } catch {
      // last-ditch: try copy
      try {
        copyFileSync(plan.oldPath, plan.livePath);
        unlinkSync(plan.oldPath);
      } catch {
        // give up — corrupt install. Caller logs.
      }
    }
  }
}

/**
 * Sweep up the .old files after a successful probe. Best-effort.
 */
export function cleanupOldBackups(completed: ReplacePlan[]): void {
  for (const plan of completed) {
    if (!existsSync(plan.oldPath)) continue;
    try {
      unlinkSync(plan.oldPath);
    } catch {
      // ignore — next sweep
    }
  }
}
