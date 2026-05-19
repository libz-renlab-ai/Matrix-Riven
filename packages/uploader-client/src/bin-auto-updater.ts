#!/usr/bin/env node
/**
 * Auto-updater bin: detached subprocess kicked off by SessionStart. Never
 * blocks; never prints anything to console (output is appended to
 * `~/.riven/digital-twin/auto-update.log`).
 *
 * Hard contract: this binary MUST always exit cleanly. Any thrown error is
 * swallowed at the top level — a half-broken updater can never bring down
 * Claude Code.
 */
import { runUpdater } from './auto-update/index.js';

async function main(): Promise<void> {
  try {
    await runUpdater();
  } catch {
    // never propagate — log file already captured stderr if anything escaped
  }
}

main().then(
  () => process.exit(0),
  () => process.exit(0),
);
