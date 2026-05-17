/**
 * Frosted-glass top navbar shared across leadership tab pages.
 *
 * P-B2 (Phase 2): renders the sticky nav with 5 tabs — Overview / People /
 * Projects / Activity / Insights. CSS lives in `_css.ts` (`.nav`, `.brand`,
 * `.brand-mark`, `.tabs`, `.tab`, `.tab.active`, `.nav-meta`, `.live-dot`,
 * `.avatar-me`, `@keyframes pulse`). Brand text is fixed to "Matrix·Riven";
 * the meta strip shows a live dot + range label + the current viewer avatar.
 */

export type ActiveTab = 'overview' | 'people' | 'projects' | 'activity' | 'insights';

interface TabSpec {
  id: ActiveTab;
  label: string;
  href: string;
}

const TABS: readonly TabSpec[] = [
  { id: 'overview', label: 'Overview', href: '/overview' },
  { id: 'people', label: 'People', href: '/people' },
  { id: 'projects', label: 'Projects', href: '/projects' },
  { id: 'activity', label: 'Activity', href: '/activity' },
  { id: 'insights', label: 'Insights', href: '/insights' },
];

export interface RenderNavOptions {
  /** Range label shown next to the live dot. Defaults to "7 日窗口". */
  rangeLabel?: string;
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
  return `
    <nav class="nav fade-in">
      <div class="brand"><div class="brand-mark"></div><span>Matrix·Riven</span></div>
      <div class="tabs">${tabs}</div>
      <div class="nav-meta">
        <span class="live-dot"></span>
        <span>实时 · ${escapeHtml(rangeLabel)}</span>
        <button id="theme-toggle" type="button" aria-label="切换主题" title="切换深色/浅色主题"
          style="background:transparent;border:1px solid var(--hairline);color:var(--ink-3);padding:6px 10px;border-radius:var(--r-sm);cursor:pointer;font-size:13px;line-height:1;">◐</button>
        <div class="avatar-me">YL</div>
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
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bind);
    } else { bind(); }
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
