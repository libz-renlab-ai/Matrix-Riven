/**
 * Phase 3-D · Insights tab page renderer.
 *
 * Sections:
 *   1. Top: Team Health Score card with 4-sub-score breakdown + 30d sparkline
 *   2. Recommendations list (3-6 rule-based recs, severity-sorted)
 *   3. Anomaly findings (top N)
 *   4. 3 sub-tabs: 时间 / 人 / 项目, content predrendered, JS-toggled
 */

import type { InsightsSnapshot } from '../types.js';
import { etaLabel } from './_leader-lang.js';
import { LEADERSHIP_CSS } from './styles.css.js';
import { renderNav } from './_nav.html.js';
import { renderSlideoverShell } from './_slideover.html.js';
import { CLIENT_REFRESH_SCRIPT } from './_refresh.js.js';
import { FILTER_BAR_CSS, FILTER_BAR_SCRIPT } from './_filter-bar.client.js';
import { CONSENT_BANNER_CSS, CONSENT_BANNER_SCRIPT, renderConsentBanner } from './_consent-banner.html.js';

export interface RenderInsightsOptions {
  filterBarHtml?: string;
  activeSubTab?: 'time' | 'people' | 'projects';
  /** QA-5 legal P0. Suppress consent banner in demo mode. */
  demo?: boolean;
}

export function renderInsightsPage(snap: InsightsSnapshot, opts: RenderInsightsOptions = {}): string {
  const activeSub = opts.activeSubTab ?? 'time';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Insights · Matrix·Riven</title>
<style>${LEADERSHIP_CSS}
${FILTER_BAR_CSS}
${CONSENT_BANNER_CSS}
${INSIGHTS_CSS}</style>
</head>
<body>
<div class="shell">
${renderNav('insights', { rangeLabel: rangeLabel(snap.range.label), demo: opts.demo === true })}
${opts.filterBarHtml ?? ''}
<header class="ins-hero fade-in">
  <div>
    <h1 class="serif">Insights</h1>
    <div class="sub">团队解读 · 不只是发生了什么，更是为什么 + 接下来怎么样</div>
  </div>
</header>
${renderHealthCard(snap)}
${renderRecommendations(snap)}
${renderAnomalies(snap)}
${renderAxesTabs(snap, activeSub)}
</div>
${renderSlideoverShell()}
${renderConsentBanner({ demo: opts.demo === true })}
<script>${CLIENT_REFRESH_SCRIPT}</script>
<script>${FILTER_BAR_SCRIPT}</script>
<script>${INSIGHTS_TAB_SCRIPT}</script>
<script>${CONSENT_BANNER_SCRIPT}</script>
</body>
</html>`;
}

function renderHealthCard(snap: InsightsSnapshot): string {
  const h = snap.healthScore;
  const ringDeg = Math.round((h.value / 100) * 360);
  // 2026-05-19 QA-4 P0: journalist flagged "卡住率: 75" looking like
  // "75% of sessions are stuck" when it's actually a 0-100 health
  // sub-score where higher = healthier (low stuck rate). Same trap for
  // "风险". Rename labels so the direction is unambiguous, and append
  // /100 on every sub-value to match the ring unit.
  const subscoreRow = (label: string, hint: string, val: number) => `
    <div class="ins-sub" title="${escapeHtml(hint)}">
      <div class="ins-sub-label">${label}</div>
      <div class="ins-sub-bar"><span class="ins-sub-bar-fill" style="width:${val}%"></span></div>
      <div class="ins-sub-val">${val}<span class="ins-sub-unit">/100</span></div>
    </div>`;
  const spark = h.history30d
    .map((v) => `<span class="ins-spark-bar" style="height:${(v / 100) * 36 + 2}px"></span>`)
    .join('');
  return `<section class="ins-health fade-in">
    <h2 class="ins-section-title">🏥 团队健康总评分 <span class="ins-section-hint">（每项 0–100，越高越好）</span></h2>
    <div class="ins-health-body">
      <div class="ins-health-ring" style="--ring-deg:${ringDeg}deg">
        <div class="ins-health-num">${h.value}</div>
        <div class="ins-health-unit">/100</div>
      </div>
      <div class="ins-health-breakdown">
        ${subscoreRow('无卡情况', '反映「卡住」信号的稀疏度。100 = 没人卡住；0 = 团队普遍卡住。', h.breakdown.stuckRate)}
        ${subscoreRow('节奏', '过去 7 日产出节奏对比基线。100 = 加速；0 = 明显放缓。', h.breakdown.rhythm)}
        ${subscoreRow('高产出', '高产出工程师占比。100 = 团队普遍高产；0 = 无突出贡献者。', h.breakdown.output)}
        ${subscoreRow('低风险', '反映风险动作（rm -rf / force-push 等）的稀疏度。100 = 干净；0 = 频发。', h.breakdown.risk)}
      </div>
      <div class="ins-health-spark">
        <div class="ins-spark-label">30 天趋势</div>
        <div class="ins-spark">${spark}</div>
      </div>
    </div>
  </section>`;
}

function renderRecommendations(snap: InsightsSnapshot): string {
  if (snap.recommendations.length === 0) {
    return `<section class="ins-recs fade-in"><h2 class="ins-section-title">✨ 建议</h2><div class="lh-empty">当前数据下没有突出建议</div></section>`;
  }
  return `<section class="ins-recs fade-in">
    <h2 class="ins-section-title">✨ 建议（${snap.recommendations.length} 条）</h2>
    <ol class="ins-rec-list">
      ${snap.recommendations.map((r) => `
        <li class="ins-rec ins-rec-${r.severity}">
          <div class="ins-rec-head">
            <span class="ins-rec-sev ins-rec-sev-${r.severity}">${severityLabel(r.severity)}</span>
            <span class="ins-rec-headline">${escapeHtml(r.headline)}</span>
          </div>
          <div class="ins-rec-body">${escapeHtml(r.body)}</div>
        </li>
      `).join('')}
    </ol>
  </section>`;
}

function renderAnomalies(snap: InsightsSnapshot): string {
  if (snap.anomalies.length === 0) {
    return `<section class="ins-anomalies fade-in"><h2 class="ins-section-title">⏰ 异常发现</h2><div class="lh-empty">本窗口未检测到突出异常</div></section>`;
  }
  return `<section class="ins-anomalies fade-in">
    <h2 class="ins-section-title">⏰ 异常发现（${snap.anomalies.length} 条）</h2>
    <ol class="ins-anom-list">
      ${snap.anomalies.map((a) => `
        <li class="ins-anom">
          <span class="ins-anom-arrow ins-anom-${a.direction}">${a.direction === 'up' ? '↑' : '↓'}</span>
          <span class="ins-anom-member">${escapeHtml(a.member)}</span>
          <span class="ins-anom-signal">${escapeHtml(humanSignal(a.signal))}</span>
          <span class="ins-anom-mag">${a.direction === 'up' ? '是平时' : '仅平时'} ${a.magnitudeRatio.toFixed(1)}x ${a.direction === 'up' ? '' : '的'}${a.direction === 'down' ? '1/' + a.magnitudeRatio.toFixed(1) : ''}</span>
          ${a.narrative ? `<span class="ins-anom-narrative">${escapeHtml(a.narrative)}</span>` : ''}
        </li>
      `).join('')}
    </ol>
  </section>`;
}

function renderAxesTabs(snap: InsightsSnapshot, active: 'time' | 'people' | 'projects'): string {
  return `<section class="ins-axes fade-in">
    <div class="ins-axes-tabs">
      <button type="button" class="ins-axis-tab${active === 'time' ? ' active' : ''}" data-ins-tab="time">⏱ 时间</button>
      <button type="button" class="ins-axis-tab${active === 'people' ? ' active' : ''}" data-ins-tab="people">👥 人</button>
      <button type="button" class="ins-axis-tab${active === 'projects' ? ' active' : ''}" data-ins-tab="projects">📁 项目</button>
    </div>
    <div class="ins-axis-panel${active === 'time' ? ' active' : ''}" data-ins-panel="time">
      ${renderTimeAxis(snap)}
    </div>
    <div class="ins-axis-panel${active === 'people' ? ' active' : ''}" data-ins-panel="people">
      ${renderPeopleAxis(snap)}
    </div>
    <div class="ins-axis-panel${active === 'projects' ? ' active' : ''}" data-ins-panel="projects">
      ${renderProjectsAxis(snap)}
    </div>
  </section>`;
}

function renderTimeAxis(snap: InsightsSnapshot): string {
  const weeks = snap.axes.time.weeks;
  if (weeks.length === 0) return `<div class="lh-empty">无趋势数据</div>`;
  const max = Math.max(...weeks.map((w) => w.tokens), 1);
  const w = 600, h = 140, pad = 24;
  const stepX = (w - 2 * pad) / Math.max(1, weeks.length - 1);
  const points = weeks
    .map((wk, i) => {
      const x = pad + i * stepX;
      const y = h - pad - (wk.tokens / max) * (h - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const dots = weeks
    .map((wk, i) => {
      const x = pad + i * stepX;
      const y = h - pad - (wk.tokens / max) * (h - 2 * pad);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#4a7aff"><title>${wk.weekStart}: ${wk.tokens} tok / ${wk.sessions} sess / ${wk.commits} commit</title></circle>`;
    })
    .join('');
  return `<div class="ins-time-chart">
    <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">
      <polyline points="${points}" fill="none" stroke="#4a7aff" stroke-width="2"/>
      ${dots}
    </svg>
    <div class="ins-time-narrative">
      ${snap.axes.time.narrative
        ? escapeHtml(snap.axes.time.narrative)
        : '<em>本周 token 总量与历史趋势对比；点 dot 看具体周数据。</em>'}
    </div>
  </div>`;
}

function renderPeopleAxis(snap: InsightsSnapshot): string {
  const rows = snap.axes.people.rows;
  if (rows.length === 0) return `<div class="lh-empty">无人员数据</div>`;
  const maxTok = Math.max(...rows.map((r) => r.metrics.tokens), 1);
  return `<div class="ins-people-chart">
    <ol class="ins-bar-list">
      ${rows.map((r) => {
        const pct = (r.metrics.tokens / maxTok) * 100;
        return `<li class="ins-bar-row">
          <span class="ins-bar-name">${escapeHtml(r.displayName)}</span>
          <span class="ins-bar"><span class="ins-bar-fill" style="width:${pct.toFixed(1)}%"></span></span>
          <span class="ins-bar-val">${r.metrics.tokens} tok · ${r.metrics.sessions} 会话 · ${r.metrics.projectsTouched} 项目</span>
        </li>`;
      }).join('')}
    </ol>
    <div class="ins-people-narrative">
      ${snap.axes.people.narrative
        ? escapeHtml(snap.axes.people.narrative)
        : '<em>按 token 量横切对比。结合 7-day delta 看每人节奏走向。</em>'}
    </div>
  </div>`;
}

function renderProjectsAxis(snap: InsightsSnapshot): string {
  const rows = snap.axes.projects.rows;
  if (rows.length === 0) return `<div class="lh-empty">无项目数据</div>`;
  return `<div class="ins-projects-chart">
    <table class="ins-proj-table">
      <thead><tr><th>项目</th><th>贡献人</th><th>健康度</th><th>ETA</th></tr></thead>
      <tbody>
        ${rows.map((r) => `<tr>
          <td class="ins-proj-name">${escapeHtml(r.name)}</td>
          <td>${r.metrics.contributors}</td>
          <td><span class="ins-health-pill ins-health-${healthBucket(r.metrics.healthScore)}">${r.metrics.healthScore.toFixed(1)}</span></td>
          <td>${escapeHtml(etaLabel(r.metrics.etaDays))}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div class="ins-projects-narrative">
      ${snap.axes.projects.narrative
        ? escapeHtml(snap.axes.projects.narrative)
        : '<em>按健康度排序的项目对比。ETA 基于近 14 天节奏外推（置信度 low）。</em>'}
    </div>
  </div>`;
}

function severityLabel(s: 'info' | 'warn' | 'critical'): string {
  return s === 'critical' ? '关键' : s === 'warn' ? '注意' : '建议';
}

function humanSignal(s: string): string {
  switch (s) {
    case 'daily_tokens': return '今日 token 量';
    case 'weekly_tokens': return '本周 token 量';
    default: return s;
  }
}

function healthBucket(v: number): 'high' | 'mid' | 'low' {
  if (v >= 7) return 'high';
  if (v >= 4) return 'mid';
  return 'low';
}

function rangeLabel(label: string): string {
  switch (label) {
    case '24h': return '24 小时';
    case 'today': return '今日';
    case '7d': return '7 日窗口';
    case '30d': return '30 日窗口';
    default: return label;
  }
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const INSIGHTS_CSS = `
.ins-hero { padding: 18px 16px 12px; border-bottom: 1px solid var(--hairline, #e0e3eb); }
.ins-hero h1 { margin: 0; font-size: 26px; }
.ins-hero .sub { color: var(--ink-3, #888); font-size: 13px; margin-top: 2px; }
.ins-section-title { font-size: 14px; font-weight: 600; color: var(--ink-2, #555); margin: 0 0 14px; }
.ins-section-hint { font-size: 11.5px; font-weight: 400; color: var(--ink-3, #888); margin-left: 6px; }
.ins-sub-unit { font-size: 11px; color: var(--ink-3, #888); margin-left: 2px; }

.ins-health { padding: 18px 16px; border-bottom: 1px solid var(--hairline, #e0e3eb); }
.ins-health-body { display: grid; grid-template-columns: 140px 1fr 200px; gap: 24px; align-items: center; }
.ins-health-ring {
  position: relative;
  width: 140px; height: 140px;
  border-radius: 50%;
  background: conic-gradient(#4a7aff var(--ring-deg, 0deg), #e8e8ec 0deg);
  display: flex;
  align-items: center;
  justify-content: center;
}
.ins-health-ring::before {
  content: '';
  position: absolute;
  inset: 14px;
  border-radius: 50%;
  background: #fff;
}
[data-theme="dark"] .ins-health-ring::before { background: #161620; }
.ins-health-num { position: relative; font-size: 38px; font-weight: 700; }
.ins-health-unit { position: absolute; font-size: 11px; color: var(--ink-3, #888); bottom: 32px; }
.ins-health-breakdown { display: flex; flex-direction: column; gap: 6px; }
.ins-sub { display: grid; grid-template-columns: 60px 1fr 30px; gap: 8px; align-items: center; font-size: 12px; }
.ins-sub-label { color: var(--ink-3, #888); }
.ins-sub-bar { height: 6px; background: var(--surface-1, #f7f8fc); border-radius: 3px; overflow: hidden; }
.ins-sub-bar-fill { display: block; height: 100%; background: #4a7aff; }
.ins-sub-val { text-align: right; font-variant-numeric: tabular-nums; }
.ins-health-spark { text-align: right; }
.ins-spark-label { font-size: 10px; color: var(--ink-3, #999); margin-bottom: 4px; }
.ins-spark { display: inline-flex; align-items: flex-end; gap: 1px; height: 40px; }
.ins-spark-bar { display: inline-block; width: 4px; background: #4a7aff; border-radius: 1px; }

.ins-recs, .ins-anomalies, .ins-axes { padding: 18px 16px; border-bottom: 1px solid var(--hairline, #e0e3eb); }
.ins-rec-list, .ins-anom-list { list-style: none; margin: 0; padding: 0; }
.ins-rec {
  padding: 12px;
  border-radius: 8px;
  margin-bottom: 8px;
  background: var(--surface-1, #f7f8fc);
}
.ins-rec-critical { background: rgba(214, 78, 78, .08); border-left: 4px solid #d64e4e; }
.ins-rec-warn { background: rgba(255, 158, 58, .08); border-left: 4px solid #ff9e3a; }
.ins-rec-info { background: rgba(74, 158, 122, .06); border-left: 4px solid #4a9e7a; }
.ins-rec-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.ins-rec-sev { font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 600; }
.ins-rec-sev-critical { background: rgba(214, 78, 78, .2); color: #d64e4e; }
.ins-rec-sev-warn { background: rgba(255, 158, 58, .2); color: #cc7a00; }
.ins-rec-sev-info { background: rgba(74, 158, 122, .2); color: #2d6e54; }
.ins-rec-headline { font-weight: 600; }
.ins-rec-body { font-size: 13px; color: var(--ink-2, #555); }

.ins-anom { display: grid; grid-template-columns: 30px 100px 140px 1fr; gap: 10px; padding: 8px 0; border-bottom: 1px dashed var(--hairline, #eee); font-size: 13px; align-items: center; }
.ins-anom:last-child { border-bottom: 0; }
.ins-anom-arrow { font-size: 18px; font-weight: 700; text-align: center; }
.ins-anom-up { color: #4a9e7a; }
.ins-anom-down { color: #d64e4e; }
.ins-anom-member { font-weight: 600; }
.ins-anom-signal { color: var(--ink-3, #888); font-size: 12px; }
.ins-anom-mag { color: var(--ink-2, #555); font-variant-numeric: tabular-nums; }

.ins-axes-tabs { display: flex; gap: 6px; margin-bottom: 14px; }
.ins-axis-tab {
  background: transparent;
  border: 1px solid var(--hairline, #d0d3db);
  border-radius: 16px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
  color: var(--ink-2, #555);
}
.ins-axis-tab.active { background: #4a7aff; color: #fff; border-color: #4a7aff; font-weight: 600; }
.ins-axis-panel { display: none; }
.ins-axis-panel.active { display: block; }

.ins-time-chart svg { background: var(--surface-1, #f7f8fc); border-radius: 6px; }
[data-theme="dark"] .ins-time-chart svg { background: #1a1a22; }

.ins-bar-list { list-style: none; margin: 0; padding: 0; }
.ins-bar-row { display: grid; grid-template-columns: 120px 1fr auto; align-items: center; gap: 12px; padding: 6px 0; font-size: 12px; }
.ins-bar-name { font-weight: 600; }
.ins-bar { height: 10px; background: var(--surface-1, #f7f8fc); border-radius: 5px; }
.ins-bar-fill { display: block; height: 100%; background: #4a7aff; border-radius: 5px; }
.ins-bar-val { color: var(--ink-3, #888); font-variant-numeric: tabular-nums; }

.ins-time-narrative, .ins-people-narrative, .ins-projects-narrative { margin-top: 14px; padding: 12px; background: var(--surface-1, #f7f8fc); border-radius: 6px; font-size: 13px; color: var(--ink-2, #555); }
[data-theme="dark"] .ins-time-narrative, [data-theme="dark"] .ins-people-narrative, [data-theme="dark"] .ins-projects-narrative { background: #1a1a22; }

.ins-proj-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.ins-proj-table th, .ins-proj-table td { padding: 8px; text-align: left; border-bottom: 1px solid var(--hairline, #eee); }
.ins-proj-table th { font-weight: 600; color: var(--ink-3, #888); font-size: 11px; }
.ins-proj-name { font-weight: 600; }
.ins-health-pill { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; }
.ins-health-high { background: rgba(74, 158, 122, .15); color: #2d6e54; }
.ins-health-mid { background: rgba(255, 158, 58, .15); color: #cc7a00; }
.ins-health-low { background: rgba(214, 78, 78, .15); color: #b53939; }
`;

const INSIGHTS_TAB_SCRIPT = `(function(){
  function bind() {
    document.addEventListener('click', function(e) {
      var btn = e.target && e.target.closest && e.target.closest('[data-ins-tab]');
      if (!btn) return;
      var key = btn.getAttribute('data-ins-tab');
      document.querySelectorAll('.ins-axis-tab').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      document.querySelectorAll('.ins-axis-panel').forEach(function(p) {
        if (p.getAttribute('data-ins-panel') === key) p.classList.add('active');
        else p.classList.remove('active');
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();`;
