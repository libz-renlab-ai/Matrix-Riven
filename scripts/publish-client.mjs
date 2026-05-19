#!/usr/bin/env node
/**
 * Matrix-Riven client publisher.
 *
 * Reads `packages/uploader-client/dist/bin-*.cjs` (6 files), computes a
 * manifest.json with sha256 + size + version + generated_at, then uploads
 * both to a remote `RIVEN_CLIENT_LATEST_DIR` on the collector server. After
 * upload the manifest is moved into place LAST, guaranteeing clients never
 * see a manifest pointing at files that aren't yet there.
 *
 * The remote upload is done via either:
 *   --server <host>          ssh + scp (default)
 *   --local-target <dir>     copy locally (for testing, e.g. into a tmp dir)
 *
 * Use `--dry-run` to print the plan without touching anything remote.
 *
 * Exit codes:
 *   0   success
 *   1   unrecoverable error (missing bins, ssh failure, etc.)
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  statSync,
  rmSync,
  renameSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { createHash, createHmac } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const DIST_DIR = join(REPO_ROOT, 'packages', 'uploader-client', 'dist');
const PKG_PATH = join(REPO_ROOT, 'packages', 'uploader-client', 'package.json');

const BINS = [
  'bin-digital-twin-tap.cjs',
  'bin-session-start.cjs',
  'bin-user-prompt-submit.cjs',
  'bin-uploader.cjs',
  'bin-digital-twin.cjs',
  'bin-auto-updater.cjs',
];

function log(line) {
  process.stdout.write(`[riven-publish] ${line}\n`);
}
function fatal(line) {
  process.stderr.write(`[riven-publish] FATAL: ${line}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {
    server: null,
    localTarget: null,
    targetDir: null,
    dryRun: false,
    help: false,
    killSwitch: false,
    note: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--server') out.server = argv[++i];
    else if (a === '--local-target') out.localTarget = argv[++i];
    else if (a === '--target-dir') out.targetDir = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--kill-switch') out.killSwitch = true;
    else if (a === '--note') out.note = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
    else fatal(`unknown flag: ${a}`);
  }
  return out;
}

function printHelp() {
  process.stdout.write(
    `Usage: node scripts/publish-client.mjs --server <user@host> [--target-dir <path>] [--dry-run]\n` +
      `       node scripts/publish-client.mjs --local-target <path> [--dry-run]\n\n` +
      `Publishes 6 dist/bin-*.cjs files + a fresh manifest.json to the collector server's\n` +
      `RIVEN_CLIENT_LATEST_DIR. Manifest is uploaded LAST (atomic rename) so half-written\n` +
      `state never poisons clients.\n\n` +
      `Options:\n` +
      `  --server <user@host>     SSH/SCP target. Default target dir: ~/riven-collector/client-latest\n` +
      `  --target-dir <path>      Override remote/local target dir.\n` +
      `  --local-target <path>    Skip SSH; copy locally (for tests / dev).\n` +
      `  --dry-run                Compute manifest and print plan, don't transfer.\n`,
  );
}

function sha256Of(filePath) {
  const buf = readFileSync(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

function gitShortSha() {
  const r = spawnSync('git', ['-C', REPO_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf-8' });
  if (r.status !== 0) return 'unknown';
  return (r.stdout || '').trim() || 'unknown';
}

function preflight() {
  if (!existsSync(DIST_DIR)) {
    fatal(`${DIST_DIR} not found — run \`pnpm -r build\` first`);
  }
  for (const bin of BINS) {
    const p = join(DIST_DIR, bin);
    if (!existsSync(p)) fatal(`missing ${p} — rerun \`pnpm -r build\``);
  }
  if (!existsSync(PKG_PATH)) fatal(`missing ${PKG_PATH}`);
}

/**
 * Canonical JSON for HMAC signing. Must match
 * packages/uploader-client/src/auto-update/hmac.ts `canonicalize`.
 */
function canonicalize(manifest) {
  const copy = {};
  const ordered = ['version', 'generated_at', 'disabled', 'note', 'files'];
  for (const k of ordered) {
    const v = manifest[k];
    if (v === undefined) continue;
    if (k === 'files' && Array.isArray(v)) {
      copy.files = v.map((f) => ({ name: f.name, sha256: f.sha256, size: f.size }));
    } else {
      copy[k] = v;
    }
  }
  return JSON.stringify(copy);
}

function buildManifest(extras = {}) {
  const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'));
  const sha = gitShortSha();
  const version = `${pkg.version}+${sha}`;
  const generated_at = new Date().toISOString();
  const files = [];
  for (const bin of BINS) {
    const p = join(DIST_DIR, bin);
    const size = statSync(p).size;
    files.push({ name: bin, sha256: sha256Of(p), size });
  }
  const manifest = { version, generated_at, files, ...extras };
  // HMAC: opt-in via env var. Same env name client uses to verify.
  const secret = process.env.RIVEN_CLIENT_MANIFEST_SECRET;
  if (secret && secret.length > 0) {
    manifest.hmac_sha256 = createHmac('sha256', secret).update(canonicalize(manifest), 'utf8').digest('hex');
    log(`signed manifest with HMAC-SHA256 (RIVEN_CLIENT_MANIFEST_SECRET set)`);
  } else {
    log(`WARN: RIVEN_CLIENT_MANIFEST_SECRET unset — manifest not signed. Set it to enable HMAC verification.`);
  }
  return manifest;
}

function publishLocal(targetDir, manifest, dryRun) {
  if (dryRun) {
    log(`[dry-run] would write 6 .cjs files + manifest.json to ${targetDir}`);
    return;
  }
  const incoming = join(targetDir, 'incoming');
  // Clean any leftover incoming dir from a previous failed publish
  if (existsSync(incoming)) {
    rmSync(incoming, { recursive: true, force: true });
  }
  mkdirSync(incoming, { recursive: true });
  mkdirSync(targetDir, { recursive: true });

  // 1. Copy all .cjs into incoming
  for (const bin of BINS) {
    copyFileSync(join(DIST_DIR, bin), join(incoming, bin));
  }
  // 2. Write manifest.json into incoming
  writeFileSync(join(incoming, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  // 3. Promote .cjs files (in any order)
  for (const bin of BINS) {
    const src = join(incoming, bin);
    const dst = join(targetDir, bin);
    try {
      renameSync(src, dst);
    } catch {
      // Fallback for Windows EBUSY edge case
      try {
        rmSync(dst, { force: true });
      } catch {}
      renameSync(src, dst);
    }
  }
  // 4. Promote manifest.json LAST — atomic switch for client readers
  const mSrc = join(incoming, 'manifest.json');
  const mDst = join(targetDir, 'manifest.json');
  try {
    renameSync(mSrc, mDst);
  } catch {
    try {
      rmSync(mDst, { force: true });
    } catch {}
    renameSync(mSrc, mDst);
  }
  rmSync(incoming, { recursive: true, force: true });
  log(`published ${BINS.length} bins + manifest to ${targetDir}`);
}

/**
 * POSIX single-quote a string for safe use in a remote shell command. Doubles
 * any embedded single quote via `'\''`. CTO review: without this, `--target-dir`
 * was a shell-injection sink.
 */
function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * Reject obviously unsafe path strings before they reach ssh. Defense-in-depth
 * on top of shellQuote.
 */
function assertPathSafe(p, role) {
  if (!/^[A-Za-z0-9._/~+@:\\-]+$/.test(p)) {
    fatal(`unsafe ${role} path: ${JSON.stringify(p)} (only letters, digits, . _ / ~ + @ : \\ -)`);
  }
}

function runRemote(server, command) {
  log(`ssh ${server} ${command}`);
  const r = spawnSync('ssh', [server, command], { stdio: 'inherit' });
  if (r.status !== 0) fatal(`ssh failed (exit ${r.status}). Check that you can run \`ssh ${server} echo ok\` interactively; if it prompts for password or fails, configure keys first.`);
}

function scpUpload(server, files, remoteDir) {
  log(`scp ${files.length} files -> ${server}:${remoteDir}/`);
  const args = [...files, `${server}:${remoteDir}/`];
  const r = spawnSync('scp', args, { stdio: 'inherit' });
  if (r.status !== 0) fatal(`scp failed (exit ${r.status}). Common causes: ssh key not configured for ${server}, remote dir doesn't exist or has wrong permissions, or local files missing.`);
}

function publishRemote(server, targetDir, manifest, dryRun) {
  assertPathSafe(targetDir, '--target-dir');
  const targetQ = shellQuote(targetDir);
  const incomingQ = shellQuote(`${targetDir}/incoming`);
  // Stage manifest to a temp local file
  const tmpManifest = join(REPO_ROOT, '.publish-manifest.tmp.json');
  writeFileSync(tmpManifest, JSON.stringify(manifest, null, 2), 'utf8');
  if (dryRun) {
    log(`[dry-run] would ssh ${server} mkdir -p ${incomingQ}`);
    log(`[dry-run] would scp 6 .cjs + manifest.json to ${server}:${targetDir}/incoming/`);
    log(`[dry-run] would ssh ${server} mv (atomic rotate into ${targetDir})`);
    try { rmSync(tmpManifest, { force: true }); } catch {}
    return;
  }
  try {
    runRemote(server, `mkdir -p ${incomingQ}`);
    const localFiles = BINS.map((b) => join(DIST_DIR, b)).concat([tmpManifest]);
    scpUpload(server, localFiles, `${targetDir}/incoming`);
    // Rename the local-temp manifest name on remote
    runRemote(
      server,
      `mv ${shellQuote(`${targetDir}/incoming/.publish-manifest.tmp.json`)} ${shellQuote(`${targetDir}/incoming/manifest.json`)}`,
    );
    // Promote .cjs files first, manifest.json LAST
    const moveBins = BINS.map((b) =>
      `mv ${shellQuote(`${targetDir}/incoming/${b}`)} ${shellQuote(`${targetDir}/${b}`)}`,
    ).join(' && ');
    runRemote(
      server,
      `cd ${targetQ} && ${moveBins} && mv ${shellQuote(`${targetDir}/incoming/manifest.json`)} ${shellQuote(`${targetDir}/manifest.json`)} && rmdir ${incomingQ}`,
    );
    log(`published to ${server}:${targetDir}`);
  } finally {
    try { rmSync(tmpManifest, { force: true }); } catch {}
  }
}

// ---- main ----

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}
if (!args.server && !args.localTarget) {
  fatal(`one of --server or --local-target is required (see --help)`);
}

preflight();
const extras = {};
if (args.killSwitch) extras.disabled = true;
if (args.note) extras.note = String(args.note).slice(0, 256);
const manifest = buildManifest(extras);
log(`manifest: version=${manifest.version} generated_at=${manifest.generated_at} files=${manifest.files.length}`);
for (const f of manifest.files) log(`  ${f.name.padEnd(32)} ${f.size.toString().padStart(8)} ${f.sha256.slice(0, 12)}...`);

const defaultRemoteDir = '~/riven-collector/client-latest';
const target = args.targetDir ?? (args.localTarget ?? defaultRemoteDir);

if (args.localTarget) {
  publishLocal(args.localTarget, manifest, args.dryRun);
} else {
  publishRemote(args.server, target, manifest, args.dryRun);
}

if (!args.dryRun) {
  // CTO review: spec promised a post-publish verification fetch. Try to do it
  // when --server has an obvious HTTP endpoint we can probe (host:port).
  if (args.server) {
    const m = String(args.server).match(/@([^:]+)$/);
    const hostOnly = m ? m[1] : args.server;
    const probeUrl = `http://${hostOnly}:8933/v1/client-latest/manifest`;
    log(`verifying via GET ${probeUrl}`);
    try {
      const resp = await fetch(probeUrl);
      if (!resp.ok) {
        log(`WARN: verify GET returned HTTP ${resp.status}. Manual check recommended.`);
      } else {
        const live = await resp.json();
        if (live.version !== manifest.version) {
          log(`WARN: server reports version=${live.version}; expected ${manifest.version}. Did the collector reload?`);
        } else {
          log(`✓ server now serves ${live.version}`);
        }
      }
    } catch (err) {
      log(`WARN: verify GET failed: ${err && err.message ? err.message : err}. If the collector is on a non-standard port, check it manually.`);
    }
  }
  log(`done. Clients will pick up version=${manifest.version} on their next SessionStart hook.`);
}
