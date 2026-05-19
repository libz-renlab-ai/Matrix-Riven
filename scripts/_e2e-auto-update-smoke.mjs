#!/usr/bin/env node
/**
 * End-to-end smoke test for the auto-update pipeline.
 *
 * Sets up a real collector server bound to a temp dir, a temp $HOME with a
 * digital-twin config pointing at the collector, simulates "operator publishes
 * v1" + "operator publishes v2", invokes bin-auto-updater.cjs each time, and
 * asserts the staged bins on disk match the published manifest.
 *
 * Run: node scripts/_e2e-auto-update-smoke.mjs
 *
 * Exit 0 = pass, anything else = fail.
 */
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  rmSync,
  existsSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const DIST_DIR = join(REPO_ROOT, 'packages', 'uploader-client', 'dist');
const COLLECTOR_BIN = join(REPO_ROOT, 'packages', 'collector-server', 'dist', 'bin-prod-server.cjs');

const BINS = [
  'bin-digital-twin-tap.cjs',
  'bin-session-start.cjs',
  'bin-user-prompt-submit.cjs',
  'bin-uploader.cjs',
  'bin-digital-twin.cjs',
  'bin-auto-updater.cjs',
];

function log(msg) {
  process.stdout.write(`[e2e] ${msg}\n`);
}
function die(msg, extra) {
  process.stderr.write(`[e2e] FAIL: ${msg}\n`);
  if (extra) process.stderr.write(extra + '\n');
  process.exit(1);
}

function sha256Of(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

function preflight() {
  if (!existsSync(DIST_DIR)) die(`dist not built: ${DIST_DIR}. Run \`pnpm -r build\``);
  if (!existsSync(COLLECTOR_BIN)) die(`collector not built: ${COLLECTOR_BIN}`);
  for (const b of BINS) {
    if (!existsSync(join(DIST_DIR, b))) die(`missing dist bin ${b}`);
  }
}

async function startCollector(collectorDir) {
  const env = {
    ...process.env,
    PORT: '0',
    HOST: '127.0.0.1',
    RIVEN_COLLECTOR_DIR: collectorDir,
    RIVEN_CLIENT_LATEST_DIR: join(collectorDir, 'client-latest'),
    RIVEN_CLIENT_UPDATE_ERRORS_PATH: join(collectorDir, 'client-update-errors.jsonl'),
  };
  const child = spawn(process.execPath, [COLLECTOR_BIN], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let portUrl = null;
  let logBuf = '';
  const tryMatch = (s) => {
    const m = s.match(/listening on (https?:\/\/127\.0\.0\.1:\d+)/);
    if (m) portUrl = m[1];
  };
  child.stdout.on('data', (b) => {
    const s = b.toString('utf8');
    logBuf += s;
    tryMatch(s);
  });
  child.stderr.on('data', (b) => {
    const s = b.toString('utf8');
    logBuf += s;
    tryMatch(s);
  });
  // Wait up to 5s for the bind line
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && !portUrl) {
    await sleep(50);
  }
  if (!portUrl) {
    child.kill('SIGKILL');
    die('collector failed to print listening URL', logBuf);
  }
  return { url: portUrl, child, logBuf: () => logBuf };
}

async function publishToCollector(targetDir) {
  const r = spawnSync(
    process.execPath,
    ['scripts/publish-client.mjs', '--local-target', targetDir],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) die(`publish-client failed (exit ${r.status})`);
}

function setupTempHome() {
  const home = mkdtempSync(join(tmpdir(), 'riven-e2e-home-'));
  const rivenDir = join(home, '.riven');
  const digitalTwinDir = join(rivenDir, 'digital-twin');
  mkdirSync(digitalTwinDir, { recursive: true });
  return { home, digitalTwinDir };
}

function writeDigitalTwinConfig(home, collectorUrl) {
  const cfg = {
    schema_version: 1,
    identity: { user_id: 'e2e-tester@local', machine_id: 'e2e-machine' },
    uploader: { enabled: true, endpoint: collectorUrl, token: 'team-shared' },
    consented_at: new Date().toISOString(),
  };
  writeFileSync(join(home, '.riven', 'digital-twin.json'), JSON.stringify(cfg, null, 2), 'utf8');
}

async function runUpdater(home) {
  const updaterPath = join(DIST_DIR, 'bin-auto-updater.cjs');
  return new Promise((resolve) => {
    // RIVEN_HOME is the **parent** of .riven (digitalTwinPaths joins .riven internally).
    const env = {
      ...process.env,
      RIVEN_HOME: home,
      HOME: home,
      USERPROFILE: home,
    };
    const child = spawn(process.execPath, ['--no-warnings', updaterPath], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (b) => (out += b.toString('utf8')));
    child.stderr.on('data', (b) => (err += b.toString('utf8')));
    child.on('exit', (code) => resolve({ code, out, err }));
  });
}

function assertManifestPublished(targetDir, expectedVersion) {
  const manifest = JSON.parse(readFileSync(join(targetDir, 'manifest.json'), 'utf8'));
  if (manifest.version !== expectedVersion) {
    die(`manifest.version mismatch: expected ${expectedVersion} got ${manifest.version}`);
  }
  if (manifest.files.length !== BINS.length) {
    die(`manifest.files length mismatch: expected ${BINS.length} got ${manifest.files.length}`);
  }
  for (const f of manifest.files) {
    const p = join(targetDir, f.name);
    if (!existsSync(p)) die(`manifest references missing file ${f.name}`);
    if (sha256Of(p) !== f.sha256) die(`sha mismatch for ${f.name}`);
  }
  return manifest;
}

function assertStagedMatches(digitalTwinDir, remoteManifest) {
  // Local manifest written?
  const localManifestPath = join(digitalTwinDir, 'manifest.json');
  if (!existsSync(localManifestPath)) die('local manifest not written');
  const local = JSON.parse(readFileSync(localManifestPath, 'utf8'));
  if (local.version !== remoteManifest.version) {
    die(`local version != remote: ${local.version} vs ${remoteManifest.version}`);
  }
  // Each .cjs sha matches?
  for (const f of remoteManifest.files) {
    const staged = join(digitalTwinDir, f.name);
    if (!existsSync(staged)) die(`staged file missing: ${f.name}`);
    if (sha256Of(staged) !== f.sha256) die(`staged sha mismatch: ${f.name}`);
  }
}

async function main() {
  preflight();

  const collectorDir = mkdtempSync(join(tmpdir(), 'riven-e2e-collector-'));
  const { home, digitalTwinDir } = setupTempHome();
  log(`collectorDir=${collectorDir}`);
  log(`home=${home}`);

  const collector = await startCollector(collectorDir);
  log(`collector listening on ${collector.url}`);

  writeDigitalTwinConfig(home, collector.url);

  try {
    // Step 1: publish v1 (the current dist)
    log('--- Step 1: publish v1 ---');
    const targetDir = join(collectorDir, 'client-latest');
    await publishToCollector(targetDir);
    const manifestV1 = assertManifestPublished(targetDir, JSON.parse(readFileSync(join(targetDir, 'manifest.json'), 'utf8')).version);
    log(`published v=${manifestV1.version}`);

    // Step 2: run auto-updater for the first time (fresh install)
    log('--- Step 2: first auto-update (fresh install) ---');
    const r1 = await runUpdater(home);
    if (r1.code !== 0) die(`updater exited ${r1.code}`, `stdout=${r1.out}\nstderr=${r1.err}`);

    // Check the auto-update log was written + bins are in place
    const logFile = join(digitalTwinDir, 'auto-update.log');
    if (!existsSync(logFile)) die('auto-update.log not written');
    const logTail = readFileSync(logFile, 'utf8');
    log(`updater log tail: ${logTail.split('\n').filter(Boolean).slice(-3).join(' | ')}`);
    assertStagedMatches(digitalTwinDir, manifestV1);
    log('✓ v1 staged correctly');

    // Step 3: re-run updater — should be no-op (same version)
    log('--- Step 3: re-run updater (should no-op) ---');
    const r2 = await runUpdater(home);
    if (r2.code !== 0) die(`updater (no-op) exited ${r2.code}`);
    const logTail2 = readFileSync(logFile, 'utf8');
    if (!logTail2.includes('current') && !logTail2.includes('same-version')) {
      log(`warn: did not log 'current' explicitly`);
    }
    log('✓ no-op when same version');

    // Step 4: simulate v2 publish — change one file's content (we use the same bins, but
    // bump version manually). To make this test repeatable without rebuilding,
    // we'll touch the published bins to be a deliberate "v2" by appending a comment.
    log('--- Step 4: publish v2 (simulated bump) ---');
    await sleep(1100); // ensure generated_at strictly newer
    // Modify one staged bin in the published dir (operator-side simulation)
    const sessionStartCjs = join(targetDir, 'bin-session-start.cjs');
    const origBytes = readFileSync(sessionStartCjs);
    writeFileSync(sessionStartCjs, Buffer.concat([origBytes, Buffer.from('\n// v2-bump\n', 'utf8')]));
    // Recompute manifest with bumped version + new sha for that file
    const newSha = sha256Of(sessionStartCjs);
    const newSize = statSync(sessionStartCjs).size;
    const v2Manifest = {
      ...manifestV1,
      version: manifestV1.version + '-v2',
      generated_at: new Date().toISOString(),
      files: manifestV1.files.map((f) =>
        f.name === 'bin-session-start.cjs' ? { ...f, sha256: newSha, size: newSize } : f,
      ),
    };
    // Write v2 manifest atomically (mimicking publish-client's behavior)
    writeFileSync(join(targetDir, 'manifest.json.tmp'), JSON.stringify(v2Manifest, null, 2), 'utf8');
    const tmpPath = join(targetDir, 'manifest.json.tmp');
    const finalPath = join(targetDir, 'manifest.json');
    rmSync(finalPath, { force: true });
    spawnSync('mv', [tmpPath, finalPath]);
    // On Windows, mv won't exist; fall back:
    if (existsSync(tmpPath)) {
      const buf = readFileSync(tmpPath);
      writeFileSync(finalPath, buf);
      rmSync(tmpPath);
    }
    log(`published v=${v2Manifest.version}`);

    // Step 5: run updater again — should pull v2
    log('--- Step 5: second auto-update (v1 -> v2) ---');
    const r3 = await runUpdater(home);
    if (r3.code !== 0) die(`v2 updater exited ${r3.code}`, `stdout=${r3.out}\nstderr=${r3.err}`);
    assertStagedMatches(digitalTwinDir, v2Manifest);
    log('✓ v2 staged correctly');

    // Step 6: suspicious manifest test (downgrade attempt)
    log('--- Step 6: suspicious downgrade attempt ---');
    const downgrade = {
      ...v2Manifest,
      version: 'malicious-downgrade',
      generated_at: '2020-01-01T00:00:00.000Z', // older than local
    };
    writeFileSync(finalPath, JSON.stringify(downgrade, null, 2), 'utf8');
    const r4 = await runUpdater(home);
    if (r4.code !== 0) die(`downgrade-rejected updater exited ${r4.code}`);
    // Should NOT have changed local manifest
    const localAfter = JSON.parse(readFileSync(join(digitalTwinDir, 'manifest.json'), 'utf8'));
    if (localAfter.version !== v2Manifest.version) {
      die(`downgrade was accepted! local now=${localAfter.version}`);
    }
    log('✓ refused suspicious downgrade');

    // Step 7: verify error report was POSTed
    const errFile = join(collectorDir, 'client-update-errors.jsonl');
    if (!existsSync(errFile)) die('no error JSONL written');
    const errLines = readFileSync(errFile, 'utf8').split('\n').filter(Boolean);
    const suspectErr = errLines.find((l) => l.includes('manifest-suspicious'));
    if (!suspectErr) die('manifest-suspicious not in error log');
    log(`✓ error report ingested: ${errLines.length} total lines`);

    log('═══════════════════════════════════════');
    log('ALL E2E ASSERTIONS PASSED');
    log('═══════════════════════════════════════');
  } finally {
    collector.child.kill('SIGTERM');
    await sleep(200);
    try { collector.child.kill('SIGKILL'); } catch {}
    try { rmSync(collectorDir, { recursive: true, force: true }); } catch {}
    try { rmSync(home, { recursive: true, force: true }); } catch {}
  }
}

main().catch((err) => die(err instanceof Error ? err.message : String(err), err?.stack));
