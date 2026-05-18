// Thin wrapper around @matrix-riven/shared's PII detector that produces
// LLM-friendly placeholder tags (<email>, <path>, <secret>, …) instead of
// the shared module's opaque "[redacted]" string.
//
// Why not just use redactSensitiveText? The dashboard's LLM prompts benefit
// from kind-tagged placeholders so the model can preserve narrative
// structure ("the user opened <path>") rather than collapsing every PII
// type into the same opaque token.
//
// Why re-do detection instead of calling detectSensitiveText? We need
// match positions so we can perform non-overlapping left-to-right
// replacement: a private-path that happens to contain an email must end
// up as a single <path> tag, not <path containing <email>>.
//
// Patterns + Luhn live in @matrix-riven/shared so this module and the
// shared `redactSensitiveText` cannot drift. If you add a kind, update
// `PII_PATTERNS` in shared and the `PLACEHOLDER` map below.

import {
  PII_PATTERNS,
  PII_CC_PATTERN,
  luhnCheck,
  type SensitiveFindingKind,
} from '@matrix-riven/shared';

// Map kind -> placeholder tag. Mirrors the spec's examples:
//   private-path -> <path>, private-ip -> <ip>, internal-host -> <host>
// while leaving hyphenated kinds like aws-key intact.
const PLACEHOLDER: Record<SensitiveFindingKind, string> = {
  'email': '<email>',
  'secret': '<secret>',
  'uuid': '<uuid>',
  'private-ip': '<ip>',
  'internal-host': '<host>',
  'private-path': '<path>',
  'aws-key': '<aws-key>',
  'jwt': '<jwt>',
  'phone': '<phone>',
  'chinese-id': '<chinese-id>',
  'credit-card': '<credit-card>',
};

interface PositionedFinding {
  kind: SensitiveFindingKind;
  start: number;
  end: number; // exclusive
}

function collectFindings(input: string): PositionedFinding[] {
  const out: PositionedFinding[] = [];
  for (const { kind, pattern } of PII_PATTERNS) {
    pattern.lastIndex = 0;
    for (const m of input.matchAll(pattern)) {
      if (m.index === undefined || !m[0]) continue;
      out.push({ kind, start: m.index, end: m.index + m[0].length });
    }
  }
  PII_CC_PATTERN.lastIndex = 0;
  for (const m of input.matchAll(PII_CC_PATTERN)) {
    if (m.index === undefined || !m[0]) continue;
    const digits = m[0].replace(/[ -]/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhnCheck(digits)) {
      out.push({
        kind: 'credit-card',
        start: m.index,
        end: m.index + m[0].length,
      });
    }
  }
  return out;
}

/**
 * Replace every email/secret/uuid/private-ip/internal-host/private-path/
 * aws-key/jwt/phone/chinese-id/credit-card span in `input` with a
 * `<kind>` placeholder. Non-PII text is preserved verbatim.
 *
 * Overlapping matches are resolved longest-first so an absolute path that
 * contains an email becomes a single `<path>` rather than nested tags.
 *
 * Idempotent: the placeholders never match any pattern, so feeding the
 * output back in returns the same string.
 */
export function redactForLLM(input: string): string {
  if (!input) return input;
  const findings = collectFindings(input);
  if (findings.length === 0) return input;

  // Sort longest-first, then by earliest start, so longer matches claim
  // their range before any shorter overlapping match gets a chance.
  findings.sort((a, b) => {
    const lenDiff = b.end - b.start - (a.end - a.start);
    if (lenDiff !== 0) return lenDiff;
    return a.start - b.start;
  });

  const accepted: PositionedFinding[] = [];
  for (const f of findings) {
    let conflict = false;
    for (const a of accepted) {
      if (f.start < a.end && a.start < f.end) {
        conflict = true;
        break;
      }
    }
    if (!conflict) accepted.push(f);
  }

  accepted.sort((a, b) => a.start - b.start);
  const parts: string[] = [];
  let cursor = 0;
  for (const f of accepted) {
    if (f.start > cursor) parts.push(input.slice(cursor, f.start));
    parts.push(PLACEHOLDER[f.kind]);
    cursor = f.end;
  }
  if (cursor < input.length) parts.push(input.slice(cursor));
  return parts.join('');
}
