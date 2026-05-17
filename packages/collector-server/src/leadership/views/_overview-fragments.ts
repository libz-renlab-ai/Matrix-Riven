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
      num: String(classifyHighOutput(snap.members)),
      unit: '人',
      trend: '<span class="up">↑</span><span>对比 7 日均值</span>',
      color: '#6F8B5E',
      path: 'M0 16 Q 12 14, 20 10 T 40 8 T 64 4',
    },
    {
      cls: 'kpi-spend',
      label: '本周消耗',
      num: `¥${formatKilo(snap.members.reduce((a, m) => a + (m?.today?.tokens ?? 0), 0))}`,
      unit: '',
      trend: '<span>按预算节奏</span>',
      color: '#8A9AAA',
      path: 'M0 12 Q 12 14, 20 10 T 40 12 T 64 10',
    },
    {
      cls: 'kpi-pace',
      label: '整体节奏',
      num: snap.kpis.attention.value === 0 ? '顺' : '稳',
      unit: '健',
      trend: '<span>多数项目按期</span>',
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
export function renderAttentionFragment(snap: OverviewSnapshot): string {
  if (snap.attention.length === 0) {
    return `<section id="attention" class="section fade-in"></section>`;
  }
  const lead = attentionLead(snap.attention.length);
  const rows = snap.attention.map(a => `
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
  return `<section id="attention" class="section fade-in">
    <div class="section-head">
      <div class="section-title">需要你看一眼 <span class="section-count">${snap.attention.length}</span></div>
    </div>
    <div class="attention">
      <div class="attention-head">
        <div class="attention-icon">⚠</div>
        <div class="attention-headline serif">${lead}</div>
      </div>
      <div class="attention-list">${rows}</div>
    </div>
  </section>`;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
