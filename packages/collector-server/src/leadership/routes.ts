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
import { createHash } from 'node:crypto';
import type { TtlCache } from './cache.js';
import type { DateRange } from './types.js';
import type { LlmCache } from './llm/cache.js';
import { requireBearerToken } from '../auth-gate.js';
import {
  buildOverviewSnapshot,
  buildMemberDetail,
  buildProjectDetail,
} from './aggregator.js';
import { renderOverview, renderStaleBanner } from './views/overview.html.js';
import {
  renderMemberSlideoverFragments,
  renderProjectSlideoverFragments,
} from './views/_slideover.html.js';
import {
  renderHeroFragment,
  renderKpisFragment,
  renderAttentionFragment,
  renderMembersFragment,
  renderProjectsFragment,
  renderHighlightsFragment,
  renderCollabFragment,
} from './views/_overview-fragments.js';
import { renderNav, type ActiveTab } from './views/_nav.html.js';
import { renderSlideoverShell } from './views/_slideover.html.js';
import { CLIENT_REFRESH_SCRIPT } from './views/_refresh.js.js';
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
  /**
   * L-11: Optional LLM narrative cache. When set, forwarded to the aggregator's
   * cache-only read path so snapshots carry T1–T5 `llm*` fields. Absent (default
   * — `LLM_ENABLED` off) preserves byte-identical pre-LLM behaviour.
   */
  llmCache?: LlmCache;
  /**
   * Optional Bearer-token gate. When non-empty, every leadership endpoint
   * (`/api/overview`, `/overview`, `/api/members/*`, `/api/projects/*`,
   * `/api/llm/status`) requires `Authorization: Bearer <token>`. Source
   * from `RIVEN_AUTH_TOKEN` env in `bin-prod-server.ts`. Empty / undefined
   * disables auth — matches the original `POST /v1/cc-sessions` behaviour
   * and keeps localhost demos friction-free when HOST=127.0.0.1.
   */
  authToken?: string;
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

  // Quick check: is this a leadership-owned path? If not, return false fast
  // (caller falls through). Doing the prefix match here lets us gate auth
  // BEFORE we run any heavy work, and lets a bearer-token failure return
  // 401 with no per-route duplication.
  const isLeadershipPath =
    pathname === '/api/overview' ||
    pathname === '/api/llm/status' ||
    pathname === '/overview' ||
    pathname === '/people' ||
    pathname === '/projects' ||
    pathname === '/highlights' ||
    pathname === '/sessions' ||
    pathname.startsWith('/api/members/') ||
    pathname.startsWith('/api/projects/') ||
    pathname.startsWith('/members/') ||
    pathname.startsWith('/projects/');
  if (isLeadershipPath && deps.authToken && deps.authToken.length > 0) {
    const auth = requireBearerToken(req.headers, deps.authToken);
    if (!auth.ok) {
      // GET / is the only ambiguous path — when ?sid=X is present, we want
      // to fall through to the Phase-1 dashboard rather than 401. Other
      // paths are leadership-only.
      sendJson(res, 401, { error: 'unauthorized' });
      return true;
    }
  }
  // GET / falls through to leadership when no ?sid=; gate it on auth too
  // when a token is configured.
  if (pathname === '/' && req.method === 'GET' && !query.has('sid') && deps.authToken) {
    const auth = requireBearerToken(req.headers, deps.authToken);
    if (!auth.ok) {
      sendJson(res, 401, { error: 'unauthorized' });
      return true;
    }
  }

  // ── API routes ──────────────────────────────────────────────────────────────

  // ── /api/llm/status — ops endpoint for the LLM narrative layer ──────────────
  // Returns a small JSON blob so a launch-day operator (or a Grafana scrape)
  // can confirm the worker is ON, the cache is hydrated, and the daily budget
  // is not yet exhausted. When LLM_ENABLED is off (no llmCache passed in)
  // the response is `{enabled:false}` — same byte-identical baseline as the
  // rest of the dashboard.
  if (pathname === '/api/llm/status') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    if (!deps.llmCache) {
      sendJson(res, 200, { enabled: false });
      return true;
    }
    const stats = deps.llmCache.stats();
    // Group cache entries by tier prefix so ops can see at a glance which
    // tier hasn't filled. `stats()` doesn't expose per-tier breakdown, so we
    // do it here from the in-mem Map via a tiny helper.
    const byTier = llmCacheTierCounts(deps.llmCache);
    sendJson(res, 200, {
      enabled: true,
      cache: {
        entries: stats.entries,
        bytes: stats.bytes,
        todayCostUsd: Number(stats.todayCostUsd.toFixed(4)),
        byTier,
      },
    });
    return true;
  }

  if (pathname === '/api/overview') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    const rangeStr = query.get('range') ?? undefined;
    const nowDate = now();
    const range = parseRange(rangeStr, nowDate);
    if (range === null) {
      sendJson(res, 400, { error: 'invalid_range', allowed: ['today', '24h', '7d', '30d'] });
      return true;
    }
    const cacheKey = `/api/overview|${range.label}`;
    // P-C1: cache holds the *enriched* payload + a pre-computed ETag, so
    // repeated polls within the same TTL window return both an identical
    // body and an identical ETag (so any client honouring If-None-Match
    // gets a 304 on the second hit).
    let entry = deps.cache.get(cacheKey) as
      | { body: Record<string, unknown>; etag: string }
      | undefined;
    if (entry === undefined) {
      try {
        const snap = buildOverviewSnapshot({
          collectorDir: deps.collectorDir,
          range,
          now: nowDate,
          mainProjects: deps.mainProjects,
          llmCache: deps.llmCache,
        });
        // /api/overview is consumed by the Overview-tab live polling loop,
        // which swaps these fragments in via outerHTML. Apply the same
        // top-N caps used in renderOverview() so polling stays consistent.
        const _html = {
          hero: renderHeroFragment(snap),
          kpis: renderKpisFragment(snap),
          attention: renderAttentionFragment(snap, { limit: 3 }),
          members: renderMembersFragment(snap, { limit: 4 }),
          projects: renderProjectsFragment(snap, { limit: 4 }),
          highlights: renderHighlightsFragment(snap),
          collab: renderCollabFragment(snap),
        };
        const body = { ...snap, _html } as Record<string, unknown>;
        entry = { body, etag: etagFor(body) };
        deps.cache.set(cacheKey, entry);
      } catch (err) {
        // Log server-side so ops can diagnose, but never leak the stack
        // through the HTTP response (`{error:'internal'}` is opaque on
        // purpose). The route+pathname tells the operator where it failed.
        process.stderr.write(
          `[leadership] 500 on ${req.method ?? 'GET'} ${pathname}: ${
            err instanceof Error ? err.stack ?? err.message : String(err)
          }\n`,
        );
        sendJson(res, 500, { error: 'internal' });
        return true;
      }
    }
    const ifNoneMatch = req.headers['if-none-match'];
    if (typeof ifNoneMatch === 'string' && ifNoneMatch === entry.etag) {
      res.statusCode = 304;
      res.setHeader('etag', entry.etag);
      res.end();
      return true;
    }
    sendJsonWithEtag(res, 200, entry.body, entry.etag);
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
    if (range === null) {
      sendJson(res, 400, { error: 'invalid_range', allowed: ['today', '24h', '7d', '30d'] });
      return true;
    }
    const cacheKey = `/api/members/${localPart}|${range.label}`;
    // P-C3: cache holds the *enriched* payload + a pre-computed ETag so that
    // the slide-over live-polling loop (which fires every 30 s while the
    // drawer is open) returns a fast 304 on identical hits.
    let entry = deps.cache.get(cacheKey) as
      | { body: Record<string, unknown>; etag: string }
      | undefined;
    if (entry === undefined) {
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
        const body = { ...detail, _html } as Record<string, unknown>;
        entry = { body, etag: etagFor(body) };
        deps.cache.set(cacheKey, entry);
      } catch (err) {
        // Log server-side so ops can diagnose, but never leak the stack
        // through the HTTP response (`{error:'internal'}` is opaque on
        // purpose). The route+pathname tells the operator where it failed.
        process.stderr.write(
          `[leadership] 500 on ${req.method ?? 'GET'} ${pathname}: ${
            err instanceof Error ? err.stack ?? err.message : String(err)
          }\n`,
        );
        sendJson(res, 500, { error: 'internal' });
        return true;
      }
    }
    const ifNoneMatch = req.headers['if-none-match'];
    if (typeof ifNoneMatch === 'string' && ifNoneMatch === entry.etag) {
      res.statusCode = 304;
      res.setHeader('etag', entry.etag);
      res.end();
      return true;
    }
    sendJsonWithEtag(res, 200, entry.body, entry.etag);
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
    if (range === null) {
      sendJson(res, 400, { error: 'invalid_range', allowed: ['today', '24h', '7d', '30d'] });
      return true;
    }
    const cacheKey = `/api/projects/${projectName}|${range.label}`;
    // P-C3: same enriched-payload + ETag cache shape as the member endpoint.
    let entry = deps.cache.get(cacheKey) as
      | { body: Record<string, unknown>; etag: string }
      | undefined;
    if (entry === undefined) {
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
        const body = { ...detail, _html } as Record<string, unknown>;
        entry = { body, etag: etagFor(body) };
        deps.cache.set(cacheKey, entry);
      } catch (err) {
        // Log server-side so ops can diagnose, but never leak the stack
        // through the HTTP response (`{error:'internal'}` is opaque on
        // purpose). The route+pathname tells the operator where it failed.
        process.stderr.write(
          `[leadership] 500 on ${req.method ?? 'GET'} ${pathname}: ${
            err instanceof Error ? err.stack ?? err.message : String(err)
          }\n`,
        );
        sendJson(res, 500, { error: 'internal' });
        return true;
      }
    }
    const ifNoneMatch = req.headers['if-none-match'];
    if (typeof ifNoneMatch === 'string' && ifNoneMatch === entry.etag) {
      res.statusCode = 304;
      res.setHeader('etag', entry.etag);
      res.end();
      return true;
    }
    sendJsonWithEtag(res, 200, entry.body, entry.etag);
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

  // P-B7: People + Projects are real pages — full unsliced grid/list with
  // the same shell, nav, slide-over and 30 s polling as Overview.
  if (pathname === '/people' && req.method === 'GET') {
    return renderPeopleTab(req, res, deps, query, now);
  }
  if (pathname === '/projects' && req.method === 'GET') {
    return renderProjectsTab(req, res, deps, query, now);
  }
  // Activity + Insights remain stubs — Phase 3 scope.
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
  if (range === null) {
    sendJson(res, 400, { error: 'invalid_range', allowed: ['today', '24h', '7d', '30d'] });
    return true;
  }
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
      llmCache: deps.llmCache,
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
 * P-B7: GET /people — full unsliced member grid. Shares the Overview shell
 * (frosted nav + slide-over panel + 30 s polling) so the slide-over and sort
 * buttons keep working. Cache-keyed independently from Overview because the
 * payload (no slicing) is different.
 */
function renderPeopleTab(
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
  const range = parseRange(query.get('range') ?? undefined, now());
  if (range === null) {
    sendJson(res, 400, { error: 'invalid_range', allowed: ['today', '24h', '7d', '30d'] });
    return true;
  }
  const cacheKey = `html|/people|${range.label}`;
  const cached = deps.cache.get(cacheKey);
  if (cached !== undefined) {
    sendHtml(res, 200, cached as string);
    return true;
  }
  try {
    const snap = buildOverviewSnapshot({
      collectorDir: deps.collectorDir,
      range,
      now: now(),
      mainProjects: deps.mainProjects,
      llmCache: deps.llmCache,
    });
    const tightHero = `<header id="hero" class="hero fade-in"><div><h1 class="serif">团队 <em>${snap.members.length} 人</em></h1><div class="sub">完整成员视图 · 数据每 30 秒刷新</div></div></header>`;
    const body = snap.members.length === 0
      ? `<section id="members" class="section fade-in"><div class="lh-empty">这个窗口内没有成员活动</div></section>`
      : renderMembersFragment(snap); // no limit → full grid
    const banner = snap.staleness ? renderStaleBanner(snap.staleness) : '';
    const html = renderTabPage('people', rangeToNavLabelLocal(range.label), banner + tightHero + body);
    deps.cache.set(cacheKey, html);
    sendHtml(res, 200, html);
  } catch {
    sendHtml(res, 500, renderOverviewError());
  }
  return true;
}

/**
 * P-B7: GET /projects — full unsliced project list. Mirrors renderPeopleTab.
 */
function renderProjectsTab(
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
  const range = parseRange(query.get('range') ?? undefined, now());
  if (range === null) {
    sendJson(res, 400, { error: 'invalid_range', allowed: ['today', '24h', '7d', '30d'] });
    return true;
  }
  const cacheKey = `html|/projects|${range.label}`;
  const cached = deps.cache.get(cacheKey);
  if (cached !== undefined) {
    sendHtml(res, 200, cached as string);
    return true;
  }
  try {
    const snap = buildOverviewSnapshot({
      collectorDir: deps.collectorDir,
      range,
      now: now(),
      mainProjects: deps.mainProjects,
      llmCache: deps.llmCache,
    });
    const tightHero = `<header id="hero" class="hero fade-in"><div><h1 class="serif">项目 <em>${snap.projects.length} 个</em></h1><div class="sub">完整项目视图 · 数据每 30 秒刷新</div></div></header>`;
    const body = snap.projects.length === 0
      ? `<section id="projects" class="section fade-in"><div class="lh-empty">这个窗口内没有项目活动</div></section>`
      : renderProjectsFragment(snap); // no limit → full list
    const banner = snap.staleness ? renderStaleBanner(snap.staleness) : '';
    const html = renderTabPage('projects', rangeToNavLabelLocal(range.label), banner + tightHero + body);
    deps.cache.set(cacheKey, html);
    sendHtml(res, 200, html);
  } catch {
    sendHtml(res, 500, renderOverviewError());
  }
  return true;
}

/**
 * Wrap a tab's inner content with the shared shell — same DOCTYPE, CSS, nav,
 * slide-over panel, and 30 s polling script as Overview. Keeps People +
 * Projects visually consistent and lets the slide-over open from member tiles
 * / project rows without duplicating markup.
 */
function renderTabPage(active: ActiveTab, rangeLabel: string, innerHtml: string): string {
  const title = active.charAt(0).toUpperCase() + active.slice(1);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)} · Matrix·Riven</title>
<style>${LEADERSHIP_CSS}</style>
</head>
<body>
<div class="shell">
${renderNav(active, { rangeLabel })}
${innerHtml}
</div>
${renderSlideoverShell()}
<script>${CLIENT_REFRESH_SCRIPT}</script>
</body>
</html>`;
}

/** Local copy of rangeToNavLabel (duplicated to avoid cross-imports). */
function rangeToNavLabelLocal(label: string): string {
  switch (label) {
    case '24h': return '24 小时';
    case 'today': return '今日';
    case '30d': return '30 日窗口';
    case '7d':
    default: return '7 日窗口';
  }
}

/**
 * Render a minimal "尚未实现" placeholder page for the Activity / Insights
 * tabs. People + Projects are now real pages (P-B7).
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

/**
 * Defensive headers applied to every leadership response. The dashboard
 * embeds inline `<script>` (small refresh-loop) and inline `<style>` so we
 * intentionally do NOT set a strict CSP — those would need refactoring all
 * `views/*.html.ts`. We DO set the cheap, drop-in headers that block easy
 * exploits (MIME-sniff bypass, clickjacking, referrer leak).
 */
function applySecurityHeaders(res: ServerResponse): void {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  applySecurityHeaders(res);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', Buffer.byteLength(json));
  res.end(json);
}

function sendJsonWithEtag(
  res: ServerResponse,
  status: number,
  body: unknown,
  etag: string,
): void {
  const json = JSON.stringify(body);
  applySecurityHeaders(res);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', Buffer.byteLength(json));
  res.setHeader('etag', etag);
  res.end(json);
}

/**
 * Count cache entries by tier prefix (`t1:`, `t2:`, …) for the
 * `/api/llm/status` endpoint. Cheap O(n) walk over the in-mem key set.
 */
function llmCacheTierCounts(cache: LlmCache): Record<string, number> {
  const counts: Record<string, number> = { t1: 0, t2: 0, t3: 0, t4: 0, t5: 0 };
  for (const k of cache.keys()) {
    const tier = k.split(':')[0]!;
    if (tier in counts) counts[tier] = (counts[tier] ?? 0) + 1;
  }
  return counts;
}

/**
 * P-C1: 16-char SHA-1 hex digest wrapped in double quotes — stable, opaque,
 * and round-trips cleanly through `If-None-Match`.
 */
function etagFor(obj: unknown): string {
  return '"' + createHash('sha1').update(JSON.stringify(obj)).digest('hex').slice(0, 16) + '"';
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  applySecurityHeaders(res);
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
 * - missing / empty → defaults to `7d` (the common case for HTML loads)
 * - one of {today, 24h, 7d, 30d} → that range
 * - anything else → null (route emits 400 so a misconfigured client doesn't
 *   silently get stale-window data without realising it)
 */
function parseRange(rangeStr: string | undefined, now: Date): DateRange | null {
  if (rangeStr !== undefined && rangeStr !== '' && !['today', '24h', '7d', '30d'].includes(rangeStr)) {
    return null;
  }
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
