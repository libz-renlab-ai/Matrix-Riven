/**
 * Server-rendered HTML project-detail page for the Leadership Dashboard.
 *
 * Exports `renderProjectDetail(snap)` → complete HTML document string.
 * Per spec §5: header, KPI cards, bus-factor warning, contributors,
 * sparkline, tech-stack bar, milestones timeline, heatmap 7×24,
 * recent files table, and web-research / test-ratio metadata.
 *
 * XSS hygiene: every user-controlled string passes through escapeHtml().
 */

import type { ProjectSnapshot, ProjectDetail } from '../types.js';
import { LEADERSHIP_CSS } from './styles.css.js';
import { escapeHtml } from './overview.html.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_LABELS: Record<string, string> = {
  active: '活跃',
  maintaining: '维护',
  dormant: '沉睡',
  revived: '复活',
};

const STATE_CLASS: Record<string, string> = {
  active: 'ok',
  maintaining: 'low',
  dormant: 'quiet',
  revived: 'ok',
};

const STACK_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f43f5e', '#71717a',
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function renderProjectDetail(snap: ProjectSnapshot & { detail: ProjectDetail }): string {
  const d = snap.detail;
  const stateClass = STATE_CLASS[snap.state] ?? 'low';
  const stateLabel = STATE_LABELS[snap.state] ?? snap.state;

  const etaText = snap.etaDays == null
    ? '<div class="lh-eta-note">数据不足，无法投影 ETA</div>'
    : `<div class="value">≈ ${snap.etaDays} 天</div><div class="lh-eta-note">基于节奏估算（信心: ${snap.etaConfidence}），不承诺精度</div>`;

  const busWarn = snap.busFactorWarning
    ? `<div class="lh-bus-warning">⚠️ 单人风险：top 贡献者占比 ${(snap.contributors[0]!.sharePct * 100).toFixed(0)}%。建议安排协作或文档承接。</div>`
    : '';

  const sparkline = renderSparkline(snap.trend7d);

  const contributorsHtml = snap.contributors.length === 0
    ? '<div class="lh-empty">无贡献者数据</div>'
    : snap.contributors.map((c, idx) => `
        <div class="lh-member-card">
          <div class="lh-avatar" style="background:${STACK_COLORS[idx % STACK_COLORS.length]}">${escapeHtml((c.email.split('@')[0] ?? c.email).slice(0, 2).toUpperCase())}</div>
          <div class="lh-member-info">
            <div class="lh-member-name">${escapeHtml(c.email.split('@')[0] ?? c.email)}</div>
            <div class="lh-member-meta">${(c.sharePct * 100).toFixed(1)}% 贡献</div>
          </div>
        </div>`).join('');

  const stackBar = renderStackBar(d.extensionMix);

  const milestonesHtml = d.milestones.length === 0
    ? '<div class="lh-empty">本窗口内无里程碑事件</div>'
    : `<table class="lh-table"><thead><tr><th>时间</th><th>类型</th><th>谁</th><th>命令</th></tr></thead><tbody>${
        d.milestones.map(m => `<tr>
          <td>${escapeHtml(m.ts.slice(0, 19))}</td>
          <td>${escapeHtml(m.type)}</td>
          <td>${escapeHtml(m.by.split('@')[0] ?? m.by)}</td>
          <td><code style="font-size:11px">${escapeHtml(m.detail)}</code></td>
        </tr>`).join('')
      }</tbody></table>`;

  const heatmapHtml = renderHeatmap(d.heatmap7x24);

  const filesHtml = d.recentFiles.length === 0
    ? '<div class="lh-empty">无文件编辑记录</div>'
    : `<table class="lh-table"><thead><tr><th>文件</th><th>触碰次数</th></tr></thead><tbody>${
        d.recentFiles.slice(0, 20).map(f => `<tr><td>${escapeHtml(f.path)}</td><td>${f.touches}</td></tr>`).join('')
      }</tbody></table>`;

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>${escapeHtml(snap.name)} · 项目 · Leadership</title>
<style>${LEADERSHIP_CSS}</style>
</head><body>
<div class="lh-container">
  <div class="lh-detail-h1">
    <a class="back" href="/overview">← Overview</a>
    <h2>${escapeHtml(snap.name)}</h2>
    <span class="lh-badge ${stateClass}">${escapeHtml(stateLabel)}</span>
  </div>

  ${busWarn}

  <div class="lh-detail-cards">
    <div class="lh-kpi-card">
      <div class="label">贡献者</div>
      <div class="value">${snap.contributors.length}</div>
      <div class="sub">${snap.contributors.length > 0 ? escapeHtml((snap.contributors[0]!.email.split('@')[0] ?? '')) + ' 主导' : ''}</div>
    </div>
    <div class="lh-kpi-card">
      <div class="label">阶段</div>
      <div class="value" style="font-size:20px">${escapeHtml(snap.phaseGuess)}</div>
    </div>
    <div class="lh-kpi-card">
      <div class="label">健康度</div>
      <div class="value">${snap.healthScore}/10</div>
    </div>
    <div class="lh-kpi-card">
      <div class="label">ETA</div>
      ${etaText}
    </div>
  </div>

  <div class="lh-section-h">7 日趋势</div>
  <div>${sparkline}</div>

  <div class="lh-section-h">贡献者</div>
  <div class="lh-member-list">${contributorsHtml}</div>

  <div class="lh-section-h">技术栈分布（按文件扩展名）</div>
  ${stackBar}
  <div style="font-size:12px;color:#6b7280">测试 ÷ 实现 编辑比 ${
    Number.isFinite(d.testRatio) ? d.testRatio.toFixed(2) : '∞'
  } · web 检索占比 ${(d.webResearchShare * 100).toFixed(0)}%</div>

  <div class="lh-section-h">里程碑事件（${d.milestones.length}）</div>
  ${milestonesHtml}

  <div class="lh-section-h">工作时段热力图（CST · 7×24）</div>
  ${heatmapHtml}

  <div class="lh-section-h">编辑频繁文件 top ${Math.min(20, d.recentFiles.length)}</div>
  ${filesHtml}
</div></body></html>`;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function renderSparkline(values: number[]): string {
  if (values.length === 0) return '';
  const max = Math.max(...values, 1);
  const bars = values.map(v => `<span style="height:${Math.round((v / max) * 100)}%"></span>`).join('');
  return `<span class="lh-sparkline" style="height:40px">${bars}</span>`;
}

function renderStackBar(mix: Record<string, number>): string {
  const entries = Object.entries(mix).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return '<div class="lh-empty">无数据</div>';
  const bar = entries.map(([k, v], idx) =>
    `<span style="width:${(v * 100).toFixed(0)}%;background:${STACK_COLORS[idx % STACK_COLORS.length]}" title="${escapeHtml(k)}: ${(v * 100).toFixed(0)}%"></span>`).join('');
  const legend = entries.map(([k, v], idx) =>
    `<span style="margin-right:12px;font-size:12px;color:#6b7280"><span style="display:inline-block;width:10px;height:10px;background:${STACK_COLORS[idx % STACK_COLORS.length]};border-radius:2px;margin-right:4px"></span>${escapeHtml(k)} ${(v * 100).toFixed(0)}%</span>`).join('');
  return `<div class="lh-stack-bar">${bar}</div><div>${legend}</div>`;
}

function renderHeatmap(grid: number[][]): string {
  const max = Math.max(1, ...grid.flat());
  const labels = ['7d前', '6d前', '5d前', '4d前', '3d前', '昨日', '今日'];
  const rows = grid.map((row, i) => {
    const cells = row.map(v => {
      const op = v === 0 ? 0.06 : 0.15 + (v / max) * 0.85;
      return `<div class="lh-hm-cell" style="opacity:${op.toFixed(2)}" title="${v}"></div>`;
    }).join('');
    return `<div class="lh-hm-label">${escapeHtml(labels[i] ?? '')}</div>${cells}`;
  }).join('');
  return `<div class="lh-heatmap">${rows}</div>`;
}
