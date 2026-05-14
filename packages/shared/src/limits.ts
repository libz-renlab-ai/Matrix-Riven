/**
 * Issue #266 F8 — single-payload size cap.
 *
 * The Stop hook copies a Claude Code transcript (or, for ffmpeg-based
 * captures, an `.ogg` file) into the queue. The pre-F8 path then read
 * the full file into RAM via `readFileSync`, gzipped it, base64-encoded
 * it, stringified the envelope to JSON, and handed the body to fetch —
 * five concurrent in-memory representations, ~5× peak RSS. For typical
 * Claude Code transcripts (a few MB) this is fine; for an accidentally
 * long ffmpeg recording (hours of audio → multi-GB) it can exhaust RAM.
 *
 * F8 keeps the wire format and pipeline shape unchanged but installs a
 * hard upper bound: oversize files are rejected at the three layers
 * that touch them (tap-session intake, queue load-on-upload, recorder
 * stop) before any `readFileSync` of the full payload happens. The cap
 * is intentionally generous (≈ 40h of 24 kbps Opus audio) — a real
 * streaming pipeline is out of scope per the issue #266 grill.
 */
export const MAX_PAYLOAD_BYTES = 100 * 1024 * 1024;
