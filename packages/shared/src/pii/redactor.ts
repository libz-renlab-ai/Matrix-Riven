export type SensitiveFindingKind =
  | "email"
  | "secret"
  | "uuid"
  | "private-ip"
  | "internal-host"
  | "private-path"
  | "aws-key"
  | "jwt"
  | "phone"
  | "chinese-id"
  | "credit-card";

export interface SensitiveFinding {
  kind: SensitiveFindingKind;
  match: string;
}

/**
 * Returns true if the digit string passes the Luhn algorithm.
 * Exported so downstream PII modules (e.g., the LLM redactor in
 * `collector-server`) can reuse the same credit-card validation rather
 * than ship a divergent copy. Pure function, no side effects.
 */
export function luhnCheck(digits: string): boolean {
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i] ?? "0", 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

/**
 * PII detection patterns shared between the shared module's
 * `redactSensitiveText` (replaces with `[redacted]`) and downstream
 * consumers that need kind-tagged placeholders (e.g., the LLM redactor
 * in `collector-server` swaps `[redacted]` for `<email>`/`<path>`/...).
 *
 * Exported so callers don't ship a divergent copy. If you add a kind
 * here, update `REDACT_MAP` below + the consumer's `PLACEHOLDER` map.
 * Credit-card uses Luhn verification and is handled separately — see
 * `CC_PATTERN` below.
 */
export const PII_PATTERNS: ReadonlyArray<{ kind: SensitiveFindingKind; pattern: RegExp }> = [
  { kind: "email", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  {
    kind: "secret",
    pattern: /\b(?:Authorization:\s*Bearer\s+[^\s"']+|[A-Z0-9_]*(?:TOKEN|SECRET|API_KEY|PASSWORD)[A-Z0-9_]*=[^\s"']+|sk-ant-[A-Za-z0-9._-]+|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9_]{20,})\b/gi,
  },
  {
    kind: "uuid",
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
  },
  {
    kind: "private-ip",
    pattern: /\b(?:10|192\.168|172\.(?:1[6-9]|2[0-9]|3[01]))\.(?:[0-9]{1,3}\.){1,2}[0-9]{1,3}\b/g,
  },
  {
    kind: "internal-host",
    pattern: /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:internal|corp|local|lan)\b/gi,
  },
  {
    kind: "private-path",
    pattern: /(?:\/Users\/[^\s"'`]+|\/home\/[^\s"'`]+|[A-Za-z]:\\Users\\[^\s"'`]+)/g,
  },
  {
    // AWS access key IDs: AKIA/ASIA/ABIA followed by 16 uppercase alphanumeric chars
    kind: "aws-key",
    pattern: /\b(?:AKIA|ASIA|ABIA)[0-9A-Z]{16}\b/g,
  },
  {
    // JWT: three base64url segments separated by dots, first two starting with eyJ
    kind: "jwt",
    pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  },
  {
    // Phone: +CC-AAA-PPP-NNNN, (AAA) PPP-NNNN, +CC AAA PPP NNNN
    // Requires country code or area code context to avoid over-matching plain digits
    kind: "phone",
    pattern: /(?:\+\d{1,3}[-\s]\d{3}[-\s]\d{3}[-\s]\d{4}|\(\d{3}\)\s?\d{3}-\d{4})/g,
  },
  {
    // Chinese resident ID: 17 digits + 1 check char (digit or X/x). Placed
    // before the credit-card pass so an 18-digit ID is redacted as PII, not
    // mis-classified as a card number. M2 验证 step 3 ("模拟身份证号").
    kind: "chinese-id",
    pattern: /\b\d{17}[\dXx]\b/g,
  },
];

/**
 * Credit-card detector. Kept separate from `PII_PATTERNS` because matches
 * must pass `luhnCheck` to avoid eating arbitrary 13–19-digit numbers.
 */
export const PII_CC_PATTERN = /\b(\d[ -]?){13,19}\b/g;

const REDACT_MAP: Record<SensitiveFindingKind, string> = {
  "email": "[redacted]",
  "secret": "[redacted]",
  "uuid": "[redacted]",
  "private-ip": "[redacted]",
  "internal-host": "[redacted]",
  "private-path": "[redacted]",
  "aws-key": "[redacted]",
  "jwt": "[redacted]",
  "phone": "[redacted]",
  "chinese-id": "[redacted]",
  "credit-card": "[redacted]",
};

export function detectSensitiveText(text: string): SensitiveFinding[] {
  const findings: SensitiveFinding[] = [];
  for (const { kind, pattern } of PII_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (match[0]) findings.push({ kind, match: match[0] });
    }
  }
  PII_CC_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(PII_CC_PATTERN)) {
    const digits = match[0].replace(/[ -]/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnCheck(digits)) {
      findings.push({ kind: "credit-card", match: match[0] });
    }
  }
  return findings;
}

export function redactSensitiveText(text: string): string {
  let redacted = text;
  for (const { kind, pattern } of PII_PATTERNS) {
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, REDACT_MAP[kind]);
  }
  PII_CC_PATTERN.lastIndex = 0;
  redacted = redacted.replace(PII_CC_PATTERN, (match) => {
    const digits = match.replace(/[ -]/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnCheck(digits)) {
      return REDACT_MAP["credit-card"];
    }
    return match;
  });
  return redacted;
}
