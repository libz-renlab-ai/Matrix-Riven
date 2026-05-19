/**
 * Local manifest read/write + the "double gate" decision: only update when
 * remote.version differs AND remote.generated_at is strictly newer. This
 * protects against an operator typo that drops the version string back to an
 * earlier value — without the timestamp gate, every client would dutifully
 * "update" to a downgrade.
 */
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { CLIENT_BIN_WHITELIST, type ClientManifest, type ClientManifestFile } from './types.js';

export type UpdateDecision =
  | { update: true }
  | { update: false; reason: 'no-local'; advice: 'install fresh — proceed' }
  | { update: false; reason: 'same-version' }
  | { update: false; reason: 'disabled'; note?: string }
  | {
      update: false;
      reason: 'manifest-suspicious';
      detail: { remoteVersion: string; localVersion: string; remoteTs: number; localTs: number };
    };

export function validateManifest(raw: unknown): ClientManifest | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.version !== 'string' || o.version.length === 0 || o.version.length > 256) return null;
  if (typeof o.generated_at !== 'string') return null;
  if (Number.isNaN(Date.parse(o.generated_at))) return null;
  if (!Array.isArray(o.files)) return null;
  const files: ClientManifestFile[] = [];
  for (const f of o.files) {
    if (typeof f !== 'object' || f === null) return null;
    const ff = f as Record<string, unknown>;
    if (
      typeof ff.name !== 'string' ||
      !(CLIENT_BIN_WHITELIST as readonly string[]).includes(ff.name)
    ) {
      return null;
    }
    if (typeof ff.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(ff.sha256)) return null;
    if (typeof ff.size !== 'number' || !Number.isFinite(ff.size) || ff.size < 0 || ff.size > 100 * 1024 * 1024) return null;
    files.push({
      name: ff.name as ClientManifestFile['name'],
      sha256: ff.sha256,
      size: ff.size,
    });
  }
  const result: ClientManifest = { version: o.version, generated_at: o.generated_at, files };
  if (typeof o.disabled === 'boolean') result.disabled = o.disabled;
  if (typeof o.note === 'string' && o.note.length > 0) result.note = o.note.slice(0, 256);
  return result;
}

export function readLocalManifest(path: string): ClientManifest | null {
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  try {
    return validateManifest(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Atomic write via tmp file + rename. Same pattern used in install-client.mjs
 * for cross-platform safety on Windows where rename-over-existing can fail
 * on some FS configurations.
 */
export function writeLocalManifest(path: string, manifest: ClientManifest): void {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  try {
    renameSync(tmp, path);
  } catch {
    try {
      unlinkSync(path);
    } catch {
      // target may not exist
    }
    renameSync(tmp, path);
  }
}

/**
 * Decide whether to apply the remote manifest.
 *
 * Double-gate logic:
 *   - First update (no local) → install.
 *   - Same version → skip.
 *   - Different version + remote.generated_at > local.generated_at → update.
 *   - Different version + remote.generated_at <= local.generated_at →
 *     SUSPICIOUS — operator likely fat-fingered the version string, refuse
 *     and report.
 */
export function shouldUpdate(
  local: ClientManifest | null,
  remote: ClientManifest,
): UpdateDecision {
  // Kill-switch (operator-set) takes priority over every other gate. Even a
  // brand-new install respects it — preventing first-time machines from
  // pulling a known-bad release during the kill window.
  if (remote.disabled === true) {
    return { update: false, reason: 'disabled', ...(remote.note ? { note: remote.note } : {}) };
  }
  if (local === null) {
    return { update: false, reason: 'no-local', advice: 'install fresh — proceed' };
  }
  if (local.version === remote.version) {
    return { update: false, reason: 'same-version' };
  }
  const remoteTs = Date.parse(remote.generated_at);
  const localTs = Date.parse(local.generated_at);
  if (!(remoteTs > localTs)) {
    return {
      update: false,
      reason: 'manifest-suspicious',
      detail: {
        remoteVersion: remote.version,
        localVersion: local.version,
        remoteTs: Number.isFinite(remoteTs) ? remoteTs : 0,
        localTs: Number.isFinite(localTs) ? localTs : 0,
      },
    };
  }
  return { update: true };
}
