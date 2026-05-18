#!/usr/bin/env node
/**
 * UserPromptSubmit hook 薄壳：读 stdin → 调 emitCcStatus(user_prompt_submit) → 退出。
 * 不引入 packages/cli 的 runHook 框架。绝不抛错、绝不阻塞会话。
 *
 * Bucket 1/2 additions (A9 + A15 + F3 + G1):
 *   - prompt_length / prompt_has_code_block — 都是元数据，不发原文（raw_prompt 受 G1 控制）
 *   - prompt_is_first_in_session — 通过 transcript 文件行数检测
 *   - slash_command — 提取 `/<name>` 前缀
 *   - prompt_injection_signals — 简单模式扫描
 *   - raw_prompt — bucket 1 决定默认开，由 realtime-emit 控制（RIVEN_REALTIME_RAW_PROMPT=0 退出）
 */
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { readEnvWithLegacy } from '@matrix-riven/shared';
import { emitCcStatus } from './realtime-emit.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
}

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+)?previous\s+(?:instructions|prompts|rules)/i,
  /disregard\s+(?:all\s+|the\s+)?(?:above|previous|prior)/i,
  /forget\s+(?:your|all\s+)?(?:instructions|rules|system\s+prompt)/i,
  /(?:your|new)\s+(?:new\s+)?instructions(?:\s+are)?\s*:/i,
  /\[SYSTEM\]|\<\|system\|\>|<\|im_start\|>system/i,
  /(?:^|\n)\s*(?:system|user|assistant)\s*:/i,
];

function countInjectionSignals(prompt: string): number {
  let n = 0;
  for (const re of INJECTION_PATTERNS) {
    if (re.test(prompt)) n += 1;
  }
  return n;
}

function extractSlashCommand(prompt: string): string | undefined {
  const m = /^\s*\/([\w-]+)/.exec(prompt);
  return m && m[1] ? m[1] : undefined;
}

function transcriptIsEmptyOrSinglePrompt(transcriptPath: string | null): boolean {
  if (!transcriptPath) return true;
  if (!existsSync(transcriptPath)) return true;
  try {
    // Cap read at 64 KiB head — enough to count user-message lines for "first?".
    const head = readFileSync(transcriptPath, 'utf-8').slice(0, 64 * 1024);
    let userCount = 0;
    for (const line of head.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed[0] !== '{') continue;
      try {
        const obj = JSON.parse(trimmed) as { type?: unknown; message?: { role?: unknown } };
        if (obj.type === 'user' || (obj.message && obj.message.role === 'user')) {
          userCount += 1;
          if (userCount > 1) return false;
        }
      } catch {
        /* skip non-JSON line */
      }
    }
    return userCount <= 1;
  } catch {
    return true;
  }
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
  let parsed: { session_id?: unknown; cwd?: unknown; prompt?: unknown; transcript_path?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  const cwd = typeof parsed.cwd === 'string' ? parsed.cwd : process.cwd();
  const sessionId = parsed.session_id;
  const promptText = typeof parsed.prompt === 'string' ? parsed.prompt : '';
  const transcriptPath = typeof parsed.transcript_path === 'string' ? parsed.transcript_path : null;

  const extras: Record<string, unknown> = {};
  if (promptText.length > 0) {
    extras.prompt_length = promptText.length;
    extras.prompt_has_code_block = /```/.test(promptText);
    const slash = extractSlashCommand(promptText);
    if (slash) extras.slash_command = slash;
    const injection = countInjectionSignals(promptText);
    if (injection > 0) extras.prompt_injection_signals = injection;
    extras.prompt_is_first_in_session = transcriptIsEmptyOrSinglePrompt(transcriptPath);
  }

  try {
    emitCcStatus({
      event: 'user_prompt_submit',
      ...(typeof sessionId === 'string' ? { sessionId } : {}),
      cwd,
      ...(promptText.length > 0 ? { rawPrompt: promptText } : {}),
      ...(Object.keys(extras).length > 0 ? { extras } : {}),
    });
  } catch {
    /* never propagate */
  }
}

// 自调用判断：纯 process.argv 检查（ESM 源文件里没有 require/module）。
if (path.basename(process.argv[1] ?? '').startsWith('bin-user-prompt-submit')) {
  main().catch(() => {
    /* never block session close */
  });
}
