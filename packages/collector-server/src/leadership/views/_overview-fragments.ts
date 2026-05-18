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

import type { OverviewSnapshot, MemberSnapshot, ProjectSnapshot, HighlightEvent } from '../types.js';
import { heroHeadline, attentionLead } from './_copy.js';
import { avatarColor } from './_helpers.js';
import { redactForLLM } from '../llm/redact.js';
import {
  phaseLabel,
  trendLabel,
  trendArrow,
  healthDotColor,
  healthLabel,
  idleSince,
  etaLabel,
  shortFile,
} from './_leader-lang.js';

/**
 * Sanitize a highlight `detail` (raw shell command from a session's Bash
 * tool use) before rendering. The PII redactor strips emails, absolute
 * paths, secrets, JWTs, etc. — same patterns we apply on the LLM-bound
 * path. Without this, a `git push` invocation can render as
 * `cd /Users/alice/projects/secret && git push origin main 2>&1 | tail -5`
 * exposing both the absolute path and the branch name in the dashboard's
 * highlight feed.
 *
 * Also truncates at 80 chars per spec §Rendering — the CSS ellipsis already
 * visually clips, but the wire format should not carry the full string.
 */
function safeHighlightDetail(s: string): string {
  if (!s) return '';
  const cleaned = redactForLLM(s);
  return cleaned.length > 80 ? cleaned.slice(0, 77) + '…' : cleaned;
}

/**
 * Per-member fallback narrative when no `llmWeekly` is cached. The historical
 * code repeated the same phase + trend string for every row, making a
 * 4-row team grid look identical. This builds a line that varies with the
 * member's own numbers (today's session count, recency, rhythm delta).
 *
 * Returns two HTML-safe strings so the caller can drop them into the tile.
 */
function memberFallbackNarrative(
  m: MemberSnapshot,
  phaseText: string,
  trendArr: string,
  trendText: string,
): { line1Html: string; line2Html: string } {
  const sessionsToday = m.today?.sessions ?? 0;
  const weekTotal = Array.isArray(m.trend7d) ? m.trend7d.reduce((a, b) => a + b, 0) : 0;
  const line1Plain = sessionsToday > 0
    ? `今日 ${sessionsToday} 会话 · ${phaseText}`
    : `本周 ${weekTotal} 会话 · ${phaseText}`;
  // Recency stamp on the second line — always varies because lastSessionAt
  // varies. Falls back to the trend label when timestamp is unknown so the
  // tile never reads "—".
  let line2Plain: string;
  if (m.lastSessionAt) {
    const hours = Math.max(0, (Date.now() - Date.parse(m.lastSessionAt)) / 3_600_000);
    let recency: string;
    if (hours < 1) recency = '刚刚活跃';
    else if (hours < 24) recency = `${Math.floor(hours)}h 前活跃`;
    else {
      const days = Math.floor(hours / 24);
      recency = days === 1 ? '昨日活跃' : `${days}天前活跃`;
    }
    // Pair recency with rhythm delta when meaningful (>10% in either dir).
    const delta = m.deltaVs7dAvgPct;
    if (typeof delta === 'number' && Math.abs(delta) > 0.1) {
      const sign = delta > 0 ? '+' : '';
      line2Plain = `${recency} · 节奏 ${sign}${Math.round(delta * 100)}%`;
    } else {
      line2Plain = `${recency} · ${trendArr} ${trendText}`;
    }
  } else {
    line2Plain = `${trendArr} ${trendText}`;
  }
  return {
    line1Html: escapeHtml(line1Plain),
    line2Html: escapeHtml(line2Plain),
  };
}

export function renderHeroFragment(snap: OverviewSnapshot): string {
  // Hero copy must agree with the count rendered under the Attention section
  // header — otherwise a leader sees "5 件事需要留意" up top and "2" below it.
  // `snap.kpis.attention.value` historically included risky-action counts
  // that aren't surfaced as attention rows; the rendered section uses
  // `snap.attention.length`, so drive both from the same source.
  const attentionCount = snap.attention.length;
  const highOutputCount = classifyHighOutput(snap.members);
  const headline = heroHeadline({ attentionCount, highOutputCount });
  const d = new Date(snap.computedAt);
  const date = `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  // Phase 3-A: when a filter is active, prepend a single-line summary so
  // the hero reads as filtered without rewriting the entire headline.
  const f = snap.appliedFilter;
  const filterCrumb = f && (f.focus || f.project || f.state || f.range !== 'today')
    ? `<div class="hero-filter-crumb" style="font-size:12px;color:var(--ink-3,#888);margin-bottom:6px;">
         🔍 当前聚焦：${[
           f.focus ? `<strong style="color:#ff9d3a;">${escapeHtml(f.focus)}</strong>` : '',
           f.project ? `<strong style="color:#ff9d3a;">${escapeHtml(f.project)}</strong>` : '',
           f.range !== 'today' ? `<strong style="color:#ff9d3a;">${escapeHtml(rangeHumanLabel(f.range))}</strong>` : '',
           f.state ? `<strong style="color:#ff9d3a;">${escapeHtml(stateHumanLabel(f.state))}</strong>` : '',
         ].filter(Boolean).join(' · ')}
       </div>`
    : '';
  const header = `<header id="hero" class="hero fade-in">
    <div>
      ${filterCrumb}
      <h1 class="serif">${headline}</h1>
      <div class="sub">${date} · 数据每 30 秒刷新</div>
    </div>
    <div class="hero-meta">
      <div><strong>${snap.members.length}</strong> 位成员 · <strong>${snap.projects.length}</strong> 个项目</div>
    </div>
  </header>`;
  // T5 daily brief: a 3-line LLM-authored briefBox dropped immediately below
  // the hero greeting. Optional — when the LLM tier is disabled or the cache
  // misses, `llmBrief` is undefined and we render only the header (existing
  // byte-identical behavior). We tolerate any non-empty array but only render
  // the first three lines, matching the T5 contract.
  const brief = snap.llmBrief;
  if (!brief || brief.length === 0) return header;
  const lineStyle = "font-family:'Newsreader',serif;font-size:15px;line-height:1.6;color:var(--ink-1);";
  const lines = brief.slice(0, 3)
    .map(l => `<div class="brief-line" style="${lineStyle}">${escapeHtml(l)}</div>`)
    .join('');
  const briefBox = `<div class="brief-box fade-in" aria-label="leader daily brief" style="margin-top:12px;padding:14px 16px;background:var(--surface);border-left:3px solid var(--accent-ink);border-radius:var(--r-lg);box-shadow:var(--shadow-1);">${lines}</div>`;
  return header + briefBox;
}

function classifyHighOutput(members: MemberSnapshot[]): number {
  return members.filter(m => m != null && m.deltaVs7dAvgPct > 0.2).length;
}

export function renderKpisFragment(snap: OverviewSnapshot): string {
  // High-output trend line: show real average delta among the members the
  // card counts. Falls back to "无" when zero high-output members so the
  // viewer doesn't see a misleading "↑". The big number itself also shows
  // "无" instead of "0 人" so the card doesn't read like a missing-data
  // failure when the team simply has no breakout performer today.
  const ho = snap.kpis.highOutput ?? { count: classifyHighOutput(snap.members), avgDeltaPct: 0 };
  const hoNum = ho.count === 0 ? '无' : String(ho.count);
  const hoUnit = ho.count === 0 ? '' : '人';
  const hoTrend = ho.count === 0
    ? '<span>无突出</span>'
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

  // Spend card: real $ today (sum of member.today.costUsd). When honestly
  // zero we show "—" instead of "$0.00" — the latter reads like a broken
  // counter, the former reads like "no captured activity yet today" which
  // is what's actually true on a stale snapshot.
  const todayUsd = snap.kpis.todayCostUsd ?? snap.members.reduce((a, m) => a + (m?.today?.costUsd ?? 0), 0);
  const spendNum = todayUsd <= 0 ? '—' : `$${formatCostUsd(todayUsd)}`;
  // Phase 3-A: when a non-today range is active, swap "今日" prefix on copy
  // so the KPI card label matches the actual data window.
  const rangeKey = snap.appliedFilter?.range ?? 'today';
  const spendCardLabel = rangeKey === 'today' ? '今日消耗' :
    rangeKey === 'yesterday' ? '昨日消耗' :
    rangeKey === '24h' ? '近 24h 消耗' :
    rangeKey === '7d' ? '近 7 天消耗' :
    rangeKey === '30d' ? '近 30 天消耗' :
    rangeKey === 'custom' ? '自定义区间消耗' : '今日消耗';
  const spendTrend = todayUsd <= 0
    ? `<span>${rangeKey === 'today' ? '今日' : '该窗口'}暂无活动</span>`
    : '<span>实际成本</span>';
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
      num: hoNum,
      unit: hoUnit,
      trend: hoTrend,
      color: '#6F8B5E',
      path: 'M0 16 Q 12 14, 20 10 T 40 8 T 64 4',
    },
    {
      cls: 'kpi-spend',
      label: '今日消耗',
      num: spendNum,
      unit: '',
      trend: spendTrend,
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
  const rows = items.map(a => {
    // T4 rewrite path: LLM string is plain text → must be escaped to be safe.
    // Legacy template path: `line2` is aggregator-controlled and may contain
    // trusted inline markup (e.g., `<span class="mono">api/x.ts</span>`), so
    // it is intentionally emitted unescaped — preserving the pre-LLM contract.
    const line2Html = a.llmRewrite ? escapeHtml(a.llmRewrite) : a.line2;
    // 2026-05-18 round-16 audit P0: attention rows had data-ref but no click
    // handler — leaders saw "需要你看一眼" highlights with no way to drill in.
    // Reuse the same openSO contract as member tiles / project rows; the
    // /api/members/:id endpoint accepts both local-part and full email.
    const soId = a.kind === 'member' ? (a.refId.split('@')[0] ?? a.refId) : a.refId;
    return `
    <div class="att-row" data-ref="${escapeHtml(a.kind)}:${escapeHtml(a.refId)}" data-attention="${a.severity}" onclick="window.openSO('${escapeHtml(a.kind)}', '${escapeHtml(soId)}')" style="cursor:pointer;">
      <div class="att-avatar" style="background:${avatarColor(a.refId)}">${escapeHtml(a.initials)}</div>
      <div class="att-body">
        <div class="att-line1">
          <strong>${escapeHtml(a.displayName)}</strong>
          <span class="att-tag ${escapeHtml(a.tagSeverity)}">${escapeHtml(a.tag)}</span>
        </div>
        <div class="att-line2">${line2Html}</div>
      </div>
      <div class="att-time">${escapeHtml(a.time)}</div>
      <div class="att-arrow">›</div>
    </div>`;
  }).join('');
  // 2026-05-18 round-15 audit P1: `?focus=attention` was a dead query
  // param — no route handler reads it, so the "see all" link landed on
  // the unfiltered People grid. Link to /people directly until the
  // focus filter actually exists (Phase 3).
  const footer = renderSeeAllFooter(items.length, totalAll, '项', '/people');
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

function rangeHumanLabel(r: string): string {
  switch (r) {
    case 'yesterday': return '昨日';
    case '24h': return '近 24 小时';
    case '7d': return '近 7 天';
    case '30d': return '近 30 天';
    case 'custom': return '自定义';
    default: return r;
  }
}

function stateHumanLabel(s: string): string {
  switch (s) {
    case 'active': return '活跃中';
    case 'quiet': return '安静';
    case 'stuck': return '卡住';
    case 'needs_help': return '求助';
    case 'low_activity': return '低活跃';
    default: return s;
  }
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
  // Project lookup so we can read phase from the member's topProject. Falls
  // back to '推进新功能' (implement) when topProject isn't in the dashboard's
  // surviving project set (e.g., filtered out as noise).
  const projectByName = new Map<string, ProjectSnapshot>();
  for (const p of snap.projects) projectByName.set(p.name, p);
  const tiles = members.map(m => {
    const initials = m.displayName.slice(0, 2).toLowerCase();
    const status = memberStatus(m);
    const path = sparkFromTrend(m.trend7d);
    const sparkColor = status === 'idle' ? '#C8924B' : '#6F8B5E';
    const color = avatarColor(m.email);
    // Phase narrative for this member: prefer the topProject's phaseGuess
    // (the project the leader most associates with them today). When the
    // top project was filtered out we still emit a sensible default so the
    // tile never reads "undefined" or "—" in the phase slot.
    const topProj = m.topProject ? projectByName.get(m.topProject) : undefined;
    const phaseText = topProj ? phaseLabel(topProj.phaseGuess) : '推进新功能';
    const trendArr = trendArrow(m.trend7d);
    const trendText = trendLabel(m.trend7d);
    // Member health: simplest honest proxy is `(1 - toolFailureRate) * 10`.
    // We avoid averaging project healthScores because that's a project-level
    // metric that doesn't decompose cleanly to one person. Falls through to
    // 8.0 (green) when failure rate is undefined.
    const failure = m.toolFailureRate ?? 0;
    const memberHealth = Math.max(0, Math.min(10, (1 - failure) * 10));
    const dotColor = healthDotColor(memberHealth);
    // T2 weekly digest: when present, the two LLM-authored sentences replace
    // the phase+trend template pair. Both lines are escaped (the LLM string
    // is plain text). Template fallback rendered below when `llmWeekly` is
    // absent or empty — keeps the dashboard useful even with LLM_ENABLED=off.
    const llmLines = m.llmWeekly ? m.llmWeekly.split('\n') : [];
    let narrative: string;
    if (llmLines.length > 0 && llmLines[0]) {
      const l1 = `<div>${escapeHtml(llmLines[0]!)}</div>`;
      const l2 = llmLines[1]
        ? `<div style="color:var(--ink-3);font-size:12px;">${escapeHtml(llmLines[1]!)}</div>`
        : '';
      narrative = `<div class="m-llm" style="font-family:'Newsreader',serif;color:var(--ink-2);font-size:13px;line-height:1.5;margin-top:2px;padding-top:10px;border-top:1px solid var(--hairline);">${l1}${l2}</div>`;
    } else {
      // LLM-off fallback. The historical version emitted the same
      // `${phaseText} · ${trendArr} ${trendText}` for every member, so a
      // team of 4 idle members all rendered the literal string "推进新功能
      // ↘ 近期已收尾" — visually broken. Build a per-member line that
      // carries a real, differentiable signal:
      //   line1 = "今日 N 会话 · <phase>" (always varies because sessions vary)
      //   line2 = recency stamp ("3h 前活跃") or rhythm tag ("节奏 +12%")
      const fallback = memberFallbackNarrative(m, phaseText, trendArr, trendText);
      narrative = `<div class="mt-phase" style="font-size:12.5px;color:var(--ink-2);margin-top:2px;">${fallback.line1Html}</div>
        <div class="mt-trend" style="font-size:12.5px;color:var(--ink-3);margin-top:6px;padding-top:10px;border-top:1px solid var(--hairline);">${fallback.line2Html}</div>`;
    }
    return `
      <div class="member-tile" data-ref="member:${escapeHtml(m.email.split('@')[0] ?? m.email)}" data-attention="${attentionScore(m)}" data-activity="${m.today.sessions}" data-alpha="${escapeHtml(m.displayName)}" onclick="window.openSO('member', '${escapeHtml(m.email.split('@')[0] ?? m.email)}')">
        <div class="mt-head">
          <div class="mt-avatar" style="background:${color}">${escapeHtml(initials)}<div class="mt-status ${status}"></div></div>
          <div style="flex:1;min-width:0;"><div class="mt-name">${escapeHtml(m.displayName)}</div><div class="mt-sub">${escapeHtml(memberSubLabel(m))}</div></div>
          <div class="mt-health-dot" title="${escapeHtml(healthLabel(memberHealth))}" style="background:${dotColor};width:8px;height:8px;border-radius:50%;flex-shrink:0;margin-left:auto;"></div>
        </div>
        <div class="mt-where">
          <span class="where-label">在做</span>
          <span class="where-val">${escapeHtml(m.topProject ?? '—')}</span>
        </div>
        ${narrative}
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

/**
 * Render one project's row in the Overview list as a 3-line narrative card
 * (B-main): health dot + name + phase · trend → latest file + author + idle
 * since → active count + ETA. Layout uses the `.proj-row` grid from `_css.ts`
 * but populates the columns with leader-friendly text rather than raw enums.
 *
 * `now` is the millisecond timestamp of the snapshot's `computedAt`, used to
 * compute the "X 小时前" idle phrase against `lastTouch.ts`. Falls back to
 * `Date.now()` if NaN (e.g. malformed `computedAt`).
 */
function p2NarrativeRow(p: ProjectSnapshot, now: number): string {
  const totalContributors = p.contributors.length;
  const activeCount = p.activeTodayCount ?? 0;
  const sumTrend = p.trend7d.reduce((a, b) => a + b, 0);
  const dotColor = healthDotColor(p.healthScore);
  const phaseText = phaseLabel(p.phaseGuess);
  const trendText = trendLabel(p.trend7d);
  const etaText = etaLabel(p.etaDays);

  // Latest-file narrative line (graceful when no edits captured). The
  // legacy template uses inline <span class="mono"> markup that depends on
  // template-controlled (escaped) inputs — so the string is emitted
  // unescaped further down. The T3 path emits an LLM-authored plain string
  // which we escape, since LLM output is treated as external content.
  let latestLine = '';
  if (p.lastTouch) {
    const hours = Math.max(0, (resolveNow(now) - Date.parse(p.lastTouch.ts)) / 3_600_000);
    const file = shortFile(p.lastTouch.filePath);
    const author = localPartEmail(p.lastTouch.by);
    latestLine = `最近: <span class="mono">${escapeHtml(file)}</span> · ${escapeHtml(author)} · ${escapeHtml(idleSince(hours))}`;
  } else {
    latestLine = '暂无最近编辑';
  }

  // T3 project digest. When present, llmLine1 replaces the phase·trend
  // subtitle, and llmLine2 replaces the "最近: file · author · since" line.
  // The project name, health dot, "N/M 人在做" and ETA columns are
  // unchanged. Both lines escaped — LLM output is external content.
  const llmLines = p.llmWeekly ? p.llmWeekly.split('\n') : [];
  const phaseSubtitleHtml = llmLines[0]
    ? escapeHtml(llmLines[0])
    : `${escapeHtml(phaseText)} · ${escapeHtml(trendText)}`;
  const latestLineHtml = llmLines[1]
    ? escapeHtml(llmLines[1])
    : latestLine;

  return `<div class="proj-row" data-ref="project:${escapeHtml(p.name)}" data-attention="${p.busFactorWarning ? 4 : 0}" data-activity="${sumTrend}" data-alpha="${escapeHtml(p.name)}" onclick="window.openSO('project', '${escapeHtml(p.name)}')" style="grid-template-columns:1fr 24px;align-items:start;padding:18px 24px;">
    <div style="min-width:0;">
      <div class="proj-name" style="display:flex;align-items:center;gap:10px;">
        <span class="proj-health-dot" title="${escapeHtml(healthLabel(p.healthScore))}" style="background:${dotColor};width:8px;height:8px;border-radius:50%;flex-shrink:0;"></span>
        <span style="font-size:15px;font-weight:600;color:var(--ink-1);">${renderProjectTitleHtml(p.name)}</span>
        <span style="font-size:12px;color:var(--ink-3);">${phaseSubtitleHtml}</span>
      </div>
      <div class="proj-latest" style="font-size:12.5px;color:var(--ink-3);margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${latestLineHtml}</div>
      <div class="proj-team-eta" style="font-size:12.5px;color:var(--ink-2);margin-top:4px;">
        <span>${activeCount}/${totalContributors} 人在做</span>
        <span style="color:var(--ink-4);"> · </span>
        <span>${escapeHtml(etaText)}</span>
      </div>
    </div>
    <div class="proj-arrow" style="align-self:center;">›</div>
  </div>`;
}

/**
 * Render a project name as HTML, dimming the `owner/` prefix when the name is
 * in the `owner/repo` form produced by the github-remote project identity.
 * Plain (cwd-derived) names render unchanged. Both branches escape their
 * content so the caller can drop the result straight into innerHTML.
 */
function renderProjectTitleHtml(name: string): string {
  const slashIdx = name.indexOf('/');
  if (slashIdx < 0) return escapeHtml(name);
  const owner = name.slice(0, slashIdx);
  const repo = name.slice(slashIdx + 1);
  return `<span style="color:var(--ink-3);font-weight:400;">${escapeHtml(owner)}/</span>${escapeHtml(repo)}`;
}

/** Local-part of email; falls through to the original string if no '@'. */
function localPartEmail(email: string): string {
  const at = email.indexOf('@');
  return at >= 0 ? email.slice(0, at) : email;
}

/** Use `now` when finite; otherwise fall back to system clock. */
function resolveNow(now: number): number {
  return Number.isFinite(now) ? now : Date.now();
}

export function renderProjectsFragment(snap: OverviewSnapshot, opts: FragmentOpts = {}): string {
  const totalAll = snap.projects.length;
  const projects = opts.limit != null ? snap.projects.slice(0, opts.limit) : snap.projects;
  const now = Date.parse(snap.computedAt);
  const rows = projects.map(p => p2NarrativeRow(p, now)).join('');
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

// ---------------------------------------------------------------------------
// B-main new sections: 本周关键进展 (highlights) + 合作热点 (collab)
// ---------------------------------------------------------------------------

/** Icon glyph for a HighlightEvent type. Single character so the row stays tight. */
function highlightIcon(type: HighlightEvent['type']): string {
  switch (type) {
    case 'commit':  return '✓';
    case 'push':    return '↑';
    case 'pr':      return '◆';
    case 'release': return '★';
    case 'tag':     return '#';
    case 'risky':   return '⚠';
  }
}

/** Verb phrase for a HighlightEvent type, used as part of the narrative line. */
function highlightVerb(type: HighlightEvent['type']): string {
  switch (type) {
    case 'commit':  return '提交';
    case 'push':    return '推送';
    case 'pr':      return '提 PR';
    case 'release': return '发布';
    case 'tag':     return '打 tag';
    case 'risky':   return '高风险操作';
  }
}

/**
 * "本周关键进展" — compact editorial feed of recent commits/pushes/PRs across
 * the team. Renders an empty section (still wrapped in the v7 surface) when
 * the snapshot's highlights list is empty so the Overview layout stays
 * predictable for the 30 s polling loop.
 */
export function renderHighlightsFragment(snap: OverviewSnapshot): string {
  const all = snap.highlights ?? [];
  if (all.length === 0) {
    return `<section id="highlights" class="section fade-in"></section>`;
  }
  const now = Date.parse(snap.computedAt);
  const rows = all.slice(0, 10).map(h => {
    const hours = Math.max(0, (resolveNow(now) - Date.parse(h.ts)) / 3_600_000);
    const since = idleSince(hours);
    // T1 digest: prefer the LLM-authored one-liner over the raw command in
    // `h.detail`. The LLM digest already went through the PII redactor at
    // prompt-build time; the raw `h.detail` is shell text straight from a
    // session's Bash tool use, so we redact it here before rendering to
    // strip absolute paths / emails / secrets that would otherwise leak
    // into the public dashboard surface.
    const text = h.llmDigest ?? safeHighlightDetail(h.detail);
    const detail = text && text.length > 0 ? ' · ' + escapeHtml(text) : '';
    return `<div class="hl-row" style="display:grid;grid-template-columns:24px 1fr auto;gap:12px;align-items:center;padding:12px 24px;border-bottom:1px solid var(--hairline);">
      <div class="hl-icon" style="font-size:13px;color:var(--accent-ink);width:24px;text-align:center;">${escapeHtml(highlightIcon(h.type))}</div>
      <div class="hl-body" style="min-width:0;font-size:13px;color:var(--ink-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        <strong style="font-weight:500;">${escapeHtml(h.by)}</strong>
        <span style="color:var(--ink-3);"> ${escapeHtml(highlightVerb(h.type))} </span>
        <span style="font-weight:500;">${escapeHtml(h.project)}</span>
        <span style="color:var(--ink-3);">${detail}</span>
      </div>
      <div class="hl-time" style="font-size:12px;color:var(--ink-3);">${escapeHtml(since)}</div>
    </div>`;
  }).join('');
  return `<section id="highlights" class="section fade-in">
    <div class="section-head">
      <div class="section-title">近期关键进展 <span class="section-count">${all.length}</span></div>
    </div>
    <div class="highlights-list" style="background:var(--surface);border-radius:var(--r-xl);box-shadow:var(--shadow-1);overflow:hidden;">${rows}</div>
  </section>`;
}

/**
 * "合作热点" — restore the Phase-1 CollabHit[] surface on Overview. Top 3
 * file-collision rows; "看全部 N →" footer when more exist (links to the
 * People tab, which is the closest existing destination for the long form).
 */
export function renderCollabFragment(snap: OverviewSnapshot): string {
  const all = snap.collaboration ?? [];
  if (all.length === 0) {
    return `<section id="collab" class="section fade-in"></section>`;
  }
  const top3 = all.slice(0, 3);
  const rows = top3.map(c => {
    const file = shortFile(c.filePath);
    const members = c.members.map(localPartEmail).map(escapeHtml).join(' · ');
    const tsMs = Date.parse(c.lastTouched);
    const hours = Number.isFinite(tsMs)
      ? Math.max(0, (Date.now() - tsMs) / 3_600_000)
      : NaN;
    const time = Number.isFinite(hours) ? idleSince(hours) : escapeHtml(c.lastTouched.slice(0, 10));
    return `<div class="collab-row" style="display:grid;grid-template-columns:1fr 1fr auto;gap:14px;align-items:center;padding:12px 24px;border-bottom:1px solid var(--hairline);">
      <div class="collab-file mono" style="font-size:12.5px;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(file)}</div>
      <div class="collab-members" style="font-size:12.5px;color:var(--ink-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${members}</div>
      <div class="collab-time" style="font-size:12px;color:var(--ink-3);">${escapeHtml(time)}</div>
    </div>`;
  }).join('');
  const footer = renderSeeAllFooter(top3.length, all.length, '处', '/people');
  return `<section id="collab" class="section fade-in">
    <div class="section-head">
      <div class="section-title">合作热点 <span class="section-count">${all.length}</span></div>
    </div>
    <div class="collab-list" style="background:var(--surface);border-radius:var(--r-xl);box-shadow:var(--shadow-1);overflow:hidden;">${rows}</div>
    ${footer}
  </section>`;
}
