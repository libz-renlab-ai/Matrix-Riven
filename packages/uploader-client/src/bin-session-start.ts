#!/usr/bin/env node
/**
 * SessionStart hook 薄壳：读 stdin → fire-and-forget 拉起 auto-updater →
 * 调 emitCcStatus(session_start) → 退出。
 * 不引入 packages/cli 的 runHook 框架。绝不抛错、绝不阻塞会话。
 */
import path from 'node:path';
import { existsSync, openSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { readEnvWithLegacy } from '@matrix-riven/shared';
import { emitCcStatus } from './realtime-emit.js';

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
  let parsed: { session_id?: unknown; cwd?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  const cwd = typeof parsed.cwd === 'string' ? parsed.cwd : process.cwd();
  const sessionId = parsed.session_id;
  try {
    emitCcStatus({
      event: 'session_start',
      ...(typeof sessionId === 'string' ? { sessionId } : {}),
      cwd,
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
