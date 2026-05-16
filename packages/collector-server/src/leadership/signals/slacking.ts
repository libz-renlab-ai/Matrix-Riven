import type { ParsedSession } from '../types.js';

const LOW_TOKEN_FRACTION = 0.3;

export interface SlackingResult {
  isLow: boolean;
  reasons: ('low_tokens' | 'no_work_hour_activity' | 'non_main_project_only')[];
}

export function detectLowActivity(
  sessions: ParsedSession[],
  teamMedian7dTokens: number,
  opts: { mainProjects: string[] },
): SlackingResult {
  const totalTokens = sessions.reduce((a, s) => a + s.tokens.input + s.tokens.output, 0);
  const lowTokens = teamMedian7dTokens > 0 && totalTokens < LOW_TOKEN_FRACTION * teamMedian7dTokens;

  const cstOffsetMs = 8 * 60 * 60 * 1000;
  const inWorkHours = sessions.some((s) => {
    const cst = new Date(s.startTs.getTime() + cstOffsetMs);
    const h = cst.getUTCHours();
    return h >= 9 && h < 18;
  });

  const main = new Set(opts.mainProjects.map((p) => p.toLowerCase()));
  const nonMainOnly =
    sessions.length > 0 && sessions.every((s) => !main.has(s.envelope.projectName.toLowerCase()));

  const reasons: SlackingResult['reasons'] = [];
  if (lowTokens) reasons.push('low_tokens');
  if (!inWorkHours && sessions.length > 0) reasons.push('no_work_hour_activity');
  if (nonMainOnly) reasons.push('non_main_project_only');

  const isLow = lowTokens && nonMainOnly && !inWorkHours;
  return { isLow, reasons };
}
