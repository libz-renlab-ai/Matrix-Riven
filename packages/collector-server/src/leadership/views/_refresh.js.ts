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

  // ── P-B6: slide-over open / close ──────────────────────────────────────────
  // soInterval is intentionally declared here (and cleared on close) so that
  // P-C3 can later swap in setInterval(refetch, 30000) without touching the
  // open/close contract.
  var soInterval = null;
  var soKind = null;
  var soId = null;

  function swap(id, html) {
    var el = document.getElementById(id);
    if (el && typeof html === 'string') el.innerHTML = html;
  }

  window.openSO = function (kind, id) {
    var scrim = document.getElementById('scrim');
    var so = document.getElementById('so');
    if (!scrim || !so) return;
    scrim.classList.add('open');
    so.classList.add('open');
    document.body.style.overflow = 'hidden';
    soKind = kind;
    soId = id;
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
    var base = kind === 'member' ? '/api/members/' : '/api/projects/';
    var url = base + encodeURIComponent(id);
    fetch(url, { headers: { accept: 'application/json' } })
      .then(function (resp) {
        if (!resp.ok) throw new Error('fetch failed: ' + resp.status);
        return resp.json();
      })
      .then(function (data) {
        if (!data) return;
        if (nameEl) nameEl.textContent = data.displayName || data.name || id;
        if (metaEl) {
          var metaText = '';
          if (data.warnings && data.warnings.length) metaText = data.warnings[0];
          else if (data.phaseGuess) metaText = String(data.phaseGuess) + ' · 健康分 ' + data.healthScore + '/10';
          metaEl.textContent = metaText;
        }
        if (avatarEl) {
          var label = data.displayName || data.name || id;
          avatarEl.textContent = String(label).slice(0, 2).toLowerCase();
        }
        var slots = ['callout', 'stats', 'evolve', 'projects'];
        if (data._html) {
          for (var i = 0; i < slots.length; i++) {
            swap('so-' + slots[i], data._html[slots[i]] || '');
          }
        }
      })
      .catch(function () {
        swap('so-callout', '<div class="so-callout"><div class="so-callout-text serif">加载失败 — 请稍后重试</div></div>');
      });
  };

  window.closeSO = function () {
    var scrim = document.getElementById('scrim');
    var so = document.getElementById('so');
    if (scrim) scrim.classList.remove('open');
    if (so) so.classList.remove('open');
    document.body.style.overflow = '';
    soKind = null;
    soId = null;
    if (soInterval) { clearInterval(soInterval); soInterval = null; }
  };

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
      var headers = overviewEtag ? { 'if-none-match': overviewEtag } : {};
      var resp = await fetch('/api/overview', { headers: headers });
      if (resp.status === 304) {
        flashLiveDot();
        return;
      }
      if (!resp.ok) return;
      overviewEtag = resp.headers.get('etag');
      var snap = await resp.json();
      var slots = ['hero', 'kpis', 'attention', 'members', 'projects'];
      for (var i = 0; i < slots.length; i++) {
        var slot = slots[i];
        var el = slot === 'hero' ? document.getElementById('hero')
              : slot === 'kpis' ? document.getElementById('kpis')
              : slot === 'attention' ? document.getElementById('attention')
              : slot === 'members' ? document.getElementById('members')
              : document.getElementById('projects');
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
