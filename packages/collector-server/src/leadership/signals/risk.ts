import type { ParsedSession, RiskyAction } from '../types.js';

const PATTERNS: Array<{ key: RiskyAction['pattern']; re: RegExp }> = [
  { key: 'rm -rf',       re: /\brm\s+-rf\b/i },
  { key: 'force push',   re: /\bgit\s+push\s+(?:-f\b|--force\b)/i },
  { key: 'reset --hard', re: /\bgit\s+reset\s+--hard\b/i },
  { key: 'drop table',   re: /\bDROP\s+TABLE\b/i },
];

/** #14 — extract risky actions from bash invocations in the given sessions. */
export function extractRiskyActions(sessions: ParsedSession[]): RiskyAction[] {
  const out: RiskyAction[] = [];
  for (const s of sessions) {
    for (const m of s.messages) {
      for (const tu of m.toolUses) {
        if (tu.name !== 'Bash') continue;
        const cmd = typeof tu.input.command === 'string' ? tu.input.command : '';
        for (const { key, re } of PATTERNS) {
          if (re.test(cmd)) {
            out.push({
              ts: (m.ts ?? s.startTs).toISOString(),
              sessionId: s.envelope.sessionId,
              pattern: key,
              snippet: cmd.length > 200 ? cmd.slice(0, 200) + '…' : cmd,
            });
          }
        }
      }
    }
  }
  return out;
}

/** #15 — sum of l1_redaction_count across sessions. */
export function sumRedactions(sessions: ParsedSession[]): number {
  return sessions.reduce((a, s) => a + s.l1RedactionCount, 0);
}
