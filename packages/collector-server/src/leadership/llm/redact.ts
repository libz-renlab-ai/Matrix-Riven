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

import type { SensitiveFindingKind } from '@matrix-riven/shared';

// Patterns mirror packages/shared/src/pii/redactor.ts but are duplicated
// here so we can capture indices via matchAll. Keep this list in sync
// with the shared module if patterns evolve.
const PATTERNS: ReadonlyArray<{
  kind: SensitiveFindingKind;
  pattern: RegExp;
}> = [
  { kind: 'email', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  {
    kind: 'secret',
    pattern:
      /\b(?:Authorization:\s*Bearer\s+[^\s"']+|[A-Z0-9_]*(?:TOKEN|SECRET|API_KEY|PASSWORD)[A-Z0-9_]*=[^\s"']+|sk-ant-[A-Za-z0-9._-]+|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9_]{20,})\b/gi,
  },
  {
    kind: 'uuid',
    pattern:
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
  },
  {
    kind: 'private-ip',
    pattern:
      /\b(?:10|192\.168|172\.(?:1[6-9]|2[0-9]|3[01]))\.(?:[0-9]{1,3}\.){1,2}[0-9]{1,3}\b/g,
  },
  {
    kind: 'internal-host',
    pattern: /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:internal|corp|local|lan)\b/gi,
  },
  {
    kind: 'private-path',
    pattern:
      /(?:\/Users\/[^\s"'`]+|\/home\/[^\s"'`]+|[A-Za-z]:\\Users\\[^\s"'`]+)/g,
  },
  { kind: 'aws-key', pattern: /\b(?:AKIA|ASIA|ABIA)[0-9A-Z]{16}\b/g },
  {
    kind: 'jwt',
    pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  },
  {
    kind: 'phone',
    pattern:
      /(?:\+\d{1,3}[-\s]\d{3}[-\s]\d{3}[-\s]\d{4}|\(\d{3}\)\s?\d{3}-\d{4})/g,
  },
  { kind: 'chinese-id', pattern: /\b\d{17}[\dXx]\b/g },
];

// Credit card uses Luhn verification, applied separately.
const CC_PATTERN = /\b(\d[ -]?){13,19}\b/g;

function luhnCheck(digits: string): boolean {
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i] ?? '0', 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

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
  for (const { kind, pattern } of PATTERNS) {
    pattern.lastIndex = 0;
    for (const m of input.matchAll(pattern)) {
      if (m.index === undefined || !m[0]) continue;
      out.push({ kind, start: m.index, end: m.index + m[0].length });
    }
  }
  CC_PATTERN.lastIndex = 0;
  for (const m of input.matchAll(CC_PATTERN)) {
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

  // Greedy non-overlap selection. We mark accepted ranges and skip
  // anything that intersects an already-accepted range.
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

  // Apply replacements left-to-right.
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
