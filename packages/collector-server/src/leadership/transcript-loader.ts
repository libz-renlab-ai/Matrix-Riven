import { gunzipSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import type {
  ParsedSession,
  ParsedEnvelope,
  ParsedMessage,
  ParsedToolUse,
  ParsedToolResult,
} from './types.js';

/**
 * Parse one on-disk envelope JSON (the format collector-server writes).
 * Returns null when the envelope is unparseable; callers skip-and-continue
 * because one corrupt file must not stop the scan.
 */
export function parseEnvelopeBuffer(buf: Buffer): ParsedSession | null {
  let raw: unknown;
  try {
    raw = JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const envBlock = obj.envelope as Record<string, unknown> | undefined;
  const tBlock = obj.transcript as { compression?: string; content?: string } | undefined;
  if (!envBlock || !tBlock || typeof tBlock.content !== 'string') return null;

  let jsonl: string;
  try {
    jsonl = gunzipSync(Buffer.from(tBlock.content, 'base64')).toString('utf8');
  } catch {
    return null;
  }

  const envelope: ParsedEnvelope = {
    id: str(envBlock.id, 'unknown'),
    userId: str(envBlock.user_id, 'unknown'),
    machineId: str(envBlock.machine_id, 'unknown'),
    sessionId: str(envBlock.session_id, 'unknown'),
    cwd: str(envBlock.cwd, ''),
    projectName: str(envBlock.project_name, '') || cwdLastSegment(str(envBlock.cwd, '')),
    capturedAt: str(envBlock.captured_at, new Date(0).toISOString()),
    rivenVersion: str(envBlock.riven_version, 'unknown'),
    consentedAt: envBlock.consented_at == null ? null : String(envBlock.consented_at),
  };

  const messages: ParsedMessage[] = [];
  let firstTs: Date | undefined;
  let lastTs: Date | undefined;
  let firstModel: string | undefined;
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (!rec || typeof rec !== 'object') continue;
    const msg = parseMessageRecord(rec as Record<string, unknown>);
    if (!msg) continue;
    messages.push(msg);
    if (msg.ts) {
      if (!firstTs || msg.ts < firstTs) firstTs = msg.ts;
      if (!lastTs || msg.ts > lastTs) lastTs = msg.ts;
    }
    if (!firstModel && msg.model) firstModel = msg.model;
    if (msg.tokens) {
      tokens.input += msg.tokens.input ?? 0;
      tokens.output += msg.tokens.output ?? 0;
      tokens.cacheRead += msg.tokens.cacheRead ?? 0;
      tokens.cacheCreation += msg.tokens.cacheCreation ?? 0;
    }
  }

  const startTs = firstTs ?? new Date(envelope.capturedAt);
  const endTs = lastTs ?? startTs;

  return {
    envelope,
    l1RedactionCount: typeof obj.l1_redaction_count === 'number' ? obj.l1_redaction_count : 0,
    messages,
    durationMs: Math.max(0, endTs.getTime() - startTs.getTime()),
    startTs,
    endTs,
    model: firstModel,
    tokens,
  };
}

function parseMessageRecord(rec: Record<string, unknown>): ParsedMessage | null {
  const ts = typeof rec.timestamp === 'string' ? new Date(rec.timestamp) : undefined;
  const inner = (rec.message as Record<string, unknown> | undefined) ?? rec;
  const roleRaw = String(inner.role ?? rec.type ?? '');
  let role: 'user' | 'assistant' | 'tool';
  if (roleRaw === 'assistant') role = 'assistant';
  else if (roleRaw === 'tool') role = 'tool';
  else role = 'user';

  const content = inner.content;
  let text = '';
  const toolUses: ParsedToolUse[] = [];
  const toolResults: ParsedToolResult[] = [];

  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const p = part as Record<string, unknown>;
      switch (p.type) {
        case 'text':
          text += (text ? '\n' : '') + String(p.text ?? '');
          break;
        case 'tool_use':
          toolUses.push({
            name: String(p.name ?? 'unknown'),
            input: (p.input as Record<string, unknown>) ?? {},
          });
          break;
        case 'tool_result': {
          const c = p.content;
          let resultText = '';
          if (typeof c === 'string') resultText = c;
          else if (Array.isArray(c)) {
            for (const x of c) {
              if (x && typeof x === 'object' && (x as Record<string, unknown>).type === 'text') {
                resultText += String((x as Record<string, unknown>).text ?? '');
              }
            }
          }
          toolResults.push({
            toolUseId: typeof p.tool_use_id === 'string' ? p.tool_use_id : undefined,
            isError: p.is_error === true,
            text: resultText,
          });
          break;
        }
      }
    }
  }

  const usage = inner.usage as Record<string, unknown> | undefined;
  const tokens = usage
    ? {
        input: numOrUndef(usage.input_tokens),
        output: numOrUndef(usage.output_tokens),
        cacheRead: numOrUndef(usage.cache_read_input_tokens),
        cacheCreation: numOrUndef(usage.cache_creation_input_tokens),
      }
    : undefined;

  return {
    role,
    ts,
    text,
    toolUses,
    toolResults,
    tokens,
    model: typeof inner.model === 'string' ? inner.model : undefined,
  };
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}
function numOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function cwdLastSegment(cwd: string): string {
  const parts = cwd.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? 'unknown';
}

export interface ScanOptions {
  fromDate?: string;
  toDate?: string;
}

export function scanAllSessions(collectorDir: string, opts: ScanOptions = {}): ParsedSession[] {
  if (!existsSync(collectorDir)) return [];
  let users: string[];
  try {
    users = readdirSync(collectorDir);
  } catch {
    return [];
  }
  const out: ParsedSession[] = [];
  for (const userDir of users) {
    const userPath = path.join(collectorDir, userDir);
    let s: ReturnType<typeof statSync> | null;
    try {
      s = statSync(userPath);
    } catch {
      continue;
    }
    if (!s.isDirectory()) continue;

    let dateDirs: string[];
    try {
      dateDirs = readdirSync(userPath);
    } catch {
      continue;
    }
    for (const dateDir of dateDirs) {
      if (opts.fromDate && dateDir < opts.fromDate) continue;
      if (opts.toDate && dateDir > opts.toDate) continue;
      const datePath = path.join(userPath, dateDir);
      let files: string[];
      try {
        files = readdirSync(datePath);
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const filePath = path.join(datePath, f);
        let buf: Buffer;
        try {
          buf = readFileSync(filePath);
        } catch {
          continue;
        }
        const parsed = parseEnvelopeBuffer(buf);
        if (parsed) out.push(parsed);
      }
    }
  }
  return out;
}
