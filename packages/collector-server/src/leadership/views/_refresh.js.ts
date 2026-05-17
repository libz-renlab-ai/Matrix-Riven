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
 *
 * The script is wrapped in an IIFE and is ES5-compatible (no arrow fns, no
 * const/let, no template literals at runtime — the surrounding TS template
 * literal does NOT get evaluated client-side).
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
})();
`;
