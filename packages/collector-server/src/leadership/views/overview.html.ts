/**
 * Server-rendered HTML overview page for the Leadership Dashboard.
 *
 * Exports `renderOverview(snapshot)` → complete HTML document string.
 * Inline <style> uses LEADERSHIP_CSS; inline <script> polls /api/overview
 * every 30 s and updates KPI values in place without a full reload.
 *
 * XSS hygiene: every user-controlled string passes through escapeHtml().
 */

import type { OverviewSnapshot, CollabHit } from '../types.js';
import { LEADERSHIP_CSS } from './styles.css.js';
import { renderNav } from './_nav.html.js';
import { renderHeroFragment, renderKpisFragment, renderAttentionFragment, renderMembersFragment, renderProjectsFragment } from './_overview-fragments.js';
import { CLIENT_REFRESH_SCRIPT } from './_refresh.js.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function renderOverview(snapshot: OverviewSnapshot): string {
  const { members, projects, collaboration, range, computedAt } = snapshot;

  const membersSection = members.length === 0
    ? `<section id="members" class="section fade-in"><div class="lh-empty">这个窗口内没有成员活动</div></section>`
    : renderMembersFragment(snapshot);

  const projectsSection = projects.length === 0
    ? `<section id="projects" class="section fade-in"><div class="lh-empty">这个窗口内没有项目活动</div></section>`
    : renderProjectsFragment(snapshot);

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
${renderAttentionFragment(snapshot)}
${membersSection}
${projectsSection}
<div class="lh-container">
  <div class="lh-topbar">
    <h1>团队 leadership 视图</h1>
    <div class="lh-meta">
      过去 ${escapeHtml(range.label)} · 截至 ${escapeHtml(computedAt.slice(11, 19))} UTC
      <span class="lh-refresh-tag">🔄 30s</span>
    </div>
  </div>
  ${collabHtml}
</div>
</div>
<script>${CLIENT_REFRESH_SCRIPT}</script>
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
// Collaboration card (Phase-1 contract — kept until P-B7 surfaces collab in v7)
// ---------------------------------------------------------------------------

function renderCollabCard(c: CollabHit): string {
  return `<div class="lh-collab-card">
    <div class="lh-member-info">
      <div class="lh-member-name">${escapeHtml(c.members.map(e => e.split('@')[0] ?? e).join(' · '))}</div>
      <div class="lh-member-meta">→ ${escapeHtml(c.filePath)} · 最后触碰 ${escapeHtml(c.lastTouched.slice(0, 10))}</div>
    </div>
  </div>`;
}
