/**
 * Frosted-glass top navbar shared across leadership tab pages.
 *
 * P-B2 (Phase 2): renders the sticky nav with 5 tabs — Overview / People /
 * Projects / Activity / Insights. CSS lives in `_css.ts` (`.nav`, `.brand`,
 * `.brand-mark`, `.tabs`, `.tab`, `.tab.active`, `.nav-meta`, `.live-dot`,
 * `.avatar-me`, `@keyframes pulse`). Brand text is fixed to "Matrix·Riven";
 * the meta strip shows a live dot + range label + the current viewer avatar.
 */

export type ActiveTab = 'overview' | 'people' | 'projects' | 'retro' | 'activity' | 'insights';

interface TabSpec {
  id: ActiveTab;
  label: string;
  href: string;
}

const TABS: readonly TabSpec[] = [
  { id: 'overview', label: 'Overview', href: '/overview' },
  { id: 'people', label: 'People', href: '/people' },
  { id: 'projects', label: 'Projects', href: '/projects' },
  { id: 'retro', label: 'Retro', href: '/retro' },
  // 2026-05-19 Phase 3-B: Activity promoted from stub to real page.
  { id: 'activity', label: 'Activity', href: '/activity' },
  // 2026-05-19 Phase 3-D: Insights promoted from stub to real page.
  { id: 'insights', label: 'Insights', href: '/insights' },
];

export interface RenderNavOptions {
  /** Range label shown next to the live dot. Defaults to "7 日窗口". */
  rangeLabel?: string;
  /**
   * QA-5 UX P2: when true, render a visible "演示数据" pill in the meta
   * strip so a user arriving from the landing-page demo CTA can't
   * mistake fixture data for their team's real numbers. Pill links
   * back to the same path with ?demo=1 stripped (a.k.a. real mode).
   */
  demo?: boolean;
  /**
   * Round-1 QA P1: avatar in the top-right used to be a hardcoded "YL"
   * which reads as un-replaced placeholder in production. Pass the
   * current viewer's initials here when known (from auth), otherwise
   * the avatar renders as a neutral viewer-slot dot.
   */
  meInitials?: string;
}

/**
 * Render the shared frosted-glass top nav. The caller is responsible for
 * ensuring the v7 CSS (`.nav`, `.tab`, ...) is in scope.
 */
export function renderNav(active: ActiveTab, opts: RenderNavOptions = {}): string {
  const tabs = TABS.map((t) => {
    const cls = t.id === active ? 'tab active' : 'tab';
    return `<a class="${cls}" href="${t.href}">${t.label}</a>`;
  }).join('');
  const rangeLabel = opts.rangeLabel ?? '7 日窗口';
  // 2026-05-19 QA-6 P1: demo pill used to hardcode href="/overview", which
  // dropped the user from /insights?demo=1 onto /overview real (losing both
  // the page context AND any filter chips). Now we render with href="#"
  // and a small inline onclick that strips ?demo=1 from the current URL,
  // so the pill takes you to the SAME page in real mode.
  // Round-1 P2 — pill label was "演示数据 · 切换", but "切换" is ambiguous
  // (theme? language?). Rename to be explicit: clicking exits demo.
  const demoPill = opts.demo
    ? `<a class="nav-demo-pill" href="#" data-real-link title="退出 Demo，连接真实数据（保留当前页面）" onclick="event.preventDefault();var u=new URL(location.href);u.searchParams.delete('demo');location.href=u.pathname+(u.search||'')+u.hash;" style="background:#fdf3e0;color:#8a6420;border:1px solid #e7c98f;padding:3px 10px;border-radius:999px;font-size:11.5px;text-decoration:none;letter-spacing:.02em;">📊 演示数据 · 切到真实</a>`
    : '';
  // Round-1 P1 — avatar was hardcoded "YL", reading like an un-replaced
  // placeholder in production. Derive initials from auth context when
  // present; in demo / unauth render a neutral "·" so it's clearly the
  // viewer slot, not a stale name.
  const meInitials = (opts.meInitials ?? '').slice(0, 2).toUpperCase() || '·';
  return `
    <nav class="nav fade-in">
      <div class="brand"><div class="brand-mark"></div><span>Matrix·Riven</span></div>
      <div class="tabs">${tabs}</div>
      <div class="nav-meta">
        ${demoPill}
        <span class="live-dot"></span>
        <span>近实时 · ${escapeHtml(rangeLabel)}</span>
        <button id="theme-toggle" type="button" aria-label="切换主题" title="切换深色/浅色主题"
          style="background:transparent;border:1px solid var(--hairline);color:var(--ink-3);padding:6px 10px;border-radius:var(--r-sm);cursor:pointer;font-size:13px;line-height:1;">◐</button>
        <div class="avatar-me" title="${escapeHtml(opts.meInitials ?? '当前查看者')}">${escapeHtml(meInitials)}</div>
      </div>
    </nav>
    <script>${THEME_TOGGLE_SCRIPT}</script>
  `;
}

/**
 * Tiny self-contained snippet: reads saved theme from localStorage, applies
 * it to <html data-theme>, and toggles on the nav button click. No external
 * deps; safe to inline alongside the CLIENT_REFRESH_SCRIPT.
 */
const THEME_TOGGLE_SCRIPT = `(function() {
  try {
    var KEY = 'mr-theme';
    var saved = localStorage.getItem(KEY);
    if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    function bind() {
      var btn = document.getElementById('theme-toggle');
      if (!btn) return;
      btn.addEventListener('click', function() {
        var cur = document.documentElement.getAttribute('data-theme');
        var next = cur === 'dark' ? null : 'dark';
        if (next) document.documentElement.setAttribute('data-theme', next);
        else document.documentElement.removeAttribute('data-theme');
        try { localStorage.setItem(KEY, next || 'light'); } catch (e) {}
      });
    }
    // 2026-05-18 round-15/17 audit: when the current page is in demo
    // mode (?demo=1), every same-origin link must propagate the flag --
    // not just a.tab. Round-17 surfaced the /retro?demo=1 back-link
    // (a.rt-back href=/overview) as a P1 because the original selector
    // missed it; broaden to any internal <a> that doesn't already carry
    // demo=1 and isn't an explicit "leave demo" target.
    function propagateDemo() {
      try {
        if (!/(\\?|&)demo=1(&|$)/.test(location.search)) return;
        var anchors = document.querySelectorAll('a[href^="/"]');
        for (var i = 0; i < anchors.length; i++) {
          var a = anchors[i];
          var href = a.getAttribute('href') || '';
          // Skip already-tagged and explicit data-real-link opt-outs.
          if (href.indexOf('demo=1') !== -1) continue;
          if (a.hasAttribute('data-real-link')) continue;
          a.setAttribute('href', href + (href.indexOf('?') >= 0 ? '&' : '?') + 'demo=1');
        }
      } catch (e) {}
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() { bind(); propagateDemo(); });
    } else { bind(); propagateDemo(); }
  } catch (e) {}
})();`;


function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
