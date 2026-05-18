/**
 * Inline single-page dashboard for the collector.
 *
 * Vanilla JS + fetch + minimal CSS. No external deps. No frameworks.
 * Served by mock-server.ts on `GET /`.
 *
 * Avoid using literal "</script>" or "</style>" inside this template — it
 * would break the inline <script>/<style> blocks. We don't.
 */

/**
 * Issue #283 — color bucket for a utilization value (0-1).
 * <50% → "ok" (green), 50-80% → "warn" (yellow), >=80% → "hot" (red).
 * Caller uses the bucket name as a CSS class suffix.
 */
export function quotaBucket(util: number): 'ok' | 'warn' | 'hot' {
  if (!Number.isFinite(util) || util < 0) return 'ok';
  if (util >= 0.8) return 'hot';
  if (util >= 0.5) return 'warn';
  return 'ok';
}

export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Matrix Riven Collector</title>
<style>
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f6f7f9; color: #222; }
header { display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: #1f2937; color: #fff; border-bottom: 1px solid #111; }
header h1 { font-size: 16px; margin: 0; font-weight: 600; }
header .ts { color: #9ca3af; font-size: 12px; margin-left: auto; }
header button { background: #2563eb; color: #fff; border: 0; border-radius: 4px; padding: 6px 12px; font-size: 13px; cursor: pointer; }
header button:hover { background: #1d4ed8; }
.grid { display: grid; grid-template-columns: 1fr 1fr 1.5fr; gap: 8px; padding: 8px; height: 38vh; }
.panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 4px; display: flex; flex-direction: column; min-height: 0; }
.panel h2 { margin: 0; padding: 8px 10px; font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e5e7eb; }
.panel ul { list-style: none; padding: 0; margin: 0; overflow-y: auto; flex: 1; }
.panel li { padding: 6px 10px; cursor: pointer; font-size: 13px; border-bottom: 1px solid #f3f4f6; }
.panel li:hover { background: #f9fafb; }
.panel li.sel { background: #dbeafe; color: #1e3a8a; font-weight: 500; }
.panel li .meta { color: #9ca3af; font-size: 11px; margin-left: 8px; }
.preview { margin: 0 8px 8px; background: #fff; border: 1px solid #e5e7eb; border-radius: 4px; padding: 10px; min-height: 30vh; max-height: 50vh; overflow: auto; }
.preview h2 { margin: 0 0 8px; font-size: 13px; color: #6b7280; }
.preview pre { margin: 0; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
.preview .ev { padding: 4px 6px; border-bottom: 1px solid #f3f4f6; }
.preview .ev .k { color: #7c3aed; }
.preview .ev .s { color: #059669; }
.preview .ev .n { color: #dc2626; }
.preview audio { width: 100%; }
.empty { color: #9ca3af; font-size: 13px; padding: 8px; }
.err { color: #dc2626; font-size: 12px; padding: 8px; }
.user-row { display: flex; align-items: center; gap: 6px; }
.user-row .uname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.user-row .qslot { display: inline-flex; align-items: center; gap: 4px; }
.qbar { display: inline-block; width: 60px; height: 8px; background: #e5e7eb; border-radius: 3px; overflow: hidden; vertical-align: middle; }
.qbar > span { display: block; height: 100%; width: 0%; background: #9ca3af; transition: width 0.2s ease; }
.qbar.ok > span { background: #10b981; }
.qbar.warn > span { background: #f59e0b; }
.qbar.hot > span { background: #ef4444; }
.qbar.stale { border: 1px dashed #9ca3af; opacity: 0.5; }
.qbadge { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 10px; color: #6b7280; min-width: 30px; text-align: right; }
.tab-nav { display: inline-flex; gap: 4px; margin-left: 16px; }
.tab-btn {
  background: transparent; border: 1px solid #6b7280; color: #d1d5db;
  padding: 4px 12px; border-radius: 4px; cursor: pointer; font: inherit;
}
.tab-btn:hover { background: #374151; }
.tab-btn.active { background: #2563eb; color: white; border-color: #2563eb; }
.tab-content[hidden] { display: none; }
.overview-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 16px;
}
.ov-panel {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px;
  display: block; flex-direction: initial; min-height: initial;
}
.ov-panel > h2 {
  margin: 0 0 8px; padding: 0; font-size: 14px;
  color: #111827; text-transform: none; letter-spacing: normal; border-bottom: none;
}
.ov-panel .panel-body { font-size: 12px; }
.ov-panel .panel-body .row {
  display: grid; grid-template-columns: 1fr auto;
  align-items: center; gap: 6px; padding: 2px 0;
}
.ov-panel .panel-body .row .bar {
  background: #dbeafe; height: 12px; border-radius: 2px;
  grid-column: 1 / -1;
}
.ov-panel .panel-body .row.clickable { cursor: pointer; }
.ov-panel .panel-body .row.clickable:hover { background: #f3f4f6; }
.big-number { font-size: 28px; font-weight: 600; padding: 4px 0; }
.muted { color: #6b7280; font-size: 11px; }
</style>
</head>
<body>
<header>
  <h1>Matrix Riven Collector</h1>
  <nav class="tab-nav">
    <button id="tab-btn-browse" class="tab-btn active" onclick="activateTab('browse')">Browse</button>
    <a id="tab-btn-overview" class="tab-btn" href="/overview">Overview</a>
  </nav>
  <span class="ts" id="ts"></span>
  <button id="refresh">Refresh</button>
</header>
<section id="tab-browse" class="tab-content">
<div class="grid">
  <div class="panel"><h2>Users</h2><ul id="users"><li class="empty">loading...</li></ul></div>
  <div class="panel"><h2>Dates</h2><ul id="dates"><li class="empty">select a user</li></ul></div>
  <div class="panel"><h2>Sessions</h2><ul id="sessions"><li class="empty">select a date</li></ul></div>
</div>
<div class="preview">
  <h2 id="ph">Preview</h2>
  <div id="pv"><div class="empty">select a session</div></div>
</div>
</section>
<section id="tab-overview" class="tab-content" hidden>
  <div class="overview-grid">
    <article class="panel ov-panel" id="panel-cost">
      <h2>💰 Cost</h2>
      <div class="panel-body"><div class="empty">loading…</div></div>
    </article>
    <article class="panel ov-panel" id="panel-productivity">
      <h2>⚡ Productivity</h2>
      <div class="panel-body"><div class="empty">loading…</div></div>
    </article>
    <article class="panel ov-panel" id="panel-projects">
      <h2>📦 Projects</h2>
      <div class="panel-body"><div class="empty">loading…</div></div>
    </article>
    <article class="panel ov-panel" id="panel-quality">
      <h2>⚠️ Quality</h2>
      <div class="panel-body"><div class="empty">loading…</div></div>
    </article>
  </div>
</section>
<script>
(function () {
  var sel = { user: null, date: null, sid: null, sext: null };
  var $ = function (id) { return document.getElementById(id); };
  function setTs() {
    var d = new Date();
    $('ts').textContent = 'last refreshed ' + d.toLocaleTimeString();
  }
  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function render(ulId, items, fn) {
    var ul = $(ulId);
    ul.innerHTML = '';
    if (!items || items.length === 0) {
      var li = document.createElement('li');
      li.className = 'empty';
      li.textContent = '(empty)';
      ul.appendChild(li);
      return;
    }
    items.forEach(function (it) {
      var li = document.createElement('li');
      fn(li, it);
      ul.appendChild(li);
    });
  }
  function showErr(ulId, msg) {
    var ul = $(ulId);
    ul.innerHTML = '<li class="err">' + escHtml(msg) + '</li>';
  }
  function quotaBucket(util) {
    if (typeof util !== 'number' || !isFinite(util) || util < 0) return 'ok';
    if (util >= 0.8) return 'hot';
    if (util >= 0.5) return 'warn';
    return 'ok';
  }
  function todayUtc() {
    return new Date().toISOString().slice(0, 10);
  }
  function quotaSlotHtml(util, stale) {
    var bucket = quotaBucket(util);
    var pct = Math.max(0, Math.min(1, util)) * 100;
    var pctText = Math.round(pct) + '%';
    var staleCls = stale ? ' stale' : '';
    return '<span class="qslot">'
      + '<span class="qbar ' + bucket + staleCls + '"><span style="width:' + pct.toFixed(1) + '%"></span></span>'
      + '<span class="qbadge">' + pctText + '</span>'
      + '</span>';
  }
  function quotaPendingHtml() {
    return '<span class="qslot">'
      + '<span class="qbar"><span></span></span>'
      + '<span class="qbadge">—</span>'
      + '</span>';
  }
  function fetchQuotaFor(u, li) {
    var url = '/api/quota?user=' + encodeURIComponent(u) + '&date=' + encodeURIComponent(todayUtc());
    fetch(url).then(function (r) {
      if (!r.ok) return null;
      return r.json();
    }).then(function (q) {
      if (!q || !li) return;
      var slots = li.querySelectorAll('.qslot');
      if (slots.length < 2) return;
      var stale = !!q.stale;
      var h5 = quotaSlotHtml(Number(q.five_hour_utilization) || 0, stale);
      var h7 = quotaSlotHtml(Number(q.seven_day_utilization) || 0, stale);
      slots[0].outerHTML = h5;
      slots[1].outerHTML = h7;
    }).catch(function () { /* keep — placeholder */ });
  }
  function loadUsers() {
    sel.user = sel.date = sel.sid = sel.sext = null;
    $('dates').innerHTML = '<li class="empty">select a user</li>';
    $('sessions').innerHTML = '<li class="empty">select a date</li>';
    $('pv').innerHTML = '<div class="empty">select a session</div>';
    $('ph').textContent = 'Preview';
    fetch('/api/users').then(function (r) { return r.json(); }).then(function (d) {
      var liByUser = {};
      render('users', d.users, function (li, u) {
        li.innerHTML = '<div class="user-row">'
          + '<span class="uname">' + escHtml(u) + '</span>'
          + quotaPendingHtml()
          + quotaPendingHtml()
          + '</div>';
        li.onclick = function () { selectUser(u, li); };
        liByUser[u] = li;
      });
      setTs();
      if (d.users && d.users.length) {
        d.users.forEach(function (u) {
          fetchQuotaFor(u, liByUser[u]);
        });
      }
    }).catch(function (e) { showErr('users', 'failed: ' + e.message); });
  }
  function selectUser(u, li) {
    sel.user = u; sel.date = sel.sid = sel.sext = null;
    Array.prototype.forEach.call($('users').querySelectorAll('li'), function (x) { x.classList.remove('sel'); });
    if (li) li.classList.add('sel');
    $('sessions').innerHTML = '<li class="empty">select a date</li>';
    $('pv').innerHTML = '<div class="empty">select a session</div>';
    $('dates').innerHTML = '<li class="empty">loading...</li>';
    fetch('/api/dates?user=' + encodeURIComponent(u)).then(function (r) { return r.json(); }).then(function (d) {
      render('dates', d.dates, function (li2, dt) {
        li2.textContent = dt;
        li2.onclick = function () { selectDate(dt, li2); };
      });
    }).catch(function (e) { showErr('dates', 'failed: ' + e.message); });
  }
  function selectDate(dt, li) {
    sel.date = dt; sel.sid = sel.sext = null;
    Array.prototype.forEach.call($('dates').querySelectorAll('li'), function (x) { x.classList.remove('sel'); });
    if (li) li.classList.add('sel');
    $('pv').innerHTML = '<div class="empty">select a session</div>';
    $('sessions').innerHTML = '<li class="empty">loading...</li>';
    var url = '/api/sessions?user=' + encodeURIComponent(sel.user) + '&date=' + encodeURIComponent(dt);
    fetch(url).then(function (r) { return r.json(); }).then(function (d) {
      render('sessions', d.sessions, function (li2, s) {
        var size = s.size < 1024 ? s.size + ' B' : (s.size / 1024).toFixed(1) + ' KB';
        li2.innerHTML = '<span>' + escHtml(s.id) + '.' + escHtml(s.ext) + '</span><span class="meta">' + size + '</span>';
        li2.onclick = function () { selectSession(s, li2); };
      });
    }).catch(function (e) { showErr('sessions', 'failed: ' + e.message); });
  }
  function selectSession(s, li) {
    sel.sid = s.id; sel.sext = s.ext;
    Array.prototype.forEach.call($('sessions').querySelectorAll('li'), function (x) { x.classList.remove('sel'); });
    if (li) li.classList.add('sel');
    var url = '/api/file?user=' + encodeURIComponent(sel.user) + '&date=' + encodeURIComponent(sel.date) + '&id=' + encodeURIComponent(s.id) + '&ext=' + encodeURIComponent(s.ext);
    $('ph').textContent = s.id + '.' + s.ext;
    if (s.ext === 'ogg') {
      $('pv').innerHTML = '<audio controls preload="metadata" src="' + escHtml(url) + '"></audio>';
      return;
    }
    $('pv').innerHTML = '<div class="empty">loading...</div>';
    fetch(url).then(function (r) { return r.text(); }).then(function (t) {
      renderJsonl(t);
    }).catch(function (e) { $('pv').innerHTML = '<div class="err">failed: ' + escHtml(e.message) + '</div>'; });
  }
  function renderJsonl(text) {
    var lines = text.split(/\\r?\\n/);
    var html = '';
    var count = 0;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line.trim()) continue;
      count++;
      try {
        var obj = JSON.parse(line);
        html += '<div class="ev"><pre>' + colorize(JSON.stringify(obj, null, 2)) + '</pre></div>';
      } catch (e) {
        html += '<div class="ev"><pre>' + escHtml(line) + '</pre></div>';
      }
      if (count >= 500) {
        html += '<div class="empty">(truncated at 500 events)</div>';
        break;
      }
    }
    if (count === 0) html = '<div class="empty">(empty)</div>';
    $('pv').innerHTML = html;
  }
  function colorize(s) {
    var esc = escHtml(s);
    esc = esc.replace(/(&quot;[^&]*?&quot;)(\\s*:)/g, '<span class="k">$1</span>$2');
    esc = esc.replace(/:\\s*(&quot;[^&]*?&quot;)/g, function (m, p) { return ': <span class="s">' + p + '</span>'; });
    esc = esc.replace(/:\\s*(-?\\d+(?:\\.\\d+)?)/g, ': <span class="n">$1</span>');
    return esc;
  }
  function activateTab(name) {
    var browseSec = $('tab-browse'), overviewSec = $('tab-overview');
    var browseBtn = $('tab-btn-browse'), overviewBtn = $('tab-btn-overview');
    if (name === 'overview') {
      browseSec.setAttribute('hidden', '');
      overviewSec.removeAttribute('hidden');
      browseBtn.classList.remove('active');
      overviewBtn.classList.add('active');
      loadOverview();
    } else {
      overviewSec.setAttribute('hidden', '');
      browseSec.removeAttribute('hidden');
      overviewBtn.classList.remove('active');
      browseBtn.classList.add('active');
    }
  }
  // Expose for the inline header onclick handlers — the IIFE wraps everything
  // else, but the buttons in the rendered HTML reference the global scope.
  window.activateTab = activateTab;

  function loadOverview() {
    fetch('/api/overview?date=' + encodeURIComponent(todayUtc()))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        renderCost(d.cost);
        renderProductivity(d.productivity);
        renderProjects(d.projects);
        renderQuality(d.quality);
        setTs();
      })
      .catch(function (e) {
        var msg = '<div class="err">overview load failed: ' + escHtml(e.message) + '</div>';
        ['panel-cost', 'panel-productivity', 'panel-projects', 'panel-quality'].forEach(function (id) {
          $(id).querySelector('.panel-body').innerHTML = msg;
        });
      });
  }

  function renderBar(label, value, max, suffix) {
    var pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
    var disp = (typeof value === 'number' && value.toFixed) ? value.toFixed(2) : String(value);
    return '<div class="row clickable" data-user="' + escHtml(label) + '">' +
      '<span>' + escHtml(label) + '</span>' +
      '<span>' + escHtml(disp) + (suffix || '') + '</span>' +
      '<div class="bar" style="width:' + pct + '%"></div>' +
    '</div>';
  }

  function renderCost(c) {
    var body = $('panel-cost').querySelector('.panel-body');
    if (!c || c.per_user.length === 0) { body.innerHTML = '<div class="empty">No data</div>'; return; }
    var maxCost = c.per_user[0].cost_usd || 1;
    var html = '<div class="big-number">$' + (c.team_total_usd || 0).toFixed(2) + '</div>' +
      '<div class="muted">today team total</div>';
    c.per_user.forEach(function (u) { html += renderBar(u.user_id, u.cost_usd, maxCost, ' USD'); });
    if (c.model_distribution && c.model_distribution.length) {
      html += '<div class="muted" style="margin-top:8px">model usage:</div>';
      c.model_distribution.forEach(function (m) {
        html += '<div class="row"><span>' + escHtml(m.model) + '</span><span>' +
          (m.pct * 100).toFixed(0) + '%</span></div>';
      });
    }
    body.innerHTML = html;
    wireDrillDown(body);
  }

  function renderProductivity(p) {
    var body = $('panel-productivity').querySelector('.panel-body');
    if (!p || p.per_user.length === 0) { body.innerHTML = '<div class="empty">No data</div>'; return; }
    var maxTurn = p.per_user[0].turn_count || 1;
    var html = '';
    p.per_user.forEach(function (u) {
      var failRate = u.tool_calls_total > 0
        ? '(fail ' + ((u.tool_calls_failed / u.tool_calls_total) * 100).toFixed(0) + '%)'
        : '';
      html += '<div class="row clickable" data-user="' + escHtml(u.user_id) + '">' +
        '<span>' + escHtml(u.user_id) + '</span>' +
        '<span>' + u.turn_count + ' turns ' + failRate + '</span>' +
        '<div class="bar" style="width:' + ((u.turn_count / maxTurn) * 100) + '%"></div>' +
        '</div>';
    });
    body.innerHTML = html;
    wireDrillDown(body);
  }

  function renderProjects(p) {
    var body = $('panel-projects').querySelector('.panel-body');
    if (!p || p.top_cwd.length === 0) { body.innerHTML = '<div class="empty">No data</div>'; return; }
    var html = '<div class="muted">top projects today:</div>';
    var maxSess = p.top_cwd[0].session_count || 1;
    p.top_cwd.forEach(function (c) {
      html += '<div class="row"><span>' + escHtml(c.cwd_basename) + '</span>' +
        '<span>' + c.session_count + ' sess</span>' +
        '<div class="bar" style="width:' + ((c.session_count / maxSess) * 100) + '%"></div></div>';
    });
    if (p.top_git_branch && p.top_git_branch.length) {
      html += '<div class="muted" style="margin-top:8px">top branches:</div>';
      p.top_git_branch.slice(0, 5).forEach(function (b) {
        html += '<div class="row"><span>' + escHtml(b.git_branch) + '</span>' +
          '<span>' + b.session_count + '</span></div>';
      });
    }
    body.innerHTML = html;
  }

  function renderQuality(q) {
    var body = $('panel-quality').querySelector('.panel-body');
    if (!q) { body.innerHTML = '<div class="empty">No data</div>'; return; }
    var html = '<div class="big-number">' + (q.team_total_redactions || 0) + '</div>' +
      '<div class="muted">L1 sensitive-field redactions today</div>';
    if (q.redactions_per_user.length === 0 && q.tool_failures_per_user.length === 0 && q.out_of_control_sessions.length === 0) {
      body.innerHTML = html + '<div class="empty">No alerts</div>';
      return;
    }
    if (q.redactions_per_user.length) {
      html += '<div class="muted" style="margin-top:8px">redactions per user:</div>';
      q.redactions_per_user.forEach(function (r) {
        html += '<div class="row clickable" data-user="' + escHtml(r.user_id) + '">' +
          '<span>' + escHtml(r.user_id) + '</span>' +
          '<span>' + r.redaction_count + '</span></div>';
      });
    }
    if (q.tool_failures_per_user.length) {
      html += '<div class="muted" style="margin-top:8px">tool failures:</div>';
      q.tool_failures_per_user.forEach(function (t) {
        html += '<div class="row clickable" data-user="' + escHtml(t.user_id) + '">' +
          '<span>' + escHtml(t.user_id) + '</span>' +
          '<span>' + t.tool_calls_failed + '</span></div>';
      });
    }
    if (q.out_of_control_sessions.length) {
      html += '<div class="muted" style="margin-top:8px">OVER_200K sessions:</div>';
      q.out_of_control_sessions.forEach(function (o) {
        html += '<div class="row clickable" data-user="' + escHtml(o.user_id) + '">' +
          '<span>' + escHtml(o.user_id) + ' / ' + escHtml(o.session_id) + '</span>' +
          '<span class="muted">' + escHtml(o.ts) + '</span></div>';
      });
    }
    body.innerHTML = html;
    wireDrillDown(body);
  }

  function wireDrillDown(container) {
    Array.prototype.forEach.call(container.querySelectorAll('.row.clickable'), function (row) {
      row.onclick = function () {
        var u = row.getAttribute('data-user');
        if (!u) return;
        activateTab('browse');
        // Reuse the existing user-selection flow: simulate a click on the
        // matching user in the Browse list.
        var match = Array.prototype.filter.call($('users').querySelectorAll('li'), function (li) {
          return li.textContent.indexOf(u) === 0;
        })[0];
        if (match) match.click();
      };
    });
  }

  $('refresh').onclick = loadUsers;
  loadUsers();
})();
</script>
</body>
</html>`;
