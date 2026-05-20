#!/usr/bin/env node
/**
 * PreToolUse hook 薄壳：在每个工具调用之前，把 tool_name / tool_input digest /
 * sandbox flag 报到 cc-status 端点（bucket 1/2 A1 + A16/F2）。
 *
 * 不发 tool_input 原文 —— 它可能含路径 / 代码 / prompt / 密钥。只发 sha256 digest。
 * user_decision 暂不在 hook 里采集；CC 的 PreToolUse 在 user 决定之前就已经 fire，
 * 后续 dashboard 通过 transcript 是否真出现 tool_use 来推断 allow vs deny。
 *
 * 绝不抛错、绝不阻塞工具执行（hook exit 0 = let it proceed）。
 */
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readEnvWithLegacy } from '@matrix-riven/shared';
import { emitCcStatus } from './realtime-emit.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
}

function digestToolInput(input: unknown): string {
  try {
    return createHash('sha256').update(JSON.stringify(input ?? {})).digest('hex');
  } catch {
    return '';
  }
}

function detectSandboxDisabled(toolInput: unknown): boolean {
  if (typeof toolInput !== 'object' || toolInput === null) return false;
  const o = toolInput as Record<string, unknown>;
  // CC's Bash tool exposes dangerouslyDisableSandbox; some configurations also
  // pass an explicit sandbox=false. Both are red flags worth recording.
  return o.dangerouslyDisableSandbox === true || o.sandbox === false;
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
  let parsed: { session_id?: unknown; cwd?: unknown; tool_name?: unknown; tool_input?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  const cwd = typeof parsed.cwd === 'string' ? parsed.cwd : process.cwd();
  const sessionId = typeof parsed.session_id === 'string' ? parsed.session_id : undefined;
  const toolName = typeof parsed.tool_name === 'string' ? parsed.tool_name : undefined;
  if (!toolName) return;
  const digest = digestToolInput(parsed.tool_input);
  const sandboxDisabled = detectSandboxDisabled(parsed.tool_input);

  try {
    emitCcStatus({
      event: 'pre_tool_use',
      ...(sessionId ? { sessionId } : {}),
      cwd,
      extras: {
        tool_name: toolName,
        tool_input_digest: digest,
        sandbox_disabled: sandboxDisabled,
      },
    });
  } catch {
    /* never propagate */
  }
}

if (path.basename(process.argv[1] ?? '').startsWith('bin-pre-tool-use')) {
  main().catch(() => {
    /* never block tool execution */
  });
}
