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
 *   GET /api/members/:emailLocalPart             → MemberSnapshot + detail + _html JSON
 *   GET /api/projects/:name                      → ProjectSnapshot + detail + _html JSON
 *   GET /overview                                → HTML page (Overview tab)
 *   GET /members/:id                             → 301 → /people (P-B6: retired)
 *   GET /projects/:name                          → 301 → /projects (P-B6: retired)
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
import {
  renderMemberSlideoverFragments,
  renderProjectSlideoverFragments,
} from './views/_slideover.html.js';
import { renderNav, type ActiveTab } from './views/_nav.html.js';
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
      // P-B6: enrich the API response with pre-rendered slide-over fragments
      // so the client can swap them in without a second round-trip.
      const _html = renderMemberSlideoverFragments(detail, detail.detail);
      const payload = { ...detail, _html };
      deps.cache.set(cacheKey, payload);
      sendJson(res, 200, payload);
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
      // P-B6: enrich the API response with pre-rendered slide-over fragments.
      const _html = renderProjectSlideoverFragments(detail, detail.detail);
      const payload = { ...detail, _html };
      deps.cache.set(cacheKey, payload);
      sendJson(res, 200, payload);
    } catch {
      sendJson(res, 500, { error: 'internal' });
    }
    return true;
  }

  // ── HTML routes ─────────────────────────────────────────────────────────────

  // P-B2: GET / falls through to the Overview tab UNLESS the URL carries a
  // `?sid=` query — in which case we defer to the Phase-1 dashboard (handled
  // by the outer dispatcher via `dashboard-html.ts`). The P-A4 "查看 raw ↗"
  // link relies on `/?sid=<...>` reaching that legacy page.
  if (pathname === '/' && req.method === 'GET') {
    if (query.has('sid')) {
      // Not ours — let the outer dispatcher serve the Phase-1 dashboard.
      return false;
    }
    return renderOverviewTab(req, res, deps, query, now);
  }

  if (pathname === '/overview') {
    return renderOverviewTab(req, res, deps, query, now);
  }

  // P-B2: stub tab routes — render the shared frosted nav with a "尚未实现"
  // placeholder. Inner content lands in Phase 3.
  if (pathname === '/people' && req.method === 'GET') {
    sendHtml(res, 200, renderStubTab('people', 'People'));
    return true;
  }
  if (pathname === '/projects' && req.method === 'GET') {
    sendHtml(res, 200, renderStubTab('projects', 'Projects'));
    return true;
  }
  if (pathname === '/activity' && req.method === 'GET') {
    sendHtml(res, 200, renderStubTab('activity', 'Activity'));
    return true;
  }
  if (pathname === '/insights' && req.method === 'GET') {
    sendHtml(res, 200, renderStubTab('insights', 'Insights'));
    return true;
  }

  // P-B6: full-page detail routes retired. The drawer is now mounted in the
  // Overview shell and populated via /api/members/:id and /api/projects/:name.
  // Anyone still hitting the old URLs (bookmarks, stale links) is redirected
  // to the corresponding tab.
  const membersHtmlMatch = /^\/members\/([^/]+)$/.exec(pathname);
  if (membersHtmlMatch) {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    sendRedirect(res, 301, '/people');
    return true;
  }

  const projectsHtmlMatch = /^\/projects\/([^/]+)$/.exec(pathname);
  if (projectsHtmlMatch) {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    sendRedirect(res, 301, '/projects');
    return true;
  }

  // Not a leadership route — tell caller to continue dispatch.
  return false;
}

// ── internal helpers ──────────────────────────────────────────────────────────

/**
 * Shared handler for both `GET /` (no `?sid=`) and `GET /overview`.
 * Returns `true` (always handled — either 200 or 500 HTML).
 */
function renderOverviewTab(
  req: IncomingMessage,
  res: ServerResponse,
  deps: LeadershipRouteDeps,
  query: URLSearchParams,
  now: () => Date,
): boolean {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return true;
  }
  const rangeStr = query.get('range') ?? undefined;
  const nowDate = now();
  const range = parseRange(rangeStr, nowDate);
  // Single cache key — /  and  /overview  produce the same payload.
  const cacheKey = `html|/overview|${range.label}`;
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
    sendHtml(res, 500, renderOverviewError());
  }
  return true;
}

/**
 * Render a minimal "尚未实现" placeholder page for the People / Projects /
 * Activity / Insights tabs (P-B2). Inner content arrives in Phase 3.
 */
function renderStubTab(active: ActiveTab, title: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)} · Matrix·Riven</title>
<style>${LEADERSHIP_CSS}</style>
</head>
<body>
<div class="shell">
  ${renderNav(active)}
  <div style="padding:80px 40px;text-align:center;color:var(--ink-3);">
    <div class="serif" style="font-size:24px;color:var(--ink-2);margin-bottom:8px;">尚未实现</div>
    <div>${escapeHtml(title)} tab 计划在 Phase 3 上线</div>
  </div>
</div>
</body>
</html>`;
}

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

function sendRedirect(res: ServerResponse, status: 301 | 302, location: string): void {
  res.statusCode = status;
  res.setHeader('location', location);
  res.setHeader('content-length', 0);
  res.end();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderOverviewError(): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Overview · 500</title><style>${LEADERSHIP_CSS}</style></head><body><div class="lh-container"><div class="lh-empty">Overview (server error)<br><a href="/overview">重试</a></div></div></body></html>`;
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
