import { describe, it, expect } from 'vitest';
import { parseQuotaHeaders, probeQuota } from '../probe.js';

const TIER = 'max/default_claude_max_20x';
const FIXED_NOW = () => new Date('2026-05-11T03:00:00.000Z');

function headers(entries: Record<string, string>): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(entries)) h.set(k, v);
  return h;
}

function mockFetch(
  status: number,
  headerEntries: Record<string, string>,
  body: unknown = { ok: true },
): typeof fetch {
  return (async () => {
    return new Response(JSON.stringify(body), {
      status,
      headers: headers(headerEntries),
    });
  }) as unknown as typeof fetch;
}

describe('parseQuotaHeaders', () => {
  it('parses a full set of 5h + 7d headers', () => {
    const q = parseQuotaHeaders(
      headers({
        'anthropic-ratelimit-unified-5h-utilization': '0.35',
        'anthropic-ratelimit-unified-7d-utilization': '0.42',
        'anthropic-ratelimit-unified-5h-reset': '1778481000',
        'anthropic-ratelimit-unified-7d-reset': '1778626800',
      }),
      { subscriptionTier: TIER, probedAt: '2026-05-11T03:00:00.000Z', stale: false },
    );
    expect(q).toEqual({
      subscription_tier: TIER,
      five_hour_utilization: 0.35,
      seven_day_utilization: 0.42,
      five_hour_reset_at: 1778481000,
      seven_day_reset_at: 1778626800,
      probed_at: '2026-05-11T03:00:00.000Z',
      stale: false,
    });
  });

  it('returns null when any header is missing', () => {
    expect(
      parseQuotaHeaders(
        headers({
          'anthropic-ratelimit-unified-5h-utilization': '0.35',
          // missing 7d-utilization
          'anthropic-ratelimit-unified-5h-reset': '1',
          'anthropic-ratelimit-unified-7d-reset': '1',
        }),
        { subscriptionTier: TIER, probedAt: 'x', stale: false },
      ),
    ).toBeNull();
  });

  it('returns null when a utilization value is non-numeric', () => {
    expect(
      parseQuotaHeaders(
        headers({
          'anthropic-ratelimit-unified-5h-utilization': 'not-a-number',
          'anthropic-ratelimit-unified-7d-utilization': '0.5',
          'anthropic-ratelimit-unified-5h-reset': '1',
          'anthropic-ratelimit-unified-7d-reset': '1',
        }),
        { subscriptionTier: TIER, probedAt: 'x', stale: false },
      ),
    ).toBeNull();
  });

  it('propagates stale flag onto output', () => {
    const q = parseQuotaHeaders(
      headers({
        'anthropic-ratelimit-unified-5h-utilization': '0.9',
        'anthropic-ratelimit-unified-7d-utilization': '0.9',
        'anthropic-ratelimit-unified-5h-reset': '1',
        'anthropic-ratelimit-unified-7d-reset': '1',
      }),
      { subscriptionTier: TIER, probedAt: 'x', stale: true },
    );
    expect(q?.stale).toBe(true);
  });
});

describe('probeQuota', () => {
  const baseInput = {
    accessToken: 'sk-ant-fake',
    subscriptionTier: TIER,
    now: FIXED_NOW,
  };

  it('returns ok+quota on 200 with full headers', async () => {
    const fetchFn = mockFetch(200, {
      'anthropic-ratelimit-unified-5h-utilization': '0.35',
      'anthropic-ratelimit-unified-7d-utilization': '0.42',
      'anthropic-ratelimit-unified-5h-reset': '1778481000',
      'anthropic-ratelimit-unified-7d-reset': '1778626800',
    });
    const result = await probeQuota(baseInput, { fetch: fetchFn });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.quota.five_hour_utilization).toBe(0.35);
      expect(result.quota.probed_at).toBe('2026-05-11T03:00:00.000Z');
      expect(result.quota.stale).toBe(false);
    }
  });

  it('returns parse-error on 200 with missing headers', async () => {
    const fetchFn = mockFetch(200, {
      // none of the unified headers
    });
    const result = await probeQuota(baseInput, { fetch: fetchFn });
    expect(result.kind).toBe('parse-error');
  });

  it('returns auth-failed on 401', async () => {
    const fetchFn = mockFetch(401, {});
    const result = await probeQuota(baseInput, { fetch: fetchFn });
    expect(result.kind).toBe('auth-failed');
    if (result.kind === 'auth-failed') expect(result.status).toBe(401);
  });

  it('returns auth-failed on 403', async () => {
    const fetchFn = mockFetch(403, {});
    const result = await probeQuota(baseInput, { fetch: fetchFn });
    expect(result.kind).toBe('auth-failed');
  });

  it('returns rate-limited on 429 (with partial quota when headers present)', async () => {
    const fetchFn = mockFetch(429, {
      'anthropic-ratelimit-unified-5h-utilization': '1.0',
      'anthropic-ratelimit-unified-7d-utilization': '0.8',
      'anthropic-ratelimit-unified-5h-reset': '1778481000',
      'anthropic-ratelimit-unified-7d-reset': '1778626800',
    });
    const result = await probeQuota(baseInput, { fetch: fetchFn });
    expect(result.kind).toBe('rate-limited');
    if (result.kind === 'rate-limited') {
      expect(result.quota?.five_hour_utilization).toBe(1.0);
      expect(result.quota?.stale).toBe(true);
    }
  });

  it('returns rate-limited without quota when 429 has no headers', async () => {
    const fetchFn = mockFetch(429, {});
    const result = await probeQuota(baseInput, { fetch: fetchFn });
    expect(result.kind).toBe('rate-limited');
    if (result.kind === 'rate-limited') expect(result.quota).toBeUndefined();
  });

  it('returns network-error when fetch throws', async () => {
    const fetchFn = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const result = await probeQuota(baseInput, { fetch: fetchFn });
    expect(result.kind).toBe('network-error');
    if (result.kind === 'network-error') expect(result.detail).toContain('ECONNREFUSED');
  });

  it('returns parse-error on unexpected 5xx', async () => {
    const fetchFn = mockFetch(500, {});
    const result = await probeQuota(baseInput, { fetch: fetchFn });
    expect(result.kind).toBe('parse-error');
  });

  it('passes the OAuth bearer + anthropic-beta headers on the request', async () => {
    const seen: {
      headers?: Record<string, string>;
      body?: string;
      method?: string;
      url?: string;
    } = {};
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      seen.url = String(url);
      seen.method = init?.method;
      seen.headers = init?.headers as Record<string, string>;
      seen.body = typeof init?.body === 'string' ? init.body : '';
      return new Response('{}', {
        status: 200,
        headers: headers({
          'anthropic-ratelimit-unified-5h-utilization': '0.1',
          'anthropic-ratelimit-unified-7d-utilization': '0.1',
          'anthropic-ratelimit-unified-5h-reset': '1',
          'anthropic-ratelimit-unified-7d-reset': '1',
        }),
      });
    }) as unknown as typeof fetch;
    await probeQuota(baseInput, { fetch: fetchFn });
    expect(seen.url).toBe('https://api.anthropic.com/v1/messages');
    expect(seen.method).toBe('POST');
    const hdrs = seen.headers ?? {};
    expect(hdrs.Authorization).toBe('Bearer sk-ant-fake');
    expect(hdrs['anthropic-version']).toBe('2023-06-01');
    expect(hdrs['anthropic-beta']).toBe('oauth-2025-04-20');
    const body = JSON.parse(seen.body ?? '{}');
    expect(body.model).toBe('claude-haiku-4-5');
    expect(body.max_tokens).toBe(1);
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });
});
