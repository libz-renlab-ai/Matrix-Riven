/**
 * Integration tests for leadership route handlers.
 * Spins up a real http.Server with a mock collector dir.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { TtlCache } from '../cache.js';
import { handleLeadershipRequest, type LeadershipRouteDeps } from '../routes.js';

// ── fixture writer ────────────────────────────────────────────────────────────

function writeEnvelope(
  dir: string,
  email: string,
  date: string,
  sid: string,
  opts: { projectName: string; cwd: string },
): void {
  // Anchor the message + envelope timestamps to the date folder so
  // sessions written under different date dirs actually bucket into
  // different days for trend7d / activeDays computations.
  const ts = `${date}T10:00:00Z`;
  const jsonl = JSON.stringify({
    type: 'user',
    timestamp: ts,
    message: { role: 'user', content: 'hi' },
  });
  const gz = gzipSync(Buffer.from(jsonl)).toString('base64');
  const env = {
    schema_version: 1,
    envelope: {
      id: sid,
      user_id: email,
      machine_id: 'm',
      session_id: sid,
      cwd: opts.cwd,
      project_name: opts.projectName,
      captured_at: ts,
      source: 'stop-hook',
      host: { os: 'l', arch: 'x', hostname: 'h' },
      riven_version: '0',
      consented_at: null,
      payload_size: jsonl.length,
      transcript_path: '',
    },
    transcript: { compression: 'gzip+base64', content: gz },
  };
  const filePath = join(dir, email, date);
  mkdirSync(filePath, { recursive: true });
  writeFileSync(join(filePath, `${sid}.json`), JSON.stringify(env));
}

// ── test server setup ─────────────────────────────────────────────────────────

const collectorDir = join(tmpdir(), `riven-routes-test-${randomUUID()}`);
const EMAIL_A = 'alice2026@example.com';
const EMAIL_B = 'bob2026@example.com';
const PROJECT_A = 'project-alpha';
const PROJECT_B = 'project-beta';

let server: Server;
let baseUrl: string;
let cache: TtlCache<unknown>;

// Fixed "now" so cache TTL and date range are deterministic
const FIXED_NOW = new Date('2026-05-16T12:00:00Z');

beforeAll(async () => {
  // Write fixture sessions — span ≥ 2 active days per project so they
  // survive the post-2026-05-17 volume gate (≥ 5 sessions OR ≥ 2 active
  // days). Without the cross-day spread, single-afternoon scratch sessions
  // would be dropped from the dashboard project list.
  writeEnvelope(collectorDir, EMAIL_A, '2026-05-14', 'sess-a1', {
    projectName: PROJECT_A,
    cwd: `/home/alice/projects/${PROJECT_A}`,
  });
  writeEnvelope(collectorDir, EMAIL_A, '2026-05-14', 'sess-a2', {
    projectName: PROJECT_A,
    cwd: `/home/alice/projects/${PROJECT_A}`,
  });
  writeEnvelope(collectorDir, EMAIL_A, '2026-05-15', 'sess-a3', {
    projectName: PROJECT_A,
    cwd: `/home/alice/projects/${PROJECT_A}`,
  });
  writeEnvelope(collectorDir, EMAIL_B, '2026-05-14', 'sess-b1', {
    projectName: PROJECT_B,
    cwd: `/home/bob/projects/${PROJECT_B}`,
  });
  writeEnvelope(collectorDir, EMAIL_B, '2026-05-14', 'sess-b2', {
    projectName: PROJECT_B,
    cwd: `/home/bob/projects/${PROJECT_B}`,
  });
  writeEnvelope(collectorDir, EMAIL_B, '2026-05-15', 'sess-b3', {
    projectName: PROJECT_B,
    cwd: `/home/bob/projects/${PROJECT_B}`,
  });

  cache = new TtlCache<unknown>(60_000); // 60s TTL

  const deps: LeadershipRouteDeps = {
    collectorDir,
    cache,
    now: () => FIXED_NOW,
  };

  await new Promise<void>((resolve, reject) => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const handled = handleLeadershipRequest(req, res, deps);
      if (!handled) {
        res.statusCode = 404;
        res.end('not handled');
      }
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('server failed to bind'));
        return;
      }
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

// ── helpers ───────────────────────────────────────────────────────────────────

async function getJson(path: string): Promise<{ status: number; body: unknown; contentType: string | null }> {
  const res = await fetch(`${baseUrl}${path}`);
  const contentType = res.headers.get('content-type');
  const body = await res.json();
  return { status: res.status, body, contentType };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/llm/status', () => {
  it('returns {enabled:false} when llmCache is undefined', async () => {
    const { status, body } = await getJson('/api/llm/status');
    expect(status).toBe(200);
    expect(body).toEqual({ enabled: false });
  });

  it('rejects non-GET with 405', async () => {
    const res = await fetch(`${baseUrl}/api/llm/status`, { method: 'POST' });
    expect(res.status).toBe(405);
  });
});

describe('GET /api/overview', () => {
  it('returns 200 with JSON content-type', async () => {
    const { status, contentType } = await getJson('/api/overview');
    expect(status).toBe(200);
    expect(contentType).toContain('application/json');
  });

  it('response has kpis, members, projects arrays', async () => {
    const { body } = await getJson('/api/overview');
    const snap = body as Record<string, unknown>;
    expect(Array.isArray(snap.members)).toBe(true);
    expect(Array.isArray(snap.projects)).toBe(true);
    expect(snap.kpis).toBeTruthy();
  });

  it('accepts ?range=30d without error', async () => {
    const { status } = await getJson('/api/overview?range=30d');
    expect(status).toBe(200);
  });

  it('accepts ?range=today without error', async () => {
    const { status } = await getJson('/api/overview?range=today');
    expect(status).toBe(200);
  });

  it('accepts ?range=24h without error', async () => {
    const { status } = await getJson('/api/overview?range=24h');
    expect(status).toBe(200);
  });
});

describe('GET /api/members/:emailLocalPart', () => {
  it('returns 200 for known local-part (alice)', async () => {
    const { status, body } = await getJson('/api/members/alice2026');
    expect(status).toBe(200);
    const snap = body as Record<string, unknown>;
    expect(snap.detail).toBeTruthy();
  });

  it('returns 200 for known local-part (bob)', async () => {
    const { status, body } = await getJson('/api/members/bob2026');
    expect(status).toBe(200);
    const snap = body as Record<string, unknown>;
    expect(snap).toHaveProperty('email');
    expect(snap.detail).toBeTruthy();
  });

  it('returns 404 for unknown local-part', async () => {
    const { status, body } = await getJson('/api/members/unknown-user-xyz');
    expect(status).toBe(404);
    const err = body as Record<string, unknown>;
    expect(err.error).toBe('not_found');
  });

  it('response has JSON content-type on 404', async () => {
    const { contentType } = await getJson('/api/members/nobody');
    expect(contentType).toContain('application/json');
  });
});

describe('GET /api/projects/:name', () => {
  it('returns 200 for known project', async () => {
    const { status, body } = await getJson(`/api/projects/${encodeURIComponent(PROJECT_A)}`);
    expect(status).toBe(200);
    const snap = body as Record<string, unknown>;
    expect(snap.detail).toBeTruthy();
  });

  it('returns 200 for another known project', async () => {
    const { status, body } = await getJson(`/api/projects/${encodeURIComponent(PROJECT_B)}`);
    expect(status).toBe(200);
    const snap = body as Record<string, unknown>;
    expect(snap).toHaveProperty('name');
  });

  it('returns 404 for unknown project', async () => {
    const { status, body } = await getJson('/api/projects/nonexistent-project-xyz');
    expect(status).toBe(404);
    const err = body as Record<string, unknown>;
    expect(err.error).toBe('not_found');
  });

  it('URL-decodes project name with spaces/slashes', async () => {
    // Just verify it handles encoded names without crashing; returns 404 since the project doesn't exist
    const { status } = await getJson('/api/projects/some%20project%20name');
    expect([200, 404]).toContain(status);
  });
});

describe('TTL cache', () => {
  it('second identical /api/overview request returns the same computedAt (cache hit)', async () => {
    // Clear cache and re-fetch twice
    cache.clear();
    const { body: body1 } = await getJson('/api/overview?range=7d');
    const { body: body2 } = await getJson('/api/overview?range=7d');
    const snap1 = body1 as Record<string, unknown>;
    const snap2 = body2 as Record<string, unknown>;
    expect(snap1.computedAt).toBe(snap2.computedAt);
  });
});

describe('HTML routes', () => {
  it('GET /overview returns 200 text/html with real renderer output', async () => {
    const res = await fetch(`${baseUrl}/overview`);
    expect(res.status).toBe(200);
    const ct = res.headers.get('content-type');
    expect(ct).toContain('text/html');
    const text = await res.text();
    expect(text).toContain('<!DOCTYPE html>');
    expect(text).toContain('lh-kpi-card');
  });

  it('non-leadership route is NOT handled (returns false)', async () => {
    // The test server returns "not handled" (404) for unhandled routes
    const res = await fetch(`${baseUrl}/some-other-route`);
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toBe('not handled');
  });
});

// ── P-B2: 5 leadership tab routes + `/` deferral ──────────────────────────────

describe('5 leadership tab routes (P-B2)', () => {
  it.each(['/overview', '/people', '/projects', '/retro', '/activity', '/insights'])(
    'GET %s returns 200 HTML containing the nav',
    async (path) => {
      const res = await fetch(`${baseUrl}${path}`);
      expect(res.status).toBe(200);
      const ct = res.headers.get('content-type');
      expect(ct).toContain('text/html');
      const html = await res.text();
      expect(html).toContain('class="nav');
      expect(html).toContain('class="tab');
      expect(html).toContain('Overview');
    },
  );

  it('GET / with no query falls through to the Overview tab rendering', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const ct = res.headers.get('content-type');
    expect(ct).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('class="nav');
    expect(html).toContain('lh-kpi-card'); // real overview content, not a stub
  });

  it('GET /overview marks the Overview tab as active', async () => {
    const res = await fetch(`${baseUrl}/overview`);
    const html = await res.text();
    expect(html).toMatch(/class="tab active"[^>]*>[^<]*Overview/);
  });

  it('GET /people marks the People tab as active and renders the full member grid (P-B7)', async () => {
    const res = await fetch(`${baseUrl}/people`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/class="tab active"[^>]*>[^<]*People/);
    // P-B7: real page, not a "尚未实现" stub.
    expect(html).not.toContain('尚未实现');
    expect(html).toContain('class="member-tile"');
    // Slide-over shell is mounted (so click-to-open works).
    expect(html).toContain('id="scrim"');
    expect(html).toContain('id="so"');
    // No see-all footer on the full page — it's the full unsliced grid.
    expect(html).not.toContain('see-all-row');
  });

  it('GET /projects marks the Projects tab as active and renders the full project list (P-B7)', async () => {
    const res = await fetch(`${baseUrl}/projects`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/class="tab active"[^>]*>[^<]*Projects/);
    expect(html).not.toContain('尚未实现');
    expect(html).toContain('class="proj-row"');
    expect(html).toContain('id="scrim"');
    expect(html).toContain('id="so"');
    expect(html).not.toContain('see-all-row');
  });

  it('GET /retro marks the Retro tab as active and renders the real retro view', async () => {
    // 2026-05-18 round-3 audit P1: /retro was an orphan (no nav entry,
    // wrong active tab). Regression-guard the wiring here.
    const res = await fetch(`${baseUrl}/retro`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/class="tab active"[^>]*>[^<]*Retro/);
    expect(html).not.toContain('尚未实现');
    expect(html).toContain('本周回顾');
  });

  it('POST /retro returns 405 not 404', async () => {
    const res = await fetch(`${baseUrl}/retro`, { method: 'POST' });
    expect(res.status).toBe(405);
  });

  it.each(['/landing', '/sources', '/activity', '/insights'])(
    'POST %s returns 405 with security headers (round-5 P1)',
    async (path) => {
      // 2026-05-18 round-5 audit: these four routes used to fall through to
      // the outer dispatcher's 404 (no security headers) on non-GET — which
      // contradicted /landing's "全路由响应都带 nosniff + X-Frame-Options"
      // copy. Now any unsupported method lands at 405 with full headers.
      const res = await fetch(`${baseUrl}${path}`, { method: 'POST' });
      expect(res.status).toBe(405);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBe('DENY');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    },
  );

  it('GET /activity is now a real page (Phase 3-B)', async () => {
    const res = await fetch(`${baseUrl}/activity`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('尚未实现');
    expect(html).toContain('活动流');
    expect(html).toMatch(/class="tab active"[^>]*>[^<]*Activity/);
  });

  it('GET /insights is now a real page (Phase 3-D)', async () => {
    const res = await fetch(`${baseUrl}/insights`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('尚未实现');
    expect(html).toContain('团队健康总评分');
    expect(html).toMatch(/class="tab active"[^>]*>[^<]*Insights/);
  });

  it('GET / with ?sid=XYZ defers to the outer dispatcher (handler returns false)', async () => {
    // The test server is wired to write "not handled" + 404 when
    // handleLeadershipRequest returns false. That signal is the contract the
    // P-A4 raw-link flow depends on.
    const res = await fetch(`${baseUrl}/?sid=01ABC`);
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toBe('not handled');
  });

  it('GET /projects/:name is intercepted by the P-B6 redirect (not the stub tab)', async () => {
    // Regression: the literal /projects route must not shadow the
    // /projects/<name> regex below it — even though the regex now redirects.
    // 2026-05-19 QA-4 P1: redirect target now preserves query and embeds
    // the project id as a #project=<id> fragment so the projects page
    // can auto-open the slideover. Match either the legacy bare target
    // (no slideover deeplink, before the fix) or the new fragment form.
    const res = await fetch(`${baseUrl}/projects/${encodeURIComponent(PROJECT_A)}`, {
      redirect: 'manual',
    });
    expect([301, 302]).toContain(res.status);
    const location = res.headers.get('location') ?? '';
    expect(location.startsWith('/projects')).toBe(true);
    expect(location).toContain(`#project=${encodeURIComponent(PROJECT_A)}`);
  });
});

// ── P-B6: slide-over API enrichment + retired full-page routes ───────────────

describe('detail API _html fragments (P-B6)', () => {
  it('GET /api/members/<id> returns JSON with _html: { callout, stats, evolve, projects }', async () => {
    const res = await fetch(`${baseUrl}/api/members/alice2026`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    const html = data._html as Record<string, unknown> | undefined;
    expect(html).toBeDefined();
    expect(typeof html!.callout).toBe('string');
    expect(typeof html!.stats).toBe('string');
    expect(typeof html!.evolve).toBe('string');
    expect(typeof html!.projects).toBe('string');
    // Sanity: the callout fragment is the so-callout block, not a full page.
    expect(html!.callout).toContain('so-callout');
    expect(html!.callout).not.toContain('<!DOCTYPE');
  });

  it('GET /api/projects/<name> returns JSON with _html fragments', async () => {
    const res = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(PROJECT_A)}`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    const html = data._html as Record<string, unknown> | undefined;
    expect(html).toBeDefined();
    expect(typeof html!.callout).toBe('string');
    expect(typeof html!.stats).toBe('string');
    expect(typeof html!.evolve).toBe('string');
    expect(typeof html!.projects).toBe('string');
    expect(html!.callout).toContain(PROJECT_A);
  });

  it('GET /members/<id> is retired — redirects to /people/<id> (Phase 3-C resurrects detail page)', async () => {
    // 2026-05-19 QA-6 P2: redirect now preserves query and adds a
    // #member=<id> fragment for slideover deeplink symmetry. The location
    // header MUST start with /people/<id> and contain the deeplink, and
    // MAY also carry the original query string.
    const res = await fetch(`${baseUrl}/members/alice2026`, { redirect: 'manual' });
    expect([301, 302]).toContain(res.status);
    const location = res.headers.get('location') ?? '';
    expect(location.startsWith('/people/alice2026')).toBe(true);
    expect(location).toContain('#member=alice2026');
  });

  it('GET /projects/<name> is retired — redirects (or 410s) away from a full page', async () => {
    // 2026-05-19 QA-4 P1: redirect now lands on /projects with a
    // #project=<name> fragment so the slideover auto-opens. Location
    // must start with /projects and embed the deeplink fragment.
    const res = await fetch(`${baseUrl}/projects/${encodeURIComponent(PROJECT_A)}`, {
      redirect: 'manual',
    });
    expect([301, 302, 404, 410]).toContain(res.status);
    if (res.status === 301 || res.status === 302) {
      const location = res.headers.get('location') ?? '';
      expect(location.startsWith('/projects')).toBe(true);
      expect(location).toContain(`#project=${encodeURIComponent(PROJECT_A)}`);
    }
  });
});

// ── P-B6: Overview HTML mounts the slide-over shell ──────────────────────────

describe('Overview HTML mounts slideover shell (P-B6)', () => {
  it('GET /overview includes the scrim + slideover panel + 4 empty fragment slots', async () => {
    const res = await fetch(`${baseUrl}/overview`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="scrim"');
    expect(html).toContain('id="so"');
    for (const slot of ['so-callout', 'so-stats', 'so-evolve', 'so-projects']) {
      expect(html).toContain(`id="${slot}"`);
    }
  });
});

// ── P-C1: ETag + per-section HTML fragments in overview API ──────────────────

describe('GET /api/overview ETag + _html fragments (P-C1)', () => {
  it('returns _html with 5 keys: hero, kpis, attention, members, projects', async () => {
    const res = await fetch(`${baseUrl}/api/overview`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    const html = data._html as Record<string, unknown> | undefined;
    expect(html).toBeDefined();
    expect(typeof html!.hero).toBe('string');
    expect(typeof html!.kpis).toBe('string');
    expect(typeof html!.attention).toBe('string');
    expect(typeof html!.members).toBe('string');
    expect(typeof html!.projects).toBe('string');
  });

  it('returns an ETag header in stable format', async () => {
    const res = await fetch(`${baseUrl}/api/overview`);
    const etag = res.headers.get('etag');
    expect(etag).toMatch(/^"[a-f0-9]{16}"$/);
  });

  it('returns 304 when If-None-Match matches current ETag', async () => {
    const first = await fetch(`${baseUrl}/api/overview`);
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();
    // Consume the first response body to avoid leaking the socket.
    await first.text();
    const second = await fetch(`${baseUrl}/api/overview`, {
      headers: { 'if-none-match': etag! },
    });
    expect(second.status).toBe(304);
    const body = await second.text();
    expect(body).toBe('');
    expect(second.headers.get('etag')).toBe(etag);
  });

  it('returns fresh body when If-None-Match does not match', async () => {
    const res = await fetch(`${baseUrl}/api/overview`, {
      headers: { 'if-none-match': '"deadbeefdeadbeef"' },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body.length).toBeGreaterThan(0);
  });
});

// ── P-C3: Detail endpoints ETag + 304 (slide-over live polling) ──────────────

describe('Detail endpoints ETag + 304 (P-C3)', () => {
  it('GET /api/members/<id> returns an ETag header in stable format', async () => {
    const res = await fetch(`${baseUrl}/api/members/alice2026`);
    expect(res.status).toBe(200);
    const etag = res.headers.get('etag');
    expect(etag).toMatch(/^"[a-f0-9]{16}"$/);
  });

  it('GET /api/members/<id> returns 304 on If-None-Match match', async () => {
    const first = await fetch(`${baseUrl}/api/members/alice2026`);
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();
    await first.text();
    const second = await fetch(`${baseUrl}/api/members/alice2026`, {
      headers: { 'if-none-match': etag! },
    });
    expect(second.status).toBe(304);
    const body = await second.text();
    expect(body).toBe('');
    expect(second.headers.get('etag')).toBe(etag);
  });

  it('GET /api/members/<id> returns fresh body when ETag does not match', async () => {
    const res = await fetch(`${baseUrl}/api/members/alice2026`, {
      headers: { 'if-none-match': '"deadbeefdeadbeef"' },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body.length).toBeGreaterThan(0);
  });

  it('GET /api/projects/<name> returns an ETag header in stable format', async () => {
    const res = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(PROJECT_A)}`);
    expect(res.status).toBe(200);
    const etag = res.headers.get('etag');
    expect(etag).toMatch(/^"[a-f0-9]{16}"$/);
  });

  it('GET /api/projects/<name> returns 304 on If-None-Match match', async () => {
    const first = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(PROJECT_A)}`);
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();
    await first.text();
    const second = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(PROJECT_A)}`, {
      headers: { 'if-none-match': etag! },
    });
    expect(second.status).toBe(304);
    const body = await second.text();
    expect(body).toBe('');
    expect(second.headers.get('etag')).toBe(etag);
  });
});

// ── round-8 audit P0: /api/members/:id and /api/projects/:name honor ?demo=1 ──

describe('demo slideover (round-8 P0)', () => {
  it('GET /api/members/alex?demo=1 returns demo detail with _html fragments', async () => {
    const res = await fetch(`${baseUrl}/api/members/alex?demo=1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.email).toBe('alex@example.com');
    expect(body.detail).toBeTruthy();
    const html = body._html as Record<string, unknown>;
    expect(typeof html.callout).toBe('string');
    expect(typeof html.stats).toBe('string');
    expect(typeof html.evolve).toBe('string');
    expect(typeof html.projects).toBe('string');
  });

  it('GET /api/members/<full-email>?demo=1 also resolves (round-14 P0)', async () => {
    // The overview HTML used to emit the full email in the onclick handler,
    // landing here as a 4-char "alex@example.com" id. We strip the `@…` at
    // the boundary so both the new local-part-only client and any stale
    // bookmark / hand-crafted curl call still find the member.
    const res = await fetch(
      `${baseUrl}/api/members/${encodeURIComponent('alex@example.com')}?demo=1`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.email).toBe('alex@example.com');
  });

  it('GET /api/members/unknown?demo=1 returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/members/nope?demo=1`);
    expect(res.status).toBe(404);
  });

  it('GET /api/projects/matrix-riven?demo=1 returns demo detail with _html fragments', async () => {
    const res = await fetch(`${baseUrl}/api/projects/matrix-riven?demo=1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.name).toBe('matrix-riven');
    expect(body.detail).toBeTruthy();
    const html = body._html as Record<string, unknown>;
    expect(typeof html.callout).toBe('string');
  });

  it('GET /api/projects/unknown?demo=1 returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/projects/nope?demo=1`);
    expect(res.status).toBe(404);
  });

  it('GET /people?demo=1 renders the 4-member demo grid (round-15 P0)', async () => {
    // Was rendering empty real-data shell because /people ignored ?demo=1.
    const res = await fetch(`${baseUrl}/people?demo=1`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('class="member-tile"');
    // Each of the four demo members should appear by displayName.
    for (const name of ['alex', 'blake', 'casey', 'dana']) {
      expect(html.toLowerCase()).toContain(name);
    }
    expect(html).not.toContain('这个窗口内没有成员活动');
  });

  it('GET /projects?demo=1 renders the 3-project demo list (round-15 P0)', async () => {
    const res = await fetch(`${baseUrl}/projects?demo=1`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('class="proj-row"');
    for (const name of ['matrix-riven', 'team-graph', 'devops-pipelines']) {
      expect(html).toContain(name);
    }
    expect(html).not.toContain('这个窗口内没有项目活动');
  });

  it('GET /api/overview?demo=1 includes _html fragments (round-16 P0)', async () => {
    // Without _html the pollOverview 30 s tick can't swap fragments —
    // live polling silently dead on every demo page.
    const res = await fetch(`${baseUrl}/api/overview?demo=1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const html = body._html as Record<string, string>;
    expect(html).toBeTruthy();
    for (const slot of ['hero', 'kpis', 'attention', 'members', 'projects', 'highlights', 'collab']) {
      expect(typeof html[slot]).toBe('string');
      expect(html[slot]!.length).toBeGreaterThan(0);
    }
  });

  it('GET /retro?demo=1 renders the demo retro (round-16 P0)', async () => {
    // Used to ignore ?demo=1 and render the empty real retro.
    const res = await fetch(`${baseUrl}/retro?demo=1`);
    expect(res.status).toBe(200);
    const html = await res.text();
    // Demo fixture has highlights (commits/pushes/PRs/releases), so the
    // "本周交付" section must not be the empty fallback.
    expect(html).not.toContain('本窗口尚无 commit / PR / release');
    // Demo attention has the blake+devops items so "需要看一眼" populated.
    expect(html).toContain('att-row');
  });
});

// ── L-13/launch: end-to-end LLM-on smoke ─────────────────────────────────────

describe('LLM-on e2e (L-13)', () => {
  // Sibling test server with `llmCache` plumbed through. Verifies that the
  // route handlers actually pass deps.llmCache to the aggregator so an
  // `/api/llm/status` consumer (the ops endpoint) sees the cache, not
  // {enabled:false}. Cache layer correctness is covered exhaustively in
  // aggregator-llm.test.ts; this is purely the HTTP wiring assertion.
  let llmServer: Server;
  let llmBaseUrl: string;
  let llmCacheRef: import('../llm/cache.js').LlmCache;

  beforeAll(async () => {
    const { LlmCache } = await import('../llm/cache.js');
    const cacheDir = join(tmpdir(), `riven-llm-routes-${randomUUID()}`);
    mkdirSync(cacheDir, { recursive: true });
    const cache = new LlmCache(join(cacheDir, 'v1.jsonl'));
    await cache.load();
    // Seed three entries across tiers so /api/llm/status returns a real
    // breakdown rather than all-zeros.
    await cache.put('t1:0123456789abcdef', JSON.stringify({ digest: 'seeded t1' }), 0.001);
    await cache.put('t3:fedcba9876543210', JSON.stringify({ weekly: 'seeded t3' }), 0.002);
    await cache.put('t5:abcd1234ef567890', JSON.stringify({ briefLines: ['ok', 'ok', 'ok'] }), 0.003);
    llmCacheRef = cache;

    const llmCollectorDir = join(tmpdir(), `riven-llm-collector-${randomUUID()}`);
    mkdirSync(llmCollectorDir, { recursive: true });
    const deps: LeadershipRouteDeps = {
      collectorDir: llmCollectorDir,
      cache: new TtlCache<unknown>(60_000),
      now: () => FIXED_NOW,
      llmCache: cache,
    };

    await new Promise<void>((resolve, reject) => {
      llmServer = createServer((req: IncomingMessage, res: ServerResponse) => {
        const handled = handleLeadershipRequest(req, res, deps);
        if (!handled) {
          res.statusCode = 404;
          res.end('not handled');
        }
      });
      llmServer.once('error', reject);
      llmServer.listen(0, '127.0.0.1', () => {
        const addr = llmServer.address();
        if (!addr || typeof addr === 'string') {
          reject(new Error('llm test server failed to bind'));
          return;
        }
        llmBaseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      llmServer.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it('GET /api/llm/status reports enabled:true with per-tier counts', async () => {
    const res = await fetch(`${llmBaseUrl}/api/llm/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.enabled).toBe(true);
    const cache = body.cache as Record<string, unknown>;
    expect(cache.entries).toBe(3);
    const byTier = cache.byTier as Record<string, number>;
    expect(byTier.t1).toBe(1);
    expect(byTier.t3).toBe(1);
    expect(byTier.t5).toBe(1);
  });

  it('seeded llmCache survives a /api/overview call (deps wired through)', async () => {
    // The fixture has zero sessions so the snapshot is empty, but the
    // route must not crash and must keep the cache alive for the status
    // endpoint to read post-request.
    const res = await fetch(`${llmBaseUrl}/api/overview`);
    expect(res.status).toBe(200);
    expect(llmCacheRef.keys().length).toBe(3);
  });
});
