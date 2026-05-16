/**
 * Leadership dashboard route handlers.
 *
 * Exports `handleLeadershipRequest` — a boolean-returning dispatcher that
 * returns `true` when the URL matched a leadership route (caller stops
 * dispatch) and `false` when the route is unrecognised (caller falls through
 * to its own handlers).
 *
 * Endpoints:
 *   GET /api/overview[?range=7d|24h|today|30d]  → OverviewSnapshot JSON
 *   GET /api/members/:emailLocalPart             → MemberSnapshot + detail JSON
 *   GET /api/projects/:name                      → ProjectSnapshot + detail JSON
 *   GET /overview                                → HTML placeholder
 *   GET /members/:id                             → HTML placeholder
 *   GET /projects/:name                          → HTML placeholder
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { readdirSync } from 'node:fs';
import type { TtlCache } from './cache.js';
import type { DateRange } from './types.js';
import {
  buildOverviewSnapshot,
  buildMemberDetail,
  buildProjectDetail,
} from './aggregator.js';
import { renderOverview } from './views/overview.html.js';
import { renderMemberDetail } from './views/member-detail.html.js';
import { renderProjectDetail } from './views/project-detail.html.js';
import { LEADERSHIP_CSS } from './views/styles.css.js';

// ── public interface ──────────────────────────────────────────────────────────

export interface LeadershipRouteDeps {
  collectorDir: string;
  /** Shared TTL cache — keyed as `${pathname}|${range}`. */
  cache: TtlCache<unknown>;
  /** Clock override for tests. Defaults to `() => new Date()`. */
  now?: () => Date;
  /** Project names treated as "main" for slacking detection. */
  mainProjects?: string[];
}

/**
 * Dispatch a single HTTP request to the leadership route handlers.
 *
 * @returns `true` if the request was handled (caller should stop dispatch).
 * @returns `false` if the URL does not match a leadership route.
 */
export function handleLeadershipRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: LeadershipRouteDeps,
): boolean {
  const now = deps.now ?? (() => new Date());
  const rawUrl = req.url ?? '/';
  const qIdx = rawUrl.indexOf('?');
  const pathname = qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl;
  const query = qIdx >= 0 ? new URLSearchParams(rawUrl.slice(qIdx + 1)) : new URLSearchParams();

  // ── API routes ──────────────────────────────────────────────────────────────

  if (pathname === '/api/overview') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    const rangeStr = query.get('range') ?? undefined;
    const nowDate = now();
    const range = parseRange(rangeStr, nowDate);
    const cacheKey = `/api/overview|${range.label}`;
    const cached = deps.cache.get(cacheKey);
    if (cached !== undefined) {
      sendJson(res, 200, cached);
      return true;
    }
    try {
      const snap = buildOverviewSnapshot({
        collectorDir: deps.collectorDir,
        range,
        now: nowDate,
        mainProjects: deps.mainProjects,
      });
      deps.cache.set(cacheKey, snap);
      sendJson(res, 200, snap);
    } catch {
      sendJson(res, 500, { error: 'internal' });
    }
    return true;
  }

  // GET /api/members/:emailLocalPart
  const membersApiMatch = /^\/api\/members\/([^/]+)$/.exec(pathname);
  if (membersApiMatch) {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    const localPart = decodeURIComponent(membersApiMatch[1]!);
    const rangeStr = query.get('range') ?? undefined;
    const nowDate = now();
    const range = parseRange(rangeStr, nowDate);
    const cacheKey = `/api/members/${localPart}|${range.label}`;
    const cached = deps.cache.get(cacheKey);
    if (cached !== undefined) {
      sendJson(res, 200, cached);
      return true;
    }
    // Resolve local-part → full email by scanning collector dir
    const email = resolveEmailByLocalPart(deps.collectorDir, localPart);
    if (!email) {
      sendJson(res, 404, { error: 'not_found' });
      return true;
    }
    try {
      const detail = buildMemberDetail({
        collectorDir: deps.collectorDir,
        email,
        range,
        now: nowDate,
        mainProjects: deps.mainProjects,
      });
      if (!detail) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }
      deps.cache.set(cacheKey, detail);
      sendJson(res, 200, detail);
    } catch {
      sendJson(res, 500, { error: 'internal' });
    }
    return true;
  }

  // GET /api/projects/:name
  const projectsApiMatch = /^\/api\/projects\/([^/]+)$/.exec(pathname);
  if (projectsApiMatch) {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    const projectName = decodeURIComponent(projectsApiMatch[1]!);
    const rangeStr = query.get('range') ?? undefined;
    const nowDate = now();
    const range = parseRange(rangeStr, nowDate);
    const cacheKey = `/api/projects/${projectName}|${range.label}`;
    const cached = deps.cache.get(cacheKey);
    if (cached !== undefined) {
      sendJson(res, 200, cached);
      return true;
    }
    try {
      const detail = buildProjectDetail({
        collectorDir: deps.collectorDir,
        projectName,
        range,
        now: nowDate,
      });
      if (!detail) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }
      deps.cache.set(cacheKey, detail);
      sendJson(res, 200, detail);
    } catch {
      sendJson(res, 500, { error: 'internal' });
    }
    return true;
  }

  // ── HTML routes ─────────────────────────────────────────────────────────────

  if (pathname === '/overview') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    const rangeStr = query.get('range') ?? undefined;
    const nowDate = now();
    const range = parseRange(rangeStr, nowDate);
    const cacheKey = `html|${pathname}|${range.label}`;
    const cached = deps.cache.get(cacheKey);
    if (cached !== undefined) {
      sendHtml(res, 200, cached as string);
      return true;
    }
    try {
      const snap = buildOverviewSnapshot({
        collectorDir: deps.collectorDir,
        range,
        now: nowDate,
        mainProjects: deps.mainProjects,
      });
      const html = renderOverview(snap);
      deps.cache.set(cacheKey, html);
      sendHtml(res, 200, html);
    } catch {
      sendHtml(res, 500, render404('Overview (server error)'));
    }
    return true;
  }

  const membersHtmlMatch = /^\/members\/([^/]+)$/.exec(pathname);
  if (membersHtmlMatch) {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    const localPart = decodeURIComponent(membersHtmlMatch[1]!);
    const rangeStr = query.get('range') ?? undefined;
    const nowDate = now();
    const range = parseRange(rangeStr, nowDate);
    const cacheKey = `html|${pathname}|${range.label}`;
    const cached = deps.cache.get(cacheKey);
    if (cached !== undefined) {
      sendHtml(res, 200, cached as string);
      return true;
    }
    const email = resolveEmailByLocalPart(deps.collectorDir, localPart);
    if (!email) {
      sendHtml(res, 404, render404(`成员 ${localPart}`));
      return true;
    }
    try {
      const detail = buildMemberDetail({
        collectorDir: deps.collectorDir,
        email,
        range,
        now: nowDate,
        mainProjects: deps.mainProjects,
      });
      if (!detail) {
        sendHtml(res, 404, render404(`成员 ${localPart}`));
        return true;
      }
      const html = renderMemberDetail(detail);
      deps.cache.set(cacheKey, html);
      sendHtml(res, 200, html);
    } catch {
      sendHtml(res, 500, render404(`成员 ${localPart} (server error)`));
    }
    return true;
  }

  const projectsHtmlMatch = /^\/projects\/([^/]+)$/.exec(pathname);
  if (projectsHtmlMatch) {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    const projectName = decodeURIComponent(projectsHtmlMatch[1]!);
    const rangeStr = query.get('range') ?? undefined;
    const nowDate = now();
    const range = parseRange(rangeStr, nowDate);
    const cacheKey = `html|${pathname}|${range.label}`;
    const cached = deps.cache.get(cacheKey);
    if (cached !== undefined) {
      sendHtml(res, 200, cached as string);
      return true;
    }
    try {
      const detail = buildProjectDetail({
        collectorDir: deps.collectorDir,
        projectName,
        range,
        now: nowDate,
      });
      if (!detail) {
        sendHtml(res, 404, render404(`项目 ${projectName}`));
        return true;
      }
      const html = renderProjectDetail(detail);
      deps.cache.set(cacheKey, html);
      sendHtml(res, 200, html);
    } catch {
      sendHtml(res, 500, render404(`项目 ${projectName} (server error)`));
    }
    return true;
  }

  // Not a leadership route — tell caller to continue dispatch.
  return false;
}

// ── internal helpers ──────────────────────────────────────────────────────────

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', Buffer.byteLength(json));
  res.end(json);
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.statusCode = status;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('content-length', Buffer.byteLength(html));
  res.end(html);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function render404(what: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>404</title><style>${LEADERSHIP_CSS}</style></head><body><div class="lh-container"><div class="lh-empty">${escapeHtml(what)} 不存在<br><a href="/overview">← Overview</a></div></div></body></html>`;
}

/**
 * Scan `collectorDir` for user directories whose email's local-part (before @)
 * matches `localPart`. Returns the first match (alphabetical order) or null.
 *
 * Collector layout: `<collectorDir>/<email>/<date>/<sid>.json`
 */
function resolveEmailByLocalPart(collectorDir: string, localPart: string): string | null {
  let dirs: string[];
  try {
    dirs = readdirSync(collectorDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return null;
  }
  for (const name of dirs) {
    // name is expected to be an email address like "alice@example.com"
    const atIdx = name.indexOf('@');
    const lp = atIdx >= 0 ? name.slice(0, atIdx) : name;
    if (lp === localPart) return name;
  }
  return null;
}

/**
 * Parse the `range` query parameter into a `DateRange`.
 * Defaults to `7d` for unknown / missing values.
 */
function parseRange(rangeStr: string | undefined, now: Date): DateRange {
  const end = new Date(now);
  let start: Date;
  let label: string;
  switch (rangeStr) {
    case 'today':
      start = new Date(now);
      start.setUTCHours(0, 0, 0, 0);
      label = 'today';
      break;
    case '24h':
      start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      label = '24h';
      break;
    case '30d':
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      label = '30d';
      break;
    case '7d':
    default:
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      label = '7d';
  }
  return { start, end, label };
}
