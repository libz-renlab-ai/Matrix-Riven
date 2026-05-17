/**
 * Slide-over (drawer) renderers for the Leadership Dashboard — P-B6.
 *
 * The v7 redesign retires the Phase-1 full-page detail views (`/members/:id`
 * and `/projects/:name`) and instead mounts a single 520-px slide-over panel
 * inside the Overview shell. The shell ships with empty `<div id="so-...">`
 * slots; the panel is populated on demand by the client refresh script,
 * which fetches `/api/members/:id` (or `/api/projects/:name`) and swaps in
 * the four HTML fragments returned under `data._html`.
 *
 * Exports:
 *   renderSlideoverShell()                    → static markup (scrim + panel)
 *   renderMemberSlideoverFragments(m, d)      → { callout, stats, evolve, projects }
 *   renderProjectSlideoverFragments(p, d)     → same shape
 *
 * XSS hygiene: every user-controlled string passes through escapeHtml().
 */

import type {
  MemberSnapshot,
  MemberDetail,
  ProjectSnapshot,
  ProjectDetail,
} from '../types.js';
import { idleCallout } from './_copy.js';

export interface SlideoverFragments {
  callout: string;
  stats: string;
  evolve: string;
  projects: string;
}

// ---------------------------------------------------------------------------
// Shell — static markup injected into the Overview page once.
// ---------------------------------------------------------------------------

export function renderSlideoverShell(): string {
  return `
<div class="scrim" id="scrim" onclick="window.closeSO && window.closeSO()"></div>
<aside class="slideover" id="so">
  <div class="so-head">
    <div class="so-avatar" id="so-avatar"></div>
    <div class="so-id">
      <div class="so-name" id="so-name"></div>
      <div class="so-meta" id="so-meta"></div>
    </div>
    <button class="so-close" type="button" onclick="window.closeSO && window.closeSO()" aria-label="关闭">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
    </button>
  </div>
  <div class="so-body">
    <div id="so-callout"></div>
    <div class="so-section"><div class="so-h">本周快照</div><div id="so-stats"></div></div>
    <div class="so-section"><div class="so-h">prompt 的演变 · 看他都在问什么</div><div id="so-evolve"></div></div>
    <div class="so-section"><div class="so-h">在哪些项目里</div><div id="so-projects"></div></div>
  </div>
</aside>`;
}

// ---------------------------------------------------------------------------
// Member fragments
// ---------------------------------------------------------------------------

export function renderMemberSlideoverFragments(
  member: MemberSnapshot,
  detail: MemberDetail,
): SlideoverFragments {
  const idleHours = computeIdleHours(detail);
  const lastFile = detail.topFiles[0]?.path ?? detail.sessions[0]?.firstPromptPreview;
  // idleCallout returns HTML (with <em> tags) — do NOT escape it.
  const calloutHtml = idleCallout({
    displayName: member.displayName,
    idleHours,
    ...(lastFile !== undefined ? { lastFile } : {}),
  });
  const callout = `<div class="so-callout">
    <div class="so-callout-icon">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
    </div>
    <div class="so-callout-text serif">${calloutHtml}</div>
  </div>`;

  const healthPct = Math.max(0, Math.min(100, Math.round((1 - detail.toolFailureRate) * 100)));
  const stats = `<div class="so-stats">
    <div class="so-stat"><div class="so-stat-num tnum">${member.today.sessions}</div><div class="so-stat-label">会话</div></div>
    <div class="so-stat"><div class="so-stat-num tnum">¥${formatKilo(member.today.tokens)}</div><div class="so-stat-label">消耗</div></div>
    <div class="so-stat"><div class="so-stat-num tnum">${healthPct}%</div><div class="so-stat-label">健康</div></div>
  </div>`;

  const evolve = renderMemberEvolve(detail);
  const projects = renderMemberProjects(detail);
  return { callout, stats, evolve, projects };
}

function renderMemberEvolve(detail: MemberDetail): string {
  const rows: { ts: string; text: string; latest: boolean }[] = [];
  for (const s of detail.sessions) {
    for (const p of s.allPrompts) {
      rows.push({ ts: formatHHMM(p.ts), text: p.preview, latest: rows.length === 0 });
      if (rows.length >= 6) break;
    }
    if (rows.length >= 6) break;
  }
  if (rows.length === 0) {
    return `<div class="so-evolve"><div class="so-evolve-item"><div class="so-evolve-text serif">没有 prompt 记录</div></div></div>`;
  }
  const items = rows
    .map(
      (r) => `
    <div class="so-evolve-item${r.latest ? ' latest' : ''}">
      <div class="so-evolve-time mono">${escapeHtml(r.ts)}</div>
      <div class="so-evolve-text serif">${escapeHtml(r.text)}</div>
    </div>`,
    )
    .join('');
  return `<div class="so-evolve">${items}</div>`;
}

function renderMemberProjects(detail: MemberDetail): string {
  const counts = new Map<string, number>();
  for (const s of detail.sessions) {
    counts.set(s.projectName, (counts.get(s.projectName) ?? 0) + 1);
  }
  const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return `<div style="color:var(--ink-3);font-size:13px;">该窗口内无项目活动</div>`;
  }
  const items = entries
    .map(
      ([name, n]) => `
    <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--surface-2);border-radius:var(--r-md);">
      <div class="proj-icon" style="width:24px;height:24px;font-size:10px;">${escapeHtml(name.slice(0, 2).toUpperCase())}</div>
      <div style="flex:1;font-size:13.5px;color:var(--ink-1);font-weight:500;">${escapeHtml(name)}</div>
      <div style="font-size:12px;color:var(--ink-3);">${n} 会话</div>
    </div>`,
    )
    .join('');
  return `<div style="display:flex;flex-direction:column;gap:8px;">${items}</div>`;
}

/**
 * Approximate "hours since the member's last captured session". Used by
 * idleCallout to pick the right editorial copy. Returns 24 when there are
 * no sessions on record (so the worst-case "建议主动问一句" copy fires).
 */
function computeIdleHours(detail: MemberDetail): number {
  const latest = detail.sessions[0]?.capturedAt;
  if (!latest) return 24;
  const ts = Date.parse(latest);
  if (Number.isNaN(ts)) return 24;
  return Math.max(0, Math.round((Date.now() - ts) / 3_600_000));
}

// ---------------------------------------------------------------------------
// Project fragments
// ---------------------------------------------------------------------------

export function renderProjectSlideoverFragments(
  project: ProjectSnapshot,
  detail: ProjectDetail,
): SlideoverFragments {
  const callout = `<div class="so-callout">
    <div class="so-callout-icon">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
    </div>
    <div class="so-callout-text serif">${escapeHtml(project.name)} 当前在 <em>${escapeHtml(project.phaseGuess)}</em> 阶段，健康分 <em>${project.healthScore}/10</em>。</div>
  </div>`;

  const etaText = project.etaDays == null ? '—' : String(project.etaDays);
  const stats = `<div class="so-stats">
    <div class="so-stat"><div class="so-stat-num tnum">${project.contributors.length}</div><div class="so-stat-label">贡献者</div></div>
    <div class="so-stat"><div class="so-stat-num tnum">${detail.weekFiles.length}</div><div class="so-stat-label">本周文件</div></div>
    <div class="so-stat"><div class="so-stat-num tnum">${etaText}</div><div class="so-stat-label">ETA (天)</div></div>
  </div>`;

  const evolve = renderProjectEvolve(detail);
  const projects = renderProjectRecentFiles(detail);
  return { callout, stats, evolve, projects };
}

function renderProjectEvolve(detail: ProjectDetail): string {
  const ms = detail.milestones.slice(0, 6);
  if (ms.length === 0) {
    return `<div class="so-evolve"><div class="so-evolve-item"><div class="so-evolve-text serif">本窗口内暂无里程碑</div></div></div>`;
  }
  const items = ms
    .map(
      (m, i) => `
    <div class="so-evolve-item${i === 0 ? ' latest' : ''}">
      <div class="so-evolve-time mono">${escapeHtml(m.ts.slice(0, 10))}</div>
      <div class="so-evolve-text serif">${escapeHtml(m.type)} · ${escapeHtml(m.detail)}</div>
    </div>`,
    )
    .join('');
  return `<div class="so-evolve">${items}</div>`;
}

function renderProjectRecentFiles(detail: ProjectDetail): string {
  if (detail.recentFiles.length === 0) {
    return `<div style="color:var(--ink-3);font-size:13px;">该窗口内无文件编辑</div>`;
  }
  const items = detail.recentFiles
    .slice(0, 5)
    .map(
      (f) => `
    <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--surface-2);border-radius:var(--r-md);">
      <div style="flex:1;font-size:13.5px;color:var(--ink-1);font-weight:500;font-family:var(--mono,monospace);">${escapeHtml(f.path)}</div>
      <div style="font-size:12px;color:var(--ink-3);">${f.touches}</div>
    </div>`,
    )
    .join('');
  return `<div style="display:flex;flex-direction:column;gap:8px;">${items}</div>`;
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatKilo(n: number): string {
  if (!Number.isFinite(n) || n < 1000) return String(Math.max(0, Math.round(n)));
  return (n / 1000).toFixed(1) + 'k';
}

function formatHHMM(ts: string): string {
  if (ts.length >= 16 && ts[10] === 'T') return ts.slice(11, 16);
  return ts;
}
