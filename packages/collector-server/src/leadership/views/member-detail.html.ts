/**
 * Phase 3-C · Member detail full page.
 *
 * Coexists with the slideover (per the head-storm decision): slideover is
 * the quick preview, /people/:id is the deep dive. Sections:
 *  1. Breadcrumb back to /people
 *  2. Hero (avatar + name + state + warnings)
 *  3. Filter bar (focus chip locked to this member, others editable)
 *  4. Stats summary (sessions / tokens / cost / state)
 *  5. 7×24 heatmap
 *  6. Project breakdown (per-project tokens, sessions, cost)
 *  7. Top files
 *  8. Full session list (expandable prompts)
 */

import type { MemberSnapshot, MemberDetail } from '../types.js';
import { LEADERSHIP_CSS } from './styles.css.js';
import { renderNav } from './_nav.html.js';
import { renderSlideoverShell } from './_slideover.html.js';
import { CLIENT_REFRESH_SCRIPT } from './_refresh.js.js';
import { FILTER_BAR_CSS, FILTER_BAR_SCRIPT } from './_filter-bar.client.js';

export interface RenderMemberDetailOptions {
  filterBarHtml?: string;
  rangeLabel?: string;
}

export function renderMemberDetail(
  member: MemberSnapshot,
  detail: MemberDetail,
  opts: RenderMemberDetailOptions = {},
): string {
  const navRangeLabel = opts.rangeLabel ?? '7 日窗口';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(member.displayName)} · Matrix·Riven</title>
<style>${LEADERSHIP_CSS}
${FILTER_BAR_CSS}
${MEMBER_DETAIL_CSS}</style>
</head>
<body>
<div class="shell">
${renderNav('people', { rangeLabel: navRangeLabel })}
${opts.filterBarHtml ?? ''}
${renderBreadcrumb()}
${renderHero(member)}
${renderStats(member, detail)}
${renderHeatmap(detail.heatmap7x24)}
${renderProjectBreakdown(detail, member)}
${renderTopFiles(detail.topFiles)}
${renderSessions(detail.sessions)}
</div>
${renderSlideoverShell()}
<script>${CLIENT_REFRESH_SCRIPT}</script>
<script>${FILTER_BAR_SCRIPT}</script>
</body>
</html>`;
}

function renderBreadcrumb(): string {
  return `<nav class="md-crumb"><a href="/people">← 返回团队</a></nav>`;
}

function renderHero(m: MemberSnapshot): string {
  const initials = (m.displayName.slice(0, 2) || '·').toUpperCase();
  const stateLabel = STATE_LABELS[m.stateBadge] ?? m.stateBadge;
  const warnings = m.warnings.length === 0 ? '' : `<div class="md-warnings">${m.warnings.map((w) => `<span class="md-warn">${escapeHtml(w)}</span>`).join(' ')}</div>`;
  return `<header class="md-hero fade-in">
    <div class="md-avatar">${escapeHtml(initials)}</div>
    <div class="md-hero-text">
      <h1 class="serif">${escapeHtml(m.displayName)}</h1>
      <div class="md-email">${escapeHtml(m.email)}</div>
      <div class="md-meta">
        <span class="md-state md-state-${m.stateBadge}">${escapeHtml(stateLabel)}</span>
        ${m.topProject ? `<span class="md-top-proj">焦点：${escapeHtml(m.topProject)}</span>` : ''}
      </div>
      ${warnings}
    </div>
  </header>`;
}

function renderStats(m: MemberSnapshot, _d: MemberDetail): string {
  const t = m.today ?? { sessions: 0, tokens: 0, estMinutes: 0, costUsd: 0 };
  return `<section class="md-stats fade-in">
    <h2 class="md-section-title">今日</h2>
    <div class="md-stat-grid">
      <div class="md-stat"><div class="md-stat-num">${t.sessions}</div><div class="md-stat-label">会话</div></div>
      <div class="md-stat"><div class="md-stat-num">${shortTokens(t.tokens)}</div><div class="md-stat-label">token</div></div>
      <div class="md-stat"><div class="md-stat-num">${t.estMinutes}m</div><div class="md-stat-label">活跃时长</div></div>
      <div class="md-stat"><div class="md-stat-num">$${t.costUsd.toFixed(2)}</div><div class="md-stat-label">消耗</div></div>
    </div>
    <div class="md-7d-row">
      <span class="md-7d-label">过去 7 天 · ${m.trend7d.reduce((a, x) => a + x, 0)} 会话</span>
      <span class="md-7d-spark">${renderSparkline(m.trend7d)}</span>
    </div>
  </section>`;
}

function renderHeatmap(matrix: number[][]): string {
  if (!matrix || matrix.length === 0) {
    return `<section class="md-heatmap fade-in"><h2 class="md-section-title">7×24 活动热力图</h2><div class="lh-empty">本窗口暂无数据</div></section>`;
  }
  const dayLabels = ['一', '二', '三', '四', '五', '六', '日'];
  let max = 0;
  for (const row of matrix) for (const v of row) if (v > max) max = v;
  const cells: string[] = [];
  for (let r = 0; r < 7; r++) {
    const row = matrix[r] ?? [];
    cells.push(`<div class="md-heat-day-label">${dayLabels[r]}</div>`);
    for (let c = 0; c < 24; c++) {
      const v = row[c] ?? 0;
      const alpha = max === 0 ? 0 : v / max;
      cells.push(`<div class="md-heat-cell" style="background:rgba(74,122,255,${alpha.toFixed(3)})" title="${dayLabels[r]} ${c}时 · ${v} tok"></div>`);
    }
  }
  return `<section class="md-heatmap fade-in">
    <h2 class="md-section-title">7×24 活动热力图</h2>
    <div class="md-heat-hours">
      <div></div>
      ${Array.from({ length: 24 }, (_, c) => `<div class="md-heat-hour-label">${c}</div>`).join('')}
    </div>
    <div class="md-heat-grid">
      ${cells.join('')}
    </div>
    <div class="md-heat-legend">蓝色越深 = 该小时 token 越多</div>
  </section>`;
}

function renderProjectBreakdown(d: MemberDetail, _m: MemberSnapshot): string {
  // Derive project breakdown from sessions: aggregate tokens / sessions / cost per project.
  const byProject = new Map<string, { tokens: number; sessions: number; cost: number }>();
  for (const s of d.sessions) {
    const proj = s.projectName || '(no project)';
    const cur = byProject.get(proj) ?? { tokens: 0, sessions: 0, cost: 0 };
    cur.sessions += 1;
    cur.tokens += s.totalTokens;
    byProject.set(proj, cur);
  }
  const rows = [...byProject.entries()]
    .sort((a, b) => b[1].tokens - a[1].tokens)
    .slice(0, 10);
  if (rows.length === 0) {
    return `<section class="md-projects fade-in"><h2 class="md-section-title">项目拆解</h2><div class="lh-empty">本窗口暂无项目活动</div></section>`;
  }
  const max = rows[0]![1].tokens;
  return `<section class="md-projects fade-in">
    <h2 class="md-section-title">项目拆解（按 token 降序，前 10）</h2>
    <ol class="md-proj-list">
      ${rows.map(([name, s]) => {
        const w = max === 0 ? 0 : (s.tokens / max) * 100;
        return `<li class="md-proj-row">
          <span class="md-proj-name">${escapeHtml(name)}</span>
          <span class="md-proj-bar"><span class="md-proj-bar-fill" style="width:${w.toFixed(1)}%"></span></span>
          <span class="md-proj-stats">${s.sessions} 会话 · ${shortTokens(s.tokens)} tok</span>
        </li>`;
      }).join('')}
    </ol>
  </section>`;
}

function renderTopFiles(files: { path: string; edits: number }[]): string {
  if (!files || files.length === 0) {
    return `<section class="md-files fade-in"><h2 class="md-section-title">高频编辑文件</h2><div class="lh-empty">本窗口暂无编辑</div></section>`;
  }
  return `<section class="md-files fade-in">
    <h2 class="md-section-title">高频编辑文件（前 ${Math.min(10, files.length)} 个）</h2>
    <ol class="md-files-list">
      ${files.slice(0, 10).map((f) => `<li><span class="md-file-path">${escapeHtml(f.path)}</span><span class="md-file-edits">${f.edits} 次</span></li>`).join('')}
    </ol>
  </section>`;
}

function renderSessions(sessions: MemberDetail['sessions']): string {
  if (sessions.length === 0) {
    return `<section class="md-sessions fade-in"><h2 class="md-section-title">会话列表</h2><div class="lh-empty">本窗口暂无会话</div></section>`;
  }
  return `<section class="md-sessions fade-in">
    <h2 class="md-section-title">会话列表（共 ${sessions.length}）</h2>
    <ol class="md-session-list">
      ${sessions.slice(0, 50).map((s) => {
        const preview = escapeHtml(s.firstPromptPreview || '（无 prompt）');
        const full = s.firstPromptFull;
        const expand = full && full.length > (s.firstPromptPreview?.length ?? 0)
          ? `<details><summary>查看完整</summary><pre class="md-session-prompt">${escapeHtml(full)}</pre></details>`
          : '';
        return `<li class="md-session-row">
          <span class="md-session-time">${s.capturedAt.slice(0, 16).replace('T', ' ')}</span>
          <span class="md-session-project">${escapeHtml(s.projectName)}</span>
          <span class="md-session-tokens">${shortTokens(s.totalTokens)} tok</span>
          <span class="md-session-preview">${preview}</span>
          ${expand}
        </li>`;
      }).join('')}
    </ol>
    ${sessions.length > 50 ? `<div class="md-session-more">显示前 50 条 · 共 ${sessions.length} 条</div>` : ''}
  </section>`;
}

function renderSparkline(trend: number[]): string {
  if (!trend || trend.length === 0) return '';
  const max = Math.max(...trend, 1);
  const bars = trend
    .map((v) => `<span class="md-spark-bar" style="height:${((v / max) * 24 + 2).toFixed(1)}px"></span>`)
    .join('');
  return `<span class="md-spark">${bars}</span>`;
}

function shortTokens(n: number): string {
  if (!isFinite(n) || n <= 0) return '0';
  if (n < 1000) return String(Math.round(n));
  if (n < 100_000) return (Math.round(n / 100) / 10).toFixed(1) + 'k';
  if (n < 1_000_000) return Math.round(n / 1000) + 'k';
  return (Math.round(n / 100_000) / 10).toFixed(1) + 'M';
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STATE_LABELS: Record<string, string> = {
  active: '活跃中',
  quiet: '安静',
  stuck: '卡住',
  needs_help: '求助',
  low_activity: '低活跃',
};

const MEMBER_DETAIL_CSS = `
.md-crumb {
  padding: 14px 16px 0;
  font-size: 12px;
}
.md-crumb a {
  color: var(--ink-3, #888);
  text-decoration: none;
}
.md-crumb a:hover { color: var(--accent, #4a7aff); }

.md-hero {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 18px 16px 24px;
  border-bottom: 1px solid var(--hairline, #e0e3eb);
}
.md-avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: linear-gradient(135deg, #4a7aff, #c98a4a);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  font-weight: 600;
}
.md-hero-text { flex: 1; }
.md-hero-text h1 { margin: 0 0 4px; font-size: 28px; }
.md-email { color: var(--ink-3, #888); font-size: 13px; }
.md-meta {
  margin-top: 8px;
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  flex-wrap: wrap;
}
.md-state {
  padding: 3px 10px;
  border-radius: 12px;
  font-weight: 600;
}
.md-state-active { background: rgba(74, 158, 122, .15); color: #4a9e7a; }
.md-state-quiet { background: rgba(150, 150, 160, .15); color: #969aa6; }
.md-state-stuck { background: rgba(214, 78, 78, .15); color: #d64e4e; }
.md-state-needs_help { background: rgba(255, 158, 58, .15); color: #ff9e3a; }
.md-state-low_activity { background: rgba(150, 150, 160, .12); color: #aaa; }
.md-top-proj { color: var(--ink-2, #555); }
.md-warnings {
  margin-top: 6px;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.md-warn {
  font-size: 11px;
  background: rgba(214, 78, 78, .08);
  color: #b53939;
  padding: 2px 8px;
  border-radius: 4px;
}

.md-stats, .md-heatmap, .md-projects, .md-files, .md-sessions {
  padding: 18px 16px;
  border-bottom: 1px solid var(--hairline, #e0e3eb);
}
.md-section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink-2, #555);
  margin: 0 0 12px;
  letter-spacing: .2px;
}
.md-stat-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.md-stat {
  background: var(--surface-1, #f7f8fc);
  padding: 14px;
  border-radius: 8px;
  text-align: center;
}
.md-stat-num {
  font-size: 22px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.md-stat-label {
  font-size: 11px;
  color: var(--ink-3, #888);
  margin-top: 4px;
}
.md-7d-row {
  margin-top: 14px;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--ink-3, #888);
}
.md-spark {
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  height: 30px;
}
.md-spark-bar {
  display: inline-block;
  width: 8px;
  background: var(--accent, #4a7aff);
  border-radius: 2px;
}

.md-heat-hours {
  display: grid;
  grid-template-columns: 24px repeat(24, 1fr);
  gap: 2px;
  font-size: 9px;
  color: var(--ink-3, #888);
  margin-bottom: 4px;
  text-align: center;
}
.md-heat-grid {
  display: grid;
  grid-template-columns: 24px repeat(24, 1fr);
  gap: 2px;
}
.md-heat-day-label {
  font-size: 11px;
  color: var(--ink-3, #888);
  align-self: center;
}
.md-heat-cell {
  height: 16px;
  background: var(--surface-1, #f7f8fc);
  border-radius: 2px;
}
.md-heat-legend {
  margin-top: 8px;
  font-size: 10px;
  color: var(--ink-3, #999);
}

.md-proj-list, .md-files-list, .md-session-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.md-proj-row {
  display: grid;
  grid-template-columns: 180px 1fr 140px;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
  font-size: 12px;
}
.md-proj-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.md-proj-bar {
  height: 10px;
  background: var(--surface-1, #f7f8fc);
  border-radius: 5px;
  overflow: hidden;
}
.md-proj-bar-fill {
  display: block;
  height: 100%;
  background: var(--accent, #4a7aff);
}
.md-proj-stats {
  color: var(--ink-3, #888);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.md-files-list li {
  display: flex;
  justify-content: space-between;
  padding: 5px 0;
  border-bottom: 1px dashed var(--hairline, #eee);
  font-size: 12px;
}
.md-file-path {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}
.md-file-edits {
  color: var(--ink-3, #888);
  font-variant-numeric: tabular-nums;
}
.md-session-row {
  display: grid;
  grid-template-columns: 130px 140px 70px 1fr;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px dashed var(--hairline, #eee);
  font-size: 12px;
  align-items: baseline;
}
.md-session-time {
  font-variant-numeric: tabular-nums;
  color: var(--ink-3, #888);
  font-size: 11px;
}
.md-session-project {
  color: var(--ink-2, #555);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.md-session-tokens {
  color: var(--ink-3, #888);
  font-variant-numeric: tabular-nums;
}
.md-session-preview {
  font-family: 'Newsreader', serif;
}
.md-session-prompt {
  grid-column: 4 / -1;
  background: var(--surface-2, #f7f8fc);
  padding: 8px;
  border-radius: 4px;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 4px 0 0;
}
[data-theme="dark"] .md-session-prompt { background: #1a1a20; }
.md-session-more {
  text-align: center;
  font-size: 11px;
  color: var(--ink-3, #888);
  padding: 10px;
}
`;
