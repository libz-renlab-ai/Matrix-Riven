/**
 * Phase 3-A · Filter Bar.
 *
 * Renders a chip bar below the main nav with 4 chips (focus / project /
 * range / state). Each chip is a clickable button; the actual dropdown menu
 * is opened by the client script in `_filter-bar.client.ts`. Server only
 * renders the current state + the list of options that are available
 * (members / projects names are dynamic, range / state are fixed).
 *
 * Visual states:
 *   - default (no filter active)  → all chips grey, label "全部 X / 今日", right-side "未启用"
 *   - any chip active             → that chip orange + ✕; bar gets data-active
 *
 * The chip values + URL contract are 1:1 with `focus-filter.ts`. Server
 * renders the chip from `filter.focus`, `filter.project`, `filter.range`,
 * `filter.state`. The client script reads the active chip on click,
 * opens a `<ul.filter-menu>` already in the DOM (one per chip, hidden by
 * default), and on selection rewrites `location.search` and reloads.
 */

import type { FocusFilter, RangeLabel } from '../types.js';

export interface FilterBarOptions {
  /** Active filter, drives rendering of current chip values + active styling. */
  filter: FocusFilter;
  /** Member email local-parts available in the focus dropdown. */
  members: string[];
  /** Project names available in the project dropdown. */
  projects: string[];
  /** Active tab — used to suppress rendering on `/retro` (spec §3.2 #8). */
  tab: 'overview' | 'people' | 'projects' | 'retro' | 'activity' | 'insights';
  /** Demo flag — appended to all chip links so demo mode survives navigation. */
  demo?: boolean;
  /**
   * QA-6 P1: when the caller's effective range differs from `filter.range`
   * (e.g. /people defaults to 7d when no ?range=, but filter.range remains
   * 'today'), pass the resolved bucket here so the chip displays the
   * actual window — not the URL-stated one. Avoids the contradiction where
   * the nav reads "实时 · 7 日窗口" but the chip reads "📅 今日".
   *
   * Accepts `RangeLabel | string` because the upstream `DateRange.label`
   * type is `RangeLabel | string` (parseRange returns a custom string when
   * `from`/`to` is set). Unknown values fall through to '自定义' via
   * RANGE_LABELS lookup below.
   */
  effectiveRange?: RangeLabel | string;
}

const RANGE_LABELS: Record<RangeLabel, string> = {
  today: '今日',
  yesterday: '昨日',
  '24h': '近 24h',
  '7d': '近 7 天',
  '30d': '近 30 天',
  custom: '自定义',
};

const STATE_LABELS: Record<string, string> = {
  active: '活跃中',
  quiet: '安静',
  stuck: '进展受阻',
  needs_help: '求助',
  low_activity: '本周参与不多',
};

const STATE_ORDER = ['active', 'quiet', 'stuck', 'needs_help', 'low_activity'] as const;

/**
 * Render the filter bar. Returns empty string for tabs that should not
 * show the filter (currently only `retro`).
 */
export function renderFilterBar(opts: FilterBarOptions): string {
  if (opts.tab === 'retro') return '';

  const f = opts.filter;
  const focusActive = !!f.focus;
  const projectActive = !!f.project;
  // 2026-05-19 QA-6 P1: rangeActive used to mean "user picked something
  // other than today", but on tabs that default to 7d (people/projects/
  // activity/insights), the chip read "今日" while the page actually
  // showed 7-day data. Now treat range as active iff the URL explicitly
  // set ?range= AND the effective bucket differs from the page's default.
  // The chip itself displays the effective bucket regardless, so the
  // viewer always sees what window they're looking at.
  const effRangeRaw = opts.effectiveRange ?? f.range;
  // Treat any non-known label as 'custom' for the active-state check —
  // safe because the chip render below also falls back to '自定义'.
  const effRange: RangeLabel = (Object.prototype.hasOwnProperty.call(RANGE_LABELS, effRangeRaw)
    ? effRangeRaw
    : 'custom') as RangeLabel;
  const rangeActive = effRange !== 'today';
  const stateActive = !!f.state;
  const anyActive = focusActive || projectActive || rangeActive || stateActive;

  const focusLabel = focusActive ? escapeHtml(f.focus!) : '全部成员';
  const projectLabel = projectActive ? escapeHtml(f.project!) : '全部项目';
  const rangeLabel = RANGE_LABELS[effRange] ?? '自定义';
  const stateLabel = stateActive ? STATE_LABELS[f.state!] ?? f.state : '全部状态';

  // Build dropdown option lists. The client script reads these from
  // `data-options` JSON to keep markup small.
  const memberOptions = opts.members
    .map((m) => ({ value: m, label: m }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const projectOptions = opts.projects
    .map((p) => ({ value: p, label: p }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const rangeOptions: { value: RangeLabel; label: string }[] = [
    { value: 'today', label: '今日' },
    { value: 'yesterday', label: '昨日' },
    { value: '7d', label: '近 7 天' },
    { value: '30d', label: '近 30 天' },
    { value: 'custom', label: '自定义' },
  ];
  const stateOptions = STATE_ORDER.map((s) => ({ value: s, label: STATE_LABELS[s]! }));

  const chip = (
    key: 'focus' | 'project' | 'range' | 'state',
    label: string,
    active: boolean,
    options: { value: string; label: string }[],
  ): string => {
    const cls = active ? 'fb-chip fb-chip-active' : 'fb-chip';
    const x = active
      ? `<button type="button" class="fb-chip-x" data-fb-clear="${key}" aria-label="清除 ${escapeHtml(key)}">✕</button>`
      : '';
    const arrow = active ? '' : '<span class="fb-chip-caret">▾</span>';
    const optionsJson = escapeHtmlAttr(JSON.stringify(options));
    return `<button type="button" class="${cls}" data-fb-chip="${key}" data-fb-options="${optionsJson}">
      <span class="fb-chip-label">${label}</span>${arrow}${x}
    </button>`;
  };

  return `
<div class="filter-bar${anyActive ? ' filter-bar-active' : ''}" data-active="${anyActive ? 'true' : 'false'}" data-demo="${opts.demo ? '1' : ''}">
  <span class="fb-prefix">聚焦：</span>
  ${chip('focus', `👤 ${focusLabel}`, focusActive, memberOptions)}
  ${chip('project', `📁 ${projectLabel}`, projectActive, projectOptions)}
  ${chip('range', `📅 ${rangeLabel}`, rangeActive, rangeOptions as { value: string; label: string }[])}
  ${chip('state', `⚠️ ${stateLabel}`, stateActive, stateOptions)}
  <span class="fb-spacer"></span>
  ${anyActive
    ? '<button type="button" class="fb-clear-all" data-fb-clear-all>↻ 清空</button>'
    : '<span class="fb-idle">点上方任一 chip 应用筛选</span>'}
</div>`;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeHtmlAttr(s: string): string {
  return escapeHtml(s);
}
