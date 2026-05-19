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

  // Round-1 QA P0 (EM): wire the three slideover action buttons. Each emits
  // a clearly-scoped artifact (no backend), so a leader can move from
  // "看到 blake 卡住" → some next step in one click instead of dashboard-staring.
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
      var draft = '@' + name + ' 我刚看到一条标记，想确认下：\\n\\n' + (calloutText || '最近的进度好像不太顺。') + '\\n\\n要不要明天找个 15 分钟聊一下，看看有没有能帮上忙的地方？';
      copyTextSafe(draft);
      flashToast('Slack 开场已复制到剪贴板');
    } else if (btn.id === 'so-act-11') {
      var key = 'riven.next-1on1';
      var existing = [];
      try { existing = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) {}
      existing.push({ name: name, addedAt: new Date().toISOString(), note: calloutText });
      try { localStorage.setItem(key, JSON.stringify(existing.slice(-50))); } catch (e) {}
      flashToast('已加入 ' + name + ' 的下次 1:1 议程（保存在本机）');
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

  async function pollOverview() {
    try {
      // 2026-05-18 round-15 audit P0: propagate the demo flag.
      // 2026-05-19 QA-7 P1: propagate THE WHOLE query string. Previous
      // version only carried "?demo=1", so a leader on
      // /overview?demo=1&focus=alex&range=7d kept getting their filtered
      // 1-member view silently swapped back to the unfiltered 4-member
      // /api/overview?demo=1 response every 30 s. The chip stayed
      // orange while the data underneath flipped. Now we forward
      // location.search verbatim (drop hash; the API doesnt care).
      var ovQs = '';
      try {
        if (typeof location !== 'undefined' && location.search) {
          ovQs = location.search;
        }
      } catch (e) { /* SSR / non-browser fallback */ }
      var headers = overviewEtag ? { 'if-none-match': overviewEtag } : {};
      var resp = await fetch('/api/overview' + ovQs, { headers: headers });
      if (resp.status === 304) {
        flashLiveDot();
        return;
      }
      if (!resp.ok) return;
      overviewEtag = resp.headers.get('etag');
      var snap = await resp.json();
      var slots = ['hero', 'kpis', 'attention', 'members', 'projects', 'highlights', 'collab'];
      for (var i = 0; i < slots.length; i++) {
        var slot = slots[i];
        var el = document.getElementById(slot);
        if (el && snap && snap._html && snap._html[slot]) {
          el.outerHTML = snap._html[slot];
        }
      }
      if (snap && snap.kpis) {
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
