/**
 * Phase 3-B · Activity tab page renderer.
 *
 * Renders a time-descending feed of session and milestone events grouped
 * by date. The page shell mirrors /people and /projects — nav, filter bar,
 * optional stale banner — so the focus filter chip bar works identically.
 */

import type { ActivityFeedSnapshot, ActivityEvent } from '../types.js';
import { LEADERSHIP_CSS } from './styles.css.js';
import { renderNav } from './_nav.html.js';
import { renderSlideoverShell } from './_slideover.html.js';
import { CLIENT_REFRESH_SCRIPT } from './_refresh.js.js';
import { FILTER_BAR_CSS, FILTER_BAR_SCRIPT } from './_filter-bar.client.js';
import { CONSENT_BANNER_CSS, CONSENT_BANNER_SCRIPT, renderConsentBanner } from './_consent-banner.html.js';

export interface RenderActivityOptions {
  filterBarHtml?: string;
  rangeLabel?: string;
  /** QA-5 legal P0. Suppress consent banner in demo mode. */
  demo?: boolean;
}

export function renderActivityPage(snap: ActivityFeedSnapshot, opts: RenderActivityOptions = {}): string {
  const navRangeLabel = opts.rangeLabel ?? rangeLabelOf(snap.range.label);
  const groups = groupByDate(snap.events);
  const body = renderBody(snap, groups);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Activity · Matrix·Riven</title>
<style>${LEADERSHIP_CSS}
${FILTER_BAR_CSS}
${CONSENT_BANNER_CSS}
${ACTIVITY_CSS}</style>
</head>
<body>
<div class="shell">
${renderNav('activity', { rangeLabel: navRangeLabel, demo: opts.demo === true })}
${opts.filterBarHtml ?? ''}
<header id="hero" class="hero fade-in">
  <div>
    <h1 class="serif">活动流</h1>
    <div class="sub">共 ${snap.events.length} 条事件 · 数据每 30 秒刷新 · 最近一次 <span id="activity-last-tick" data-computed-at="${escapeHtml(snap.computedAt)}">${formatRelative(snap.computedAt)}</span></div>
  </div>
</header>
${body}
</div>
${renderSlideoverShell()}
${renderConsentBanner({ demo: opts.demo === true })}
<script>${CLIENT_REFRESH_SCRIPT}</script>
<script>${FILTER_BAR_SCRIPT}</script>
<script>${CONSENT_BANNER_SCRIPT}</script>
<script>${ACTIVITY_LAST_TICK_SCRIPT}</script>
</body>
</html>`;
}

const ACTIVITY_LAST_TICK_SCRIPT = `
(function () {
  // §5.8: keep the "最近一次 X 秒前" label live without a round-trip. We
  // pulled the server's computedAt into data-computed-at on initial render;
  // every 10 s we re-derive the relative label client-side so the badge
  // reflects "how stale you're looking at" instead of an evergreen
  // "数据每 30 秒刷新" promise.
  function fmt(iso) {
    try {
      var ms = Date.now() - new Date(iso).getTime();
      if (isNaN(ms) || ms < 0) return '刚刚';
      var s = Math.round(ms / 1000);
      if (s < 5) return '刚刚';
      if (s < 60) return s + ' 秒前';
      var m = Math.round(s / 60);
      if (m < 60) return m + ' 分钟前';
      var h = Math.round(m / 60);
      if (h < 24) return h + ' 小时前';
      return Math.round(h / 24) + ' 天前';
    } catch (e) { return '刚刚'; }
  }
  function tick() {
    var el = document.getElementById('activity-last-tick');
    if (!el) return;
    var iso = el.getAttribute('data-computed-at');
    if (!iso) return;
    el.textContent = fmt(iso);
  }
  tick();
  setInterval(tick, 10000);
})();
`;

function renderBody(snap: ActivityFeedSnapshot, groups: Map<string, ActivityEvent[]>): string {
  if (snap.events.length === 0) {
    return `<section class="section fade-in">
      <div class="lh-empty">这个时间窗口和过滤组合下没有活动。试试放宽过滤或换更长时间窗。</div>
    </section>`;
  }
  const sections: string[] = [];
  for (const [dateLabel, evs] of groups) {
    sections.push(`<section class="activity-day fade-in">
      <h2 class="activity-day-header">${escapeHtml(dateLabel)}</h2>
      <ol class="activity-list">
        ${evs.map(renderRow).join('')}
      </ol>
    </section>`);
  }
  let footer = '';
  if (snap.hasMore && snap.nextCursor) {
    const u = new URL('http://h/p');
    u.searchParams.set('before', snap.nextCursor);
    if (snap.appliedFilter?.focus) u.searchParams.set('focus', snap.appliedFilter.focus);
    if (snap.appliedFilter?.project) u.searchParams.set('project', snap.appliedFilter.project);
    if (snap.appliedFilter && snap.appliedFilter.range !== 'today') u.searchParams.set('range', snap.appliedFilter.range);
    footer = `<div class="activity-more">
      <a class="activity-more-link" href="/activity${u.search}">加载更早 →</a>
    </div>`;
  }
  return sections.join('\n') + footer;
}

function renderRow(e: ActivityEvent): string {
  const icon = ICON_FOR_TYPE[e.type] ?? '·';
  const hhmm = e.ts.slice(11, 16);
  const by = e.by.split('@')[0] ?? e.by;
  const summary = escapeHtml(e.summary);
  const promptFull = e.detail?.promptFull;
  const tokens = e.detail?.tokens;
  const meta =
    e.type === 'session' && tokens
      ? `<span class="activity-meta">${shortTokens(tokens)} tok</span>`
      : '';
  const expandable = promptFull && promptFull.length > e.summary.length;
  const expanded = expandable
    ? `<details class="activity-expand"><summary>查看完整 prompt</summary><pre class="activity-prompt">${escapeHtml(promptFull!)}</pre></details>`
    : '';
  return `<li class="activity-row activity-row-${e.type}">
    <span class="activity-time">${escapeHtml(hhmm)}</span>
    <span class="activity-icon">${icon}</span>
    <span class="activity-by">${escapeHtml(by)}</span>
    <span class="activity-project">${escapeHtml(e.project)}</span>
    <span class="activity-summary">${summary}</span>
    ${meta}
    ${expanded}
  </li>`;
}

function groupByDate(events: ActivityEvent[]): Map<string, ActivityEvent[]> {
  const out = new Map<string, ActivityEvent[]>();
  const today = new Date();
  const todayKey = utcDateKey(today);
  const yesterdayKey = utcDateKey(new Date(today.getTime() - 24 * 60 * 60 * 1000));
  for (const e of events) {
    const key = e.ts.slice(0, 10);
    let label: string;
    if (key === todayKey) label = '今天';
    else if (key === yesterdayKey) label = '昨天';
    else label = key;
    const arr = out.get(label) ?? [];
    arr.push(e);
    out.set(label, arr);
  }
  return out;
}

function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shortTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 100_000) return (Math.round(n / 100) / 10).toFixed(1) + 'k';
  if (n < 1_000_000) return Math.round(n / 1000) + 'k';
  return (Math.round(n / 100_000) / 10).toFixed(1) + 'M';
}

function formatRelative(iso: string): string {
  // Render a human "X秒前 / X分钟前 / 刚刚" label for the initial server-rendered
  // sub-header. Client polling updates the same DOM node via the polling loop.
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (Number.isNaN(ms) || ms < 0) return '刚刚';
    const s = Math.round(ms / 1000);
    if (s < 5) return '刚刚';
    if (s < 60) return `${s} 秒前`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} 分钟前`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} 小时前`;
    return `${Math.round(h / 24)} 天前`;
  } catch {
    return '刚刚';
  }
}

function rangeLabelOf(label: string): string {
  switch (label) {
    case '24h': return '24 小时';
    case 'today': return '今日';
    case 'yesterday': return '昨日';
    case '30d': return '30 日窗口';
    case '7d': return '7 日窗口';
    case 'custom': return '自定义';
    default: return label;
  }
}

const ICON_FOR_TYPE: Record<ActivityEvent['type'], string> = {
  session: '📝',
  commit: '✅',
  push: '🚀',
  pr_open: '🔀',
  pr_merged: '🎯',
  release: '🏷️',
  tag: '🏷️',
};

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ACTIVITY_CSS = `
.activity-day {
  padding: 0 16px 14px;
}
.activity-day-header {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-3, #888);
  margin: 14px 0 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--hairline, #e0e3eb);
  letter-spacing: .2px;
}
.activity-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.activity-row {
  display: grid;
  grid-template-columns: 50px 22px 90px 140px 1fr auto;
  align-items: baseline;
  gap: 8px;
  padding: 8px 4px;
  border-bottom: 1px dashed var(--hairline, #eee);
  font-size: 13px;
}
.activity-row:last-child { border-bottom: 0; }
.activity-time {
  font-variant-numeric: tabular-nums;
  color: var(--ink-3, #888);
  font-size: 11px;
}
.activity-icon {
  font-size: 14px;
}
.activity-by {
  font-weight: 600;
  color: var(--ink-1, #1a1d2e);
}
.activity-project {
  color: var(--ink-2, #555);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.activity-summary {
  color: var(--ink-1, #1a1d2e);
  font-family: 'Newsreader', serif;
}
.activity-meta {
  font-size: 11px;
  color: var(--ink-3, #888);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.activity-row-commit { background: rgba(74, 158, 122, .05); }
.activity-row-push { background: rgba(74, 122, 200, .06); }
.activity-row-pr_open, .activity-row-pr_merged { background: rgba(122, 74, 200, .06); }
.activity-row-release, .activity-row-tag { background: rgba(200, 122, 74, .08); }
.activity-expand {
  grid-column: 3 / -1;
  margin-top: 4px;
}
.activity-expand summary {
  font-size: 11px;
  color: var(--ink-3, #888);
  cursor: pointer;
}
.activity-prompt {
  background: var(--surface-2, #f7f8fc);
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 4px 0 0;
}
[data-theme="dark"] .activity-prompt { background: #1a1a20; }
.activity-more {
  text-align: center;
  padding: 20px;
}
.activity-more-link {
  color: var(--accent, #4a7aff);
  font-size: 13px;
  text-decoration: none;
}
.activity-more-link:hover { text-decoration: underline; }
`;
