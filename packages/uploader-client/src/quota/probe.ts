/**
 * Issue #283 — Anthropic Max-tier quota probe.
 *
 * Posts a 1-token message to `POST /v1/messages` and parses the
 * `anthropic-ratelimit-unified-*` response headers into a
 * `CcSessionQuotaBlock`. Used by the hourly scheduler to attach a fresh
 * quota snapshot to the next envelope.
 *
 * Pure: takes an injectable `fetch`. No filesystem, no globals.
 *
 * Cost discipline: the probe is sized to be the cheapest valid request
 * the API accepts (haiku, 1 token, "hi"). The hourly cadence means each
 * machine generates ≤24 probes/day; on a Claude Max 20x tier each probe
 * counts as one message toward the 5h window. The trade-off is documented
 * in the grill comment on issue #283.
 */

import type { CcSessionQuotaBlock } from '@matrix-riven/shared';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const PROBE_MODEL = 'claude-haiku-4-5';
const ANTHROPIC_VERSION = '2023-06-01';
const OAUTH_BETA = 'oauth-2025-04-20';

export interface ProbeQuotaInput {
  /** OAuth access token from `~/.claude/.credentials.json`. */
  accessToken: string;
  /** Pre-formatted tier string (e.g. "max/default_claude_max_20x"). */
  subscriptionTier: string;
  /** Injectable wall clock for `probed_at`. */
  now?: () => Date;
}

export interface ProbeQuotaDeps {
  /** Injectable fetch. Defaults to global fetch. */
  fetch?: typeof fetch;
}

export type ProbeQuotaResult =
  | { kind: 'ok'; quota: CcSessionQuotaBlock }
  | { kind: 'auth-failed'; status: number }
  | { kind: 'rate-limited'; status: number; quota?: CcSessionQuotaBlock }
  | { kind: 'parse-error'; detail: string }
  | { kind: 'network-error'; detail: string };

/**
 * Parse the four unified rate-limit headers off a Response into a quota
 * block. Returns null if any header is missing or unparseable; caller
 * decides whether to surface that as `parse-error` (for a 200) or
 * `rate-limited` (for a 429 — body indicates blocked but headers may
 * still carry the latest utilization).
 */
export function parseQuotaHeaders(
  headers: Headers,
  input: { subscriptionTier: string; probedAt: string; stale: boolean },
): CcSessionQuotaBlock | null {
  const fiveHourUtil = parseFloatHeader(headers.get('anthropic-ratelimit-unified-5h-utilization'));
  const sevenDayUtil = parseFloatHeader(headers.get('anthropic-ratelimit-unified-7d-utilization'));
  const fiveHourReset = parseIntHeader(headers.get('anthropic-ratelimit-unified-5h-reset'));
  const sevenDayReset = parseIntHeader(headers.get('anthropic-ratelimit-unified-7d-reset'));
  if (
    fiveHourUtil === null ||
    sevenDayUtil === null ||
    fiveHourReset === null ||
    sevenDayReset === null
  ) {
    return null;
  }
  return {
    subscription_tier: input.subscriptionTier,
    five_hour_utilization: fiveHourUtil,
    seven_day_utilization: sevenDayUtil,
    five_hour_reset_at: fiveHourReset,
    seven_day_reset_at: sevenDayReset,
    probed_at: input.probedAt,
    stale: input.stale,
  };
}

function parseFloatHeader(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

function parseIntHeader(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * Issue an actual probe. Never throws — all errors surface as a tagged
 * `ProbeQuotaResult`. Caller decides cache fallback policy.
 */
export async function probeQuota(
  input: ProbeQuotaInput,
  deps: ProbeQuotaDeps = {},
): Promise<ProbeQuotaResult> {
  const f = deps.fetch ?? fetch;
  const now = input.now ?? (() => new Date());
  const probedAt = now().toISOString();
  let res: Response;
  try {
    res = await f(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-beta': OAUTH_BETA,
        Authorization: `Bearer ${input.accessToken}`,
      },
      body: JSON.stringify({
        model: PROBE_MODEL,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
  } catch (err) {
    return {
      kind: 'network-error',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  if (res.status === 401 || res.status === 403) {
    return { kind: 'auth-failed', status: res.status };
  }
  if (res.status === 429) {
    // Per Anthropic, the rate-limit headers may still be present on 429.
    // We surface whatever utilization we can parse alongside the status
    // so callers can pick: emit it as a stale snapshot, or fall back to
    // the persisted cache.
    const partial = parseQuotaHeaders(res.headers, {
      subscriptionTier: input.subscriptionTier,
      probedAt,
      stale: true,
    });
    return partial
      ? { kind: 'rate-limited', status: res.status, quota: partial }
      : { kind: 'rate-limited', status: res.status };
  }
  if (res.status < 200 || res.status >= 300) {
    return {
      kind: 'parse-error',
      detail: `unexpected status ${res.status}`,
    };
  }
  const quota = parseQuotaHeaders(res.headers, {
    subscriptionTier: input.subscriptionTier,
    probedAt,
    stale: false,
  });
  if (!quota) {
    return {
      kind: 'parse-error',
      detail: 'missing or unparseable anthropic-ratelimit-unified-* headers',
    };
  }
  return { kind: 'ok', quota };
}
