#!/usr/bin/env node
/**
 * Matrix-Riven client installer.
 *
 * Idempotent. Three steps:
 *   1. Stage CJS bin bundles into <data-root>/digital-twin/ so they survive
 *      `git pull` / nvm switch / worktree churn.
 *   2. Safely merge our 3 hook blocks into ~/.claude/settings.json — preserving
 *      every other field, recognising our own `_rivenTag` entries for in-place
 *      update, and migrating any TeamBrain-era `_teamagentTag` entries that
 *      point at the legacy `bin-digital-twin-tap.cjs` location.
 *   3. Run a dry-run probe (`RIVEN_UPLOADER_DRYRUN=1`) to prove the staged
 *      bundle resolves every import (catches `MODULE_NOT_FOUND` before the
 *      first Stop hook does).
 *
 * Designed to be invoked by an AI agent (Claude Code, Cursor, etc.) following
 * INSTALL.md, but also runnable by hand. Every action prints exactly one line.
 *
 * Flags:
 *   --dry-run      Print the plan, do not touch the filesystem.
 *   --uninstall    Remove staged bins + our hook entries (leaves settings.json
 *                  backup intact).
 *   --help         Print usage.
 *
 * Exit codes:
 *   0 success / no-op
 *   1 unrecoverable error (corrupt settings.json, missing dist, etc.)
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
  rmSync,
  renameSync,
  statSync,
} from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const DIST_DIR = join(REPO_ROOT, 'packages', 'uploader-client', 'dist');

const RIVEN_TAG_PREFIX = 'riven-';
const LEGACY_TAG_PREFIX = 'teamagent-';

/** Six Claude Code hook events we wire up, in registration order.
 *  The 3 originals (Stop / SessionStart / UserPromptSubmit) cover the core
 *  transcript-upload + real-time status path. The 3 bucket-1/2 additions
 *  (PreToolUse / PreCompact / SessionEnd) extend telemetry breadth — see
 *  docs/superpowers/specs/ for what each event collects.
 */
const HOOKS = /** @type {const} */ ([
  { event: 'Stop', bin: 'bin-digital-twin-tap.cjs', tag: 'riven-digital-twin-tap' },
  { event: 'SessionStart', bin: 'bin-session-start.cjs', tag: 'riven-session-start' },
  { event: 'UserPromptSubmit', bin: 'bin-user-prompt-submit.cjs', tag: 'riven-user-prompt-submit' },
  { event: 'PreToolUse', bin: 'bin-pre-tool-use.cjs', tag: 'riven-pre-tool-use' },
  { event: 'PreCompact', bin: 'bin-pre-compact.cjs', tag: 'riven-pre-compact' },
  { event: 'SessionEnd', bin: 'bin-session-end.cjs', tag: 'riven-session-end' },
]);

// Resolve $HOME the same way every other riven binary does: prefer the
// canonical `os.homedir()` but allow override via env for sandboxed tests.
function resolveHome() {
  const env = process.env.RIVEN_HOME || process.env.TEAMAGENT_HOME;
  if (env && env.length > 0) return env;
  return homedir();
}

function log(line) {
  process.stdout.write(`[riven-install] ${line}\n`);
}

function fatal(line) {
  process.stderr.write(`[riven-install] FATAL: ${line}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { dryRun: false, uninstall: false, help: false, projectLevel: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--uninstall') out.uninstall = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--project-level') {
      // Optional path argument; defaults to REPO_ROOT (the repo this script
      // ships in). The hooks land in `<path>/.claude/settings.json` instead of
      // `~/.claude/settings.json` — used by hosts where a third-party
      // user-level "viral install" overwrites our entries.
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out.projectLevel = resolve(next);
        i++;
      } else {
        out.projectLevel = REPO_ROOT;
      }
    } else fatal(`unknown flag: ${a}`);
  }
  return out;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/install-client.mjs [flags]\n`);
  process.stdout.write(`  Stage CJS bins into ~/.riven/digital-twin/ and register Claude Code hooks.\n`);
  process.stdout.write(`  Flags:\n`);
  process.stdout.write(`    --dry-run                Print the plan, do not touch the filesystem.\n`);
  process.stdout.write(`    --uninstall              Remove hook entries + staged bins.\n`);
  process.stdout.write(`    --project-level [path]   Write hooks to <path>/.claude/settings.json\n`);
  process.stdout.write(`                             (defaults to this repo). Use this when a\n`);
  process.stdout.write(`                             third-party tool overwrites ~/.claude/settings.json.\n`);
  process.stdout.write(`  See INSTALL.md for the full agent-driven flow.\n`);
}

// ────────────────────────────── filesystem helpers ──────────────────────────────

function readJsonOrEmpty(path) {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf-8');
  if (raw.trim().length === 0) return {};
  try {
    const v = JSON.parse(raw);
    return typeof v === 'object' && v !== null ? v : {};
  } catch (err) {
    fatal(`cannot parse ${path}: ${String(err.message || err)} — back it up and rerun`);
  }
}

function writeJsonAtomic(path, obj, dryRun) {
  const text = JSON.stringify(obj, null, 2) + '\n';
  if (dryRun) {
    log(`[dry-run] would write ${path} (${text.length} bytes)`);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, text, 'utf-8');
  // Cross-platform atomic replace: unlink-then-rename on Windows, atomic on POSIX.
  try {
    // node ≥17 supports rename over existing file on every supported platform.
    renameSync(tmp, path);
  } catch {
    // Fallback path (rare; older Windows fs configs).
    try { rmSync(path, { force: true }); } catch { /* */ }
    renameSync(tmp, path);
  }
}

function ensureDir(path, dryRun) {
  if (dryRun) {
    log(`[dry-run] would mkdir -p ${path}`);
    return;
  }
  mkdirSync(path, { recursive: true });
}

// ────────────────────────────── settings.json hook merge ──────────────────────────────

/**
 * Build the canonical hook entry for one event. The `bash -c '[ -f "$1" ] ||
 * exit 0; exec node ...'` wrapper matches what Claude Code expects and the
 * shape we observed in real-world installs (PR-level). The `[ -f ... ]` guard
 * silently exits 0 if the bin is missing — so an uninstalled-but-still-listed
 * hook never blocks Claude Code's Stop close.
 */
function buildHookEntry(stagedBinPath, tag) {
  // Forward-slash the absolute path on Windows so `bash -c` sees a POSIX-style
  // arg under git-bash. Node's `path.join` on Windows uses `\` which would be
  // mangled inside the single-quoted bash string otherwise.
  const posixPath = stagedBinPath.split(sep).join('/');
  return {
    _rivenTag: tag,
    hooks: [
      {
        type: 'command',
        command: `bash -c '[ -f "$1" ] || exit 0; exec node --no-warnings "$1"' _ ${posixPath}`,
        timeout: 5,
      },
    ],
  };
}

/**
 * Recognise either our own `_rivenTag` or the TeamBrain-era `_teamagentTag`
 * so a machine upgrading from the old layout gets its hook entry replaced
 * rather than duplicated.
 */
function isOurEntry(entry, tag) {
  if (entry == null || typeof entry !== 'object') return false;
  if (typeof entry._rivenTag === 'string' && entry._rivenTag === tag) return true;
  // Legacy tag — same shape, teamagent-* prefix.
  const legacy = tag.replace(new RegExp(`^${RIVEN_TAG_PREFIX}`), LEGACY_TAG_PREFIX);
  if (typeof entry._teamagentTag === 'string' && entry._teamagentTag === legacy) return true;
  return false;
}

/**
 * In-place merge of one hook event. Returns true if `settings` was mutated.
 */
function mergeOneEvent(settings, event, newEntry, tag) {
  if (!settings.hooks || typeof settings.hooks !== 'object') {
    settings.hooks = {};
  }
  const list = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
  const existingIdx = list.findIndex((e) => isOurEntry(e, tag));
  if (existingIdx >= 0) {
    const before = JSON.stringify(list[existingIdx]);
    list[existingIdx] = newEntry;
    settings.hooks[event] = list;
    return before !== JSON.stringify(newEntry);
  }
  list.push(newEntry);
  settings.hooks[event] = list;
  return true;
}

function removeOneEvent(settings, event, tag) {
  if (!settings.hooks || typeof settings.hooks !== 'object') return false;
  const list = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
  const before = list.length;
  const filtered = list.filter((e) => !isOurEntry(e, tag));
  if (filtered.length === before) return false;
  settings.hooks[event] = filtered;
  return true;
}

// ────────────────────────────── install / uninstall flows ──────────────────────────────

function preflightDist() {
  if (!existsSync(DIST_DIR)) {
    fatal(`${DIST_DIR} not found — run \`pnpm install && pnpm -r build\` first`);
  }
  for (const { bin } of HOOKS) {
    if (!existsSync(join(DIST_DIR, bin))) {
      fatal(`missing ${join(DIST_DIR, bin)} — rerun \`pnpm -r build\``);
    }
  }
  // bin-uploader.cjs is needed by the daemon spawn path; also verify it.
  if (!existsSync(join(DIST_DIR, 'bin-uploader.cjs'))) {
    fatal(`missing ${join(DIST_DIR, 'bin-uploader.cjs')} — rerun \`pnpm -r build\``);
  }
  // bin-digital-twin.cjs for the CLI (login/inject-mock); verify too.
  if (!existsSync(join(DIST_DIR, 'bin-digital-twin.cjs'))) {
    fatal(`missing ${join(DIST_DIR, 'bin-digital-twin.cjs')} — rerun \`pnpm -r build\``);
  }
  // bin-auto-updater.cjs is fired by SessionStart hook; verify it's built.
  if (!existsSync(join(DIST_DIR, 'bin-auto-updater.cjs'))) {
    fatal(`missing ${join(DIST_DIR, 'bin-auto-updater.cjs')} — rerun \`pnpm -r build\``);
  }
  log(`OK: all ${HOOKS.length + 3} bins present in ${DIST_DIR}`);
}

function stageBins(home, dryRun) {
  const stageDir = join(home, '.riven', 'digital-twin');
  ensureDir(stageDir, dryRun);
  const allBins = [
    ...HOOKS.map((h) => h.bin),
    'bin-uploader.cjs',
    'bin-digital-twin.cjs',
    'bin-auto-updater.cjs',
  ];
  for (const bin of allBins) {
    const src = join(DIST_DIR, bin);
    const dest = join(stageDir, bin);
    if (dryRun) {
      log(`[dry-run] would copy ${src} -> ${dest}`);
      continue;
    }
    copyFileSync(src, dest);
  }
  log(`staged ${allBins.length} bins into ${stageDir}`);
  return stageDir;
}

function unstageBins(home, dryRun) {
  const stageDir = join(home, '.riven', 'digital-twin');
  const allBins = [
    ...HOOKS.map((h) => h.bin),
    'bin-uploader.cjs',
    'bin-digital-twin.cjs',
    'bin-auto-updater.cjs',
  ];
  let removed = 0;
  for (const bin of allBins) {
    const p = join(stageDir, bin);
    if (!existsSync(p)) continue;
    if (dryRun) {
      log(`[dry-run] would rm ${p}`);
      removed++;
      continue;
    }
    rmSync(p, { force: true });
    removed++;
  }
  log(`removed ${removed} staged bins from ${stageDir}`);
}

function mergeHooks(home, stageDir, dryRun, projectLevelDir) {
  const settingsPath = projectLevelDir
    ? join(projectLevelDir, '.claude', 'settings.json')
    : join(home, '.claude', 'settings.json');
  const settings = readJsonOrEmpty(settingsPath);
  // Back up unconditionally — small file, easy diff after.
  if (!dryRun && existsSync(settingsPath)) {
    const backup = `${settingsPath}.riven-backup-${Date.now()}`;
    copyFileSync(settingsPath, backup);
    log(`backed up settings.json -> ${backup}`);
  }
  let mutated = false;
  for (const { event, bin, tag } of HOOKS) {
    const entry = buildHookEntry(join(stageDir, bin), tag);
    const changed = mergeOneEvent(settings, event, entry, tag);
    if (changed) {
      log(`merged hook: ${event} -> ${bin}`);
      mutated = true;
    } else {
      log(`hook ${event} -> ${bin} already up-to-date`);
    }
  }
  if (mutated) {
    writeJsonAtomic(settingsPath, settings, dryRun);
    log(`wrote ${settingsPath}`);
  } else {
    log(`no settings.json changes needed`);
  }
}

function removeHooks(home, dryRun, projectLevelDir) {
  const settingsPath = projectLevelDir
    ? join(projectLevelDir, '.claude', 'settings.json')
    : join(home, '.claude', 'settings.json');
  if (!existsSync(settingsPath)) {
    log(`no ${settingsPath} — nothing to uninstall`);
    return;
  }
  const settings = readJsonOrEmpty(settingsPath);
  if (!dryRun) {
    const backup = `${settingsPath}.riven-uninstall-backup-${Date.now()}`;
    copyFileSync(settingsPath, backup);
    log(`backed up settings.json -> ${backup}`);
  }
  let mutated = false;
  for (const { event, tag } of HOOKS) {
    if (removeOneEvent(settings, event, tag)) {
      log(`removed hook: ${event} (${tag})`);
      mutated = true;
    }
  }
  if (mutated) {
    writeJsonAtomic(settingsPath, settings, dryRun);
    log(`wrote ${settingsPath}`);
  } else {
    log(`no riven hooks found in ${settingsPath}`);
  }
}

function dryRunProbe(stageDir) {
  const probe = join(stageDir, 'bin-uploader.cjs');
  log(`running probe: RIVEN_UPLOADER_DRYRUN=1 node ${probe}`);
  const r = spawnSync(
    process.execPath,
    ['--no-warnings', probe],
    { env: { ...process.env, RIVEN_UPLOADER_DRYRUN: '1' }, encoding: 'utf-8' },
  );
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.status !== 0) {
    process.stderr.write(out);
    fatal(`probe exited ${r.status} — staged bundle is broken`);
  }
  if (!out.includes('dry-run OK')) {
    process.stderr.write(out);
    fatal(`probe ran but did not print "dry-run OK" — staged bundle is broken`);
  }
  log(`probe OK: ${out.trim().split('\n').pop()}`);
}

/**
 * Zero-touch bootstrap of the per-user config at `~/.riven/digital-twin.json`.
 *
 * Without this step a fresh-install user finishes `install-client.mjs` with
 * hooks wired up but no config file — every subsequent `bin-digital-twin
 * status` returns `digital-twin: not configured`, contradicting INSTALL §3a's
 * 4 success criteria. The fix mirrors what an operator would type by hand:
 * `bin-digital-twin login team-shared`. We only spawn it when the config
 * file is absent, so a user with a custom endpoint / token (set by a previous
 * `login` or hand-edit) is never overwritten.
 */
function ensureConfig(home, stageDir, dryRun) {
  const configFile = join(home, '.riven', 'digital-twin.json');
  if (existsSync(configFile)) {
    log(`config already present at ${configFile} — leaving untouched`);
    return;
  }
  if (dryRun) {
    log(`[dry-run] would create ${configFile} via \`bin-digital-twin login team-shared\``);
    return;
  }
  const cli = join(stageDir, 'bin-digital-twin.cjs');
  log(`bootstrapping config: ${cli} login team-shared`);
  const r = spawnSync(
    process.execPath,
    ['--no-warnings', cli, 'login', 'team-shared'],
    { encoding: 'utf-8' },
  );
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.status !== 0) {
    process.stderr.write(out);
    fatal(`bin-digital-twin login exited ${r.status} — config not written`);
  }
  if (!existsSync(configFile)) {
    process.stderr.write(out);
    fatal(`bin-digital-twin login claimed success but ${configFile} is missing`);
  }
  log(`config written: ${configFile}`);
}

// ────────────────────────────── main ──────────────────────────────

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}
const home = resolveHome();
log(
  `platform=${platform()} home=${home} dry-run=${args.dryRun} uninstall=${args.uninstall}` +
    (args.projectLevel ? ` project-level=${args.projectLevel}` : ''),
);

if (args.uninstall) {
  removeHooks(home, args.dryRun, args.projectLevel);
  unstageBins(home, args.dryRun);
  log(`done. Restart Claude Code for the hook removal to take effect.`);
  log(`(local data at ~/.riven/digital-twin/ left intact; rm -rf if you want a clean wipe)`);
  process.exit(0);
}

preflightDist();
const stageDir = stageBins(home, args.dryRun);
mergeHooks(home, stageDir, args.dryRun, args.projectLevel);
if (!args.dryRun) {
  dryRunProbe(stageDir);
}
ensureConfig(home, stageDir, args.dryRun);
log(`done.`);
log(`next steps:`);
log(`  1. Restart Claude Code (so it re-reads ~/.claude/settings.json).`);
log(`  2. Verify status: node ${join(stageDir, 'bin-digital-twin.cjs')} status`);
log(`     Expect: enabled=true, endpoint set, client_version visible after first auto-update tick.`);
log(`  3. Real uploads happen automatically when your next CC Stop hook fires.`);
log(`  4. After your next session, check the dashboard for your user_id.`);
