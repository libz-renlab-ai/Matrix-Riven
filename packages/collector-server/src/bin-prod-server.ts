#!/usr/bin/env node
/**
 * Production receiver entry — long-running HTTP server for team data collection.
 *
 * Wraps startMockServer with production defaults:
 *   - Bind 0.0.0.0 (LAN-visible) instead of 127.0.0.1
 *   - outputDir from $RIVEN_COLLECTOR_DIR (default $HOME/riven-collector)
 *   - Logs each request line to stderr
 *   - SIGTERM / SIGINT trigger graceful shutdown
 *
 * Env vars (legacy `TEAMAGENT_*` / `BPP_*` names accepted with a deprecation
 * warning — see compat.ts):
 *   PORT                       (default 8933)
 *   HOST                       (default 127.0.0.1 — loopback only.
 *                               Set HOST=0.0.0.0 explicitly to expose on LAN,
 *                               and pair with RIVEN_AUTH_TOKEN since
 *                               leadership endpoints surface team data.)
 *   RIVEN_COLLECTOR_DIR        (default $HOME/riven-collector;
 *                               legacy: TEAMAGENT_COLLECTOR_DIR / ~/teamagent-collector)
 *   RIVEN_AUTH_TOKEN           (optional — when set, POST /v1/cc-sessions
 *                               requires `Authorization: Bearer <token>`;
 *                               legacy: BPP_AUTH_TOKEN)
 *   HTTPS_KEY_PATH / HTTPS_CERT_PATH
 *                              (optional — when BOTH are set, serve over TLS
 *                               instead of plain HTTP)
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readEnvWithLegacy } from '@matrix-riven/shared';
import { startMockServer } from './mock-server.js';

export interface RunProdServerDeps {
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
  log?: (msg: string) => void;
  onReady?: (info: { url: string; outputDir: string }) => void;
}

export async function runProdServer(deps: RunProdServerDeps = {}): Promise<() => Promise<void>> {
  const env = deps.env ?? process.env;
  const home = (deps.homedir ?? homedir)();
  const log = deps.log ?? ((msg: string) => process.stderr.write(`${msg}\n`));

  const portRaw = env.PORT ?? '8933';
  const portParsed = Number(portRaw);
  if (!Number.isInteger(portParsed) || portParsed < 0 || portParsed > 65535) {
    throw new Error(
      `[riven-collector] invalid PORT='${portRaw}' — must be an integer 0-65535`,
    );
  }
  const port = portParsed;
  // Default to loopback so the leadership dashboard isn't exposed on the LAN
  // by accident. To run on the network, the operator must set HOST=0.0.0.0
  // explicitly — and should also set RIVEN_AUTH_TOKEN, which gates the
  // leadership routes when present.
  const host = env.HOST ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== 'localhost' && !(env.RIVEN_AUTH_TOKEN || env.BPP_AUTH_TOKEN)) {
    // 2026-05-19 QA-4 P0: security auditor's P0 — a non-loopback bind
    // without RIVEN_AUTH_TOKEN exposes both leadership endpoints AND
    // the write endpoint (POST /v1/cc-sessions) to the LAN. With no
    // token, anyone can ingest a session as any email, corrupting
    // every signal. The previous behaviour was to log a warning and
    // start anyway, which a sleepy operator would miss. Refuse to
    // start so the misconfiguration surfaces immediately.
    throw new Error(
      `[riven-collector] REFUSING TO START: HOST=${host} (non-loopback) ` +
        `without RIVEN_AUTH_TOKEN. POST /v1/cc-sessions and every ` +
        `leadership route would be reachable on the LAN without auth, ` +
        `letting anyone spoof a teammate's email and corrupt aggregates. ` +
        `Set RIVEN_AUTH_TOKEN=<32 random bytes> or bind HOST=127.0.0.1.`,
    );
  }
  if ((host === '127.0.0.1' || host === 'localhost') && !(env.RIVEN_AUTH_TOKEN || env.BPP_AUTH_TOKEN)) {
    // Loopback + no token: any local process can spoof. Acceptable
    // for single-user laptops, dangerous on shared/multi-tenant hosts.
    // Log a bootscreen NOTICE (not a warning — this is the documented
    // single-user mode) so the operator sees it and decides.
    log(
      '[riven-collector] NOTICE: HOST=127.0.0.1 without RIVEN_AUTH_TOKEN. ' +
        'Any local process on this host can POST sessions under any ' +
        'teammate email. Safe for single-user laptops; on shared hosts ' +
        'set RIVEN_AUTH_TOKEN=<32 random bytes> and configure the ' +
        'upload daemon to send it.',
    );
  }
  // Resolve outputDir from env, with TeamBrain → Matrix-Riven legacy fallback.
  // If the env vars are unset, also fall back to the legacy default
  // (~/teamagent-collector) when that directory exists on disk — so a host
  // migrating off TeamBrain keeps reading from its existing data dir without
  // needing the operator to set an env var.
  const explicitDir = readEnvWithLegacy(
    env,
    'RIVEN_COLLECTOR_DIR',
    'TEAMAGENT_COLLECTOR_DIR',
  );
  const rivenDefault = join(home, 'riven-collector');
  const legacyDefault = join(home, 'teamagent-collector');
  const outputDir =
    explicitDir ??
    (existsSync(legacyDefault) && !existsSync(rivenDefault)
      ? legacyDefault
      : rivenDefault);

  // Optional token auth on the conversation-upload endpoint.
  const authToken =
    readEnvWithLegacy(env, 'RIVEN_AUTH_TOKEN', 'BPP_AUTH_TOKEN') ?? '';
  // M2 — optional TLS. Both key + cert paths must be set to serve over HTTPS;
  // a partial config is treated as plain HTTP so a half-finished deploy fails
  // loud (no cert) rather than silently downgrading.
  const httpsKeyPath = env.HTTPS_KEY_PATH;
  const httpsCertPath = env.HTTPS_CERT_PATH;
  const tls =
    httpsKeyPath && httpsCertPath
      ? { keyPath: httpsKeyPath, certPath: httpsCertPath }
      : undefined;

  // Comma-separated list of "main" project names. Used by the slacking
  // detector (signals/slacking.ts) to flag members whose recent work is
  // off the company's primary repos. Empty/unset = signal stays dormant.
  const mainProjects = (env.RIVEN_MAIN_PROJECTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const handle = await startMockServer({
    port,
    host,
    outputDir,
    authToken,
    tls,
    mainProjects,
  });
  log(`[riven-collector] listening on ${handle.url}`);
  log(`[riven-collector] outputDir = ${handle.outputDir}`);
  if (mainProjects.length > 0) {
    log(`[riven-collector] main projects: ${mainProjects.join(', ')}`);
  }
  if (authToken) log(`[riven-collector] token auth ENABLED (POST /v1/cc-sessions + all leadership routes)`);
  if (tls) log(`[riven-collector] TLS ENABLED (key=${tls.keyPath})`);
  deps.onReady?.({ url: handle.url, outputDir: handle.outputDir });

  return handle.close;
}

const argv1 = process.argv[1] ?? '';
if (argv1.includes('bin-prod-server')) {
  runProdServer()
    .then((close) => {
      const shutdown = (signal: string) => {
        process.stderr.write(`[riven-collector] ${signal} received — shutting down\n`);
        close()
          .then(() => process.exit(0))
          .catch((err) => {
            process.stderr.write(`shutdown error: ${String(err)}\n`);
            process.exit(1);
          });
      };
      process.on('SIGTERM', () => shutdown('SIGTERM'));
      process.on('SIGINT', () => shutdown('SIGINT'));
    })
    .catch((err) => {
      process.stderr.write(`[riven-collector] fatal: ${String(err)}\n`);
      process.exit(1);
    });
}
