#!/usr/bin/env node
/**
 * SessionStart hook 薄壳：读 stdin → fire-and-forget 拉起 auto-updater →
 * 调 emitCcStatus(session_start) → 退出。
 * 不引入 packages/cli 的 runHook 框架。绝不抛错、绝不阻塞会话。
 *
 * Bucket 1/2 additions: 在 session_start 时采样 host metrics（cpu/mem +
 * concurrent CC + ~/.claude/projects size），通过 extras 发到 snapshot。
 * 这些 metric 仅在 session_start 采集——pre_tool_use 等高频事件不重复采。
 */
import path from 'node:path';
import { existsSync, openSync, readdirSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readEnvWithLegacy } from '@matrix-riven/shared';
import { emitCcStatus, sampleHostMetrics } from './realtime-emit.js';

/**
 * Fire-and-forget the auto-updater. Never blocks SessionStart. Detached
 * subprocess writes its output to ~/.riven/digital-twin/auto-update.log.
 *
 * Skip when:
 *   - RIVEN_DISABLED=1 (already short-circuits main; this branch is defense-in-depth)
 *   - RIVEN_AUTO_UPDATE_DISABLED=1 (specific opt-out, e.g. test environments)
 *   - the updater binary doesn't exist on this machine (pre-bootstrap)
 */
function fireUpdater(): void {
  try {
    if (readEnvWithLegacy(process.env, 'RIVEN_DISABLED', 'TEAMAGENT_DISABLED') === '1') return;
    if (process.env.RIVEN_AUTO_UPDATE_DISABLED === '1') return;
    const stageDir = path.dirname(process.argv[1] ?? __filename);
    const updaterPath = path.join(stageDir, 'bin-auto-updater.cjs');
    if (!existsSync(updaterPath)) return;
    const logPath = path.join(stageDir, 'auto-update.log');
    let logFd: number;
    try {
      logFd = openSync(logPath, 'a');
    } catch {
      return;
    }
    const child = spawn(process.execPath, ['--no-warnings', updaterPath], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
    });
    child.on('error', () => {});
    child.unref();
  } catch {
    // never propagate
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
}

/** Count `.jsonl` transcripts mtime'd within the last 5 min — proxy for active CC instances. */
function countActiveCcInstances(home: string): number {
  const projectsDir = join(home, '.claude', 'projects');
  if (!existsSync(projectsDir)) return 0;
  let count = 0;
  const cutoff = Date.now() - 5 * 60 * 1000;
  try {
    for (const sub of readdirSync(projectsDir, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue;
      try {
        const subPath = join(projectsDir, sub.name);
        for (const f of readdirSync(subPath)) {
          if (!f.endsWith('.jsonl')) continue;
          try {
            const st = statSync(join(subPath, f));
            if (st.mtimeMs > cutoff) {
              count += 1;
              break; // dedupe to one per project
            }
          } catch {
            /* stat error */
          }
        }
      } catch {
        /* readdir error */
      }
    }
  } catch {
    /* outer readdir error */
  }
  return count;
}

/** Sum sizes of top-level transcript files (no deep recursion) — bounded fast. */
function computeClaudeDirSizeMb(home: string): number {
  let bytes = 0;
  const projectsDir = join(home, '.claude', 'projects');
  if (!existsSync(projectsDir)) return 0;
  try {
    for (const sub of readdirSync(projectsDir, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue;
      try {
        const subPath = join(projectsDir, sub.name);
        for (const f of readdirSync(subPath, { withFileTypes: true })) {
          if (!f.isFile()) continue;
          try {
            bytes += statSync(join(subPath, f.name)).size;
          } catch {
            /* stat error */
          }
        }
      } catch {
        /* readdir error */
      }
    }
  } catch {
    /* outer readdir error */
  }
  return Math.round(bytes / (1024 * 1024));
}

export async function main(
  stdinReader: () => Promise<string> = readStdin,
): Promise<void> {
  if (readEnvWithLegacy(process.env, 'RIVEN_DISABLED', 'TEAMAGENT_DISABLED') === '1') return;
  // Kick off the auto-updater FIRST: it's detached and unref'd, so this is a
  // ~1ms cost on the critical path. Even if stdin or emit later fails, the
  // updater is already running independently.
  fireUpdater();
  let raw: string;
  try {
    raw = (await stdinReader()).trim();
  } catch {
    return;
  }
  if (!raw) return;
  let parsed: {
    session_id?: unknown;
    cwd?: unknown;
    transcript_path?: unknown;
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  const cwd = typeof parsed.cwd === 'string' ? parsed.cwd : process.cwd();
  const sessionId = parsed.session_id;
  const transcriptPath = parsed.transcript_path;

  // Host metrics — cheap, sampled once per session_start.
  const extras: Record<string, unknown> = { ...sampleHostMetrics() };
  try {
    const home = homedir();
    const active = countActiveCcInstances(home);
    if (active > 0) extras.concurrent_cc_count = active;
    const sz = computeClaudeDirSizeMb(home);
    if (sz > 0) extras.claude_dir_size_mb = sz;
  } catch {
    /* metrics best-effort */
  }

  try {
    emitCcStatus({
      event: 'session_start',
      ...(typeof sessionId === 'string' ? { sessionId } : {}),
      cwd,
      ...(typeof transcriptPath === 'string' && transcriptPath.length > 0
        ? { transcriptPath }
        : {}),
      ...(Object.keys(extras).length > 0 ? { extras } : {}),
    });
  } catch {
    /* never propagate */
  }
}

// 自调用判断：纯 process.argv 检查（ESM 源文件里没有 require/module）。
if (path.basename(process.argv[1] ?? '').startsWith('bin-session-start')) {
  main().catch(() => {
    /* never block session close */
  });
}
