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
import {
  phaseLabel,
  stateLabel,
  trendLabel,
  trendArrow,
  healthLabel,
  healthDotColor,
  shortFile,
  etaLabel,
  idleSince,
} from './_leader-lang.js';

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
    <a class="so-expand" id="so-expand" href="#" title="展开整页" aria-label="展开整页" hidden>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 3H3v6"/><path d="M21 15v6h-6"/><path d="M21 3l-9 9"/><path d="M3 21l9-9"/></svg>
      <span>整页</span>
    </a>
    <button class="so-close" type="button" onclick="window.closeSO && window.closeSO()" aria-label="关闭">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
    </button>
  </div>
  <div class="so-body">
    <div id="so-callout"></div>
    <div class="so-actions" id="so-actions" hidden style="display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 18px;">
      <button type="button" class="so-action-btn so-action-primary" id="so-act-draft" title="基于这条 attention 草一段开场">起草 Slack 开场 →</button>
      <button type="button" class="so-action-btn" id="so-act-11" title="把这条 attention 加到下次 1:1 议程">加入下次 1:1 →</button>
      <button type="button" class="so-action-btn" id="so-act-evidence" title="展开触发该判定的原始信号">看证据</button>
    </div>
    <div class="so-section"><div class="so-h">本周快照</div><div id="so-stats"></div></div>
    <div class="so-section"><div class="so-h">近期会话主题</div><div id="so-evolve"></div></div>
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
  // Member callout: build a one-sentence narrative from real fields rather
  // than the generic "idle X hours" boilerplate. Branches on the (already
  // distribution-calibrated) stateBadge so the message matches the leader's
  // mental model of why this person is in the drawer.
  const idleHours = computeIdleHours(detail);
  const topFile = detail.topFiles[0]?.path;
  const topProject = member.topProject ?? mostCommonProject(detail);
  const shortTopFile = topFile ? shortFile(topFile) : '';
  let calloutSentence: string;
  // T2 LLM digest takes precedence: when present we emit the LLM string
  // (escaped — plain external text) joining the two lines into one
  // sentence. The severity color and icon come from the surrounding markup
  // and are unchanged. Falls back to the template-authored callout below
  // when llmWeekly is absent or empty.
  const llmText = member.llmWeekly?.split('\n').filter(Boolean).join(' ').trim();
  if (llmText) {
    calloutSentence = escapeHtml(llmText);
  } else if (member.stateBadge === 'needs_help') {
    calloutSentence = topProject
      ? `${escapeHtml(member.displayName)} 在 <em>${escapeHtml(topProject)}</em> 上反复受阻 — <em>看一眼是否需要支援</em>。`
      : `${escapeHtml(member.displayName)} 工具调用反复失败 — <em>看一眼是否需要支援</em>。`;
  } else if (member.stateBadge === 'stuck') {
    if (shortTopFile) {
      calloutSentence = `${escapeHtml(member.displayName)} 卡在 <em>${escapeHtml(shortTopFile)}</em> 已经 ${escapeHtml(idleSince(idleHours))} — <em>可能需要支援</em>。`;
    } else {
      calloutSentence = `${escapeHtml(member.displayName)} 在反复尝试相似问题 — <em>可能需要支援</em>。`;
    }
  } else if (member.stateBadge === 'low_activity') {
    calloutSentence = `${escapeHtml(member.displayName)} 已经 ${escapeHtml(idleSince(idleHours))} 没有新动作 — <em>本周参与不多</em>。`;
  } else if (member.stateBadge === 'quiet') {
    calloutSentence = `${escapeHtml(member.displayName)} 本窗口无活动 — <em>暂无新工作</em>。`;
  } else {
    const trend = trendLabel(member.trend7d);
    calloutSentence = topProject
      ? `${escapeHtml(member.displayName)} 正常推进 <em>${escapeHtml(topProject)}</em>，本周 <em>${escapeHtml(trend)}</em>。`
      : `${escapeHtml(member.displayName)} 正常推进，本周 <em>${escapeHtml(trend)}</em>。`;
  }
  const callout = `<div class="so-callout">
    <div class="so-callout-icon">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
    </div>
    <div class="so-callout-text serif">${calloutSentence}</div>
  </div>`;

  // Stats block — 3 narrative phrases instead of raw numbers. Leader can
  // still see counts on the member detail page (Phase 3); this drawer is
  // editorial-first. CSS class `.so-stat-num` is preserved (test contract)
  // even though the content is now a phrase, not a number.
  const trendText = trendLabel(member.trend7d);
  const focusProject = topProject ?? '—';
  const focusPhase = '聚焦 ' + (focusProject === '—' ? '—' : focusProject);
  const stateText = stateLabel(member.stateBadge);
  // 2026-05-18 round-16 audit: surface the raw today numbers (sessions /
  // tokens / cost) so leaders can answer "他今天用了多少 token、花了多少钱"
  // without leaving the drawer. The editorial 3-cell strip above keeps the
  // qualitative read; the breakdown below carries the hard numbers.
  const t = member.today ?? { sessions: 0, tokens: 0, estMinutes: 0, costUsd: 0 };
  const usage = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px;padding:12px 14px;background:var(--surface-2);border-radius:var(--r-md);">
    <div style="text-align:center;">
      <div style="font-size:15px;font-weight:600;color:var(--ink-1);font-variant-numeric:tabular-nums;">${t.sessions}</div>
      <div style="font-size:11px;color:var(--ink-3);margin-top:2px;">今日会话</div>
    </div>
    <div style="text-align:center;">
      <div style="font-size:15px;font-weight:600;color:var(--ink-1);font-variant-numeric:tabular-nums;">${formatTokensShort(t.tokens)}</div>
      <div style="font-size:11px;color:var(--ink-3);margin-top:2px;">今日 token</div>
    </div>
    <div style="text-align:center;">
      <div style="font-size:15px;font-weight:600;color:var(--ink-1);font-variant-numeric:tabular-nums;">$${formatCostShort(t.costUsd)}</div>
      <div style="font-size:11px;color:var(--ink-3);margin-top:2px;">今日消耗</div>
    </div>
  </div>`;
  const stats = `<div class="so-stats">
    <div class="so-stat"><div class="so-stat-num" style="font-size:14px;font-weight:500;">${escapeHtml(trendText)}</div><div class="so-stat-label">本周节奏</div></div>
    <div class="so-stat"><div class="so-stat-num" style="font-size:14px;font-weight:500;">${escapeHtml(focusPhase)}</div><div class="so-stat-label">焦点</div></div>
    <div class="so-stat"><div class="so-stat-num" style="font-size:14px;font-weight:500;">${escapeHtml(stateText)}</div><div class="so-stat-label">状态</div></div>
  </div>${usage}`;

  const evolve = renderMemberEvolve(detail);
  const projects = renderMemberProjects(detail);
  return { callout, stats, evolve, projects };
}

/** Best-effort topProject fallback when MemberSnapshot.topProject is empty. */
function mostCommonProject(detail: MemberDetail): string | undefined {
  const counts = new Map<string, number>();
  for (const s of detail.sessions) {
    counts.set(s.projectName, (counts.get(s.projectName) ?? 0) + 1);
  }
  let top: string | undefined;
  let topN = 0;
  for (const [name, n] of counts) if (n > topN) { topN = n; top = name; }
  return top;
}

function renderMemberEvolve(detail: MemberDetail): string {
  // Round-7 QA P0 (EM + journalist): previously rendered `p.preview` (the
  // first ~80 chars of the prompt) directly. Even with member-detail's
  // "v1 不渲染原文" change, the slideover was still leaking the first 80
  // chars in plain text — accessible from any attention click. Switch to
  // a topic class label + length so the leader sees "what kind of work
  // and how dense", not "what the engineer literally typed". v2 audit-log
  // gated reveal is the same path planned for /people/<id>.
  const rows: { ts: string; topic: string; len: number; latest: boolean }[] = [];
  for (const s of detail.sessions) {
    for (const p of s.allPrompts) {
      rows.push({
        ts: formatHHMM(p.ts),
        topic: classifyPromptTopic(p.preview),
        len: (p.preview ?? '').length,
        latest: rows.length === 0,
      });
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
      <div class="so-evolve-text serif">📝 ${escapeHtml(r.topic)} · <span style="color:var(--ink-3);">${r.len} 字符</span></div>
    </div>`,
    )
    .join('');
  return `<div class="so-evolve">${items}</div>`;
}

/**
 * Round-7 QA P0: classify a prompt preview into a coarse topic label so the
 * slideover can show "what kind of work" without leaking the literal words.
 * Heuristic keyword match — better than nothing, doesn't pretend to be NLP.
 */
function classifyPromptTopic(preview: string | undefined): string {
  const text = (preview ?? '').toLowerCase();
  if (!text) return '空 prompt';
  if (/(test|spec|vitest|jest|\btdd\b)/i.test(text)) return '测试相关';
  if (/(error|err|fail|bug|exception|stack|trace)/i.test(text)) return '排错 / 修 bug';
  if (/(refactor|rename|cleanup|tidy|extract)/i.test(text)) return '重构';
  if (/(doc|readme|comment|说明|文档)/i.test(text)) return '文档';
  if (/(deploy|release|ship|publish|push|merge|pr)/i.test(text)) return '发布 / 集成';
  if (/(type|interface|generic|tsc|narrow)/i.test(text)) return '类型 / 接口';
  if (/(perf|optim|slow|fast|latency)/i.test(text)) return '性能';
  if (/(ui|css|style|design|前端|界面)/i.test(text)) return 'UI / 样式';
  if (/(数据|查|filter|sort|join|sql|query)/i.test(text)) return '数据 / 查询';
  if (/(security|auth|token|权限|认证)/i.test(text)) return '安全 / 认证';
  return '常规编码';
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
      <div class="proj-icon" style="width:24px;height:24px;font-size:10px;">${escapeHtml(projectInitials(name))}</div>
      <div style="flex:1;font-size:13.5px;color:var(--ink-1);font-weight:500;">${renderProjectTitleHtml(name)}</div>
      <div style="font-size:12px;color:var(--ink-3);">${n} 会话</div>
    </div>`,
    )
    .join('');
  return `<div style="display:flex;flex-direction:column;gap:8px;">${items}</div>`;
}

/**
 * 2-character initials for a project icon. When the name is in the
 * `owner/repo` form produced by the github-remote project identity, the
 * initials come from the **repo** part (the meaningful identifier) rather
 * than the owner. Cwd-derived names use the first two characters as-is.
 */
function projectInitials(name: string): string {
  const slash = name.indexOf('/');
  if (slash >= 0) {
    const repo = name.slice(slash + 1);
    return repo.slice(0, 2).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/**
 * Render an `owner/repo` name with the `owner/` prefix dimmed. Plain names
 * pass through unchanged. Both branches escape so output is safe to drop
 * into innerHTML directly.
 */
function renderProjectTitleHtml(name: string): string {
  const slashIdx = name.indexOf('/');
  if (slashIdx < 0) return escapeHtml(name);
  const owner = name.slice(0, slashIdx);
  const repo = name.slice(slashIdx + 1);
  return `<span style="color:var(--ink-3);font-weight:400;">${escapeHtml(owner)}/</span>${escapeHtml(repo)}`;
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
  // Callout — composed entirely from leader-language helpers. Names the
  // project, what phase it's in, the trajectory this week, who's actively
  // touching it today, and a calibrated ETA. No "phase=implement" or
  // "healthScore=7/10" surfaces here — those are engineer-speak.
  const phaseText = phaseLabel(project.phaseGuess);
  const trendText = trendLabel(project.trend7d);
  const etaText = etaLabel(project.etaDays);
  const activeCount = project.activeTodayCount ?? 0;
  // ETA "暂无预估" reads awkwardly when concatenated as "预计 暂无预估"; in
  // that case we use the underlying phrase as a standalone sentence end.
  const etaClause = project.etaDays == null ? etaText : `预计 ${etaText}`;
  // T3 LLM digest takes precedence: when present we emit the LLM sentences
  // (escaped — plain external text) joined into a single callout line.
  // Severity / icon color / surrounding markup are unchanged. Falls back to
  // the template callout when llmWeekly is absent or empty.
  const llmText = project.llmWeekly?.split('\n').filter(Boolean).join(' ').trim();
  const calloutText = llmText
    ? escapeHtml(llmText)
    : `<em>${escapeHtml(project.name)}</em> ${escapeHtml(phaseText)}，${escapeHtml(trendText)}。当前 <em>${activeCount} 人在做</em>，${escapeHtml(etaClause)}。`;
  const dotColor = healthDotColor(project.healthScore);
  const callout = `<div class="so-callout">
    <div class="so-callout-icon" style="color:${dotColor};">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
    </div>
    <div class="so-callout-text serif">${calloutText}</div>
  </div>`;

  // Stats — 3 narrative phrases instead of raw counts.
  const teamSize = `${project.contributors.length} 位贡献者${project.contributors.length === 1 ? '（单人项目）' : ''}`;
  const healthText = healthLabel(project.healthScore);
  const stats = `<div class="so-stats">
    <div class="so-stat"><div class="so-stat-num" style="font-size:14px;font-weight:500;">${escapeHtml(trendArrow(project.trend7d))} ${escapeHtml(trendText)}</div><div class="so-stat-label">本周节奏</div></div>
    <div class="so-stat"><div class="so-stat-num" style="font-size:14px;font-weight:500;">${escapeHtml(teamSize)}</div><div class="so-stat-label">团队规模</div></div>
    <div class="so-stat"><div class="so-stat-num" style="font-size:14px;font-weight:500;">${escapeHtml(healthText)}</div><div class="so-stat-label">整体健康</div></div>
  </div>`;

  const evolve = renderProjectEvolve(detail);
  const projects = renderProjectRecentFiles(detail);
  return { callout, stats, evolve, projects };
}

function renderProjectEvolve(detail: ProjectDetail): string {
  // 2026-05-18 round-16 audit P0: surface real user prompts from sessions
  // touching this project — the section label says "看他都在问什么", so it
  // must show questions, not raw git commands. Falls back to milestones
  // when no filtered prompts survived (e.g. a project whose sessions only
  // contain slash-command activity).
  const prompts = detail.recentPrompts.slice(0, 6);
  if (prompts.length > 0) {
    const items = prompts
      .map(
        (p, i) => `
    <div class="so-evolve-item${i === 0 ? ' latest' : ''}">
      <div class="so-evolve-time mono">${escapeHtml(formatHHMM(p.ts))}</div>
      <div class="so-evolve-text serif">${escapeHtml(p.preview)}</div>
    </div>`,
      )
      .join('');
    return `<div class="so-evolve">${items}</div>`;
  }
  const ms = detail.milestones.slice(0, 6);
  if (ms.length === 0) {
    return `<div class="so-evolve"><div class="so-evolve-item"><div class="so-evolve-text serif">本窗口内暂无活动</div></div></div>`;
  }
  const items = ms
    .map(
      (m, i) => `
    <div class="so-evolve-item${i === 0 ? ' latest' : ''}">
      <div class="so-evolve-time mono">${escapeHtml(localDateKey(m.ts))}</div>
      <div class="so-evolve-text serif">${escapeHtml(milestoneLabel(m.type))} · ${escapeHtml(milestoneSummary(m.detail))}</div>
    </div>`,
    )
    .join('');
  return `<div class="so-evolve">${items}</div>`;
}

function milestoneLabel(type: string): string {
  switch (type) {
    case 'commit': return '提交';
    case 'push': return '推送';
    case 'pr': return '发起 PR';
    case 'release': return '发布';
    case 'tag': return '打标签';
    default: return type;
  }
}

function milestoneSummary(detail: string): string {
  // Bash detail can be a heredoc-style commit message ($(cat <<'EOF' …)).
  // Strip the heredoc shell, take the first non-empty line, truncate.
  const trimmed = detail.replace(/\$\(cat\s+<<'?EOF'?\s*/i, '').replace(/EOF\s*\)/i, '');
  const firstLine = trimmed.split('\n').map((l) => l.trim()).filter(Boolean)[0] ?? '';
  return firstLine.length > 120 ? firstLine.slice(0, 120) + '…' : firstLine;
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

function formatHHMM(ts: string): string {
  // Server-local HH:MM (consistent with PR4's local-timezone day boundary).
  // Falls back to the raw string when it isn't a parseable timestamp.
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Server-local YYYY-MM-DD for an ISO ts (the evolve timeline's date labels). */
function localDateKey(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Short token-count formatter for drawer cards: 1234 → "1.2k", 12345 → "12k",
// 1234567 → "1.2M". Single source of truth for "怎么显示 token 数".
function formatTokensShort(n: number): string {
  if (!isFinite(n) || n <= 0) return '0';
  if (n < 1000) return String(Math.round(n));
  if (n < 100_000) return (Math.round(n / 100) / 10).toFixed(1) + 'k';
  if (n < 1_000_000) return Math.round(n / 1000) + 'k';
  return (Math.round(n / 100_000) / 10).toFixed(1) + 'M';
}

function formatCostShort(n: number): string {
  if (!isFinite(n) || n <= 0) return '0.00';
  if (n < 100) return n.toFixed(2);
  if (n < 1000) return Math.round(n).toString();
  return (Math.round(n / 100) / 10).toFixed(1) + 'k';
}
