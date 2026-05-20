import type { ParsedSession, CollabHit } from '../types.js';

const FILE_EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

/**
 * #5 — collaboration hit: a file edited by ≥2 distinct user emails in the
 * window. Returns one CollabHit per such file, with lastTouched = most
 * recent ts among contributors.
 */
export function detectCollabHits(allSessions: ParsedSession[]): CollabHit[] {
  // filePath → { users: Set<string>, lastTs: Date }
  const map = new Map<string, { users: Set<string>; lastTs: Date }>();

  for (const s of allSessions) {
    const user = s.envelope.userId;
    for (const m of s.messages) {
      for (const tu of m.toolUses) {
        if (!FILE_EDIT_TOOLS.has(tu.name)) continue;
        const fp = typeof tu.input.file_path === 'string' ? tu.input.file_path : undefined;
        if (!fp) continue;
        const entry = map.get(fp) ?? { users: new Set<string>(), lastTs: new Date(0) };
        entry.users.add(user);
        const ts = m.ts ?? s.startTs;
        if (ts > entry.lastTs) entry.lastTs = ts;
        map.set(fp, entry);
      }
    }
  }

  const hits: CollabHit[] = [];
  for (const [filePath, entry] of map.entries()) {
    if (entry.users.size >= 2) {
      hits.push({
        filePath,
        members: Array.from(entry.users),
        lastTouched: entry.lastTs.toISOString(),
      });
    }
  }
  // Sort newest lastTouched first for stable, useful default order
  hits.sort((a, b) => b.lastTouched.localeCompare(a.lastTouched));
  return hits;
}
