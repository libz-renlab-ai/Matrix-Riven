/**
 * Server-rendered HTML overview page for the Leadership Dashboard.
 *
 * Exports `renderOverview(snapshot)` → complete HTML document string.
 * Inline <style> uses LEADERSHIP_CSS; inline <script> polls /api/overview
 * every 30 s and updates KPI values in place without a full reload.
 *
 * XSS hygiene: every user-controlled string passes through escapeHtml().
 */

import type { OverviewSnapshot, MemberSnapshot, ProjectSnapshot, CollabHit } from '../types.js';
import { LEADERSHIP_CSS, avatarColor, emailInitials } from './styles.css.js';
import { renderNav } from './_nav.html.js';
import { renderHeroFragment, renderKpisFragment } from './_overview-fragments.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function renderOverview(snapshot: OverviewSnapshot): string {
  const { members, projects, collaboration, range, computedAt } = snapshot;

  const membersHtml = members.length === 0
    ? `<div class="lh-empty">这个窗口内没有成员活动</div>`
    : members.map(m => renderMemberCard(m)).join('');

  const projectsHtml = projects.length === 0
    ? `<div class="lh-empty">这个窗口内没有项目活动</div>`
    : projects.map(p => renderProjectCard(p)).join('');

  const collabHtml = collaboration.length === 0
    ? ''
    : `<div class="lh-section-h">协作机会（${collaboration.length}）</div>
       <div class="lh-collab-list">${collaboration.slice(0, 10).map(renderCollabCard).join('')}</div>`;

  const navRangeLabel = rangeToNavLabel(range.label);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Leadership · Matrix-Riven</title>
<style>${LEADERSHIP_CSS}</style>
</head>
<body>
<div class="shell">
${renderNav('overview', { rangeLabel: navRangeLabel })}
${renderHeroFragment(snapshot)}
${renderKpisFragment(snapshot)}
<div class="lh-container">
  <div class="lh-topbar">
    <h1>团队 leadership 视图</h1>
    <div class="lh-meta">
      过去 ${escapeHtml(range.label)} · 截至 ${escapeHtml(computedAt.slice(11, 19))} UTC
      <span class="lh-refresh-tag">🔄 30s</span>
    </div>
  </div>
  <div class="lh-section-h">成员（${members.length}）</div>
  <div class="lh-member-list">${membersHtml}</div>
  <div class="lh-section-h">项目（${projects.length}）</div>
  <div class="lh-project-list">${projectsHtml}</div>
  ${collabHtml}
</div>
</div>
<script>${REFRESH_SCRIPT}</script>
</body>
</html>`;
}

/** Map a DateRange.label (`7d` / `24h` / `today` / `30d`) to a CJK nav label. */
function rangeToNavLabel(label: string): string {
  switch (label) {
    case '24h': return '24 小时';
    case 'today': return '今日';
    case '30d': return '30 日窗口';
    case '7d':
    default: return '7 日窗口';
  }
}

// ---------------------------------------------------------------------------
// XSS helper (exported so tests can validate it directly)
// ---------------------------------------------------------------------------

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Card renderers
// ---------------------------------------------------------------------------

function renderMemberCard(m: MemberSnapshot): string {
  const color = avatarColor(m.email);
  const initials = emailInitials(m.email);
  const badgeClass = badgeClassFor(m.stateBadge);
  const badgeText = badgeTextFor(m.stateBadge);
  const trend = m.trend7d.length > 0 ? renderSparkline(m.trend7d) : '';
  return `<a class="lh-member-card" href="/members/${encodeURIComponent(m.displayName)}" title="${escapeHtml(m.email)}">
    <div class="lh-avatar" style="background:${color}">${escapeHtml(initials)}</div>
    <div class="lh-member-info">
      <div class="lh-member-name">${escapeHtml(m.displayName)}</div>
      <div class="lh-member-meta">${m.today.sessions} sessions${m.topProject ? ' · ' + escapeHtml(m.topProject) : ''}${m.warnings.length ? ' · ' + escapeHtml(m.warnings.join(' · ')) : ''}</div>
    </div>
    ${trend}
    <span class="lh-badge ${badgeClass}">${escapeHtml(badgeText)}</span>
  </a>`;
}

function renderProjectCard(p: ProjectSnapshot): string {
  const trend = p.trend7d.length > 0 ? renderSparkline(p.trend7d) : '';
  const eta = p.etaDays == null ? '' : `<span class="lh-eta-note">≈ ${p.etaDays} 天（按节奏估算）</span>`;
  const busWarn = p.busFactorWarning ? `<span class="lh-badge stuck" title="单人风险">单人</span>` : '';
  return `<a class="lh-project-card" href="/projects/${encodeURIComponent(p.name)}">
    <div class="lh-member-info">
      <div class="lh-member-name">${escapeHtml(p.name)}</div>
      <div class="lh-member-meta">${p.contributors.length} 人 · 阶段:${escapeHtml(p.phaseGuess)} · 健康 ${p.healthScore}/10 ${eta}</div>
    </div>
    ${trend}
    <span class="lh-badge ${stateClass(p.state)}">${escapeHtml(stateLabel(p.state))}</span>
    ${busWarn}
  </a>`;
}

function renderCollabCard(c: CollabHit): string {
  return `<div class="lh-collab-card">
    <div class="lh-member-info">
      <div class="lh-member-name">${escapeHtml(c.members.map(e => e.split('@')[0] ?? e).join(' · '))}</div>
      <div class="lh-member-meta">→ ${escapeHtml(c.filePath)} · 最后触碰 ${escapeHtml(c.lastTouched.slice(0, 10))}</div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Sparkline helper
// ---------------------------------------------------------------------------

function renderSparkline(values: number[]): string {
  if (values.length === 0) return '';
  const max = Math.max(...values, 1);
  const bars = values.map(v => `<span style="height:${Math.round((v / max) * 100)}%"></span>`).join('');
  return `<span class="lh-sparkline">${bars}</span>`;
}

// ---------------------------------------------------------------------------
// Badge / state helpers
// ---------------------------------------------------------------------------

function badgeClassFor(s: string): string {
  return s === 'active' ? 'ok'
    : s === 'stuck' ? 'stuck'
    : s === 'needs_help' ? 'help'
    : s === 'quiet' ? 'quiet'
    : 'low';
}

function badgeTextFor(s: string): string {
  return s === 'active' ? '活跃'
    : s === 'stuck' ? '卡点'
    : s === 'needs_help' ? '求助'
    : s === 'quiet' ? '安静'
    : '低活跃';
}

function stateClass(s: string): string {
  return s === 'active' ? 'ok'
    : s === 'maintaining' ? 'low'
    : s === 'revived' ? 'ok'
    : 'quiet';
}

function stateLabel(s: string): string {
  return s === 'active' ? '活跃'
    : s === 'maintaining' ? '维护'
    : s === 'revived' ? '复活'
    : '沉睡';
}

// ---------------------------------------------------------------------------
// Client-side refresh script (no external deps, ES5-compatible)
// ---------------------------------------------------------------------------

const REFRESH_SCRIPT = `
(function(){
  function getRange(){
    var p = new URLSearchParams(window.location.search);
    return p.get('range') || '7d';
  }
  function update(){
    fetch('/api/overview?range=' + encodeURIComponent(getRange()))
      .then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); })
      .then(function(snap){
        // Refresh KPI numbers in place
        var ta = document.querySelector('[data-kpi=teamActivity]');
        if (ta) ta.textContent = snap.kpis.teamActivity.value;
        var at = document.querySelector('[data-kpi=attention]');
        if (at) at.textContent = snap.kpis.attention.value;
        var pj = document.querySelector('[data-kpi=projects]');
        if (pj) pj.textContent = snap.kpis.projects.active + snap.kpis.projects.maintaining;
      })
      .catch(function(){});
  }
  setInterval(update, 30000);
})();
`;
