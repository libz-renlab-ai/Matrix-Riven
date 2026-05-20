/**
 * Tests for the worker input collector (`llm/inputs.ts`).
 *
 * Three layers:
 *   1. Empty collector dir → null (worker short-circuits with `no_inputs`).
 *   2. Single-session fixture on a tmp dir → returns non-null, sessions
 *      array populated, function doesn't throw.
 *   3. (Skip-if) Real frozen snapshot at the same path the aggregator's
 *      real-snapshot test uses → returns non-null with all arrays present.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { gzipSync } from 'node:zlib';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectWorkerInputs } from '../inputs.js';
import { __resetParsedCacheForTests } from '../../transcript-loader.js';

const REAL_DIR = 'D:/0jingtong/Matrix-Riven/data/teamagent-logs-20260514-190026';
const SNAPSHOT_AVAILABLE = existsSync(REAL_DIR);

/**
 * "Now" used by both the collector and the fixture. Fixed to a value AFTER
 * the fixture's captured_at so the 7-day window includes it.
 */
const NOW = new Date('2026-05-17T12:00:00Z');

function makeEmptyDir(): string {
  return mkdtempSync(join(tmpdir(), 'llm-inputs-empty-'));
}

/**
 * Write one minimal cc-session envelope into a fresh tmp dir, then return the
 * collectorDir root. Layout mirrors what the real mock-server writes:
 *   <root>/<user>/<date>/<sessionId>.jsonl
 */
function makeOneSessionDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'llm-inputs-one-'));
  const user = 'alice@example.com';
  const date = '2026-05-16';
  const leaf = join(root, user, date);
  mkdirSync(leaf, { recursive: true });

  const jsonl = [
    JSON.stringify({
      type: 'user',
      timestamp: '2026-05-16T10:00:00.000Z',
      message: { role: 'user', content: 'help me fix the build' },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-05-16T10:00:30.000Z',
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        content: [
          { type: 'text', text: 'sure' },
          { type: 'tool_use', id: 'tu1', name: 'Edit', input: { file_path: 'src/index.ts' } },
        ],
        usage: { input_tokens: 100, output_tokens: 30 },
      },
    }),
  ].join('\n');

  const envelope = {
    schema_version: 1,
    envelope: {
      id: 'eid-1',
      user_id: user,
      machine_id: 'host-abc',
      session_id: 'sess-1',
      cwd: '/home/alice/widget/src',
      project_name: 'widget',
      transcript_path: '/home/alice/.claude/projects/.../sess-1.jsonl',
      payload_size: jsonl.length,
      captured_at: '2026-05-16T10:00:00.000Z',
      source: 'stop-hook',
      host: { os: 'linux', arch: 'x64', hostname: 'host' },
      riven_version: '0.1.0',
      consented_at: null,
    },
    transcript: {
      compression: 'gzip+base64',
      content: gzipSync(Buffer.from(jsonl, 'utf8')).toString('base64'),
    },
    l1_redaction_count: 0,
  };
  writeFileSync(join(leaf, 'sess-1.jsonl'), JSON.stringify(envelope), 'utf8');
  return root;
}

describe('collectWorkerInputs', () => {
  beforeEach(() => {
    __resetParsedCacheForTests();
  });

  it('returns null for an empty collector dir', async () => {
    const dir = makeEmptyDir();
    try {
      const result = await collectWorkerInputs({
        collectorDir: dir,
        now: () => NOW,
      });
      expect(result).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('handles a single-session fixture without throwing', async () => {
    const dir = makeOneSessionDir();
    try {
      const result = await collectWorkerInputs({
        collectorDir: dir,
        now: () => NOW,
      });
      expect(result).not.toBeNull();
      if (!result) return;
      // T1 input must always be present when we have a session
      expect(result.sessions.length).toBeGreaterThanOrEqual(1);
      // Members may be 0 if the aggregator's per-team thresholds drop the
      // single member, but the arrays must always exist.
      expect(Array.isArray(result.members)).toBe(true);
      expect(Array.isArray(result.projects)).toBe(true);
      expect(Array.isArray(result.attention)).toBe(true);
      // T5 brief input is always present (shape-wise)
      expect(typeof result.brief.date).toBe('string');
      expect(Array.isArray(result.brief.topHighlights)).toBe(true);
      expect(Array.isArray(result.brief.attentionRewrites)).toBe(true);
      expect(Array.isArray(result.brief.topProjects)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!SNAPSHOT_AVAILABLE)('handles the real frozen snapshot', async () => {
    const result = await collectWorkerInputs({
      collectorDir: REAL_DIR,
      now: () => NOW,
    });
    expect(result).not.toBeNull();
    if (!result) return;
    expect(Array.isArray(result.sessions)).toBe(true);
    expect(Array.isArray(result.members)).toBe(true);
    expect(Array.isArray(result.projects)).toBe(true);
    expect(Array.isArray(result.attention)).toBe(true);
    expect(typeof result.brief.date).toBe('string');
    // At least some T1 inputs should land for a real snapshot
    expect(result.sessions.length).toBeGreaterThan(0);
  });

  it('uses todayKey override for the T5 brief date when provided', async () => {
    const dir = makeOneSessionDir();
    try {
      const result = await collectWorkerInputs({
        collectorDir: dir,
        now: () => NOW,
        todayKey: () => '2026-12-31',
      });
      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.brief.date).toBe('2026-12-31');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
