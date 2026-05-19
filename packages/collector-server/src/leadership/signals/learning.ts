import type { ParsedSession } from '../types.js';

/** #18a — count WebSearch + WebFetch tool calls across sessions. */
export function computeWebResearch(sessions: ParsedSession[]): number {
  let n = 0;
  for (const s of sessions) {
    for (const m of s.messages) {
      for (const tu of m.toolUses) {
        if (tu.name === 'WebSearch' || tu.name === 'WebFetch') n++;
      }
    }
  }
  return n;
}

/** #18b — count of file extensions/dirs newly seen in `current` vs `historical`. */
export function computeNewSurfaceCount(
  current: ParsedSession[],
  historical: ParsedSession[],
): number {
  const collectExts = (sx: ParsedSession[]): Set<string> => {
    const set = new Set<string>();
    for (const s of sx) {
      for (const m of s.messages) {
        for (const tu of m.toolUses) {
          const fp = typeof tu.input.file_path === 'string' ? tu.input.file_path : undefined;
          if (!fp) continue;
          const dot = fp.lastIndexOf('.');
          const slash = Math.max(fp.lastIndexOf('/'), fp.lastIndexOf('\\'));
          if (dot > slash) set.add(fp.slice(dot).toLowerCase());
        }
      }
    }
    return set;
  };
  const cur = collectExts(current);
  const past = collectExts(historical);
  let novel = 0;
  for (const e of cur) if (!past.has(e)) novel++;
  return novel;
}
