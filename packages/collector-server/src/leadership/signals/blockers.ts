import type { ParsedSession } from '../types.js';

const REPEAT_EDIT_THRESHOLD = 5;
const HIGH_TOOL_FAILURE_RATE = 0.25;
const BLOCKER_MIN_SESSIONS = 3;
const BLOCKER_WINDOW_MS = 24 * 60 * 60 * 1000;
const OVERFLOW_MIN = 2;
const OVERFLOW_PATTERN = /OVER_200K/;

export interface DifficultyResult {
  isDifficult: boolean;
  hotFiles: string[];
  toolFailureRate: number;
}

export function detectDifficulty(session: ParsedSession): DifficultyResult {
  const editCounts = new Map<string, number>();
  let toolUses = 0;
  let toolFails = 0;

  for (const m of session.messages) {
    for (const tu of m.toolUses) {
      toolUses++;
      const editTools = new Set(['Edit', 'Write', 'MultiEdit', 'Read']);
      if (editTools.has(tu.name)) {
        const fp = typeof tu.input.file_path === 'string' ? tu.input.file_path : undefined;
        if (fp) editCounts.set(fp, (editCounts.get(fp) ?? 0) + 1);
      }
    }
    for (const tr of m.toolResults) {
      if (tr.isError) toolFails++;
    }
  }

  const totalResults = session.messages.reduce((a, m) => a + m.toolResults.length, 0);
  const toolFailureRate = totalResults === 0 ? 0 : toolFails / totalResults;

  const hotFiles: string[] = [];
  for (const [fp, count] of editCounts.entries()) {
    if (count >= REPEAT_EDIT_THRESHOLD) hotFiles.push(fp);
  }
  const isDifficult = hotFiles.length > 0 || toolFailureRate > HIGH_TOOL_FAILURE_RATE;
  return { isDifficult, hotFiles, toolFailureRate };
}

export interface BlockerResult {
  isBlocked: boolean;
  reasons: ('repeat_sessions_no_commit' | 'context_overflow')[];
}

export function detectBlocker(sessions: ParsedSession[], cwd: string, now: Date): BlockerResult {
  const reasons: BlockerResult['reasons'] = [];

  const windowStart = new Date(now.getTime() - BLOCKER_WINDOW_MS);
  const inCwd = sessions.filter(
    (s) => s.envelope.cwd === cwd && s.startTs >= windowStart && s.startTs <= now,
  );

  if (inCwd.length >= BLOCKER_MIN_SESSIONS) {
    const sawCommit = inCwd.some((s) =>
      s.messages.some((m) =>
        m.toolUses.some(
          (tu) =>
            tu.name === 'Bash' &&
            typeof tu.input.command === 'string' &&
            /git\s+commit/i.test(tu.input.command),
        ),
      ),
    );
    if (!sawCommit) reasons.push('repeat_sessions_no_commit');
  }

  let overflowCount = 0;
  for (const s of inCwd.length > 0 ? inCwd : sessions) {
    for (const m of s.messages) {
      if (m.role === 'user' && OVERFLOW_PATTERN.test(m.text)) overflowCount++;
    }
  }
  if (overflowCount >= OVERFLOW_MIN) reasons.push('context_overflow');

  return { isBlocked: reasons.length > 0, reasons };
}
