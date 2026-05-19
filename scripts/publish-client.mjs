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
import { createHash } from 'node:crypto';
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
  const out = { server: null, localTarget: null, targetDir: null, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--server') out.server = argv[++i];
    else if (a === '--local-target') out.localTarget = argv[++i];
    else if (a === '--target-dir') out.targetDir = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
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

function buildManifest() {
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
  return { version, generated_at, files };
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

function runRemote(server, command) {
  log(`ssh ${server} '${command}'`);
  const r = spawnSync('ssh', [server, command], { stdio: 'inherit' });
  if (r.status !== 0) fatal(`ssh failed (exit ${r.status})`);
}

function scpUpload(server, files, remoteDir) {
  log(`scp ${files.length} files -> ${server}:${remoteDir}/`);
  const args = [...files, `${server}:${remoteDir}/`];
  const r = spawnSync('scp', args, { stdio: 'inherit' });
  if (r.status !== 0) fatal(`scp failed (exit ${r.status})`);
}

function publishRemote(server, targetDir, manifest, dryRun) {
  // Stage manifest to a temp local file
  const tmpManifest = join(REPO_ROOT, '.publish-manifest.tmp.json');
  writeFileSync(tmpManifest, JSON.stringify(manifest, null, 2), 'utf8');
  const incoming = `${targetDir}/incoming`;
  if (dryRun) {
    log(`[dry-run] would ssh ${server} mkdir -p ${incoming}`);
    log(`[dry-run] would scp 6 .cjs + manifest.json to ${server}:${incoming}/`);
    log(`[dry-run] would ssh ${server} mv (atomic rotate into ${targetDir})`);
    try { rmSync(tmpManifest, { force: true }); } catch {}
    return;
  }
  try {
    runRemote(server, `mkdir -p ${incoming}`);
    const localFiles = BINS.map((b) => join(DIST_DIR, b)).concat([tmpManifest]);
    // scp doesn't let us rename inline — upload tmpManifest as manifest.json.tmp on remote
    scpUpload(server, localFiles, incoming);
    // Rename the local-temp manifest name on remote to match
    runRemote(
      server,
      `mv ${incoming}/.publish-manifest.tmp.json ${incoming}/manifest.json`,
    );
    // Promote .cjs files first, manifest.json LAST
    const moveBins = BINS.map((b) => `mv ${incoming}/${b} ${targetDir}/${b}`).join(' && ');
    runRemote(
      server,
      `cd ${targetDir} && ${moveBins} && mv ${incoming}/manifest.json ${targetDir}/manifest.json && rmdir ${incoming}`,
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
const manifest = buildManifest();
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
  log(`done. Clients will pick up version=${manifest.version} on their next SessionStart hook.`);
}
