import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CcStatusSnapshot } from '@matrix-riven/shared';
import type { RawSnapshots } from './types.js';

const CC_STATUS_SUFFIX = '.cc-status.jsonl';
const META_SUFFIX = '.meta.json';

/**
 * Walk `<outputDir>/<user>/<date>/` and pull out every cc-status snapshot
 * plus every `.meta.json` sidecar (the real production format written by
 * mock-server.ts on a successful cc-sessions upload). Pure I/O, no
 * aggregation. Bad rows / unreadable directories degrade gracefully (skip
 * + stderr line). Never throws — the caller's HTTP handler must stay
 * 200-able even when one user's data is corrupt.
 *
 * Sidecar contract: `<sid>.meta.json` carries `{ l1_redaction_count: n,
 * l2_redaction_count: n }`. The leadership view counts L1 only (member-side
 * pass), per spec §4.4 line 141 `Σ l1_redaction_count`.
 */
export function scanForOverview(outputDir: string, date: string): RawSnapshots {
  const allSnapshots: CcStatusSnapshot[] = [];
  const latestPerSession = new Map<string, CcStatusSnapshot>();
  const redactionsPerSession = new Map<string, number>();

  let userDirs: string[];
  try {
    userDirs = readdirSync(outputDir);
  } catch {
    return { allSnapshots, latestPerSession, redactionsPerSession };
  }

  for (const user of userDirs) {
    const dayDir = join(outputDir, user, date);
    if (!existsSync(dayDir)) continue;
    let files: string[];
    try {
      files = readdirSync(dayDir);
    } catch (err) {
      process.stderr.write(`[overview] skipping ${dayDir}: ${String(err)}\n`);
      continue;
    }
    for (const file of files) {
      const abs = join(dayDir, file);
      if (file.endsWith(CC_STATUS_SUFFIX)) {
        readCcStatusFile(abs, allSnapshots, latestPerSession);
      } else if (file.endsWith(META_SUFFIX)) {
        readRedactionMeta(abs, file, redactionsPerSession);
      }
    }
  }
  return { allSnapshots, latestPerSession, redactionsPerSession };
}

function readCcStatusFile(
  path: string,
  allSnapshots: CcStatusSnapshot[],
  latestPerSession: Map<string, CcStatusSnapshot>,
): void {
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch (err) {
    process.stderr.write(`[overview] cannot read ${path}: ${String(err)}\n`);
    return;
  }
  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isCcStatusSnapshot(parsed)) continue;
    allSnapshots.push(parsed);
    const prev = latestPerSession.get(parsed.session_id);
    if (!prev || parsed.ts > prev.ts) {
      latestPerSession.set(parsed.session_id, parsed);
    }
  }
}

function readRedactionMeta(
  path: string,
  filename: string,
  redactionsPerSession: Map<string, number>,
): void {
  const sid = filename.slice(0, -META_SUFFIX.length);
  if (sid.length === 0) return;
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (typeof parsed !== 'object' || parsed === null) return;
  const l1 = (parsed as { l1_redaction_count?: unknown }).l1_redaction_count;
  if (typeof l1 === 'number' && Number.isFinite(l1) && l1 >= 0) {
    redactionsPerSession.set(sid, l1);
  }
}

function isCcStatusSnapshot(v: unknown): v is CcStatusSnapshot {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.session_id === 'string' &&
    typeof o.user_id === 'string' &&
    typeof o.ts === 'string' &&
    typeof o.event === 'string'
  );
}
