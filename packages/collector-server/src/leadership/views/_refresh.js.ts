/**
 * Client-side JS bundled into the Overview HTML.
 *
 * P-B5: sort handlers + openSO stub. Real polling and slide-over wiring lands
 * in P-B6 / P-C2 / P-C3.
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
  // Stub: hash-based deep link until P-B6 wires the slide-over
  window.openSO = window.openSO || function (kind, id) {
    window.location.hash = '#detail=' + kind + ':' + id;
  };
})();
`;
