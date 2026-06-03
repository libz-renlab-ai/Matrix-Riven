/**
 * Client-side JS bundled into the Overview HTML.
 *
 * P-B5: sort handlers + openSO stub.
 * P-B6: real openSO / closeSO that fetches `/api/{members|projects}/:id` and
 *       swaps the four returned HTML fragments into the slide-over slots
 *       mounted by `renderSlideoverShell()`. ESC + scrim-click close.
 *       Body scroll is locked while the drawer is open. The `soInterval` var
 *       is reserved here so P-C3 can plug in 30 s polling without touching
 *       the open/close contract.
 * P-C2: 30 s overview polling. `pollOverview()` fetches `/api/overview`
 *       with `If-None-Match: <last etag>`. On 304 → pulse live-dot only.
 *       On 200 → swap 5 fragments (hero/kpis/attention/members/projects)
 *       via `outerHTML`, compute KPI deltas vs `localStorage['lh.lastKpis']`
 *       and render ±N badges that fade after 4–5 s. The current KPI snapshot
 *       is persisted back to localStorage so next-load can diff.
 * P-C3: slide-over live polling while the drawer is open. `openSO` records
 *       (kind, id) and delegates the initial fetch to `pollSO`, then arms a
 *       30 s `soInterval = setInterval(pollSO, 30000)` so the panel keeps
 *       refreshing while the user reads it. `pollSO` sends
 *       `If-None-Match: soEtag` and on 304 short-circuits. On 200 it swaps
 *       the 4 drawer fragments and refreshes head fields. `closeSO` clears
 *       the interval and resets `soKind` / `soId` / `soEtag`.
 *
 * The script is wrapped in an IIFE and uses ES2017-compatible syntax (var,
 * function expressions, async/await — async is needed for fetch flow). No
 * arrow fns / const-let / template literals at runtime, so the surrounding
 * TS template literal does NOT get evaluated client-side.
 */

export const CLIENT_REFRESH_SCRIPT = `
(function () {
  function sortContainer(section, key) {
    var root = section.querySelector('.members, .projects-list');
    if (!root) return;
    var items = Array.prototype.slice.call(root.children);
    items.sort(function (a, b) {
      var av = a.dataset[key] || a.getAttribute('data-' + key) || '0';
      var bv = b.dataset[key] || b.getAttribute('data-' + key) || '0';
      var an = parseFloat(av), bn = parseFloat(bv);
      if (!isNaN(an) && !isNaN(bn) && key !== 'alpha') return bn - an;
      return String(av).localeCompare(String(bv));
    });
    items.forEach(function (el) { root.appendChild(el); });
  }
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest && e.target.closest('[data-sort]');
    if (!btn) return;
    var section = btn.closest('section');
    if (!section) return;
    sortContainer(section, btn.dataset.sort);
    // Visually mark active sort
    section.querySelectorAll('[data-sort]').forEach(function (b) {
      b.classList.toggle('active', b === btn);
    });
  });

  // ── P-B6 / P-C3: slide-over open / close + live polling ──────────────────
  // openSO records (kind, id), paints an optimistic loading state, then
  // delegates to pollSO for the initial fetch AND arms a 30 s interval that
  // keeps re-fetching while the drawer is open. closeSO clears the interval
  // and resets all slide-over state.
  var soInterval = null;
  var soKind = null;
  var soId = null;
  var soEtag = null;

  function swap(id, html) {
    var el = document.getElementById(id);
    if (el && typeof html === 'string') el.innerHTML = html;
  }

  async function pollSO() {
    if (!soKind || !soId) return;
    var base = soKind === 'member' ? '/api/members/' : '/api/projects/';
    // 2026-05-18 round-14 audit P0: when the overview is in demo mode
    // (?demo=1), the slideover fetch must carry the flag too — otherwise
    // /api/members/:id falls through to the real-data path and 404s on
    // the fake email local-parts. Propagate from location.search.
    var qs = '';
    try {
      if (typeof location !== 'undefined' && /(\\?|&)demo=1(&|$)/.test(location.search)) {
        qs = '?demo=1';
      }
    } catch (e) { /* SSR / non-browser fallback — qs stays empty */ }
    var url = base + encodeURIComponent(soId) + qs;
    var headers = { accept: 'application/json' };
    if (soEtag) headers['if-none-match'] = soEtag;
    try {
      var resp = await fetch(url, { headers: headers });
      // 304 → server says nothing changed; leave the drawer untouched.
      if (resp.status === 304) return;
      if (!resp.ok) {
        // Only paint the error state on the first fetch (when we have no
        // ETag yet) so a transient mid-poll failure doesn't blow away a
        // working drawer.
        if (!soEtag) {
          swap('so-callout', '<div class="so-callout"><div class="so-callout-text serif">加载失败 — 请稍后重试</div></div>');
        }
        return;
      }
      soEtag = resp.headers.get('etag');
      var data = await resp.json();
      if (!data) return;
      // Head fields
      var nameEl = document.getElementById('so-name');
      var metaEl = document.getElementById('so-meta');
      var avatarEl = document.getElementById('so-avatar');
      var label = data.displayName || data.name || soId;
      if (nameEl) nameEl.textContent = label;
      if (metaEl) {
        var metaText = '';
        if (data.warnings && data.warnings.length) metaText = data.warnings[0];
        else if (data.phaseGuess) metaText = String(data.phaseGuess) + ' · 健康分 ' + data.healthScore + '/10';
        metaEl.textContent = metaText;
      }
      if (avatarEl) avatarEl.textContent = String(label).slice(0, 2).toLowerCase();
      // 4 fragment slots
      var slots = ['so-callout', 'so-stats', 'so-evolve', 'so-projects'];
      var keys = ['callout', 'stats', 'evolve', 'projects'];
      if (data._html) {
        for (var i = 0; i < slots.length; i++) {
          swap(slots[i], data._html[keys[i]] || '');
        }
      }
    } catch (e) {
      if (!soEtag) {
        swap('so-callout', '<div class="so-callout"><div class="so-callout-text serif">加载失败 — 请稍后重试</div></div>');
      }
    }
  }

  window.openSO = async function (kind, id) {
    var scrim = document.getElementById('scrim');
    var so = document.getElementById('so');
    if (!scrim || !so) return;
    scrim.classList.add('open');
    so.classList.add('open');
    document.body.style.overflow = 'hidden';
    // Reset live-polling state for a fresh fetch loop.
    soKind = kind;
    soId = id;
    soEtag = null;
    if (soInterval) { clearInterval(soInterval); soInterval = null; }
    // Round-7 P2 / autonomous: wire the drawer→full-page expand link. Members
    // get /people/<localpart>, projects get /projects (no per-project page —
    // surface the slideover via #project=<id> deeplink so back-button works).
    var expandEl = document.getElementById('so-expand');
    if (expandEl) {
      var demoSuffix = '';
      try {
        if (typeof location !== 'undefined' && /(\\?|&)demo=1(&|$)/.test(location.search)) {
          demoSuffix = '?demo=1';
        }
      } catch (e) { /* SSR fallback */ }
      if (kind === 'member') {
        expandEl.setAttribute('href', '/people/' + encodeURIComponent(id) + demoSuffix);
        expandEl.hidden = false;
      } else if (kind === 'project') {
        // No per-project standalone page yet — link back to /projects with a
        // deeplink that auto-reopens the slideover (handleSlideoverHash).
        expandEl.setAttribute('href', '/projects' + demoSuffix + '#project=' + encodeURIComponent(id));
        expandEl.hidden = false;
      } else {
        expandEl.hidden = true;
      }
    }
    // Optimistic loading state — clear stale content while the fetch runs.
    swap('so-callout', '<div class="so-callout"><div class="so-callout-text serif">加载中…</div></div>');
    swap('so-stats', '');
    swap('so-evolve', '');
    swap('so-projects', '');
    var nameEl = document.getElementById('so-name');
    var metaEl = document.getElementById('so-meta');
    var avatarEl = document.getElementById('so-avatar');
    if (nameEl) nameEl.textContent = id;
    if (metaEl) metaEl.textContent = '';
    if (avatarEl) avatarEl.textContent = String(id).slice(0, 2).toLowerCase();
    // Round-1 QA P0 (EM): wire next-action affordance. Member drawer shows
    // 3 buttons (draft Slack opener / add to 1:1 / show evidence). Hidden
    // for project drawers (no useful 1:1 / Slack scope there).
    var actEl = document.getElementById('so-actions');
    if (actEl) actEl.hidden = (kind !== 'member');
    // Immediate first paint, then arm 30 s live polling.
    await pollSO();
    soInterval = setInterval(pollSO, 30000);
  };

  // wire the three slideover action buttons; each emits a scoped artifact
  // so the viewer can move from observation to one of three next actions
  // in one click instead of dashboard-staring.
  function copyTextSafe(text) {
    try {
      if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
      }
    } catch (e) {}
    // Fallback: temporary textarea + execCommand.
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e) {}
    return null;
  }
  function flashToast(msg) {
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;left:50%;bottom:30px;transform:translateX(-50%);background:#222;color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;z-index:10000;opacity:0;transition:opacity .2s;';
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.style.opacity = '1'; });
    setTimeout(function () {
      t.style.opacity = '0';
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 250);
    }, 2200);
  }
  document.addEventListener('click', function (e) {
    var target = e.target;
    if (!target || !target.closest) return;
    var btn = target.closest('#so-act-draft, #so-act-11, #so-act-evidence');
    if (!btn) return;
    if (!soId || soKind !== 'member') return;
    var nameEl = document.getElementById('so-name');
    var name = (nameEl && nameEl.textContent) || soId;
    var calloutEl = document.querySelector('#so-callout .so-callout-text');
    var calloutText = (calloutEl && calloutEl.textContent) ? calloutEl.textContent.trim() : '';
    if (btn.id === 'so-act-draft') {
      // Round-5 R4 P0 (journalist): rewrite the draft to read as a starting
      // point the viewer obviously edits, not an "AI-prompted manager
      // message". Tone shifts from prescriptive ("找个 15 分钟聊一下") to
      // exploratory ("方便时随手回一下"); also explicit "(自动草稿 · 请按
      // 实际情况修改)" prefix so the receiver — if it leaks — sees the AI
      // origin instead of mistaking it for considered human concern.
      var draft = '(自动草稿 · 请按实际情况修改) Hi ' + name + '，看 dashboard 提示「' + (calloutText || '近期可能不太顺') + '」，不一定准 — 方便时随手回一下，我看要不要帮你挪点优先级。';
      copyTextSafe(draft);
      flashToast('开场草稿已复制 · 请按实际情况修改后再发');
    } else if (btn.id === 'so-act-11') {
      var key = 'riven.next-1on1';
      var existing = [];
      try { existing = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) {}
      existing.push({ name: name, addedAt: new Date().toISOString(), note: calloutText });
      try { localStorage.setItem(key, JSON.stringify(existing.slice(-50))); } catch (e) {}
      flashToast('已加入 ' + name + ' 的下次 1:1 议程（仅保存在本机）');
    } else if (btn.id === 'so-act-evidence') {
      var stats = document.getElementById('so-stats');
      if (stats) stats.scrollIntoView({ behavior: 'smooth', block: 'start' });
      flashToast('已滚动到本周快照 — 信号证据');
    }
  });

  window.closeSO = function () {
    var scrim = document.getElementById('scrim');
    var so = document.getElementById('so');
    if (scrim) scrim.classList.remove('open');
    if (so) so.classList.remove('open');
    document.body.style.overflow = '';
    if (soInterval) { clearInterval(soInterval); soInterval = null; }
    soKind = null;
    soId = null;
    soEtag = null;
  };

  // 2026-05-19 QA-4 P1: deeplink from /projects/<id> redirect. The
  // server now 302's /projects/<id> → /projects#project=<id>; we read
  // the fragment on load and auto-open the slideover so the chevron's
  // promised "drill-down" actually lands. Same hook accepts
  // #member=<id> for symmetry with /members/<id> → /people/<id>.
  function handleSlideoverHash() {
    var hash = String(window.location.hash || '').replace(/^#/, '');
    if (!hash) return;
    var parts = hash.split('=');
    if (parts.length !== 2) return;
    var kind = parts[0] === 'project' ? 'project'
             : parts[0] === 'member'  ? 'member'
             : null;
    if (!kind) return;
    var id = decodeURIComponent(parts[1]);
    if (!/^[A-Za-z0-9._@\/-]{1,128}$/.test(id)) return;
    window.openSO(kind, id);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handleSlideoverHash);
  } else {
    handleSlideoverHash();
  }
  window.addEventListener('hashchange', handleSlideoverHash);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') window.closeSO();
  });

  // ── P-C2: Overview live polling (ETag + fragment swap) ────────────────────
  var overviewEtag = null;
  var lastKpis = null;
  try {
    var raw = localStorage.getItem('lh.lastKpis');
    if (raw) lastKpis = JSON.parse(raw);
  } catch (e) { /* ignore quota / parse errors */ }

  function flashLiveDot() {
    var dot = document.querySelector('.live-dot');
    if (!dot) return;
    dot.classList.add('pulse');
    setTimeout(function () { dot.classList.remove('pulse'); }, 1500);
  }

  function showKpiDeltas(prev, curr) {
    if (!prev || !curr) return;
    // Only diff attention.value — the kpi-good card displays
    // classifyHighOutput(members), not kpis.teamActivity.value, so we can't
    // honestly diff it here without re-deriving member counts client-side.
    var fields = [
      { key: 'attention', selector: '.kpi.kpi-warn .kpi-num' }
    ];
    for (var f = 0; f < fields.length; f++) {
      var spec = fields[f];
      var prevVal = (prev[spec.key] && prev[spec.key].value) | 0;
      var currVal = (curr[spec.key] && curr[spec.key].value) | 0;
      var delta = currVal - prevVal;
      if (delta === 0) continue;
      var card = document.querySelector(spec.selector);
      if (!card) continue;
      var badge = document.createElement('span');
      badge.className = 'kpi-badge ' + (delta > 0 ? 'up' : 'down');
      badge.textContent = (delta > 0 ? '↑' : '↓') + Math.abs(delta);
      badge.style.cssText = 'margin-left:8px;font-size:12px;color:' + (delta > 0 ? 'var(--accent-ink)' : 'var(--danger)') + ';opacity:1;transition:opacity .8s ease;';
      card.appendChild(badge);
      (function (b) {
        setTimeout(function () { b.style.opacity = '0'; }, 4000);
        setTimeout(function () { if (b && b.parentNode) b.parentNode.removeChild(b); }, 5000);
      })(badge);
    }
  }

  // 2026-06-03 PR1: which tab is this poll running on? The same script is
  // embedded on /overview, /people, /projects, /activity, /insights and the
  // member-detail page — but only Overview/People/Projects own pollable
  // Overview fragments. Returning 'other' makes the poll a no-op on the rest
  // (previously it blindly overwrote any element whose id matched a slot — e.g.
  // the /activity hero — with the Overview fragment).
  function currentPollTab() {
    var path = '';
    try { if (typeof location !== 'undefined') path = location.pathname || ''; } catch (e) { /* SSR */ }
    if (path === '/people') return 'people';
    if (path === '/projects') return 'projects';
    if (path === '/' || path === '/overview') return 'overview';
    return 'other';
  }

  async function pollOverview() {
    try {
      var tab = currentPollTab();
      if (tab === 'other') return;
      // 2026-05-18/05-19: propagate THE WHOLE query string (demo / focus /
      // range) so the polled snapshot matches the mounted view rather than
      // silently swapping a filtered view back to the unfiltered default.
      var ovQs = '';
      try {
        if (typeof location !== 'undefined' && location.search) {
          ovQs = location.search;
        }
      } catch (e) { /* SSR / non-browser fallback */ }
      // 2026-06-03 PR1: path-aware fetch + scoped swap. People/Projects are
      // FULL unsliced grids that reuse the Overview shell. Fetching the
      // Overview's top-4 fragments and swapping #members/#projects collapsed
      // those grids to 4 on every 30 s tick. Now each tab requests its own
      // UNSLICED fragment (full=members|projects) and swaps ONLY that slot, so
      // the full grid refreshes in place. Overview keeps its 7-slot top-4 swap.
      var url, slots;
      if (tab === 'people') {
        url = '/api/overview' + ovQs + (ovQs ? '&' : '?') + 'full=members';
        slots = ['members'];
      } else if (tab === 'projects') {
        url = '/api/overview' + ovQs + (ovQs ? '&' : '?') + 'full=projects';
        slots = ['projects'];
      } else {
        url = '/api/overview' + ovQs;
        slots = ['hero', 'kpis', 'attention', 'members', 'projects', 'highlights', 'collab'];
      }
      var headers = overviewEtag ? { 'if-none-match': overviewEtag } : {};
      var resp = await fetch(url, { headers: headers });
      if (resp.status === 304) {
        flashLiveDot();
        return;
      }
      if (!resp.ok) return;
      overviewEtag = resp.headers.get('etag');
      var snap = await resp.json();
      for (var i = 0; i < slots.length; i++) {
        var slot = slots[i];
        var el = document.getElementById(slot);
        if (el && snap && snap._html && snap._html[slot]) {
          el.outerHTML = snap._html[slot];
        }
      }
      // KPI delta badges only apply to the Overview KPI row.
      if (tab === 'overview' && snap && snap.kpis) {
        showKpiDeltas(lastKpis, snap.kpis);
        lastKpis = snap.kpis;
        try { localStorage.setItem('lh.lastKpis', JSON.stringify(snap.kpis)); } catch (e) { /* ignore */ }
      }
      flashLiveDot();
    } catch (e) { /* swallow network / parse errors */ }
  }

  setInterval(pollOverview, 30000);
})();
`;
