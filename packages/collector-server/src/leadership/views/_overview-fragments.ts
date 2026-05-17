/**
 * Overview-tab fragment renderers for P-B3 (Phase 2 redesign).
 *
 * `renderHeroFragment` — Newsreader-serif H1 hero with templated editorial
 * copy + a meta strip (date + member/project counts).
 * `renderKpisFragment` — 4 floating KPI cards (need-attention, high-output,
 * spend, pace) each with its own inline SVG sparkline.
 *
 * Both consume an `OverviewSnapshot` and return HTML string fragments to
 * splice into `overview.html.ts`. CSS comes from `_css.ts`.
 */

import type { OverviewSnapshot, MemberSnapshot } from '../types.js';
import { heroHeadline, attentionLead } from './_copy.js';
import { avatarColor } from './_helpers.js';

export function renderHeroFragment(snap: OverviewSnapshot): string {
  const attentionCount = snap.kpis.attention.value;
  const highOutputCount = classifyHighOutput(snap.members);
  const headline = heroHeadline({ attentionCount, highOutputCount });
  const d = new Date(snap.computedAt);
  const date = `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  return `<header id="hero" class="hero fade-in">
    <div>
      <h1 class="serif">${headline}</h1>
      <div class="sub">${date} · 数据每 30 秒刷新</div>
    </div>
    <div class="hero-meta">
      <div><strong>${snap.members.length}</strong> 位成员 · <strong>${snap.projects.length}</strong> 个项目</div>
    </div>
  </header>`;
}

function classifyHighOutput(members: MemberSnapshot[]): number {
  return members.filter(m => m != null && m.deltaVs7dAvgPct > 0.2).length;
}

export function renderKpisFragment(snap: OverviewSnapshot): string {
  // High-output trend line: show real average delta among the members the
  // card counts. Falls back to "无" when zero high-output members so the
  // viewer doesn't see a misleading "↑".
  const ho = snap.kpis.highOutput ?? { count: classifyHighOutput(snap.members), avgDeltaPct: 0 };
  const hoTrend = ho.count === 0
    ? '<span>无</span>'
    : `<span class="up">↑${Math.round(ho.avgDeltaPct * 100)}%</span><span>平均</span>`;

  // Pace card: real rhythm classification (升/稳/缓) from team-wide
  // computeRhythmDelta. Trend line shows the % delta to back up the label.
  const pace = snap.kpis.pace ?? { rhythmDelta: 0, label: '稳' as const };
  const deltaPct = Math.round(pace.rhythmDelta * 100);
  const paceTrend = deltaPct === 0
    ? '<span>与 7 日均值持平</span>'
    : deltaPct > 0
      ? `<span class="up">↑${deltaPct}%</span><span>对比 7 日均值</span>`
      : `<span>↓${Math.abs(deltaPct)}%</span><span>对比 7 日均值</span>`;

  // Spend card: real $ today (sum of member.today.costUsd). Label is
  // "今日消耗" because the underlying field is per-today, not per-week.
  const todayUsd = snap.kpis.todayCostUsd ?? snap.members.reduce((a, m) => a + (m?.today?.costUsd ?? 0), 0);
  const cards: { cls: string; label: string; num: string; unit: string; trend: string; color: string; path: string }[] = [
    {
      cls: 'kpi-warn',
      label: '需要关注',
      num: String(snap.kpis.attention.value),
      unit: '项',
      trend: snap.kpis.attention.deltaToday > 0
        ? `<span class="up">↑${snap.kpis.attention.deltaToday}</span><span>较昨日</span>`
        : '<span>与昨日持平</span>',
      color: '#C8924B',
      path: 'M0 14 Q 12 10, 20 12 T 40 8 T 64 4',
    },
    {
      cls: 'kpi-good',
      label: '高产出',
      num: String(ho.count),
      unit: '人',
      trend: hoTrend,
      color: '#6F8B5E',
      path: 'M0 16 Q 12 14, 20 10 T 40 8 T 64 4',
    },
    {
      cls: 'kpi-spend',
      label: '今日消耗',
      num: `$${formatCostUsd(todayUsd)}`,
      unit: '',
      trend: '<span>实际成本</span>',
      color: '#8A9AAA',
      path: 'M0 12 Q 12 14, 20 10 T 40 12 T 64 10',
    },
    {
      cls: 'kpi-pace',
      label: '整体节奏',
      num: pace.label,
      unit: '',
      trend: paceTrend,
      color: '#45433E',
      path: 'M0 12 Q 12 11, 20 13 T 40 11 T 64 12',
    },
  ];
  const html = cards.map(c => `
    <div class="kpi ${c.cls}">
      <div class="kpi-label"><span class="kpi-dot"></span>${c.label}</div>
      <div class="kpi-num">${c.num}<span class="unit">${c.unit}</span></div>
      <div class="kpi-trend">${c.trend}</div>
      <svg class="kpi-spark" viewBox="0 0 64 22"><path d="${c.path}" stroke="${c.color}" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>
    </div>`).join('');
  return `<section id="kpis" class="kpis fade-in">${html}</section>`;
}

/**
 * Format a USD value for the spend card. Sub-100 shows two decimals
 * (e.g., "$4.32"); >= 1000 uses k-suffix (e.g., "$1.2k"). In between we
 * round to whole dollars so the card stays tight.
 */
function formatCostUsd(n: number): string {
  if (!isFinite(n) || n <= 0) return '0.00';
  if (n < 100) return n.toFixed(2);
  if (n < 1000) return Math.round(n).toString();
  return (Math.round(n / 100) / 10).toFixed(1) + 'k';
}

function formatKilo(n: number): string {
  if (n < 1000) return String(n);
  return (Math.round(n / 100) / 10).toFixed(1) + 'k';
}

/**
 * Attention editorial card (P-B4) — rendered between the KPI row and the
 * member grid. Each row carries a `data-ref` attribute so the slideover
 * (P-B6) can hook click-to-open. `line2` is emitted unescaped because the
 * aggregator guarantees it is safe HTML (template-controlled, no user input).
 */
export interface FragmentOpts {
  /** Cap the number of items rendered. When set and total > limit, a
   * "看全部 N →" footer link is appended pointing to the dedicated tab. */
  limit?: number;
}

export function renderAttentionFragment(snap: OverviewSnapshot, opts: FragmentOpts = {}): string {
  if (snap.attention.length === 0) {
    return `<section id="attention" class="section fade-in"></section>`;
  }
  const totalAll = snap.attention.length;
  const items = opts.limit != null ? snap.attention.slice(0, opts.limit) : snap.attention;
  const lead = attentionLead(totalAll);
  const rows = items.map(a => `
    <div class="att-row" data-ref="${escapeHtml(a.kind)}:${escapeHtml(a.refId)}" data-attention="${a.severity}">
      <div class="att-avatar" style="background:${avatarColor(a.refId)}">${escapeHtml(a.initials)}</div>
      <div class="att-body">
        <div class="att-line1">
          <strong>${escapeHtml(a.displayName)}</strong>
          <span class="att-tag ${escapeHtml(a.tagSeverity)}">${escapeHtml(a.tag)}</span>
        </div>
        <div class="att-line2">${a.line2}</div>
      </div>
      <div class="att-time">${escapeHtml(a.time)}</div>
      <div class="att-arrow">›</div>
    </div>`).join('');
  const footer = renderSeeAllFooter(items.length, totalAll, '项', '/people?focus=attention');
  return `<section id="attention" class="section fade-in">
    <div class="section-head">
      <div class="section-title">需要你看一眼 <span class="section-count">${totalAll}</span></div>
    </div>
    <div class="attention">
      <div class="attention-head">
        <div class="attention-icon">⚠</div>
        <div class="attention-headline serif">${lead}</div>
      </div>
      <div class="attention-list">${rows}</div>
      ${footer}
    </div>
  </section>`;
}

/**
 * Render a "看全部 N →" footer link inside a section wrapper. Returns the
 * empty string when no overflow exists (totalShown >= totalAll) so callers
 * can interpolate unconditionally.
 */
function renderSeeAllFooter(totalShown: number, totalAll: number, label: string, href: string): string {
  if (totalShown >= totalAll) return '';
  return `<div class="see-all-row" style="text-align:right;padding:14px 24px 4px;">
    <a href="${href}" style="font-size:12.5px;color:var(--ink-3);text-decoration:none;border-bottom:1px solid var(--ink-5);padding-bottom:1px;">看全部 ${totalAll} ${label} →</a>
  </div>`;
}

function escapeHtml(s: string): string {
  // Must escape `'` too — inline onclick handlers in member tiles / project
  // rows embed escaped strings inside JS single-quoted literals.
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// P-B5: v7 member tiles + project rows
// ---------------------------------------------------------------------------

/**
 * Convert a numeric trend series into an SVG path for a tile-sized sparkline.
 * Viewbox is 48 × 16 (matches `.mt-spark` in `_css.ts`). Returns a flat
 * baseline when the trend is empty so the SVG still renders something visible.
 */
export function sparkFromTrend(trend: number[]): string {
  if (trend.length === 0) return 'M0 8 L48 8';
  const max = Math.max(...trend, 1);
  const pts = trend.map((v, i) => {
    const x = trend.length === 1 ? 24 : (i / (trend.length - 1)) * 48;
    const y = 14 - (v / max) * 12;
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  return 'M' + pts.join(' L');
}

function memberSubLabel(m: MemberSnapshot): string {
  if (m.deltaVs7dAvgPct > 0.2) return `高产出 ↑${Math.round(m.deltaVs7dAvgPct * 100)}%`;
  if (m.stateBadge === 'low_activity') return `闲置`;
  return `${m.today.sessions} 会话`;
}

function memberStatus(m: MemberSnapshot): 'active' | 'idle' | 'warn' {
  if (m.stateBadge === 'low_activity') return 'idle';
  if (m.stateBadge === 'stuck' || m.stateBadge === 'needs_help') return 'warn';
  return 'active';
}

function attentionScore(m: MemberSnapshot): number {
  if (m.stateBadge === 'stuck') return 9;
  if (m.stateBadge === 'needs_help') return 8;
  if (m.stateBadge === 'low_activity') return 5;
  return 0;
}

export function renderMembersFragment(snap: OverviewSnapshot, opts: FragmentOpts = {}): string {
  const totalAll = snap.members.length;
  const members = opts.limit != null ? snap.members.slice(0, opts.limit) : snap.members;
  const tiles = members.map(m => {
    const initials = m.displayName.slice(0, 2).toLowerCase();
    const status = memberStatus(m);
    const path = sparkFromTrend(m.trend7d);
    const sparkColor = status === 'idle' ? '#C8924B' : '#6F8B5E';
    const color = avatarColor(m.email);
    return `
      <div class="member-tile" data-ref="member:${escapeHtml(m.email)}" data-attention="${attentionScore(m)}" data-activity="${m.today.sessions}" data-alpha="${escapeHtml(m.displayName)}" onclick="window.openSO('member', '${escapeHtml(m.email)}')">
        <div class="mt-head">
          <div class="mt-avatar" style="background:${color}">${escapeHtml(initials)}<div class="mt-status ${status}"></div></div>
          <div><div class="mt-name">${escapeHtml(m.displayName)}</div><div class="mt-sub">${escapeHtml(memberSubLabel(m))}</div></div>
        </div>
        <div class="mt-where">
          <span class="where-label">在做</span>
          <span class="where-val">${escapeHtml(m.topProject ?? '—')}</span>
        </div>
        <div class="mt-stats">
          <div><div class="mt-stat-num">${m.today.sessions}</div><div class="mt-stat-label">会话</div></div>
          <div><div class="mt-stat-num">¥${formatKilo(m.today.tokens)}</div><div class="mt-stat-label">消耗</div></div>
          <div><div class="mt-stat-num">${m.warnings.length === 0 ? '—' : m.warnings.length}</div><div class="mt-stat-label">警告</div></div>
        </div>
        <svg class="mt-spark" viewBox="0 0 48 16"><path d="${path}" stroke="${sparkColor}" stroke-width="1.2" fill="none" stroke-linecap="round"/></svg>
      </div>`;
  }).join('');

  const footer = renderSeeAllFooter(members.length, totalAll, '人', '/people');
  return `<section id="members" class="section fade-in">
    <div class="section-head">
      <div class="section-title">团队 <span class="section-count">${totalAll}</span></div>
      <div class="sort-toggle">
        <button data-sort="attention" class="active">需关注</button>
        <button data-sort="activity">活跃</button>
        <button data-sort="alpha">字母</button>
      </div>
    </div>
    <div class="members">${tiles}</div>
    ${footer}
  </section>`;
}

export function renderProjectsFragment(snap: OverviewSnapshot, opts: FragmentOpts = {}): string {
  const totalAll = snap.projects.length;
  const projects = opts.limit != null ? snap.projects.slice(0, opts.limit) : snap.projects;
  const rows = projects.map(p => {
    const initials = p.name.slice(0, 2).toUpperCase();
    // Bar = today's active contributor ratio (real data from aggregator).
    // Label is "N / M 人在做" — leadership-friendly: at a glance you see how
    // many of the project's people actually touched it today.
    const totalContributors = p.contributors.length;
    const activeCount = p.activeTodayCount ?? 0;
    const pct = (p.activeTodayPct ?? 0) * 100;
    const progress = Math.max(0, Math.min(100, Math.round(pct)));
    const sumTrend = p.trend7d.reduce((a, b) => a + b, 0);
    const avatars = p.contributors.slice(0, 3)
      .map(c => `<div class="av-sm" style="background:${avatarColor(c.email)}">${escapeHtml(c.email.slice(0, 2).toLowerCase())}</div>`)
      .join('');
    const extra = p.contributors.length > 3
      ? `<div class="proj-people-extra">+${p.contributors.length - 3}</div>`
      : '';
    const eta = p.etaDays != null ? `${p.etaDays}d` : '—';
    const etaClass = p.etaDays != null && p.etaDays > 14 ? 'slip' : '';
    return `<div class="proj-row" data-ref="project:${escapeHtml(p.name)}" data-attention="${p.busFactorWarning ? 4 : 0}" data-activity="${sumTrend}" data-alpha="${escapeHtml(p.name)}" onclick="window.openSO('project', '${escapeHtml(p.name)}')">
      <div>
        <div class="proj-name"><div class="proj-icon">${escapeHtml(initials)}</div><div>${escapeHtml(p.name)}<div class="proj-sub">${escapeHtml(p.phaseGuess)} · ${escapeHtml(p.state)}</div></div></div>
      </div>
      <div>
        <div class="proj-bar"><div class="proj-bar-fill" style="width:${progress}%"></div></div>
        <div class="proj-progress-label tnum">${activeCount} / ${totalContributors} 人在做</div>
      </div>
      <div class="proj-people"><div class="proj-people-stack">${avatars}</div>${extra}</div>
      <div class="proj-eta ${etaClass}">${escapeHtml(eta)}</div>
      <div class="proj-arrow">›</div>
    </div>`;
  }).join('');
  const footer = renderSeeAllFooter(projects.length, totalAll, '个', '/projects');
  return `<section id="projects" class="section fade-in">
    <div class="section-head">
      <div class="section-title">项目 <span class="section-count">${totalAll}</span></div>
      <div class="sort-toggle">
        <button data-sort="attention" class="active">需关注</button>
        <button data-sort="activity">活跃</button>
        <button data-sort="alpha">字母</button>
      </div>
    </div>
    <div class="projects-list">${rows}</div>
    ${footer}
  </section>`;
}
