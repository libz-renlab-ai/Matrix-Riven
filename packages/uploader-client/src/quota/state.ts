/**
 * Issue #283 — local state I/O for the quota subsystem.
 *
 * Three concerns, kept here because they're all thin filesystem wrappers
 * around the pure probe:
 *
 *   1. Read OAuth credentials from `~/.claude/.credentials.json`.
 *   2. Persist the most recent successful quota probe to
 *      `~/.teamagent/digital-twin/quota-cache.json`.
 *   3. Load the cache on probe failure.
 *
 * All functions take fs hooks via deps so tests stay hermetic.
 */

import {
  existsSync as defaultExistsSync,
  readFileSync as defaultReadFileSync,
  writeFileSync as defaultWriteFileSync,
  mkdirSync as defaultMkdirSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { CcSessionQuotaBlock } from '@matrix-riven/shared';

export interface FsReadDeps {
  existsSync?: (p: string) => boolean;
  readFileSync?: (p: string, encoding: 'utf8') => string;
}

export interface FsWriteDeps extends FsReadDeps {
  writeFileSync?: (p: string, data: string) => void;
  mkdirSync?: (p: string, opts: { recursive: true }) => void;
}

export interface OAuthCredentials {
  accessToken: string;
  /** Pre-formatted tier: e.g. "max/default_claude_max_20x". */
  tier: string;
  /** Unix milliseconds — when the access token expires. */
  expiresAt: number | null;
}

/**
 * Compute the path to `~/.claude/.credentials.json` for a given home.
 * Exposed so callers + tests share one resolver.
 */
export function claudeCredentialsPath(home: string): string {
  return join(home, '.claude', '.credentials.json');
}

/**
 * Read OAuth credentials from `<home>/.claude/.credentials.json`. Returns
 * null when the file is missing, malformed, or doesn't contain the
 * `claudeAiOauth` block (Claude Code rewrites credentials on auth flow
 * changes; we treat anything we don't understand as "no probe possible").
 */
export function loadOAuthCredentials(
  home: string,
  deps: FsReadDeps = {},
): OAuthCredentials | null {
  const ex = deps.existsSync ?? defaultExistsSync;
  const rd = deps.readFileSync ?? defaultReadFileSync;
  const file = claudeCredentialsPath(home);
  if (!ex(file)) return null;
  let raw: string;
  try {
    raw = rd(file, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const oauth = (parsed as Record<string, unknown>).claudeAiOauth;
  if (typeof oauth !== 'object' || oauth === null) return null;
  const o = oauth as Record<string, unknown>;
  const accessToken = typeof o.accessToken === 'string' ? o.accessToken : null;
  if (!accessToken) return null;
  const subscriptionType = typeof o.subscriptionType === 'string' ? o.subscriptionType : '';
  const rateLimitTier = typeof o.rateLimitTier === 'string' ? o.rateLimitTier : '';
  const tier = [subscriptionType, rateLimitTier].filter(Boolean).join('/') || 'unknown';
  const expiresAt =
    typeof o.expiresAt === 'number' && Number.isFinite(o.expiresAt) ? o.expiresAt : null;
  return { accessToken, tier, expiresAt };
}

/**
 * Read the persisted quota cache. Returns null when missing / malformed /
 * unshaped. Defensive against hand-edited cache files.
 */
export function loadQuotaCache(
  cachePath: string,
  deps: FsReadDeps = {},
): CcSessionQuotaBlock | null {
  const ex = deps.existsSync ?? defaultExistsSync;
  const rd = deps.readFileSync ?? defaultReadFileSync;
  if (!ex(cachePath)) return null;
  let raw: string;
  try {
    raw = rd(cachePath, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isCcSessionQuotaBlock(parsed)) return null;
  return parsed;
}

/**
 * Persist a quota block to the cache. Best-effort; failures are
 * swallowed (Stop hook must never throw).
 */
export function saveQuotaCache(
  cachePath: string,
  quota: CcSessionQuotaBlock,
  deps: FsWriteDeps = {},
): void {
  const md = deps.mkdirSync ?? defaultMkdirSync;
  const wr = deps.writeFileSync ?? defaultWriteFileSync;
  try {
    md(dirname(cachePath), { recursive: true });
    wr(cachePath, JSON.stringify(quota, null, 2));
  } catch {
    /* swallow — cache is best-effort */
  }
}

/**
 * Mark a freshly-loaded cached quota as stale (so the envelope reflects
 * "probe failed, this is the last good snapshot"). Pure helper.
 */
export function markStale(quota: CcSessionQuotaBlock): CcSessionQuotaBlock {
  if (quota.stale) return quota;
  return { ...quota, stale: true };
}

function isCcSessionQuotaBlock(v: unknown): v is CcSessionQuotaBlock {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.subscription_tier === 'string' &&
    typeof o.five_hour_utilization === 'number' &&
    typeof o.seven_day_utilization === 'number' &&
    typeof o.five_hour_reset_at === 'number' &&
    typeof o.seven_day_reset_at === 'number' &&
    typeof o.probed_at === 'string' &&
    typeof o.stale === 'boolean'
  );
}
