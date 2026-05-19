/**
 * Spawn the freshly-replaced bin-uploader with `RIVEN_UPLOADER_DRYRUN=1` and
 * confirm it exits cleanly with "dry-run OK" in stdout/stderr. Catches a
 * broken bundle BEFORE we kill the live daemon.
 *
 * Hard 10s timeout: the dry-run path resolves imports, parses config, and
 * exits — it should complete in <1s. If it doesn't, treat as broken.
 */
import { spawn } from 'node:child_process';

export interface ProbeResult {
  ok: boolean;
  detail?: string;
}

const PROBE_TIMEOUT_MS = 10_000;
const EXPECTED_MARKER = 'dry-run OK';

export async function probeUploader(uploaderPath: string): Promise<ProbeResult> {
  return new Promise<ProbeResult>((resolve) => {
    const child = spawn(process.execPath, ['--no-warnings', uploaderPath], {
      env: { ...process.env, RIVEN_UPLOADER_DRYRUN: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {}
      resolve({ ok: false, detail: `probe timeout after ${PROBE_TIMEOUT_MS}ms; stdout=${out.slice(-200)} stderr=${err.slice(-200)}` });
    }, PROBE_TIMEOUT_MS);
    child.stdout?.on('data', (b: Buffer) => {
      out += b.toString('utf8');
    });
    child.stderr?.on('data', (b: Buffer) => {
      err += b.toString('utf8');
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, detail: `spawn error: ${e.message}` });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      const combined = out + err;
      if (code !== 0) {
        resolve({ ok: false, detail: `probe exited ${code}; stdout=${out.slice(-200)} stderr=${err.slice(-200)}` });
        return;
      }
      if (!combined.includes(EXPECTED_MARKER)) {
        resolve({ ok: false, detail: `probe exited 0 but did not print "${EXPECTED_MARKER}"; output=${combined.slice(-200)}` });
        return;
      }
      resolve({ ok: true });
    });
  });
}
