/**
 * Server-rendered HTML overview page for the Leadership Dashboard.
 *
 * Exports `renderOverview(snapshot)` → complete HTML document string.
 * Inline <style> uses LEADERSHIP_CSS; inline <script> polls /api/overview
 * every 30 s and updates KPI values in place without a full reload.
 *
 * XSS hygiene: every user-controlled string passes through escapeHtml().
 */

import type { OverviewSnapshot } from '../types.js';
import { LEADERSHIP_CSS } from './styles.css.js';
import { renderNav } from './_nav.html.js';
import {
  renderHeroFragment,
  renderKpisFragment,
  renderAttentionFragment,
  renderMembersFragment,
  renderProjectsFragment,
  renderHighlightsFragment,
  renderCollabFragment,
} from './_overview-fragments.js';
import { renderSlideoverShell } from './_slideover.html.js';
import { CLIENT_REFRESH_SCRIPT } from './_refresh.js.js';
import { FILTER_BAR_CSS, FILTER_BAR_SCRIPT } from './_filter-bar.client.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RenderOverviewExtras {
  /** Phase 3-A. Pre-rendered filter bar HTML to inject below the nav. */
  filterBarHtml?: string;
}

export function renderOverview(snapshot: OverviewSnapshot, extras: RenderOverviewExtras = {}): string {
  const { members, projects, range } = snapshot;

  const membersSection = members.length === 0
    ? `<section id="members" class="section fade-in"><div class="lh-empty">这个窗口内没有成员活动</div></section>`
    : renderMembersFragment(snapshot, { limit: 4 });

  const projectsSection = projects.length === 0
    ? `<section id="projects" class="section fade-in"><div class="lh-empty">这个窗口内没有项目活动</div></section>`
    : renderProjectsFragment(snapshot, { limit: 4 });

  const navRangeLabel = rangeToNavLabel(range.label);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Leadership · Matrix-Riven</title>
<style>${LEADERSHIP_CSS}
${FILTER_BAR_CSS}</style>
</head>
<body>
<div class="shell">
${renderNav('overview', { rangeLabel: navRangeLabel })}
${extras.filterBarHtml ?? ''}
${snapshot.staleness ? renderStaleBanner(snapshot.staleness) : ''}
${renderHeroFragment(snapshot)}
${renderKpisFragment(snapshot)}
${renderAttentionFragment(snapshot, { limit: 3 })}
${membersSection}
${projectsSection}
${renderHighlightsFragment(snapshot)}
${renderCollabFragment(snapshot)}
</div>
${renderSlideoverShell()}
<script>${CLIENT_REFRESH_SCRIPT}</script>
<script>${FILTER_BAR_SCRIPT}</script>
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
// Stale-data banner (P-D2 data-trust rebuild)
// ---------------------------------------------------------------------------

/**
 * Render the "data is N days old" banner that mounts above the hero when
 * the snapshot's freshest in-range session is more than ~1 day older than
 * `computedAt`. Visually tied to the warn palette so it reads as advisory,
 * not error. Exported so the People/Projects tab can reuse the markup.
 */
export function renderStaleBanner(s: { ageDays: number; lastActivityAt: string }): string {
  const d = new Date(s.lastActivityAt);
  const dateLabel = `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  return `<div class="stale-banner" style="background:var(--warn-soft);border:1px solid rgba(200,146,75,.2);border-radius:var(--r-md);padding:12px 16px;margin-bottom:20px;color:var(--ink-2);font-size:13px;">
    <strong style="color:var(--warn);">ⓘ 数据截止 ${escapeHtml(dateLabel)}</strong> · 距今 ${s.ageDays} 天 · 实时数据需要团队成员接入 Riven plugin
  </div>`;
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

// Collaboration is rendered by `renderCollabFragment` in `_overview-fragments.ts`
// (B-main, "合作热点"). The Phase-1 `.lh-collab-card` helper retired with that
// migration — keep the section here as a comment marker for git-blame archaeology.
