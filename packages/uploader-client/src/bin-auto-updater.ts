#!/usr/bin/env node
/**
 * Auto-updater bin: detached subprocess kicked off by SessionStart. Never
 * blocks; never prints anything to console (output is appended to
 * `~/.riven/digital-twin/auto-update.log`).
 *
 * Hard contract: this binary MUST always exit cleanly. Any thrown error is
 * swallowed at the top level — a half-broken updater can never bring down
 * Claude Code.
 *
 * Thundering herd mitigation: CTO review noted that 30 developers opening CC
 * at the same time would burst-fire 30 concurrent manifest fetches. We sleep
 * 0–30s before the actual work to spread load. Override via env if needed
 * (CI / tests need 0).
 */
import { runUpdater } from './auto-update/index.js';

const DEFAULT_MAX_JITTER_MS = 30_000;

function readJitterMs(): number {
  const raw = process.env.RIVEN_AUTO_UPDATE_JITTER_MAX_MS;
  if (raw === undefined) return DEFAULT_MAX_JITTER_MS;
  if (raw === '0') return 0;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0 && n <= 600_000) return n;
  return DEFAULT_MAX_JITTER_MS;
}

async function main(): Promise<void> {
  try {
    const jitterMs = readJitterMs();
    if (jitterMs > 0) {
      await new Promise((r) => setTimeout(r, Math.floor(Math.random() * jitterMs)));
    }
    await runUpdater();
  } catch {
    // never propagate — log file already captured stderr if anything escaped
  }
}

main().then(
  () => process.exit(0),
  () => process.exit(0),
);
