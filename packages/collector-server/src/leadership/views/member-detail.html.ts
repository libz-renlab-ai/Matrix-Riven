/**
 * Server-rendered HTML member-detail page for the Leadership Dashboard.
 *
 * Exports `renderMemberDetail(snap)` → complete HTML document string.
 * Inline <style> uses LEADERSHIP_CSS; all user-controlled strings are
 * escaped via escapeHtml() to prevent XSS.
 */

import type { MemberSnapshot, MemberDetail } from '../types.js';
import { LEADERSHIP_CSS, avatarColor, emailInitials } from './styles.css.js';
import { escapeHtml } from './overview.html.js';

export { escapeHtml };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function renderMemberDetail(snap: MemberSnapshot & { detail: MemberDetail }): string {
  const d = snap.detail;
  const heatmapHtml = renderHeatmap(d.heatmap7x24);
  const topFilesHtml =
    d.topFiles.length === 0
      ? `<div class="lh-empty">No file activity in this window</div>`
      : `<table class="lh-table"><thead><tr><th>File</th><th>Edits</th></tr></thead><tbody>${d.topFiles
          .map(f => `<tr><td>${escapeHtml(f.path)}</td><td>${f.edits}</td></tr>`)
          .join('')}</tbody></table>`;

  const riskyHtml =
    d.riskyActions.length === 0
      ? ''
      : `<div class="lh-section-h">风险动作（${d.riskyActions.length}）</div>
         <div>${d.riskyActions
           .map(
             a => `
           <div class="lh-session-item">
             <div class="lh-session-meta">${escapeHtml(a.ts.slice(0, 19))} · ${escapeHtml(a.pattern)}</div>
             <pre class="lh-session-full">${escapeHtml(a.snippet)}</pre>
           </div>`,
           )
           .join('')}</div>`;

  const sessionsHtml =
    d.sessions.length === 0
      ? `<div class="lh-empty">这位成员在该窗口内没有 session</div>`
      : d.sessions
          .map(
            s => `
          <div class="lh-session-item">
            <div class="lh-session-meta">${escapeHtml(s.capturedAt.slice(0, 19))} · ${escapeHtml(s.projectName)} · ${s.totalTokens.toLocaleString()} tok</div>
            <div class="lh-session-preview">${escapeHtml(s.firstPromptPreview)}${s.firstPromptFull.length > s.firstPromptPreview.length ? '…' : ''}</div>
            <details><summary>展开全文（${s.allPrompts.length} 条 prompt）</summary>
              <div class="lh-prompts-list">${s.allPrompts
                .map(
                  p => `
                <div class="lh-prompt-item">
                  <div class="lh-prompt-ts">${escapeHtml(formatTimeHMS(p.ts))}</div>
                  <div class="lh-prompt-preview">${escapeHtml(p.preview)}${p.full.length > p.preview.length ? '…' : ''}</div>
                  ${
                    p.full.length > p.preview.length
                      ? `<details><summary>全文</summary><pre class="lh-session-full">${escapeHtml(p.full)}</pre></details>`
                      : ''
                  }
                </div>`,
                )
                .join('')}</div>
            </details>
          </div>`,
          )
          .join('');

  const modelMixHtml = renderModelMix(d.modelMix);
  const collaboratorsHtml =
    d.collaborators.length === 0
      ? '<div class="lh-empty">没有协作信号</div>'
      : `<ul>${d.collaborators
          .map(
            c =>
              `<li>${escapeHtml(c.withEmail.split('@')[0] ?? c.withEmail)} · ${c.sharedFiles.length} 个共编文件</li>`,
          )
          .join('')}</ul>`;

  // Avatar for header
  const color = avatarColor(snap.email);
  const initials = emailInitials(snap.email);

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>${escapeHtml(snap.displayName)} · Leadership</title>
<style>${LEADERSHIP_CSS}</style>
</head><body>
<div class="lh-container">
  <div class="lh-detail-h1">
    <a class="back" href="/overview">← Overview</a>
    <div class="lh-avatar" style="background:${color}">${escapeHtml(initials)}</div>
    <h2>${escapeHtml(snap.displayName)}</h2>
    <span class="email">${escapeHtml(snap.email)}</span>
  </div>

  <div class="lh-detail-cards">
    <div class="lh-kpi-card"><div class="label">今日 sessions</div><div class="value">${snap.today.sessions}</div></div>
    <div class="lh-kpi-card"><div class="label">今日 tokens</div><div class="value">${snap.today.tokens.toLocaleString()}</div></div>
    <div class="lh-kpi-card"><div class="label">今日 成本</div><div class="value">$${snap.today.costUsd.toFixed(2)}</div></div>
    <div class="lh-kpi-card"><div class="label">估算工时</div><div class="value">${(snap.today.estMinutes / 60).toFixed(1)}h</div></div>
    <div class="lh-kpi-card"><div class="label">7 日均环比</div><div class="value">${(snap.deltaVs7dAvgPct * 100).toFixed(0)}%</div></div>
  </div>

  <div class="lh-detail-cards">
    <div class="lh-kpi-card">
      <div class="label">状态</div>
      <div class="value" style="font-size:18px">${escapeHtml(snap.stateBadge)}</div>
      <div class="sub">${escapeHtml(snap.warnings.join(' · '))}</div>
    </div>
    <div class="lh-kpi-card">
      <div class="label">效率</div>
      <div class="value" style="font-size:18px">tool 失败 ${(d.toolFailureRate * 100).toFixed(0)}%</div>
      <div class="sub">context 爆炸 ${d.overContext200kCount} · iter ${d.iterationDensity.toFixed(1)} msg/任务</div>
    </div>
    <div class="lh-kpi-card">
      <div class="label">学习</div>
      <div class="value" style="font-size:18px">${d.webResearchCount}</div>
      <div class="sub">web 检索次数</div>
    </div>
  </div>

  <div class="lh-section-h">工作时段热力图（CST · 7×24）</div>
  ${heatmapHtml}

  <div class="lh-section-h">模型使用分布</div>
  ${modelMixHtml}

  <div class="lh-section-h">触碰文件 top ${d.topFiles.length}</div>
  ${topFilesHtml}

  <div class="lh-section-h">协作者</div>
  ${collaboratorsHtml}

  ${riskyHtml}

  <div class="lh-section-h">Sessions（${d.sessions.length}）</div>
  <div class="lh-sessions-list">${sessionsHtml}</div>
</div></body></html>`;
}

// ---------------------------------------------------------------------------
// Time format helper — extracts HH:MM:SS from an ISO timestamp; tolerant of
// non-ISO inputs (falls back to the original string).
// ---------------------------------------------------------------------------

function formatTimeHMS(ts: string): string {
  // ISO timestamps look like 2026-05-17T03:12:00.000Z → take chars 11..19
  if (ts.length >= 19 && ts[10] === 'T') return ts.slice(11, 19);
  return ts;
}

// ---------------------------------------------------------------------------
// Heatmap renderer
// ---------------------------------------------------------------------------

function renderHeatmap(grid: number[][]): string {
  const max = Math.max(1, ...grid.flat());
  const labels = ['7d前', '6d前', '5d前', '4d前', '3d前', '昨日', '今日'];
  const rows = grid
    .map((row, i) => {
      const cells = row
        .map(v => {
          const op = v === 0 ? 0.06 : 0.15 + (v / max) * 0.85;
          return `<div class="lh-hm-cell" style="opacity:${op.toFixed(2)}" title="${v}"></div>`;
        })
        .join('');
      return `<div class="lh-hm-label">${escapeHtml(labels[i] ?? '')}</div>${cells}`;
    })
    .join('');
  return `<div class="lh-heatmap">${rows}</div>`;
}

// ---------------------------------------------------------------------------
// Model mix stacked bar renderer
// ---------------------------------------------------------------------------

function renderModelMix(mix: Record<string, number>): string {
  const entries = Object.entries(mix);
  if (entries.length === 0) return '<div class="lh-empty">无数据</div>';
  const colors: Record<string, string> = {
    opus: '#8b5cf6',
    sonnet: '#3b82f6',
    haiku: '#10b981',
    other: '#71717a',
    unknown: '#71717a',
  };
  const bar = entries
    .map(
      ([k, v]) =>
        `<span style="width:${(v * 100).toFixed(0)}%;background:${colors[k] ?? '#71717a'}" title="${escapeHtml(k)}: ${(v * 100).toFixed(0)}%"></span>`,
    )
    .join('');
  const legend = entries
    .map(
      ([k, v]) =>
        `<span style="margin-right:12px"><span style="display:inline-block;width:10px;height:10px;background:${colors[k] ?? '#71717a'};border-radius:2px;margin-right:4px"></span>${escapeHtml(k)} ${(v * 100).toFixed(0)}%</span>`,
    )
    .join('');
  return `<div class="lh-stack-bar">${bar}</div><div style="font-size:12px;color:#6b7280">${legend}</div>`;
}
