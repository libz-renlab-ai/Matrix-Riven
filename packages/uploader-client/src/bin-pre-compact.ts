#!/usr/bin/env node
/**
 * PreCompact hook 薄壳：CC 准备压缩对话上下文之前发一个 cc-status 事件
 * （bucket 1/2 A4）。用于"哪些 session 撑爆 context、什么时机压缩"的诊断。
 * 不阻塞压缩本身。
 */
import path from 'node:path';
import { readEnvWithLegacy } from '@matrix-riven/shared';
import { emitCcStatus, sampleHostMetrics } from './realtime-emit.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
}

export async function main(stdinReader: () => Promise<string> = readStdin): Promise<void> {
  if (readEnvWithLegacy(process.env, 'RIVEN_DISABLED', 'TEAMAGENT_DISABLED') === '1') return;
  let raw: string;
  try {
    raw = (await stdinReader()).trim();
  } catch {
    return;
  }
  if (!raw) return;
  let parsed: { session_id?: unknown; cwd?: unknown; trigger?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  const cwd = typeof parsed.cwd === 'string' ? parsed.cwd : process.cwd();
  const sessionId = typeof parsed.session_id === 'string' ? parsed.session_id : undefined;
  const trigger =
    parsed.trigger === 'manual'
      ? ('manual' as const)
      : parsed.trigger === 'auto'
        ? ('auto' as const)
        : undefined;

  const extras: Record<string, unknown> = { ...sampleHostMetrics() };
  if (trigger) extras.compact_trigger = trigger;

  try {
    emitCcStatus({
      event: 'pre_compact',
      ...(sessionId ? { sessionId } : {}),
      cwd,
      ...(Object.keys(extras).length > 0 ? { extras } : {}),
    });
  } catch {
    /* never propagate */
  }
}

if (path.basename(process.argv[1] ?? '').startsWith('bin-pre-compact')) {
  main().catch(() => {
    /* never block compaction */
  });
}
