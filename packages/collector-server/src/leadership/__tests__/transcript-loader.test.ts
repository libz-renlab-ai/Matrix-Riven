import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { parseEnvelopeBuffer } from '../transcript-loader.js';

function buildEnvelope(transcriptLines: string[]): Buffer {
  const jsonl = transcriptLines.join('\n');
  const gz = gzipSync(Buffer.from(jsonl, 'utf8')).toString('base64');
  const env = {
    schema_version: 1,
    envelope: {
      id: 'eid',
      user_id: 'liu@example.com',
      machine_id: 'host-abc',
      session_id: 'sid-1',
      cwd: '/home/u/proj/Matrix-Riven',
      project_name: 'Matrix-Riven',
      transcript_path: '/home/u/.claude/projects/.../sid-1.jsonl',
      payload_size: jsonl.length,
      captured_at: '2026-05-13T10:00:00.000Z',
      source: 'stop-hook',
      host: { os: 'linux', arch: 'x64', hostname: 'host' },
      riven_version: '0.1.0',
      consented_at: null,
    },
    transcript: { compression: 'gzip+base64', content: gz },
    l1_redaction_count: 2,
  };
  return Buffer.from(JSON.stringify(env), 'utf8');
}

describe('parseEnvelopeBuffer', () => {
  it('parses a minimal envelope with one user message', () => {
    const buf = buildEnvelope([
      JSON.stringify({
        type: 'user',
        timestamp: '2026-05-13T10:00:05.000Z',
        message: { role: 'user', content: 'hello' },
      }),
    ]);
    const parsed = parseEnvelopeBuffer(buf);
    expect(parsed).not.toBeNull();
    expect(parsed!.envelope.projectName).toBe('Matrix-Riven');
    expect(parsed!.envelope.userId).toBe('liu@example.com');
    expect(parsed!.l1RedactionCount).toBe(2);
    expect(parsed!.messages).toHaveLength(1);
    expect(parsed!.messages[0]!.role).toBe('user');
    expect(parsed!.messages[0]!.text).toBe('hello');
  });

  it('extracts tool use and tool result', () => {
    const buf = buildEnvelope([
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-05-13T10:00:10.000Z',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [
            { type: 'text', text: 'I will run bash' },
            { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } },
          ],
          usage: { input_tokens: 100, output_tokens: 20 },
        },
      }),
      JSON.stringify({
        type: 'user',
        timestamp: '2026-05-13T10:00:11.000Z',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tu1', is_error: false, content: 'a.txt\nb.txt' }],
        },
      }),
    ]);
    const parsed = parseEnvelopeBuffer(buf)!;
    expect(parsed.messages[0]!.toolUses).toEqual([{ name: 'Bash', input: { command: 'ls' } }]);
    expect(parsed.messages[1]!.toolResults).toEqual([{ toolUseId: 'tu1', isError: false, text: 'a.txt\nb.txt' }]);
    expect(parsed.model).toBe('claude-sonnet-4-6');
    expect(parsed.tokens.input).toBe(100);
    expect(parsed.tokens.output).toBe(20);
  });

  it('returns null on malformed JSON', () => {
    expect(parseEnvelopeBuffer(Buffer.from('not json'))).toBeNull();
  });

  it('returns null on missing transcript block', () => {
    const env = { schema_version: 1, envelope: { user_id: 'x' } };
    expect(parseEnvelopeBuffer(Buffer.from(JSON.stringify(env)))).toBeNull();
  });

  it('computes startTs/endTs/durationMs from message timestamps', () => {
    const buf = buildEnvelope([
      JSON.stringify({ type: 'user', timestamp: '2026-05-13T10:00:00.000Z', message: { role: 'user', content: 'a' } }),
      JSON.stringify({ type: 'user', timestamp: '2026-05-13T10:05:00.000Z', message: { role: 'user', content: 'b' } }),
    ]);
    const p = parseEnvelopeBuffer(buf)!;
    expect(p.startTs.toISOString()).toBe('2026-05-13T10:00:00.000Z');
    expect(p.endTs.toISOString()).toBe('2026-05-13T10:05:00.000Z');
    expect(p.durationMs).toBe(5 * 60 * 1000);
  });
});
