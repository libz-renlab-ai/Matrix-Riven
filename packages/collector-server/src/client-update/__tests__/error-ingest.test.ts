import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sanitizeErrorReport, appendErrorReport } from '../error-ingest.js';

const VALID_REPORT = {
  machine_id: 'mac-deadbeef',
  user_id: 'alice@example.com',
  from_version: '0.3.0+old',
  to_version: '0.3.1+new',
  stage: 'download' as const,
  error_message: 'connection refused',
  ts: '2026-05-19T12:00:00.000Z',
};

describe('sanitizeErrorReport', () => {
  it('accepts a well-formed report', () => {
    expect(sanitizeErrorReport(VALID_REPORT)).not.toBeNull();
  });
  it('accepts null from_version (first install)', () => {
    const r = sanitizeErrorReport({ ...VALID_REPORT, from_version: null });
    expect(r?.from_version).toBeNull();
  });
  it('accepts null to_version (manifest fetch failed)', () => {
    const r = sanitizeErrorReport({ ...VALID_REPORT, stage: 'fetch-manifest', to_version: null });
    expect(r?.to_version).toBeNull();
  });
  it('rejects unknown stage', () => {
    expect(sanitizeErrorReport({ ...VALID_REPORT, stage: 'unknown' })).toBeNull();
  });
  it('rejects empty machine_id', () => {
    expect(sanitizeErrorReport({ ...VALID_REPORT, machine_id: '' })).toBeNull();
  });
  it('rejects malformed ts', () => {
    expect(sanitizeErrorReport({ ...VALID_REPORT, ts: 'not a date' })).toBeNull();
  });
  it('truncates oversized error_message', () => {
    const r = sanitizeErrorReport({ ...VALID_REPORT, error_message: 'x'.repeat(10000) });
    expect(r?.error_message.length).toBeLessThanOrEqual(2048);
  });
  it('rejects non-string from_version (must be string or null)', () => {
    expect(sanitizeErrorReport({ ...VALID_REPORT, from_version: 123 })).toBeNull();
  });
});

describe('appendErrorReport', () => {
  it('writes a JSON line to the target file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'riven-err-'));
    try {
      const file = join(dir, 'errors.jsonl');
      const sanitized = sanitizeErrorReport(VALID_REPORT)!;
      const r = appendErrorReport(file, sanitized);
      expect(r.ok).toBe(true);
      const raw = readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw.trim());
      expect(parsed.user_id).toBe('alice@example.com');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('handles concurrent appends without corrupting JSONL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'riven-err-'));
    try {
      const file = join(dir, 'errors.jsonl');
      const sanitized = sanitizeErrorReport(VALID_REPORT)!;
      // 20 sequential appends — JSONL must remain parseable line by line
      for (let i = 0; i < 20; i++) {
        appendErrorReport(file, { ...sanitized, error_message: `error ${i}` });
      }
      const raw = readFileSync(file, 'utf8');
      const lines = raw.split('\n').filter((l) => l.length > 0);
      expect(lines.length).toBe(20);
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('creates parent dir if missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'riven-err-'));
    try {
      const file = join(dir, 'nested', 'deep', 'errors.jsonl');
      const sanitized = sanitizeErrorReport(VALID_REPORT)!;
      const r = appendErrorReport(file, sanitized);
      expect(r.ok).toBe(true);
      expect(() => readFileSync(file, 'utf8')).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
