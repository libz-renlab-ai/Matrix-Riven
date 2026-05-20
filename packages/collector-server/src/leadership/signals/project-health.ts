import type { ParsedSession, Milestone } from '../types.js';

const OVERFLOW_PATTERN = /OVER_200K/;
const FILE_EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
const REPEAT_EDIT_THRESHOLD = 5;

/**
 * P9 — composite health score, 0..10. Starts at 10, subtracts:
 *   - tool failure rate × 10  (cap 6)
 *   - context_overflow count  (cap 3)
 *   - hot-file count          (cap 3)
 * Then clamps to [0, 10] and rounds to 1 decimal.
 */
export function computeHealthScore(sessions: ParsedSession[]): number {
  let toolTotal = 0;
  let toolFails = 0;
  let overflow = 0;
  const editCounts = new Map<string, number>();

  for (const s of sessions) {
    for (const m of s.messages) {
      if (m.role === 'user' && OVERFLOW_PATTERN.test(m.text)) overflow++;
      for (const tu of m.toolUses) {
        if (FILE_EDIT_TOOLS.has(tu.name)) {
          const fp = typeof tu.input.file_path === 'string' ? tu.input.file_path : undefined;
          if (fp) editCounts.set(fp, (editCounts.get(fp) ?? 0) + 1);
        }
      }
      for (const tr of m.toolResults) {
        toolTotal++;
        if (tr.isError) toolFails++;
      }
    }
  }

  const failRate = toolTotal === 0 ? 0 : toolFails / toolTotal;
  let hotFiles = 0;
  for (const cnt of editCounts.values()) if (cnt >= REPEAT_EDIT_THRESHOLD) hotFiles++;

  const penalty = Math.min(6, failRate * 10) + Math.min(3, overflow) + Math.min(3, hotFiles);
  const score = Math.max(0, Math.min(10, 10 - penalty));
  return Math.round(score * 10) / 10;
}

/**
 * P10 — extract milestone events from bash invocations:
 *   commit, push, gh pr create, npm publish, git tag
 */
const PATTERNS: Array<{ key: Milestone['type']; re: RegExp; descLabel: string }> = [
  { key: 'commit',  re: /\bgit\s+commit\b/i,                          descLabel: 'git commit' },
  { key: 'push',    re: /\bgit\s+push\b/i,                            descLabel: 'git push' },
  { key: 'pr',      re: /\bgh\s+pr\s+create\b/i,                      descLabel: 'gh pr create' },
  { key: 'release', re: /\bnpm\s+publish\b|\bpnpm\s+publish\b/i,      descLabel: 'publish' },
  { key: 'tag',     re: /\bgit\s+tag\b/i,                             descLabel: 'git tag' },
];

export function extractMilestones(sessions: ParsedSession[]): Milestone[] {
  const out: Milestone[] = [];
  for (const s of sessions) {
    for (const m of s.messages) {
      for (const tu of m.toolUses) {
        if (tu.name !== 'Bash') continue;
        const cmd = typeof tu.input.command === 'string' ? tu.input.command : '';
        for (const { key, re, descLabel } of PATTERNS) {
          if (re.test(cmd)) {
            out.push({
              ts: (m.ts ?? s.startTs).toISOString(),
              type: key,
              by: s.envelope.userId,
              detail: cmd.length > 200 ? cmd.slice(0, 200) + '…' : cmd,
            });
            // Use descLabel only to avoid TS unused warning
            void descLabel;
          }
        }
      }
    }
  }
  out.sort((a, b) => a.ts.localeCompare(b.ts));
  return out;
}
