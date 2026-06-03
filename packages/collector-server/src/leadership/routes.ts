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
import { readdirSync, existsSync, statSync } from 'node:fs';
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
import { CONSENT_BANNER_CSS, CONSENT_BANNER_SCRIPT, renderConsentBanner } from './views/_consent-banner.html.js';
import { parseFocusFromQuery, focusFilterCacheKey, isDefaultFilter } from './focus-filter.js';
import type { FocusFilter, OverviewSnapshot, ParsedSession } from './types.js';
import { buildActivityFeed } from './activity-feed.js';
import { renderActivityPage } from './views/activity.html.js';
import { renderMemberDetail } from './views/member-detail.html.js';
import { buildInsightsSnapshot } from './insights/index.js';
import { renderInsightsPage } from './views/insights.html.js';
import { scanAllSessions } from './transcript-loader.js';

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

// Round-2 QA P0 (security): bound the `/healthz` disk scan. 30 s TTL means
// up to 1 collector-tree readdir burst per 30 s regardless of probe rate.
const HEALTHZ_TTL_MS = 30_000;
let healthzCache: { computedAtMs: number; collectorDirExists: boolean; envelopeCount: number; lastIngestAt: string | null } | null = null;

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
  // 2026-05-19 QA-5 ops P1: health probe for load balancers / cron canaries.
  // Returns a small JSON with version, uptime, collector-dir reachability,
  // LLM-tier state, and the live cache size so an ops dashboard can
  // page on degradation. Unauth — same trust level as `/landing`, no
  // sensitive payload. Cache-Control: no-store inherited via sendJson →
  // applySecurityHeaders, so a probe seeing 200 means "just-now true".
  if (pathname === '/healthz') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    // Round-2 QA P0 (security): the disk scan below was unauth and uncached,
    // making `/healthz` a DoS amplifier — N members × M days × K files of
    // readdirSync + statSync per request. Cache the result for 30 s and
    // return the cached payload on every hit inside that window. Result:
    // bounded I/O even under 10k req/s probing.
    const cached = healthzCache;
    const nowMs = now().getTime();
    if (cached && nowMs - cached.computedAtMs < HEALTHZ_TTL_MS) {
      const ageOfIngest = cached.lastIngestAt
        ? Math.max(0, Math.round((nowMs - new Date(cached.lastIngestAt).getTime()) / 1000))
        : null;
      sendJson(res, 200, {
        ok: true,
        service: 'matrix-riven-collector',
        now: new Date(nowMs).toISOString(),
        uptimeSec: Math.round(process.uptime()),
        collectorDirExists: cached.collectorDirExists,
        envelopeCount: cached.envelopeCount,
        lastIngestAt: cached.lastIngestAt,
        lastIngestAgeSec: ageOfIngest,
        cacheSize: deps.cache.size,
      });
      return true;
    }
    let collectorDirExists = false;
    let envelopeCount = 0;
    let lastIngestAt: string | null = null;
    try {
      collectorDirExists = existsSync(deps.collectorDir);
      if (collectorDirExists) {
        let newestMs = 0;
        for (const userDir of readdirSync(deps.collectorDir, { withFileTypes: true })) {
          if (!userDir.isDirectory()) continue;
          const userPath = `${deps.collectorDir}/${userDir.name}`;
          for (const dateDir of readdirSync(userPath, { withFileTypes: true })) {
            if (!dateDir.isDirectory()) continue;
            const datePath = `${userPath}/${dateDir.name}`;
            for (const f of readdirSync(datePath, { withFileTypes: true })) {
              if (!f.isFile()) continue;
              if (!f.name.endsWith('.jsonl') && !f.name.endsWith('.ogg')) continue;
              envelopeCount += 1;
              try {
                const stat = statSync(`${datePath}/${f.name}`);
                if (stat.mtimeMs > newestMs) newestMs = stat.mtimeMs;
              } catch { /* skip */ }
            }
          }
        }
        if (newestMs > 0) lastIngestAt = new Date(newestMs).toISOString();
      }
    } catch { /* ignore — degrade gracefully if dir scan fails */ }
    healthzCache = { computedAtMs: nowMs, collectorDirExists, envelopeCount, lastIngestAt };
    const lastIngestAgeSec = lastIngestAt
      ? Math.max(0, Math.round((nowMs - new Date(lastIngestAt).getTime()) / 1000))
      : null;
    sendJson(res, 200, {
      ok: true,
      service: 'matrix-riven-collector',
      now: new Date(nowMs).toISOString(),
      uptimeSec: Math.round(process.uptime()),
      collectorDirExists,
      envelopeCount,
      lastIngestAt,
      lastIngestAgeSec,
      cacheSize: deps.cache.size,
    });
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
  // 2026-05-19 QA-4 P0: previously `/?demo=1` fell through to
  // renderOverviewTab → real snapshot → "0 位成员" empty state, because
  // the demo branch only matched `/overview`. A first-time visitor
  // clicking around the nav lands on `/`, sees nothing, bounces. Now
  // both `/` (no ?sid=) and `/overview` honour ?demo=1 identically.
  if ((pathname === '/overview' || (pathname === '/' && !query.has('sid'))) && req.method === 'GET' && query.get('demo') === '1') {
    const filter = parseFocusFromQuery(query);
    const snap = applyFilterToDemoSnapshot(getDemoSnapshot(), filter);
    const filterBarHtml = renderFilterBar({
      filter,
      members: extractMemberLocalParts(getDemoSnapshot()),
      projects: getDemoSnapshot().projects.map((p) => p.name),
      tab: 'overview',
      demo: true,
      effectiveRange: filter.range,
    });
    sendHtml(res, 200, renderOverview(snap, { filterBarHtml, demo: true }));
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
    // Round-7 P2 / autonomous: demo /api/overview previously had no ETag,
    // so the 30 s polling loop re-downloaded the full demo snapshot every
    // tick. Stamp an ETag based on the rendered demo payload and honour
    // If-None-Match so the demo path matches the real path's 304 contract.
    const demoBody = { ...demoSnap, _html };
    const demoEtag = etagFor(demoBody);
    const ifNoneMatch = req.headers['if-none-match'];
    if (typeof ifNoneMatch === 'string' && ifNoneMatch === demoEtag) {
      applySecurityHeaders(res);
      res.statusCode = 304;
      res.setHeader('etag', demoEtag);
      res.end();
      return true;
    }
    sendJsonWithEtag(res, 200, demoBody, demoEtag);
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
    // PR1: the People/Projects 30 s polling loop requests the UNSLICED member
    // or project fragment (`?full=members` / `?full=projects`) so its tick
    // refreshes the full grid in place instead of collapsing it to the
    // Overview's top-4. Normalise unknown values to null so arbitrary
    // `?full=…` input can't spawn distinct cache entries (DoS amplification).
    const fullParam = query.get('full');
    const fullScope = fullParam === 'members' || fullParam === 'projects' ? fullParam : null;
    const cacheKey = `/api/overview|${range.label}${focusFilterCacheKey(apiFilter)}${fullScope ? `|full=${fullScope}` : ''}`;
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
          members: renderMembersFragment(snap, fullScope === 'members' ? {} : { limit: 4 }),
          projects: renderProjectsFragment(snap, fullScope === 'projects' ? {} : { limit: 4 }),
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
    return renderInsightsTab(req, res, deps, query, now);
  }
  if (pathname === '/api/insights') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    return handleInsightsApi(req, res, deps, query, now);
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
    // 2026-05-19 QA-4 P2: security auditor flagged the legacy redirect
    // echoed attacker-controlled bytes into the Location header (after
    // encodeURIComponent, so not exploitable today, but a one-line
    // hardening that prevents future open-redirect regressions).
    // Member local-parts are letters/digits/dot/dash/underscore/at.
    const rawId = membersHtmlMatch[1]!;
    if (!/^[A-Za-z0-9._@-]{1,128}$/.test(rawId)) {
      sendJson(res, 404, { error: 'not_found' });
      return true;
    }
    // Phase 3-C: forward to the new /people/:id URL (preserving id).
    // 2026-05-19 QA-6 P2: mirror the /projects/<id> fix — preserve query
    // string so /members/<id>?demo=1 doesn't drop into real mode + 404.
    // Adds #member=<id> fragment for slideover deeplink symmetry with
    // /projects/<id> → /projects?#project=<id>.
    const memberQs = query.toString();
    const memberTarget =
      '/people/' + encodeURIComponent(rawId) +
      (memberQs ? '?' + memberQs : '') +
      '#member=' + encodeURIComponent(rawId);
    sendRedirect(res, 302, memberTarget);
    return true;
  }

  const projectsHtmlMatch = /^\/projects\/([^/]+)$/.exec(pathname);
  if (projectsHtmlMatch) {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    // 2026-05-19 QA-4 P1: customer #2 flagged that /projects/<id>?demo=1
    // 301'd to /projects (dropping demo=1), so the chevron-suggested
    // drill-down landed on an empty page. There is no per-project detail
    // page yet (slideover serves that role). Preserve query string + add
    // a #project=<id> fragment so a one-line bootstrap in the projects
    // page can auto-open the slideover on that project.
    const rawProj = projectsHtmlMatch[1]!;
    // Match the same chars project names accept: letters, digits, slash
    // (owner/repo), dot, dash, underscore. Reject otherwise to avoid
    // header-injection / open-redirect via Location echo.
    if (!/^[A-Za-z0-9._/@-]{1,128}$/.test(rawProj)) {
      sendJson(res, 404, { error: 'not_found' });
      return true;
    }
    const qs = query.toString();
    const target = `/projects${qs ? '?' + qs : ''}#project=${encodeURIComponent(rawProj)}`;
    sendRedirect(res, 302, target);
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
      effectiveRange: range.label,
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
    const tightHero = `<header id="hero" class="hero fade-in"><div><h1 class="serif">团队 <em>${snap.members.length} 人</em></h1><div class="sub">完整成员视图 · ${snap.members.length === 0 ? '等待第一条 transcript' : '每 30 秒近实时刷新'}</div></div></header>`;
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
      effectiveRange: range.label,
    });
    const html = renderTabPage('people', rangeToNavLabelLocal(range.label), banner + tightHero + body, filterBarHtml, { demo: isDemo });
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
    const tightHero = `<header id="hero" class="hero fade-in"><div><h1 class="serif">项目 <em>${snap.projects.length} 个</em></h1><div class="sub">完整项目视图 · ${snap.projects.length === 0 ? '等待第一条 transcript' : '每 30 秒近实时刷新'}</div></div></header>`;
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
      effectiveRange: range.label,
    });
    const html = renderTabPage('projects', rangeToNavLabelLocal(range.label), banner + tightHero + body, filterBarHtml, { demo: isDemo });
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
    const html = renderRetro(snap, { demo: isDemo });
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
function renderTabPage(active: ActiveTab, rangeLabel: string, innerHtml: string, filterBarHtml: string = '', opts: { demo?: boolean } = {}): string {
  // Round-7 QA P1 (designer): page <title> should be Chinese, matching
  // lang="zh-CN" + the renamed other tabs. Previously titles were
  // English-capitalised ("People · …", "Projects · …").
  const titleMap: Record<ActiveTab, string> = {
    overview: '实时看板',
    people: '团队',
    projects: '项目',
    activity: '活动流',
    insights: '洞察',
    retro: '周回顾',
  };
  const title = titleMap[active] ?? active;
  const isDemo = opts.demo === true;
  // 2026-05-19 QA-7 P0: final acceptance review caught that /people and
  // /projects rendered with NO consent banner — renderTabPage didn't
  // import or call renderConsentBanner, and renderNav was called without
  // demo: so neither tab showed the "演示数据 · 切换" pill either. /people
  // is the highest-PII surface (raw prompt previews + email columns), so
  // a CTO landing there first never saw the disclosure round-5 mandated.
  // Now both ship from this single shell, matching /overview parity.
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · Matrix·Riven</title>
<style>${LEADERSHIP_CSS}
${FILTER_BAR_CSS}
${CONSENT_BANNER_CSS}</style>
</head>
<body>
<div class="shell">
${renderNav(active, { rangeLabel, demo: isDemo })}
${filterBarHtml}
${innerHtml}
</div>
${renderSlideoverShell()}
${renderConsentBanner({ demo: isDemo })}
<script>${CLIENT_REFRESH_SCRIPT}</script>
<script>${FILTER_BAR_SCRIPT}</script>
<script>${CONSENT_BANNER_SCRIPT}</script>
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
        effectiveRange: range.label,
      });
      const html = renderMemberDetail(demoMember, demoMember.detail, { filterBarHtml, demo: true });
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

/**
 * Phase 3-D: /insights tab handler.
 */
function renderInsightsTab(
  req: IncomingMessage,
  res: ServerResponse,
  deps: LeadershipRouteDeps,
  query: URLSearchParams,
  now: () => Date,
): boolean {
  const nowDate = now();
  const filter = parseFocusFromQuery(query);
  const range = parseRange(filter.range === 'today' && !query.has('range') ? '30d' : filter.range, nowDate);
  if (range === null) {
    sendJson(res, 400, { error: 'invalid_range', allowed: ['today', '24h', '7d', '30d', 'yesterday', 'custom'] });
    return true;
  }
  const isDemo = query.get('demo') === '1';
  const axisRaw = query.get('axis');
  const activeSubTab: 'time' | 'people' | 'projects' =
    axisRaw === 'people' || axisRaw === 'projects' ? axisRaw : 'time';
  const cacheKey = `html|/insights|${range.label}|${isDemo ? 'demo' : 'real'}|axis=${activeSubTab}${focusFilterCacheKey(filter)}`;
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
        });
    const sessions = isDemo
      ? synthesizeDemoSessions(snap, nowDate)
      : scanAllSessions(deps.collectorDir, {
          fromDate: range.start.toISOString().slice(0, 10),
          toDate: range.end.toISOString().slice(0, 10),
        });
    const insights = buildInsightsSnapshot({
      collectorDir: deps.collectorDir,
      range,
      now: nowDate,
      sessions,
      snapshot: snap,
      filter,
    });
    // Demo: replace the all-zero history with a hand-shaped 30-day curve
    // so the sparkline reads visually (QA P0).
    if (isDemo) {
      insights.healthScore.history30d = synthesizeDemoSparkline();
    }
    const filterBarHtml = renderFilterBar({
      filter,
      members: extractMemberLocalParts(snap),
      projects: snap.projects.map((p) => p.name),
      tab: 'insights',
      demo: isDemo,
      effectiveRange: range.label,
    });
    const html = renderInsightsPage(insights, { filterBarHtml, activeSubTab, demo: isDemo });
    deps.cache.set(cacheKey, html);
    sendHtml(res, 200, html);
  } catch (err) {
    process.stderr.write(
      `[leadership] 500 on /insights: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
    );
    sendHtml(res, 500, renderOverviewError());
  }
  return true;
}

/**
 * QA P0 fix: build a believable synthetic sessions list from a demo snapshot
 * so the Insights time/people axes don't render with 0-everywhere.
 *
 * Each demo member gets N sessions proportional to their `today.tokens`,
 * spread across the past 30 days with a slight weekly cycle so the 12-week
 * time chart shows a recognisable trend.
 */
function synthesizeDemoSessions(snap: OverviewSnapshot, now: Date): ParsedSession[] {
  const out: ParsedSession[] = [];
  const nowMs = now.getTime();
  for (let mIdx = 0; mIdx < snap.members.length; mIdx++) {
    const m = snap.members[mIdx]!;
    const baseTokens = (m.today?.tokens ?? 5000) || 5000;
    const sessionsPerWeek = Math.max(2, Math.round((m.today?.sessions ?? 3) * 5));
    // Spread 12 weeks of sessions with a gentle ramp (week 0 fewer, week 11 more)
    for (let w = 0; w < 12; w++) {
      const weekFactor = 0.5 + (w / 11) * 1.0; // 0.5 → 1.5 ramp
      const count = Math.round(sessionsPerWeek * weekFactor / 4); // per-week mid-point
      for (let i = 0; i < count; i++) {
        const dayInWeek = (w * 7 + i) % 7;
        const hour = 9 + ((mIdx + i) % 8); // 9..16 local
        const tsMs = nowMs - (11 - w) * 7 * 86400000 - dayInWeek * 86400000 + hour * 3600000;
        out.push({
          envelope: {
            id: `demo-${m.email}-${w}-${i}`,
            userId: m.email,
            machineId: 'demo-host',
            sessionId: `demo-${m.email}-${w}-${i}`,
            cwd: `/demo/${m.topProject ?? snap.projects[0]?.name ?? 'demo'}`,
            projectName: m.topProject ?? snap.projects[0]?.name ?? 'demo',
            capturedAt: new Date(tsMs).toISOString(),
            rivenVersion: '0.1',
            consentedAt: null,
          },
          l1RedactionCount: 0,
          messages: [
            {
              role: 'assistant',
              ts: new Date(tsMs + 60_000),
              text: '',
              toolUses: [{ name: 'Bash', input: { command: 'git commit -m "demo work"' } }],
              toolResults: [],
            },
          ],
          durationMs: 25 * 60 * 1000,
          startTs: new Date(tsMs),
          endTs: new Date(tsMs + 25 * 60 * 1000),
          tokens: {
            input: Math.round(baseTokens * weekFactor * 0.6),
            output: Math.round(baseTokens * weekFactor * 0.4),
            cacheRead: 0,
            cacheCreation: 0,
          },
        });
      }
    }
  }
  return out;
}

/**
 * QA P0 fix: 30-day sparkline values for the demo Insights health card.
 * Hand-shaped so the curve reads as gentle ramp-up + recent dip + recovery,
 * which is what the editorial demo narrative implies.
 */
function synthesizeDemoSparkline(): number[] {
  const out: number[] = [];
  for (let d = 0; d < 30; d++) {
    const base = 40 + Math.sin(d / 4) * 18 + d * 1.2;
    out.push(Math.round(Math.max(10, Math.min(100, base))));
  }
  return out;
}

function handleInsightsApi(
  req: IncomingMessage,
  res: ServerResponse,
  deps: LeadershipRouteDeps,
  query: URLSearchParams,
  now: () => Date,
): boolean {
  const nowDate = now();
  const filter = parseFocusFromQuery(query);
  const range = parseRange(filter.range === 'today' && !query.has('range') ? '30d' : filter.range, nowDate);
  if (range === null) {
    sendJson(res, 400, { error: 'invalid_range', allowed: ['today', '24h', '7d', '30d', 'yesterday', 'custom'] });
    return true;
  }
  const isDemo = query.get('demo') === '1';
  try {
    const snap = isDemo
      ? getDemoSnapshot()
      : buildOverviewSnapshot({
          collectorDir: deps.collectorDir,
          range,
          now: nowDate,
          mainProjects: deps.mainProjects,
          llmCache: deps.llmCache,
        });
    const sessions = isDemo
      ? synthesizeDemoSessions(snap, nowDate)
      : scanAllSessions(deps.collectorDir, {
          fromDate: range.start.toISOString().slice(0, 10),
          toDate: range.end.toISOString().slice(0, 10),
        });
    const insights = buildInsightsSnapshot({
      collectorDir: deps.collectorDir,
      range,
      now: nowDate,
      sessions,
      snapshot: snap,
      filter,
    });
    if (isDemo) insights.healthScore.history30d = synthesizeDemoSparkline();
    sendJson(res, 200, insights);
  } catch (err) {
    process.stderr.write(
      `[leadership] 500 on /api/insights: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
    );
    sendJson(res, 500, { error: 'internal' });
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
      effectiveRange: range.label,
    });
    const html = renderActivityPage(feed, { filterBarHtml, demo: isDemo });
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
  // 2026-05-19 QA-4 P2: security auditor flagged that ?before=AAA hit
  // `new Date(beforeStr)` → Invalid Date → throws inside buildActivityFeed
  // → 500. Public 500 on attacker-controlled input is an enumeration
  // signal even though the stack only goes to stderr. Validate to
  // ISO-8601-ish and return 400 instead.
  let beforeTs: Date | undefined;
  if (beforeStr !== null) {
    const parsed = new Date(beforeStr);
    if (Number.isNaN(parsed.getTime())) {
      sendJson(res, 400, { error: 'invalid_before', hint: 'ISO-8601 timestamp expected, e.g. 2026-05-19T00:00:00Z' });
      return true;
    }
    beforeTs = parsed;
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
  // Editorial demo prompts — make rows read like a real audit trail, not
  // generic "session #1 demo data" placeholders (QA P0 fix).
  const PROMPTS_BY_MEMBER: Record<string, string[]> = {
    alex: ['完善 hero 区域的标题文案', '修一下 KPI 卡的对齐', '搭骨架：3 列 stat 卡'],
    blake: ['修 status/page.tsx 类型推导报错', '继续看为什么 stuck', '尝试改 generic 约束'],
    casey: ['team-graph 视图渲染抖动调试', 'attention 卡 click 路由打通', 'SVG transform 抖动追因'],
    dana: ['同步 README v0.3 段落', '改一下 onboarding 文档', '补 changelog 上一周项'],
  };
  // Sessions: 3 per member over past 48h. QA round-3 P1: previous version
  // produced timestamps in a perfect xx:44 grid (every 8h), which read as
  // synthetic at a glance. Now jitter by mi/i seed so events feel bursty.
  snap.members.forEach((m, mi) => {
    const lp = (m.email.split('@')[0] ?? '').toLowerCase();
    const prompts = PROMPTS_BY_MEMBER[lp] ?? [
      `${m.displayName} · 调研`,
      `${m.displayName} · 实现`,
      `${m.displayName} · 调试`,
    ];
    for (let i = 0; i < 3; i++) {
      // Realistic bursts: cluster two sessions ~1h apart, then a 5-7h gap.
      const baseHours = mi * 5 + (i === 0 ? 0 : i === 1 ? 0.8 : 6.3);
      const jitterMin = ((mi * 7 + i * 11) % 53);
      const jitterSec = ((mi * 17 + i * 23) % 47);
      const tsMs = nowMs - baseHours * 3600 * 1000 - jitterMin * 60 * 1000 - jitterSec * 1000;
      const ts = new Date(tsMs).toISOString();
      events.push({
        ts,
        type: 'session',
        by: m.email,
        project: m.topProject ?? snap.projects[0]?.name ?? 'demo',
        summary: prompts[i % prompts.length]!,
        detail: { sessionId: `demo-${m.email}-${i}`, tokens: 1200 + i * 800, durationMs: 25 * 60 * 1000 },
      });
    }
  });
  // Milestones: 1 commit per project — editorial messages, not "#1 / #2".
  const COMMIT_MSGS = [
    'feat: 完成 hero 区域骨架与 KPI 卡片',
    'fix: 修复 team-graph 视图渲染抖动',
    'chore: README v0.3 + onboarding 段落同步',
  ];
  snap.projects.forEach((p, pi) => {
    const hOffset = 3.7 + pi * 11.4 + ((pi * 13) % 7);
    const mOffset = (pi * 23) % 60;
    const ts = new Date(nowMs - hOffset * 3600 * 1000 - mOffset * 60 * 1000).toISOString();
    events.push({
      ts,
      type: 'commit',
      by: snap.members[pi % snap.members.length]!.email,
      project: p.name,
      summary: COMMIT_MSGS[pi % COMMIT_MSGS.length]!,
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
 * Phase 3-A helper: apply a focus filter to a demo snapshot. QA round 2
 * (P0): the previous version sliced members/projects but left KPIs and
 * Attention contradicting the filtered set ("1 位成员" in hero but "高产 2 人"
 * in KPI). Now KPIs are recomputed from the filtered member set so the
 * page is internally consistent.
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

  // Round-2 QA P0 (EM N1): when focus=<person> is set, project-kind
  // attention items should be limited to projects the focused person
  // contributes to. Otherwise the page lists "devops-pipelines 单点依赖
  // (casey 一人独撑)" inside a blake-focused view — answers a question
  // the viewer isn't asking. Build the focused-member's project set
  // from snap.projects.contributors, then drop project-kind attention
  // for projects outside it.
  let focusProjectNames: Set<string> | null = null;
  if (focus) {
    focusProjectNames = new Set();
    for (const p of snap.projects) {
      const isContrib = p.contributors.some((c) => (c.email.split('@')[0] ?? '').toLowerCase() === focus);
      if (isContrib) focusProjectNames.add(p.name.toLowerCase());
    }
  }
  const attention = snap.attention.filter((a) => {
    if (focus && a.kind === 'member') {
      const local = (a.refId.split('@')[0] ?? '').toLowerCase();
      if (local !== focus) return false;
    }
    if (focus && a.kind === 'project') {
      if (!focusProjectNames || !focusProjectNames.has(a.refId.toLowerCase())) return false;
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

  // QA round-2 P0: recompute KPIs from filtered subset so the hero numbers
  // (members/projects count) agree with the KPI card numbers below.
  const stuckCount = members.filter((m) => m.stateBadge === 'stuck').length;
  const helpCount = members.filter((m) => m.stateBadge === 'needs_help').length;
  const riskyCount = members.filter((m) => m.warnings.some((w) => /危险|risky/i.test(w))).length;
  const highOutputMembers = members.filter((m) => m.deltaVs7dAvgPct > 0.2);
  const avgHighDelta = highOutputMembers.length === 0 ? 0 : highOutputMembers.reduce((a, m) => a + m.deltaVs7dAvgPct, 0) / highOutputMembers.length;
  const todayCostUsd = members.reduce((a, m) => a + (m.today?.costUsd ?? 0), 0);
  const kpis = {
    ...snap.kpis,
    teamActivity: { value: members.reduce((a, m) => a + (m.today?.sessions ?? 0), 0), deltaVsAvg: 0 },
    attention: {
      value: stuckCount + helpCount + riskyCount,
      deltaToday: 0,
      breakdown: { stuck: stuckCount, needsHelp: helpCount, riskyAction: riskyCount },
    },
    projects: {
      active: projects.filter((p) => p.state === 'active').length,
      maintaining: projects.filter((p) => p.state === 'maintaining').length,
      dormant: projects.filter((p) => p.state === 'dormant').length,
    },
    highOutput: { count: highOutputMembers.length, avgDeltaPct: avgHighDelta },
    todayCostUsd: Math.round(todayCostUsd * 100) / 100,
  };

  return { ...snap, members, projects, attention, highlights, collaboration, kpis, appliedFilter: filter };
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
 * Defensive headers applied to every leadership response.
 *
 * 2026-05-19 QA-4 P1: security auditor flagged missing CSP + missing
 * Cache-Control on PII-bearing routes. Added both:
 *
 * - `Content-Security-Policy` is now set. The dashboard inlines its
 *   own `<script>` blocks (CLIENT_REFRESH_SCRIPT, FILTER_BAR_SCRIPT)
 *   and inline `<style>` is pervasive in every view, so we cannot
 *   adopt strict nonce-based CSP without a deeper refactor. Instead
 *   we ship a default-deny-third-party CSP that explicitly allows
 *   `'unsafe-inline'` on script-src and style-src (own content
 *   only), denies all third-party origins, denies `<frame>`, and
 *   forbids `<base href>` injection. This blocks reflected/stored
 *   XSS pivots that depend on loading remote payload while keeping
 *   the existing inline-everything architecture working. Tighten to
 *   sha256-pinned script-src in a follow-up once the inline scripts
 *   are stable enough to pin.
 *
 * - `Cache-Control: no-store` on every response. The dashboard renders
 *   raw user prompts + emails + file paths under PII-light routes
 *   (/people/*, /api/members/*, /api/projects/*, /retro, /activity,
 *   /insights). HTTP/1.0 caching proxies would otherwise treat the
 *   responses as freely cacheable. No-store also fixes a future
 *   regression risk where someone adds a public-Wi-Fi reverse-proxy.
 *   ETag-based 304 on the /api/* routes keeps working under no-store.
 */
function applySecurityHeaders(res: ServerResponse): void {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader(
    'content-security-policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
    ].join('; '),
  );
  res.setHeader('cache-control', 'no-store');
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
