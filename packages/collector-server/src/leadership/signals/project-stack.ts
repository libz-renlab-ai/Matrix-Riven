import type { ParsedSession } from '../types.js';
const FILE_EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
const TEST_FILE_RE = /(\.test\.|\.spec\.|_test\.|\/__tests__\/)/i;

/** P6 — extension mix (lowercased) by edit count, share of total. */
export function computeExtensionMix(sessions: ParsedSession[]): Record<string, number> {
  const counts = new Map<string, number>();
  let total = 0;
  for (const s of sessions) {
    for (const m of s.messages) {
      for (const tu of m.toolUses) {
        if (!FILE_EDIT_TOOLS.has(tu.name)) continue;
        const fp = typeof tu.input.file_path === 'string' ? tu.input.file_path : undefined;
        if (!fp) continue;
        const dot = fp.lastIndexOf('.');
        const slash = Math.max(fp.lastIndexOf('/'), fp.lastIndexOf('\\'));
        const ext = dot > slash ? fp.slice(dot).toLowerCase() : '<none>';
        counts.set(ext, (counts.get(ext) ?? 0) + 1);
        total++;
      }
    }
  }
  if (total === 0) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of counts.entries()) out[k] = Math.round((v / total) * 1000) / 1000;
  return out;
}

/** P8 — testRatio = edits to test files / edits to non-test files (including 0/0=0). */
export function computeTestRatio(sessions: ParsedSession[]): number {
  let testEdits = 0;
  let srcEdits = 0;
  for (const s of sessions) {
    for (const m of s.messages) {
      for (const tu of m.toolUses) {
        if (!FILE_EDIT_TOOLS.has(tu.name)) continue;
        const fp = typeof tu.input.file_path === 'string' ? tu.input.file_path : undefined;
        if (!fp) continue;
        if (TEST_FILE_RE.test(fp)) testEdits++;
        else srcEdits++;
      }
    }
  }
  if (srcEdits === 0) return testEdits === 0 ? 0 : Number.POSITIVE_INFINITY;
  return Math.round((testEdits / srcEdits) * 1000) / 1000;
}
