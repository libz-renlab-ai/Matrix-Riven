import type { ParsedSession, ProjectState } from '../types.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** P1, P11 — classify project state based on recent sessions. */
export function classifyProject(sessions: ParsedSession[], now: Date): ProjectState {
  const windowStart = new Date(now.getTime() - SEVEN_DAYS_MS);
  const recent = sessions.filter((s) => s.startTs >= windowStart && s.startTs <= now);
  const earlier = sessions.filter((s) => s.startTs < windowStart);

  if (recent.length >= 5) {
    // revived if it had 0 activity in the prior 7 days but >0 in the trailing 14
    const priorWindowStart = new Date(windowStart.getTime() - SEVEN_DAYS_MS);
    const prior = earlier.filter((s) => s.startTs >= priorWindowStart);
    if (prior.length === 0 && earlier.length > 0) return 'revived';
    return 'active';
  }
  if (recent.length >= 1) return 'maintaining';
  return 'dormant';
}

/** P2 — distinct files touched (read/edited/written/grepped) by Edit/Write/MultiEdit/Read tools. */
export function getRecentFiles(sessions: ParsedSession[]): string[] {
  const tools = new Set(['Edit', 'Write', 'MultiEdit', 'Read']);
  const files = new Set<string>();
  for (const s of sessions) {
    for (const m of s.messages) {
      for (const tu of m.toolUses) {
        if (!tools.has(tu.name)) continue;
        const fp = typeof tu.input.file_path === 'string' ? tu.input.file_path : undefined;
        if (fp) files.add(fp);
      }
    }
  }
  return [...files].sort();
}
