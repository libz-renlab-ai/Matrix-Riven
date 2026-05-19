/**
 * Append a single line to ~/.riven/digital-twin/auto-update.log, with a
 * cheap "keep at most last N lines" rotation. Best-effort; never throws.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';

const KEEP_LINES = 200;
const ROTATE_THRESHOLD = 1000;

export function appendLog(file: string, line: string): void {
  const stamped = `[${new Date().toISOString()}] ${line.replace(/\n/g, ' ')}\n`;
  try {
    appendFileSync(file, stamped, 'utf8');
  } catch {
    // ignore — log is opportunistic
    return;
  }
  // Cheap line count check
  try {
    const stat = readFileSync(file, 'utf8');
    const lineCount = stat.split('\n').length;
    if (lineCount > ROTATE_THRESHOLD) {
      const tail = stat.split('\n').slice(-KEEP_LINES).join('\n');
      const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
      writeFileSync(tmp, tail, 'utf8');
      try {
        renameSync(tmp, file);
      } catch {
        try {
          unlinkSync(file);
        } catch {}
        try {
          renameSync(tmp, file);
        } catch {}
      }
    }
  } catch {
    // ignore
  }
}
