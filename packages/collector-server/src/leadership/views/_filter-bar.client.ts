/**
 * Phase 3-A · Filter Bar client-side interactions.
 *
 * Self-contained inline script (no external deps) that wires up:
 *   - clicking a chip → opens a popover menu of options
 *   - selecting an option → rewrites `location.search` and reloads (URL is
 *     the single source of truth for filter state)
 *   - clicking chip ✕ → drops that single dimension
 *   - clicking ↻ 清空 → drops all filter dimensions
 *   - chip data-fb-options is JSON: [{ value, label }, ...]
 *
 * Inlined into the `<script>` block already produced by `_refresh.js.ts`
 * so we don't add a new external request.
 */

export const FILTER_BAR_SCRIPT = `(function() {
  function urlSetMany(updates) {
    var u = new URL(location.href);
    for (var k in updates) {
      if (updates[k] == null || updates[k] === '') u.searchParams.delete(k);
      else u.searchParams.set(k, updates[k]);
    }
    location.assign(u.pathname + (u.search || '') + (u.hash || ''));
  }

  function clearKey(key) {
    var u = new URL(location.href);
    u.searchParams.delete(key);
    if (key === 'range') {
      // Removing range falls back to default 'today' — also clear from/to
      u.searchParams.delete('from');
      u.searchParams.delete('to');
    }
    location.assign(u.pathname + (u.search || '') + (u.hash || ''));
  }

  function clearAll() {
    var u = new URL(location.href);
    ['focus','project','range','from','to','state'].forEach(function(k) { u.searchParams.delete(k); });
    location.assign(u.pathname + (u.search || '') + (u.hash || ''));
  }

  function closeOpenMenus() {
    var menus = document.querySelectorAll('.fb-menu');
    for (var i = 0; i < menus.length; i++) menus[i].remove();
  }

  function openMenuFor(chip) {
    closeOpenMenus();
    var key = chip.getAttribute('data-fb-chip');
    var optsJson = chip.getAttribute('data-fb-options') || '[]';
    var options;
    try { options = JSON.parse(optsJson); } catch (e) { options = []; }
    var menu = document.createElement('div');
    menu.className = 'fb-menu';
    menu.setAttribute('role', 'listbox');
    // Position roughly below the chip
    var rect = chip.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.left = rect.left + 'px';
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.minWidth = Math.max(160, rect.width) + 'px';
    var inner = '';
    if (options.length === 0) {
      inner = '<div class="fb-menu-empty">没有可选项</div>';
    } else {
      for (var i = 0; i < options.length; i++) {
        var o = options[i];
        inner += '<button type="button" class="fb-menu-item" data-fb-value="' + escAttr(o.value) + '">' + escHtml(o.label) + '</button>';
      }
    }
    if (key === 'range') {
      inner += '<div class="fb-menu-divider"></div>';
      inner += '<div class="fb-menu-hint">选择「自定义」后可输入日期</div>';
    }
    menu.innerHTML = inner;
    document.body.appendChild(menu);

    menu.addEventListener('click', function(e) {
      var item = e.target && e.target.closest && e.target.closest('[data-fb-value]');
      if (!item) return;
      var value = item.getAttribute('data-fb-value');
      closeOpenMenus();
      if (key === 'range' && value === 'custom') {
        // Prompt for from/to instead of immediate apply.
        var f = window.prompt('开始日期 (YYYY-MM-DD)');
        if (!f) return;
        var t = window.prompt('结束日期 (YYYY-MM-DD)');
        if (!t) return;
        urlSetMany({ range: 'custom', from: f, to: t });
        return;
      }
      var update = {};
      update[key] = value;
      if (key === 'range' && value !== 'custom') {
        update.from = '';
        update.to = '';
      }
      urlSetMany(update);
    });
  }

  function escAttr(s) {
    return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function bind() {
    document.addEventListener('click', function(e) {
      var t = e.target;
      if (!t) return;
      var x = t.closest && t.closest('[data-fb-clear]');
      if (x) { e.preventDefault(); clearKey(x.getAttribute('data-fb-clear')); return; }
      var ca = t.closest && t.closest('[data-fb-clear-all]');
      if (ca) { e.preventDefault(); clearAll(); return; }
      var chip = t.closest && t.closest('[data-fb-chip]');
      if (chip) { e.preventDefault(); openMenuFor(chip); return; }
      // Click outside menu — close
      if (!t.closest || !t.closest('.fb-menu')) closeOpenMenus();
    }, true);

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeOpenMenus();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();`;

export const FILTER_BAR_CSS = `
.filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: var(--surface-1, #f7f8fc);
  border-bottom: 1px solid var(--hairline, #e0e3eb);
  font-size: 13px;
  flex-wrap: wrap;
}
.filter-bar-active {
  background: #fffaf0;
  border-bottom: 2px solid #ff9d3a;
}
[data-theme="dark"] .filter-bar { background: #16161b; border-bottom-color: #2a2a33; }
[data-theme="dark"] .filter-bar-active { background: #2a1f10; border-bottom-color: #ff9d3a; }
.fb-prefix {
  color: var(--ink-3, #888);
  font-size: 12px;
  margin-right: 2px;
}
.fb-chip {
  background: #fff;
  border: 1px solid var(--hairline, #d0d3db);
  border-radius: 16px;
  padding: 4px 12px;
  cursor: pointer;
  font-size: 13px;
  color: var(--ink-1, #1a1d2e);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.fb-chip:hover { background: #fafbfd; }
[data-theme="dark"] .fb-chip { background: #1f1f25; color: #e8e8ec; border-color: #3a3a44; }
[data-theme="dark"] .fb-chip:hover { background: #26262d; }
.fb-chip-active {
  background: #ff9d3a !important;
  color: #fff !important;
  border-color: #ff9d3a !important;
  font-weight: 600;
}
.fb-chip-caret {
  opacity: .55;
  font-size: 10px;
  margin-left: 2px;
}
.fb-chip-x {
  margin-left: 4px;
  background: transparent;
  border: 0;
  color: #fff;
  cursor: pointer;
  font-size: 11px;
  padding: 0 2px;
  line-height: 1;
}
.fb-chip-x:hover { opacity: .8; }
.fb-spacer { flex: 1 1 auto; }
.fb-idle {
  color: var(--ink-3, #aaa);
  font-size: 11px;
}
.fb-clear-all {
  background: transparent;
  border: 0;
  color: #cc5500;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
[data-theme="dark"] .fb-clear-all { color: #ffb968; }
.fb-menu {
  z-index: 1000;
  background: #fff;
  border: 1px solid var(--hairline, #d0d3db);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,.12);
  max-height: 320px;
  overflow-y: auto;
  padding: 4px;
}
[data-theme="dark"] .fb-menu { background: #1f1f25; border-color: #3a3a44; box-shadow: 0 8px 24px rgba(0,0,0,.45); }
.fb-menu-item {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  padding: 7px 12px;
  font-size: 13px;
  cursor: pointer;
  color: var(--ink-1, #1a1d2e);
  border-radius: 4px;
}
.fb-menu-item:hover { background: #f0f0f5; }
[data-theme="dark"] .fb-menu-item { color: #e8e8ec; }
[data-theme="dark"] .fb-menu-item:hover { background: #2a2a33; }
.fb-menu-empty, .fb-menu-hint {
  padding: 8px 12px;
  font-size: 11px;
  color: var(--ink-3, #888);
}
.fb-menu-divider {
  height: 1px;
  background: var(--hairline, #e0e3eb);
  margin: 4px 0;
}
[data-theme="dark"] .fb-menu-divider { background: #3a3a44; }
.dimmed { opacity: 0.3; }
`;
