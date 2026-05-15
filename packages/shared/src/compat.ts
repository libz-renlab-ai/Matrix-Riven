/**
 * Legacy-name compatibility shim.
 *
 * Matrix-Riven was extracted from the TeamBrain monorepo (see
 * `docs/superpowers/specs/2026-05-14-teambrain-log-upload-extraction-design.md`).
 * The extraction renamed the npm packages (`@teamagent/*` → `@matrix-riven/*`)
 * but kept the runtime namespace on `teamagent` / `TEAMAGENT_*` so that machines
 * migrating off TeamBrain could keep their existing `~/.teamagent/` queue,
 * config, and `machine-id` without a manual move.
 *
 * As of v0.2.0 the runtime namespace migrates to `riven` / `RIVEN_*`. This
 * module is the single place that knows about the legacy names — every other
 * source file reads env vars and paths through these helpers.
 *
 * Removal plan: legacy fallbacks emit a one-shot stderr deprecation line and
 * will be removed after one minor release.
 */

const _warnedKeys = new Set<string>();

/**
 * Read an env var by its canonical (new) name. If unset, fall back to any of
 * the provided legacy names in order, emitting a one-shot deprecation warning
 * to stderr the first time a legacy hit is observed in this process.
 *
 * Returns `undefined` only when neither the canonical nor any legacy name is
 * set. An empty-string value counts as "set" (matches `process.env` semantics).
 *
 * The `env` parameter is explicit so call sites that already accept an
 * injectable env (e.g. `bin-prod-server`) don't have to fall back to
 * `process.env` and so tests can pass a sealed env object.
 */
export function readEnvWithLegacy(
  env: NodeJS.ProcessEnv,
  canonical: string,
  ...legacy: string[]
): string | undefined {
  const direct = env[canonical];
  if (direct !== undefined && direct.length > 0) return direct;
  for (const old of legacy) {
    const v = env[old];
    if (v !== undefined && v.length > 0) {
      warnOnce(old, canonical);
      return v;
    }
  }
  return undefined;
}

function warnOnce(legacy: string, canonical: string): void {
  if (_warnedKeys.has(legacy)) return;
  _warnedKeys.add(legacy);
  // Best-effort: a failing stderr write must not block the daemon / hook.
  try {
    process.stderr.write(
      `[riven] DEPRECATED: env ${legacy} is renamed to ${canonical}; the legacy name will be removed in a future release\n`,
    );
  } catch {
    /* ignore */
  }
}

/**
 * Reset the one-shot warning cache. Intended for tests that exercise multiple
 * env-var-fallback scenarios in the same process.
 */
export function _resetDeprecationWarnings(): void {
  _warnedKeys.clear();
}
