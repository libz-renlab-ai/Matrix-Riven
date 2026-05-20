// BPP auth gate — Phase 5 P5.3.
//
// Spec: docs/superpowers/specs/2026-05-13-best-practice-push-design.md §6.3.
// Validates `Authorization: Bearer <token>` strictly. Returns a result object
// rather than throwing so the HTTP-layer caller decides whether to emit 401 /
// 403 / 404 (and avoid leaking endpoint existence). Token comparison is a
// strict string equality check; callers should source `expected_token` from
// the BPP_AUTH_TOKEN env var, not hardcode it.

import type { IncomingHttpHeaders } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

export interface AuthOk {
  ok: true;
}

export interface AuthFail {
  ok: false;
  error: 'unauthorized';
}

export type AuthResult = AuthOk | AuthFail;

const BEARER_PREFIX = 'Bearer ';

export function requireBearerToken(
  headers: IncomingHttpHeaders,
  expected_token: string,
): AuthResult {
  const raw = headers.authorization;
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, error: 'unauthorized' };
  }
  if (!raw.startsWith(BEARER_PREFIX)) {
    return { ok: false, error: 'unauthorized' };
  }
  const supplied = raw.slice(BEARER_PREFIX.length);
  // Round-1 QA P1 (security): use timing-safe comparison so remote attackers
  // can't side-channel-leak the token via response-timing diffs. Length must
  // match before timingSafeEqual can run (otherwise it throws), so we first
  // length-gate then compare equal-length buffers.
  if (supplied.length !== expected_token.length) {
    return { ok: false, error: 'unauthorized' };
  }
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected_token);
  if (!timingSafeEqual(a, b)) {
    return { ok: false, error: 'unauthorized' };
  }
  return { ok: true };
}
