import type { ParsedSession, ProjectPhase } from '../types.js';

const DEBUG_KEYWORDS = /bug|broken|error|why\s+(?:does|isn'?t|won'?t|doesn'?t)|fail/i;
const PLAN_KEYWORDS = /plan|design|spec|brainstorm/i;
const FILE_EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
const TEST_FILE_RE = /(\.test\.|\.spec\.|_test\.|\/__tests__\/)/i;
const MD_RE = /\.md$/i;
const RENAME_RE = /\b(mv|git\s+mv|rename)\b/i;

interface Counters {
  total: number;
  debug: number;
  plan: number;
  testEdits: number;
  srcEdits: number;
  mdEdits: number;
  rename: number;
  toolFails: number;
  toolTotal: number;
}

/** P7 — guess project phase from message keywords + tool patterns. */
export function guessPhase(sessions: ParsedSession[]): ProjectPhase {
  const c: Counters = { total: 0, debug: 0, plan: 0, testEdits: 0, srcEdits: 0, mdEdits: 0, rename: 0, toolFails: 0, toolTotal: 0 };
  for (const s of sessions) {
    for (const m of s.messages) {
      if (m.role === 'user') {
        c.total++;
        if (DEBUG_KEYWORDS.test(m.text)) c.debug++;
        if (PLAN_KEYWORDS.test(m.text)) c.plan++;
      }
      for (const tu of m.toolUses) {
        if (FILE_EDIT_TOOLS.has(tu.name)) {
          const fp = typeof tu.input.file_path === 'string' ? tu.input.file_path : '';
          if (TEST_FILE_RE.test(fp)) c.testEdits++;
          else if (MD_RE.test(fp)) c.mdEdits++;
          else c.srcEdits++;
        }
        if (tu.name === 'Bash') {
          const cmd = typeof tu.input.command === 'string' ? tu.input.command : '';
          if (RENAME_RE.test(cmd)) c.rename++;
        }
      }
      for (const tr of m.toolResults) {
        c.toolTotal++;
        if (tr.isError) c.toolFails++;
      }
    }
  }
  const totalEdits = c.testEdits + c.srcEdits + c.mdEdits;
  const failRate = c.toolTotal === 0 ? 0 : c.toolFails / c.toolTotal;
  const candidates: Array<{ p: ProjectPhase; weight: number }> = [];
  if (failRate > 0.2 || (c.total > 0 && c.debug / c.total > 0.3)) candidates.push({ p: 'debug', weight: Math.max(failRate, c.total > 0 ? c.debug / c.total : 0) });
  if (totalEdits > 0 && c.testEdits / totalEdits > 0.5) candidates.push({ p: 'test', weight: c.testEdits / totalEdits });
  if (totalEdits > 0 && c.mdEdits / totalEdits >= 0.5) candidates.push({ p: 'docs', weight: c.mdEdits / totalEdits });
  if (c.rename > 0 && c.rename >= c.srcEdits) candidates.push({ p: 'refactor', weight: c.rename / Math.max(1, c.rename + c.srcEdits) });
  if (c.total > 0 && c.plan / c.total > 0.4) candidates.push({ p: 'plan', weight: c.plan / c.total });

  if (candidates.length === 0) {
    return totalEdits > 0 ? 'implement' : 'mixed';
  }
  candidates.sort((a, b) => b.weight - a.weight);
  const top = candidates[0]!;
  if (top.weight < 0.4) return 'mixed';
  return top.p;
}
