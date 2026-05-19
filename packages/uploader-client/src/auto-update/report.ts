/**
 * Best-effort POST of a single error report to the collector server. Never
 * throws. Used by the orchestrator on every terminal-error branch.
 */
import type { UpdateErrorReport } from './types.js';

const TIMEOUT_MS = 5_000;

export async function reportError(
  baseUrl: string,
  report: UpdateErrorReport,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<{ ok: boolean; detail?: string }> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/client-update-error`;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (resp.ok || resp.status === 202) return { ok: true };
    return { ok: false, detail: `HTTP ${resp.status}` };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
