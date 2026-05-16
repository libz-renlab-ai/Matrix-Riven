import type { ParsedSession } from '../types.js';

/**
 * #4 — help-needed detector.
 *
 * Two independent triggers (any one flags):
 *   (a) user-message text matches the help-keyword regex below
 *   (b) WebSearch/WebFetch usage rate exceeds 2× team average
 *
 * Keywords are scanned ONLY in messages with role==='user' and only the `.text`
 * field — to avoid false positives from the assistant echoing the words.
 * The regex uses negative lookahead to exclude `不会议` (a false-positive compound).
 */
const HELP_KEYWORDS = /卡住|不会(?!议)|为什么[\s\S]{0,8}不|help[\s,!?]|stuck|求助|救命|怎么办/gi;

export interface HelpNeededResult {
  isNeeded: boolean;
  keywordHits: string[];
  webSearchRatio: number;
}

export function detectHelpNeeded(
  sessions: ParsedSession[],
  teamAvgWebSearch: number,
): HelpNeededResult {
  const keywordHits: string[] = [];
  let webCalls = 0;

  for (const s of sessions) {
    for (const m of s.messages) {
      if (m.role === 'user') {
        // reset lastIndex each iteration (global flag)
        HELP_KEYWORDS.lastIndex = 0;
        const matches = m.text.matchAll(HELP_KEYWORDS);
        for (const match of matches) keywordHits.push(match[0]);
      }
      for (const tu of m.toolUses) {
        if (tu.name === 'WebSearch' || tu.name === 'WebFetch') webCalls++;
      }
    }
  }

  const denom = teamAvgWebSearch > 0 ? teamAvgWebSearch : 1;
  const webSearchRatio = webCalls / denom / Math.max(1, sessions.length);
  // Note: ratio normalized per session, then divided by team-avg-per-session.

  const isNeeded = keywordHits.length > 0 || webSearchRatio > 2;
  return { isNeeded, keywordHits, webSearchRatio };
}
