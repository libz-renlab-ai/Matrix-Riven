#!/usr/bin/env node
/**
 * SessionEnd hook 薄壳：CC session 关闭时发一个 cc-status 事件（bucket 1/2 A5）。
 * 计算 session_duration_ms = now - transcript 第一行 timestamp。
 * 透传 stop_reason 如果 CC 给了的话。
 */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { readEnvWithLegacy } from '@matrix-riven/shared';
import { emitCcStatus, sampleHostMetrics } from './realtime-emit.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
}

function readFirstTimestamp(transcriptPath: string): number | null {
  // Cap the head sample at 16 KiB — the first timestamped line typically lands
  // in the first few hundred bytes; we don't need to load multi-MB transcripts
  // on every SessionEnd.
  const HEAD_BYTES = 16 * 1024;
  try {
    const content = readFileSync(transcriptPath, 'utf-8').slice(0, HEAD_BYTES);
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed[0] !== '{') continue;
      try {
        const obj = JSON.parse(trimmed) as { timestamp?: unknown };
        if (typeof obj.timestamp === 'string') {
          const ms = Date.parse(obj.timestamp);
          if (Number.isFinite(ms)) return ms;
        }
      } catch {
        /* not JSON, keep scanning */
      }
    }
  } catch {
    /* fs error, treat as no transcript */
  }
  return null;
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
  let parsed: { session_id?: unknown; cwd?: unknown; transcript_path?: unknown; stop_reason?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  const cwd = typeof parsed.cwd === 'string' ? parsed.cwd : process.cwd();
  const sessionId = typeof parsed.session_id === 'string' ? parsed.session_id : undefined;
  const transcriptPath = typeof parsed.transcript_path === 'string' ? parsed.transcript_path : null;
  const stopReason = typeof parsed.stop_reason === 'string' ? parsed.stop_reason : undefined;

  const extras: Record<string, unknown> = { ...sampleHostMetrics() };
  if (stopReason) extras.stop_reason = stopReason;
  if (transcriptPath) {
    const firstTs = readFirstTimestamp(transcriptPath);
    if (firstTs !== null) {
      extras.session_duration_ms = Math.max(0, Date.now() - firstTs);
    }
  }

  try {
    emitCcStatus({
      event: 'session_end',
      ...(sessionId ? { sessionId } : {}),
      cwd,
      ...(Object.keys(extras).length > 0 ? { extras } : {}),
    });
  } catch {
    /* never propagate */
  }
}

if (path.basename(process.argv[1] ?? '').startsWith('bin-session-end')) {
  main().catch(() => {
    /* never block session close */
  });
}
