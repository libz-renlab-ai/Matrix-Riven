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

// Returns true if the digit string passes the Luhn algorithm.
function luhnCheck(digits: string): boolean {
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

const PATTERNS: Array<{ kind: SensitiveFindingKind; pattern: RegExp }> = [
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
  for (const { kind, pattern } of PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (match[0]) findings.push({ kind, match: match[0] });
    }
  }
  // Credit card detection with Luhn check (separate from regex-only patterns)
  const ccPattern = /\b(\d[ -]?){13,19}\b/g;
  ccPattern.lastIndex = 0;
  for (const match of text.matchAll(ccPattern)) {
    const digits = match[0].replace(/[ -]/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnCheck(digits)) {
      findings.push({ kind: "credit-card", match: match[0] });
    }
  }
  return findings;
}

export function redactSensitiveText(text: string): string {
  let redacted = text;
  for (const { kind, pattern } of PATTERNS) {
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, REDACT_MAP[kind]);
  }
  // Credit card redaction with Luhn check
  const ccPattern = /\b(\d[ -]?){13,19}\b/g;
  redacted = redacted.replace(ccPattern, (match) => {
    const digits = match.replace(/[ -]/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnCheck(digits)) {
      return REDACT_MAP["credit-card"];
    }
    return match;
  });
  return redacted;
}

/**
 * Bucket 1/2 (F1 + F5) — scan a Claude Code transcript (JSONL) for sensitive
 * text and report aggregate stats: total count, count by kind, count by
 * location-in-transcript. The redactor still runs the line-level
 * `detectSensitiveText` per content fragment; this helper just walks the
 * transcript structure so the caller knows where each finding came from.
 *
 * Locations (see RedactionLocationCounts):
 *   - in_user_prompt:        plain user text turns (string content or text blocks)
 *   - in_assistant_response: assistant text blocks
 *   - in_tool_use_input:     assistant tool_use's `input` (serialized + scanned)
 *   - in_tool_result:        user tool_result blocks
 *
 * Lines that fail to parse as JSON are skipped silently — matches the
 * robustness contract of {@link parseTranscriptLines}.
 */
export interface TranscriptRedactionStats {
  count: number;
  by_kind: Record<SensitiveFindingKind, number>;
  by_location: {
    in_user_prompt: number;
    in_assistant_response: number;
    in_tool_use_input: number;
    in_tool_result: number;
  };
}

/** Bucket the location counts for a slice of text we have already attributed. */
function attributeLocation(
  text: string,
  stats: TranscriptRedactionStats,
  location: keyof TranscriptRedactionStats['by_location'],
): void {
  if (typeof text !== 'string' || text.length === 0) return;
  const findings = detectSensitiveText(text);
  stats.by_location[location] += findings.length;
}

export function scanTranscriptForStats(jsonl: string): TranscriptRedactionStats {
  // Flat pass — authoritative `count` + `by_kind`. Matches the pre-bucket-1/2
  // `detectSensitiveText(jsonl).length` semantics so a transcript that doesn't
  // follow the canonical {type,message,content} shape still gets the right
  // total count (location buckets may then under-sum — the difference is
  // "findings in unrecognized line shapes").
  const flat = detectSensitiveText(jsonl);
  const stats: TranscriptRedactionStats = {
    count: flat.length,
    by_kind: {
      email: 0, secret: 0, uuid: 0, 'private-ip': 0, 'internal-host': 0,
      'private-path': 0, 'aws-key': 0, jwt: 0, phone: 0, 'chinese-id': 0,
      'credit-card': 0,
    },
    by_location: { in_user_prompt: 0, in_assistant_response: 0, in_tool_use_input: 0, in_tool_result: 0 },
  };
  for (const f of flat) {
    stats.by_kind[f.kind] = (stats.by_kind[f.kind] ?? 0) + 1;
  }
  // Structural pass — attribute findings to transcript locations. Best-effort.
  for (const rawLine of jsonl.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line[0] !== '{') continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const message = obj.message as Record<string, unknown> | undefined;
    const role = (message?.role as string | undefined) ?? (obj.type as string | undefined);
    const content = message?.content;
    if (role === 'user' || obj.type === 'user') {
      if (typeof content === 'string') {
        attributeLocation(content, stats, 'in_user_prompt');
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (typeof block !== 'object' || block === null) continue;
          const b = block as Record<string, unknown>;
          if (b.type === 'text' && typeof b.text === 'string') {
            attributeLocation(b.text, stats, 'in_user_prompt');
          } else if (b.type === 'tool_result') {
            // tool_result.content can be string or array of {type:'text',text}
            const tc = b.content;
            if (typeof tc === 'string') {
              attributeLocation(tc, stats, 'in_tool_result');
            } else if (Array.isArray(tc)) {
              for (const tb of tc) {
                if (typeof tb !== 'object' || tb === null) continue;
                const tbObj = tb as Record<string, unknown>;
                if (typeof tbObj.text === 'string') attributeLocation(tbObj.text, stats, 'in_tool_result');
              }
            }
          }
        }
      }
    } else if (role === 'assistant' || obj.type === 'assistant') {
      if (Array.isArray(content)) {
        for (const block of content) {
          if (typeof block !== 'object' || block === null) continue;
          const b = block as Record<string, unknown>;
          if (b.type === 'text' && typeof b.text === 'string') {
            attributeLocation(b.text, stats, 'in_assistant_response');
          } else if (b.type === 'tool_use') {
            // Serialize tool input as JSON for scanning. The Stop tap pipeline
            // already gzips the whole transcript, so we don't keep the
            // serialized string around.
            try {
              attributeLocation(JSON.stringify(b.input ?? {}), stats, 'in_tool_use_input');
            } catch { /* circular / unserializable input — skip */ }
          }
        }
      } else if (typeof content === 'string') {
        attributeLocation(content, stats, 'in_assistant_response');
      }
    }
  }
  return stats;
}
