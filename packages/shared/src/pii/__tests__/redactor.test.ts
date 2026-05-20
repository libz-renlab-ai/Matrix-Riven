import { describe, expect, it } from "vitest";
import { detectSensitiveText, redactSensitiveText, scanTranscriptForStats } from "../redactor.js";

describe("PII redactor", () => {
  it("detects team-sharing sensitive identifiers", () => {
    const findings = detectSensitiveText([
      "owner alice@example.com",
      "Authorization: Bearer sk-ant-api03-secret",
      "host prod-db.internal",
      "path /Users/alice/acme/private.env",
      "uuid 123e4567-e89b-12d3-a456-426614174000",
      "ip 10.1.2.3",
    ].join("\n"));

    expect(findings.map((f) => f.kind)).toEqual(
      expect.arrayContaining(["email", "secret", "internal-host", "private-path", "uuid", "private-ip"]),
    );
  });

  it("redacts sensitive values without removing ordinary lesson text", () => {
    const out = redactSensitiveText(
      "Use fetch instead of axios. Contact alice@example.com; token GITHUB_TOKEN=ghp_abcdef1234567890123456.",
    );
    expect(out).toContain("Use fetch instead of axios");
    expect(out).toContain("[redacted]");
    expect(out).not.toContain("alice@example.com");
    expect(out).not.toContain("ghp_abcdef");
  });

  // ── AWS access key ──────────────────────────────────────────────────────────
  it("detects and redacts AWS AKIA access key", () => {
    const text = "AWS credentials: AKIAIOSFODNN7EXAMPLE";
    const findings = detectSensitiveText(text);
    expect(findings.some((f) => f.kind === "aws-key")).toBe(true);
    const out = redactSensitiveText(text);
    expect(out).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(out).toContain("[redacted]");
  });

  it("detects ASIA and ABIA key prefixes", () => {
    // ASIA/ABIA + exactly 16 uppercase alphanumeric chars (20 chars total)
    expect(detectSensitiveText("key ASIAIOSFODNN7EXAMPL1").some((f) => f.kind === "aws-key")).toBe(true);
    expect(detectSensitiveText("key ABIAIOSFODNN7EXAMPL1").some((f) => f.kind === "aws-key")).toBe(true);
  });

  it("does not over-match ordinary uppercase strings that lack the AKIA prefix", () => {
    const text = "STATUS: DEPLOYMENT_OK_PROD_ENV12345678";
    expect(detectSensitiveText(text).some((f) => f.kind === "aws-key")).toBe(false);
  });

  // ── JWT ─────────────────────────────────────────────────────────────────────
  it("detects and redacts a 3-segment JWT", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4fw";
    const text = `Auth token: ${jwt}`;
    const findings = detectSensitiveText(text);
    expect(findings.some((f) => f.kind === "jwt")).toBe(true);
    const out = redactSensitiveText(text);
    expect(out).not.toContain(jwt);
    expect(out).toContain("[redacted]");
  });

  it("does not over-match ordinary text with dots", () => {
    const text = "version 1.2.3 or host foo.bar.baz are not JWTs";
    expect(detectSensitiveText(text).some((f) => f.kind === "jwt")).toBe(false);
  });

  // ── Phone numbers ───────────────────────────────────────────────────────────
  it("detects and redacts +CC-AAA-PPP-NNNN phone format", () => {
    const text = "Call me at +1-415-555-0172 for details";
    const findings = detectSensitiveText(text);
    expect(findings.some((f) => f.kind === "phone")).toBe(true);
    const out = redactSensitiveText(text);
    expect(out).not.toContain("+1-415-555-0172");
    expect(out).toContain("[redacted]");
  });

  it("detects (AAA) PPP-NNNN phone format", () => {
    const text = "Contact: (415) 555-0172";
    expect(detectSensitiveText(text).some((f) => f.kind === "phone")).toBe(true);
    expect(redactSensitiveText(text)).not.toContain("(415) 555-0172");
  });

  it("detects +CC AAA PPP NNNN phone format with spaces", () => {
    const text = "Phone: +1 415 555 0172";
    expect(detectSensitiveText(text).some((f) => f.kind === "phone")).toBe(true);
    expect(redactSensitiveText(text)).not.toContain("+1 415 555 0172");
  });

  it("does not over-match plain digit sequences without phone context", () => {
    const text = "12345678901234 or port 443 or year 2024";
    expect(detectSensitiveText(text).some((f) => f.kind === "phone")).toBe(false);
  });

  // ── Credit card ─────────────────────────────────────────────────────────────
  it("detects and redacts a valid Visa card number", () => {
    const text = "Payment card: 4532015112830366";
    const findings = detectSensitiveText(text);
    expect(findings.some((f) => f.kind === "credit-card")).toBe(true);
    const out = redactSensitiveText(text);
    expect(out).not.toContain("4532015112830366");
    expect(out).toContain("[redacted]");
  });

  it("detects credit card with dashes", () => {
    const text = "Card: 4532-0151-1283-0366";
    expect(detectSensitiveText(text).some((f) => f.kind === "credit-card")).toBe(true);
    expect(redactSensitiveText(text)).not.toContain("4532-0151-1283-0366");
  });

  it("does not redact digit sequences that fail Luhn check", () => {
    // 4532015112830367 is the same card with last digit incremented → Luhn fails
    const text = "reference 4532015112830367 in the logs";
    expect(detectSensitiveText(text).some((f) => f.kind === "credit-card")).toBe(false);
    expect(redactSensitiveText(text)).toContain("4532015112830367");
  });

  // ── Bucket 1/2 — scanTranscriptForStats (F1 by-kind + F5 by-location) ─────
  describe("scanTranscriptForStats (bucket 1/2)", () => {
    it("counts findings grouped by kind across the transcript", () => {
      const jsonl = [
        '{"type":"user","message":{"role":"user","content":"contact alice@example.com about it"}}',
        '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"use sk-ant-api03-LEAKED0123456789 carefully"}]}}',
      ].join("\n");
      const stats = scanTranscriptForStats(jsonl);
      expect(stats.count).toBeGreaterThanOrEqual(2);
      expect(stats.by_kind.email).toBeGreaterThanOrEqual(1);
      expect(stats.by_kind.secret).toBeGreaterThanOrEqual(1);
    });

    it("attributes redaction location to user_prompt vs assistant_response", () => {
      const jsonl = [
        '{"type":"user","message":{"role":"user","content":"my email is alice@example.com"}}',
        '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"got it bob@example.com"}]}}',
      ].join("\n");
      const stats = scanTranscriptForStats(jsonl);
      expect(stats.by_location.in_user_prompt).toBe(1);
      expect(stats.by_location.in_assistant_response).toBe(1);
    });

    it("attributes tool_use input + tool_result content correctly", () => {
      const jsonl = [
        '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{"command":"echo carol@example.com"}}]}}',
        '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"output: dave@example.com"}]}}',
      ].join("\n");
      const stats = scanTranscriptForStats(jsonl);
      expect(stats.by_location.in_tool_use_input).toBeGreaterThanOrEqual(1);
      expect(stats.by_location.in_tool_result).toBeGreaterThanOrEqual(1);
    });

    it("returns zero-everywhere for a clean transcript", () => {
      const jsonl = [
        '{"type":"user","message":{"role":"user","content":"hello world"}}',
        '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}',
      ].join("\n");
      const stats = scanTranscriptForStats(jsonl);
      expect(stats.count).toBe(0);
      expect(Object.values(stats.by_kind).every((v) => v === 0)).toBe(true);
      expect(Object.values(stats.by_location).every((v) => v === 0)).toBe(true);
    });

    it("count remains authoritative even when line shape is unrecognized", () => {
      // Flat top-level role+content (pre-bucket-1/2 test fixture shape). Our
      // structural walker doesn't recognize this layout — but the flat pass
      // still finds the secret, so `count` and `by_kind` stay accurate.
      const jsonl = '{"role":"user","content":"key sk-ant-api03-LEAKED0123456789"}';
      const stats = scanTranscriptForStats(jsonl);
      expect(stats.count).toBeGreaterThanOrEqual(1);
      expect(stats.by_kind.secret).toBeGreaterThanOrEqual(1);
    });
  });
});
