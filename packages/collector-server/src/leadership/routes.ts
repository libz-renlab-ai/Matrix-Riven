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
import { renderLanding } from './views/_landing.html.js';
import { renderSources } from './views/_sources.html.js';
import { renderRetro } from './views/_retro.html.js';
import {
  getDemoSnapshot,
  getDemoMemberByLocalPart,
  getDemoProjectByName,
} from './views/_demo-fixture.js';
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
import { renderFilterBar } from './views/_filter-bar.html.js';
import { FILTER_BAR_CSS, FILTER_BAR_SCRIPT } from './views/_filter-bar.client.js';
import { parseFocusFromQuery, focusFilterCacheKey, isDefaultFilter } from './focus-filter.js';
import type { FocusFilter, OverviewSnapshot } from './types.js';
import { buildActivityFeed } from './activity-feed.js';
import { renderActivityPage } from './views/activity.html.js';
import { renderMemberDetail } from './views/member-detail.html.js';

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

  // ── Public unauth routes ────────────────────────────────────────────────────
  // These render before the auth gate so a CTO clicking the link sees pages
  // without 401: landing (marketing), sources (transparency), demo overview.
  // 2026-05-18 round-5 audit (P1): non-GET to these public routes used to
  // fall through to the outer dispatcher's 404 with no security headers —
  // which contradicted the /landing copy claiming "全路由响应都带 nosniff
  // + X-Frame-Options". Now any unsupported method returns 405 here (still
  // public, still no auth required) so headers + status are consistent
  // with /overview, /retro, /people, /projects.
  if (pathname === '/landing') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    sendHtml(res, 200, renderLanding({ hasAuth: !!deps.authToken }));
    return true;
  }
  if (pathname === '/sources') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    sendHtml(res, 200, renderSources());
    return true;
  }
  if (pathname === '/overview' && req.method === 'GET' && query.get('demo') === '1') {
    const filter = parseFocusFromQuery(query);
    const snap = applyFilterToDemoSnapshot(getDemoSnapshot(), filter);
    const filterBarHtml = renderFilterBar({
      filter,
      members: extractMemberLocalParts(getDemoSnapshot()),
      projects: getDemoSnapshot().projects.map((p) => p.name),
      tab: 'overview',
      demo: true,
    });
    sendHtml(res, 200, renderOverview(snap, { filterBarHtml }));
    return true;
  }
  if (pathname === '/api/overview' && req.method === 'GET' && query.get('demo') === '1') {
    // 2026-05-18 round-16 audit P0: must include the same `_html`
    // fragments the non-demo branch builds at lines 239-247, otherwise
    // pollOverview's 30-s tick (in _refresh.js.ts) finds snap._html
    // missing, skips every fragment swap, and live polling is silently
    // dead on every demo page.
    const filter = parseFocusFromQuery(query);
    const demoSnap = applyFilterToDemoSnapshot(getDemoSnapshot(), filter);
    const _html = {
      hero: renderHeroFragment(demoSnap),
      kpis: renderKpisFragment(demoSnap),
      attention: renderAttentionFragment(demoSnap, { limit: 3 }),
      members: renderMembersFragment(demoSnap, { limit: 4 }),
      projects: renderProjectsFragment(demoSnap, { limit: 4 }),
      highlights: renderHighlightsFragment(demoSnap),
      collab: renderCollabFragment(demoSnap),
    };
    sendJson(res, 200, { ...demoSnap, _html });
    return true;
  }

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
    pathname === '/activity' ||
    pathname === '/insights' ||
    pathname === '/retro' ||
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
      sendJson(res, 400, { error: 'invalid_range', allowed: ['today', '24h', '7d', '30d', 'yesterday', 'custom'] });
      return true;
    }
    // Phase 3-A: focus filter on /api/overview too — the polling loop sends
    // the same query string the page is mounted with, so the JSON snapshot
    // must apply the same filter or live polling resets the view.
    const apiFilter = parseFocusFromQuery(query);
    const cacheKey = `/api/overview|${range.label}${focusFilterCacheKey(apiFilter)}`;
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
          filter: apiFilter,
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
    const rawId = decodeURIComponent(membersApiMatch[1]!);
    // 2026-05-18 round-14 audit P0: accept either local-part ("alex") or
    // full email ("alex@example.com") — prior client emitters sent the
    // full email, but the API contract was local-part only, so every
    // member tile click 404'd. Strip an `@…` tail at the boundary so
    // both shapes work.
    const localPart = rawId.includes('@') ? (rawId.split('@')[0] ?? rawId) : rawId;
    // 2026-05-18 round-8 audit P0: drawer click on /overview?demo=1 used
    // to 404 because this endpoint ignored the demo flag. Now honors it
    // and returns the hand-built demo detail + slideover fragments.
    if (query.get('demo') === '1') {
      const demoMember = getDemoMemberByLocalPart(localPart);
      if (!demoMember) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }
      const _html = renderMemberSlideoverFragments(demoMember, demoMember.detail);
      sendJson(res, 200, { ...demoMember, _html });
      return true;
    }
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
    // 2026-05-18 round-8 audit P0: same demo-mode short-circuit as the
    // member endpoint so the drawer on /overview?demo=1 actually opens.
    if (query.get('demo') === '1') {
      const demoProject = getDemoProjectByName(projectName);
      if (!demoProject) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }
      const _html = renderProjectSlideoverFragments(demoProject, demoProject.detail);
      sendJson(res, 200, { ...demoProject, _html });
      return true;
    }
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
  // the same shell, nav, slide-over and 30 s polling as Overview. The
  // method check lives inside renderPeopleTab / renderProjectsTab so
  // non-GET returns 405 (not 404 via outer dispatcher fall-through).
  if (pathname === '/people') {
    return renderPeopleTab(req, res, deps, query, now);
  }
  if (pathname === '/projects') {
    return renderProjectsTab(req, res, deps, query, now);
  }
  // Phase 3-B: /activity is now a real page (was stub).
  if (pathname === '/activity') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    return renderActivityTab(req, res, deps, query, now);
  }
  if (pathname === '/api/activity') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    return handleActivityApi(req, res, deps, query, now);
  }
  if (pathname === '/insights') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    sendHtml(res, 200, renderStubTab('insights', 'Insights'));
    return true;
  }
  if (pathname === '/retro') {
    // Don't gate on method here — let the inner handler return 405 for
    // non-GET (matches the /people + /projects + /overview convention).
    return renderRetroTab(req, res, deps, query, now);
  }

  // Phase 3-C: /people/:id is the new member detail full page.
  const peopleDetailMatch = /^\/people\/([^/]+)$/.exec(pathname);
  if (peopleDetailMatch) {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    return renderMemberDetailPage(req, res, deps, query, now, decodeURIComponent(peopleDetailMatch[1]!));
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
    // Phase 3-C: forward to the new /people/:id URL (preserving id).
    sendRedirect(res, 301, '/people/' + encodeURIComponent(membersHtmlMatch[1]!));
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
  const nowDate = now();
  const filter = parseFocusFromQuery(query);
  // Phase 3-A: filter.range overrides the legacy ?range= param.
  const range = parseRange(filter.range === 'today' && !query.has('range') ? undefined : filter.range, nowDate);
  if (range === null) {
    sendJson(res, 400, { error: 'invalid_range', allowed: ['today', '24h', '7d', '30d', 'yesterday', 'custom'] });
    return true;
  }
  const cacheKey = `html|/overview|${range.label}${focusFilterCacheKey(filter)}`;
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
      filter,
    });
    const filterBarHtml = renderFilterBar({
      filter,
      members: extractMemberLocalParts(snap),
      projects: snap.projects.map((p) => p.name),
      tab: 'overview',
      demo: false,
    });
    const html = renderOverview(snap, { filterBarHtml });
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
  const nowDate = now();
  const filter = parseFocusFromQuery(query);
  const range = parseRange(filter.range === 'today' && !query.has('range') ? undefined : filter.range, nowDate);
  if (range === null) {
    sendJson(res, 400, { error: 'invalid_range', allowed: ['today', '24h', '7d', '30d', 'yesterday', 'custom'] });
    return true;
  }
  const isDemo = query.get('demo') === '1';
  const cacheKey = `html|/people|${range.label}|${isDemo ? 'demo' : 'real'}${focusFilterCacheKey(filter)}`;
  const cached = deps.cache.get(cacheKey);
  if (cached !== undefined) {
    sendHtml(res, 200, cached as string);
    return true;
  }
  try {
    const snap = isDemo
      ? getDemoSnapshot()
      : buildOverviewSnapshot({
          collectorDir: deps.collectorDir,
          range,
          now: nowDate,
          mainProjects: deps.mainProjects,
          llmCache: deps.llmCache,
          filter,
        });
    const tightHero = `<header id="hero" class="hero fade-in"><div><h1 class="serif">团队 <em>${snap.members.length} 人</em></h1><div class="sub">完整成员视图 · 数据每 30 秒刷新</div></div></header>`;
    const body = snap.members.length === 0
      ? `<section id="members" class="section fade-in"><div class="lh-empty">这个窗口内没有成员活动</div></section>`
      : renderMembersFragment(snap); // no limit → full grid
    const banner = snap.staleness ? renderStaleBanner(snap.staleness) : '';
    const filterBarHtml = renderFilterBar({
      filter,
      members: extractMemberLocalParts(snap),
      projects: snap.projects.map((p) => p.name),
      tab: 'people',
      demo: isDemo,
    });
    const html = renderTabPage('people', rangeToNavLabelLocal(range.label), banner + tightHero + body, filterBarHtml);
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
  const nowDate = now();
  const filter = parseFocusFromQuery(query);
  const range = parseRange(filter.range === 'today' && !query.has('range') ? undefined : filter.range, nowDate);
  if (range === null) {
    sendJson(res, 400, { error: 'invalid_range', allowed: ['today', '24h', '7d', '30d', 'yesterday', 'custom'] });
    return true;
  }
  const isDemo = query.get('demo') === '1';
  const cacheKey = `html|/projects|${range.label}|${isDemo ? 'demo' : 'real'}${focusFilterCacheKey(filter)}`;
  const cached = deps.cache.get(cacheKey);
  if (cached !== undefined) {
    sendHtml(res, 200, cached as string);
    return true;
  }
  try {
    const snap = isDemo
      ? getDemoSnapshot()
      : buildOverviewSnapshot({
          collectorDir: deps.collectorDir,
          range,
          now: nowDate,
          mainProjects: deps.mainProjects,
          llmCache: deps.llmCache,
          filter,
        });
    const tightHero = `<header id="hero" class="hero fade-in"><div><h1 class="serif">项目 <em>${snap.projects.length} 个</em></h1><div class="sub">完整项目视图 · 数据每 30 秒刷新</div></div></header>`;
    const body = snap.projects.length === 0
      ? `<section id="projects" class="section fade-in"><div class="lh-empty">这个窗口内没有项目活动</div></section>`
      : renderProjectsFragment(snap); // no limit → full list
    const banner = snap.staleness ? renderStaleBanner(snap.staleness) : '';
    const filterBarHtml = renderFilterBar({
      filter,
      members: extractMemberLocalParts(snap),
      projects: snap.projects.map((p) => p.name),
      tab: 'projects',
      demo: isDemo,
    });
    const html = renderTabPage('projects', rangeToNavLabelLocal(range.label), banner + tightHero + body, filterBarHtml);
    deps.cache.set(cacheKey, html);
    sendHtml(res, 200, html);
  } catch {
    sendHtml(res, 500, renderOverviewError());
  }
  return true;
}

/**
 * GET /retro — weekly retrospective view. Reuses the snapshot computed for
 * /overview but selects different fields (delivered / concerns / standout /
 * dormant). Default range forced to `7d` since "本周" is the editorial frame.
 */
function renderRetroTab(
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
  const range = parseRange(query.get('range') ?? '7d', now());
  if (range === null) {
    sendJson(res, 400, { error: 'invalid_range', allowed: ['today', '24h', '7d', '30d'] });
    return true;
  }
  // 2026-05-18 round-16 audit P0: /retro?demo=1 used to ignore the demo
  // flag and render the empty real retro ("本窗口尚无 commit / PR /
  // release" × 3) — the landing → /overview?demo=1 → click Retro flow
  // cliffed silently. Mirror the round-15 /people /projects demo branch.
  const isDemo = query.get('demo') === '1';
  const cacheKey = `html|/retro|${range.label}|${isDemo ? 'demo' : 'real'}`;
  const cached = deps.cache.get(cacheKey);
  if (cached !== undefined) {
    sendHtml(res, 200, cached as string);
    return true;
  }
  try {
    const snap = isDemo
      ? getDemoSnapshot()
      : buildOverviewSnapshot({
          collectorDir: deps.collectorDir,
          range,
          now: now(),
          mainProjects: deps.mainProjects,
          llmCache: deps.llmCache,
        });
    const html = renderRetro(snap);
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
function renderTabPage(active: ActiveTab, rangeLabel: string, innerHtml: string, filterBarHtml: string = ''): string {
  const title = active.charAt(0).toUpperCase() + active.slice(1);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)} · Matrix·Riven</title>
<style>${LEADERSHIP_CSS}
${FILTER_BAR_CSS}</style>
</head>
<body>
<div class="shell">
${renderNav(active, { rangeLabel })}
${filterBarHtml}
${innerHtml}
</div>
${renderSlideoverShell()}
<script>${CLIENT_REFRESH_SCRIPT}</script>
<script>${FILTER_BAR_SCRIPT}</script>
</body>
</html>`;
}

/**
 * Phase 3-C: /people/:id handler.
 *
 * Renders a full member detail page that coexists with the slideover.
 * URL is /people/<email-local-part>; demo mode falls back to demo data.
 */
function renderMemberDetailPage(
  req: IncomingMessage,
  res: ServerResponse,
  deps: LeadershipRouteDeps,
  query: URLSearchParams,
  now: () => Date,
  rawId: string,
): boolean {
  const nowDate = now();
  const localPart = rawId.includes('@') ? (rawId.split('@')[0] ?? rawId) : rawId;
  const isDemo = query.get('demo') === '1';
  // Filter bar always lock the focus to this member.
  const filterRaw = parseFocusFromQuery(query);
  const filter: FocusFilter = { ...filterRaw, focus: localPart };
  const range = parseRange(filter.range === 'today' && !query.has('range') ? '7d' : filter.range, nowDate);
  if (range === null) {
    sendJson(res, 400, { error: 'invalid_range', allowed: ['today', '24h', '7d', '30d', 'yesterday', 'custom'] });
    return true;
  }
  const cacheKey = `html|/people/${localPart}|${range.label}|${isDemo ? 'demo' : 'real'}${focusFilterCacheKey(filter)}`;
  const cached = deps.cache.get(cacheKey);
  if (cached !== undefined) {
    sendHtml(res, 200, cached as string);
    return true;
  }
  try {
    if (isDemo) {
      const demoMember = getDemoMemberByLocalPart(localPart);
      if (!demoMember || !demoMember.detail) {
        sendHtml(res, 404, renderMemberNotFound(localPart));
        return true;
      }
      const filterBarHtml = renderFilterBar({
        filter,
        members: extractMemberLocalParts(getDemoSnapshot()),
        projects: getDemoSnapshot().projects.map((p) => p.name),
        tab: 'people',
        demo: true,
      });
      const html = renderMemberDetail(demoMember, demoMember.detail, { filterBarHtml });
      deps.cache.set(cacheKey, html);
      sendHtml(res, 200, html);
      return true;
    }
    const email = resolveEmailByLocalPart(deps.collectorDir, localPart);
    if (!email) {
      sendHtml(res, 404, renderMemberNotFound(localPart));
      return true;
    }
    const detail = buildMemberDetail({
      collectorDir: deps.collectorDir,
      email,
      range,
      now: nowDate,
      mainProjects: deps.mainProjects,
    });
    if (!detail) {
      sendHtml(res, 404, renderMemberNotFound(localPart));
      return true;
    }
    // Use snapshot for filter bar dropdown options.
    const teamSnap = buildOverviewSnapshot({
      collectorDir: deps.collectorDir,
      range,
      now: nowDate,
      mainProjects: deps.mainProjects,
      llmCache: deps.llmCache,
    });
    const filterBarHtml = renderFilterBar({
      filter,
      members: extractMemberLocalParts(teamSnap),
      projects: teamSnap.projects.map((p) => p.name),
      tab: 'people',
      demo: false,
    });
    const html = renderMemberDetail(detail, detail.detail, { filterBarHtml });
    deps.cache.set(cacheKey, html);
    sendHtml(res, 200, html);
  } catch (err) {
    process.stderr.write(
      `[leadership] 500 on /people/${localPart}: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
    );
    sendHtml(res, 500, renderOverviewError());
  }
  return true;
}

function renderMemberNotFound(id: string): string {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>未找到 · Matrix·Riven</title><style>body{font-family:system-ui;padding:60px;text-align:center;}</style></head><body><h1>未找到成员</h1><p>"${id.replace(/[<>"&]/g, '?')}" 不在当前数据中</p><p><a href="/people">← 返回团队</a></p></body></html>`;
}

/**
 * Phase 3-B: /activity tab handler.
 */
function renderActivityTab(
  req: IncomingMessage,
  res: ServerResponse,
  deps: LeadershipRouteDeps,
  query: URLSearchParams,
  now: () => Date,
): boolean {
  const nowDate = now();
  const filter = parseFocusFromQuery(query);
  const range = parseRange(filter.range === 'today' && !query.has('range') ? '7d' : filter.range, nowDate);
  if (range === null) {
    sendJson(res, 400, { error: 'invalid_range', allowed: ['today', '24h', '7d', '30d', 'yesterday', 'custom'] });
    return true;
  }
  const isDemo = query.get('demo') === '1';
  const beforeStr = query.get('before');
  const beforeTs = beforeStr ? new Date(beforeStr) : undefined;
  const cacheKey = `html|/activity|${range.label}|${isDemo ? 'demo' : 'real'}${focusFilterCacheKey(filter)}|before=${beforeStr ?? ''}`;
  const cached = deps.cache.get(cacheKey);
  if (cached !== undefined) {
    sendHtml(res, 200, cached as string);
    return true;
  }
  try {
    const feed = isDemo
      ? buildDemoActivityFeed(filter, nowDate, beforeTs)
      : buildActivityFeed({
          collectorDir: deps.collectorDir,
          range,
          filter,
          now: nowDate,
          beforeTs,
        });
    // For the filter bar we need member/project options — pull from a fresh overview snapshot
    // (cheap on demo path; on real path the cache makes this acceptable).
    const filterBarHtml = renderFilterBar({
      filter,
      members: collectMembersForFilterBar(deps, range, nowDate, isDemo),
      projects: collectProjectsForFilterBar(deps, range, nowDate, isDemo),
      tab: 'activity',
      demo: isDemo,
    });
    const html = renderActivityPage(feed, { filterBarHtml });
    deps.cache.set(cacheKey, html);
    sendHtml(res, 200, html);
  } catch (err) {
    process.stderr.write(
      `[leadership] 500 on /activity: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
    );
    sendHtml(res, 500, renderOverviewError());
  }
  return true;
}

function handleActivityApi(
  req: IncomingMessage,
  res: ServerResponse,
  deps: LeadershipRouteDeps,
  query: URLSearchParams,
  now: () => Date,
): boolean {
  const nowDate = now();
  const filter = parseFocusFromQuery(query);
  const range = parseRange(filter.range === 'today' && !query.has('range') ? '7d' : filter.range, nowDate);
  if (range === null) {
    sendJson(res, 400, { error: 'invalid_range', allowed: ['today', '24h', '7d', '30d', 'yesterday', 'custom'] });
    return true;
  }
  const isDemo = query.get('demo') === '1';
  const beforeStr = query.get('before');
  const beforeTs = beforeStr ? new Date(beforeStr) : undefined;
  try {
    const feed = isDemo
      ? buildDemoActivityFeed(filter, nowDate, beforeTs)
      : buildActivityFeed({
          collectorDir: deps.collectorDir,
          range,
          filter,
          now: nowDate,
          beforeTs,
        });
    sendJson(res, 200, feed);
  } catch (err) {
    process.stderr.write(
      `[leadership] 500 on /api/activity: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
    );
    sendJson(res, 500, { error: 'internal' });
  }
  return true;
}

/**
 * Demo activity feed: synthesize events from getDemoSnapshot().members'
 * recent activity. Each demo member gets 2-3 session events spread across
 * the past 48h; each demo project gets 1 commit milestone.
 */
function buildDemoActivityFeed(
  filter: FocusFilter,
  now: Date,
  beforeTs: Date | undefined,
): ReturnType<typeof buildActivityFeed> {
  const snap = getDemoSnapshot();
  const events: import('./types.js').ActivityEvent[] = [];
  const nowMs = now.getTime();
  // Sessions: 3 per member over past 48h
  snap.members.forEach((m, mi) => {
    for (let i = 0; i < 3; i++) {
      const hoursAgo = mi * 6 + i * 8;
      const ts = new Date(nowMs - hoursAgo * 3600 * 1000).toISOString();
      events.push({
        ts,
        type: 'session',
        by: m.email,
        project: m.topProject ?? snap.projects[0]?.name ?? 'demo',
        summary: `${m.displayName} 的会话 #${i + 1} · 演示数据`,
        detail: { sessionId: `demo-${m.email}-${i}`, tokens: 1200 + i * 800, durationMs: 25 * 60 * 1000 },
      });
    }
  });
  // Milestones: 1 commit per project
  snap.projects.forEach((p, pi) => {
    const ts = new Date(nowMs - (4 + pi * 12) * 3600 * 1000).toISOString();
    events.push({
      ts,
      type: 'commit',
      by: snap.members[pi % snap.members.length]!.email,
      project: p.name,
      summary: `feat(${p.name}): 演示提交 #${pi + 1}`,
    });
  });
  // Apply filter
  const focus = filter.focus?.toLowerCase();
  const project = filter.project?.toLowerCase();
  let filtered = events.filter((e) => {
    if (focus && (e.by.split('@')[0] ?? '').toLowerCase() !== focus) return false;
    if (project && e.project.toLowerCase() !== project) return false;
    return true;
  });
  filtered.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  if (beforeTs) {
    const cutoff = beforeTs.toISOString();
    filtered = filtered.filter((e) => e.ts < cutoff);
  }
  return {
    schemaVersion: 1,
    range: { start: new Date(nowMs - 7 * 24 * 3600 * 1000).toISOString(), end: now.toISOString(), label: '7d' },
    events: filtered,
    hasMore: false,
    computedAt: now.toISOString(),
    appliedFilter: filter,
  };
}

function collectMembersForFilterBar(
  deps: LeadershipRouteDeps,
  range: DateRange,
  now: Date,
  isDemo: boolean,
): string[] {
  if (isDemo) return extractMemberLocalParts(getDemoSnapshot());
  try {
    const snap = buildOverviewSnapshot({
      collectorDir: deps.collectorDir,
      range,
      now,
      mainProjects: deps.mainProjects,
      llmCache: deps.llmCache,
    });
    return extractMemberLocalParts(snap);
  } catch {
    return [];
  }
}

function collectProjectsForFilterBar(
  deps: LeadershipRouteDeps,
  range: DateRange,
  now: Date,
  isDemo: boolean,
): string[] {
  if (isDemo) return getDemoSnapshot().projects.map((p) => p.name);
  try {
    const snap = buildOverviewSnapshot({
      collectorDir: deps.collectorDir,
      range,
      now,
      mainProjects: deps.mainProjects,
      llmCache: deps.llmCache,
    });
    return snap.projects.map((p) => p.name);
  } catch {
    return [];
  }
}

/**
 * Phase 3-A helper: apply a focus filter to a demo snapshot. Demo data is
 * static (4 members / 3 projects) so we do a shallow slice — members and
 * projects matching the filter survive, KPI / attention / highlights /
 * collaboration are trimmed by the same predicates. KPI numeric recompute
 * is skipped (demo KPIs are editorial, not derived); the chip bar provides
 * the visual signal that filter is active.
 */
function applyFilterToDemoSnapshot(snap: OverviewSnapshot, filter: FocusFilter): OverviewSnapshot {
  if (isDefaultFilter(filter)) return snap;
  const focus = filter.focus?.toLowerCase();
  const project = filter.project?.toLowerCase();
  const state = filter.state;

  let members = snap.members;
  if (focus) members = members.filter((m) => (m.email.split('@')[0] ?? '').toLowerCase() === focus);
  if (state) members = members.filter((m) => m.stateBadge === state);

  let projects = snap.projects;
  if (project) projects = projects.filter((p) => p.name.toLowerCase() === project);

  const attention = snap.attention.filter((a) => {
    if (focus && a.kind === 'member') {
      const local = (a.refId.split('@')[0] ?? '').toLowerCase();
      if (local !== focus) return false;
    }
    if (project && a.kind === 'project') {
      if (a.refId.toLowerCase() !== project) return false;
    }
    return true;
  });

  const highlights = snap.highlights.filter((h) => {
    if (focus && h.by.toLowerCase() !== focus) return false;
    if (project && h.project.toLowerCase() !== project) return false;
    return true;
  });

  const collaboration = snap.collaboration.filter((c) => {
    if (focus) {
      if (!c.members.some((email) => (email.split('@')[0] ?? '').toLowerCase() === focus)) return false;
    }
    return true;
  });

  return { ...snap, members, projects, attention, highlights, collaboration, appliedFilter: filter };
}

/**
 * Phase 3-A helper: pull every member's email local-part out of a snapshot
 * for the filter dropdown options. Skips empty / fallback emails.
 */
function extractMemberLocalParts(snap: OverviewSnapshot): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of snap.members) {
    const local = (m.email.split('@')[0] ?? '').trim();
    if (!local || seen.has(local)) continue;
    seen.add(local);
    out.push(local);
  }
  return out;
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
