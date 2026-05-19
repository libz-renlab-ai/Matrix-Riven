import { describe, it, expect } from 'vitest';
import { redactForLLM } from '../redact.js';

describe('redactForLLM', () => {
  it('replaces an email with <email>', () => {
    expect(redactForLLM('contact alice@x.com please')).toBe(
      'contact <email> please',
    );
  });

  it('replaces an absolute Windows user path with <path>', () => {
    expect(redactForLLM('open C:\\Users\\alice\\projects\\foo\\bar')).toBe(
      'open <path>',
    );
  });

  it('replaces an absolute POSIX user path with <path>', () => {
    expect(redactForLLM('see /Users/m1/secrets')).toBe('see <path>');
  });

  it('replaces a shell-style token assignment with <secret>', () => {
    const out = redactForLLM(
      'export GITHUB_TOKEN=ghp_abc123def456ghi789jkl012mno345pqr678',
    );
    expect(out).toContain('<secret>');
    expect(out).not.toContain('ghp_abc123def456ghi789jkl012mno345pqr678');
  });

  it('replaces every finding in a multi-PII string', () => {
    const input =
      'mail alice@x.com from /Users/m1/notes ip 10.0.0.5 tok GITHUB_TOKEN=ghp_abc123def456ghi789jkl012mno345pqr678';
    const out = redactForLLM(input);
    expect(out).not.toContain('alice@x.com');
    expect(out).not.toContain('/Users/m1/notes');
    expect(out).not.toContain('10.0.0.5');
    expect(out).not.toContain('ghp_abc123def456ghi789jkl012mno345pqr678');
    expect(out).toContain('<email>');
    expect(out).toContain('<path>');
    expect(out).toContain('<ip>');
    expect(out).toContain('<secret>');
  });

  it('passes plain code/text through unchanged', () => {
    const input =
      'function add(a, b) { return a + b; } // simple helper, no PII here';
    expect(redactForLLM(input)).toBe(input);
  });

  it('is idempotent', () => {
    const inputs = [
      'contact alice@x.com please',
      'see /Users/m1/secrets and C:\\Users\\bob\\desktop',
      'export GITHUB_TOKEN=ghp_abc123def456ghi789jkl012mno345pqr678',
      'mail alice@x.com tok GITHUB_TOKEN=ghp_abc123def456ghi789jkl012mno345pqr678 ip 192.168.1.1',
      'no pii here, just words',
    ];
    for (const x of inputs) {
      const once = redactForLLM(x);
      expect(redactForLLM(once)).toBe(once);
    }
  });
});
