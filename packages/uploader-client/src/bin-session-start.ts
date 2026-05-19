#!/usr/bin/env node
/**
 * SessionStart hook 薄壳：读 stdin → 调 emitCcStatus(session_start) → 退出。
 * 不引入 packages/cli 的 runHook 框架。绝不抛错、绝不阻塞会话。
 */
import path from 'node:path';
import { readEnvWithLegacy } from '@matrix-riven/shared';
import { emitCcStatus } from './realtime-emit.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
}

export async function main(
  stdinReader: () => Promise<string> = readStdin,
): Promise<void> {
  if (readEnvWithLegacy(process.env, 'RIVEN_DISABLED', 'TEAMAGENT_DISABLED') === '1') return;
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
  try {
    emitCcStatus({
      event: 'session_start',
      ...(typeof sessionId === 'string' ? { sessionId } : {}),
      cwd,
      ...(typeof transcriptPath === 'string' && transcriptPath.length > 0
        ? { transcriptPath }
        : {}),
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
