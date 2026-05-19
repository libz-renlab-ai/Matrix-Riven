/**
 * Weekly retrospective view — reuses the OverviewSnapshot already
 * computed by the aggregator. Three editorial sections:
 *
 *   - **本周交付** — `highlights` filtered to commit / push / pr /
 *     release / tag, top 8, newest first.
 *   - **本周关注** — `attention` items, sorted desc by severity.
 *   - **本周表现** — `members` with `stateBadge === 'active'` AND
 *     `deltaVs7dAvgPct > 0.1`, plus the dormant projects (state ===
 *     'dormant') as a "stale watch" callout.
 *
 * No new data flow — every value comes from the snapshot the
 * `/api/overview` endpoint already produces. This is a different LENS on
 * the same numbers, suitable for a Monday-morning retro print.
 */

import type { OverviewSnapshot, HighlightEvent, AttentionItem, MemberSnapshot, ProjectSnapshot } from '../types.js';
import { LEADERSHIP_CSS } from './styles.css.js';
import { renderNav } from './_nav.html.js';
import { CONSENT_BANNER_CSS, CONSENT_BANNER_SCRIPT, renderConsentBanner } from './_consent-banner.html.js';

export function renderRetro(snap: OverviewSnapshot, opts: { demo?: boolean } = {}): string {
  const delivered = (snap.highlights ?? [])
    .filter((h) => ['commit', 'push', 'pr', 'release', 'tag'].includes(h.type))
    .slice(0, 8);
  const concerns = [...snap.attention].sort((a, b) => b.severity - a.severity).slice(0, 6);
  const standout = snap.members
    .filter((m) => m.stateBadge === 'active' && m.deltaVs7dAvgPct > 0.1)
    .slice(0, 5);
  const dormant = snap.projects.filter((p) => p.state === 'dormant').slice(0, 4);
  // §5.6: /retro is a *weekly* view. Previously we rendered `snap.llmBrief`
  // (T5 daily brief) here because the snapshot already had it — but a daily
  // brief at the top of a weekly retrospective reads as semantic noise
  // ("今日… 明日…" copy in a "本周回顾" page). Replace with a
  // deterministic weekly summary line built from the same snapshot.
  const weeklySummary = renderWeeklySummary(snap);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>周回顾 · Matrix-Riven</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${LEADERSHIP_CSS}
${CONSENT_BANNER_CSS}
.rt-page { max-width:980px; margin:0 auto; padding:32px 40px 80px; }
.rt-page h1 { font-family:'Newsreader',serif; font-size:32px; color:var(--ink-1); margin:0 0 8px; font-weight:500; }
.rt-page .sub { font-size:14px; color:var(--ink-3); margin:0 0 28px; }
.rt-brief { background:var(--surface); border-left:3px solid var(--accent-ink); border-radius:var(--r-lg); padding:14px 18px; margin:0 0 28px; box-shadow:var(--shadow-1); font-family:'Newsreader',serif; line-height:1.6; color:var(--ink-1); }
.rt-brief > div + div { margin-top:4px; }
.rt-section { margin:36px 0 0; }
.rt-section h2 { font-family:'Newsreader',serif; font-size:20px; color:var(--ink-1); margin:0 0 12px; font-weight:500; }
.rt-section h2 .count { font-size:13px; color:var(--ink-3); margin-left:8px; }
.rt-list { background:var(--surface); border-radius:var(--r-lg); padding:6px 0; box-shadow:var(--shadow-1); }
.rt-row { display:flex; justify-content:space-between; align-items:baseline; padding:10px 18px; border-bottom:1px solid var(--hairline); gap:18px; }
.rt-row:last-child { border-bottom:none; }
.rt-row .what { font-size:14px; color:var(--ink-1); line-height:1.5; flex:1; min-width:0; }
.rt-row .who  { font-size:12px; color:var(--ink-3); white-space:nowrap; }
.rt-row .tag  { font-size:11px; padding:1px 6px; border-radius:8px; background:var(--accent-soft); color:var(--accent-ink); margin-right:6px; }
.rt-row .urg  { background:var(--danger-soft); color:var(--danger); }
.rt-row .cm   { background:var(--calm-soft); color:var(--calm); }
.rt-empty { padding:16px 18px; font-size:13px; color:var(--ink-3); }
.rt-back { font-size:13px; color:var(--ink-3); margin-bottom:18px; display:inline-block; text-decoration:none; border-bottom:1px solid var(--ink-5); }
</style>
</head>
<body>
<div class="shell">
${renderNav('retro', { rangeLabel: '本周回顾', demo: opts.demo === true })}
<div class="rt-page">
  <a class="rt-back" href="/overview">← 返回实时看板</a>
  <h1>本周回顾</h1>
  <div class="sub">由 ${escapeHtml(snap.range.label)} 窗口生成，覆盖 ${snap.members.length} 位成员 · ${snap.projects.length} 个项目</div>
  ${weeklySummary}

  <section class="rt-section">
    <h2>本周交付 <span class="count">${delivered.length}</span></h2>
    <div class="rt-list">${delivered.length === 0
      ? `<div class="rt-empty">本窗口尚无 commit / PR / release。</div>`
      : delivered.map((h) => `
      <div class="rt-row">
        <div class="what"><span class="tag">${escapeHtml(verbLabel(h.type))}</span>${escapeHtml(h.llmDigest ?? h.detail)}</div>
        <div class="who">${escapeHtml(h.by)} · ${escapeHtml(h.project)}</div>
      </div>`).join('')
    }</div>
  </section>

  <section class="rt-section">
    <h2>需要看一眼 <span class="count">${concerns.length}</span></h2>
    <div class="rt-list">${concerns.length === 0
      ? `<div class="rt-empty">本周无需处理的关注项。</div>`
      : concerns.map((a) => `
      <div class="rt-row">
        <div class="what"><span class="tag ${a.tagSeverity === 'urgent' ? 'urg' : 'cm'}">${escapeHtml(a.tag)}</span>${escapeHtml(a.llmRewrite ?? stripTags(a.line2))}</div>
        <div class="who">${escapeHtml(a.displayName)} · ${escapeHtml(a.time)}</div>
      </div>`).join('')
    }</div>
  </section>

  <section class="rt-section">
    <h2>突出表现 <span class="count">${standout.length}</span></h2>
    <div class="rt-list">${standout.length === 0
      ? `<div class="rt-empty">本周无突出节奏（&gt;10% 高于个人均值）。</div>`
      : standout.map((m) => `
      <div class="rt-row">
        <div class="what">${escapeHtml(m.displayName)} 推进 <strong>${escapeHtml(m.topProject ?? '多个项目')}</strong>，节奏 +${Math.round((m.deltaVs7dAvgPct ?? 0) * 100)}%</div>
        <div class="who">${escapeHtml(stateBadgeLabel(m.stateBadge))}</div>
      </div>`).join('')
    }</div>
  </section>

  ${dormant.length > 0 ? `
  <section class="rt-section">
    <h2>沉睡项目 <span class="count">${dormant.length}</span></h2>
    <div class="rt-list">${dormant.map((p) => `
      <div class="rt-row">
        <div class="what"><strong>${escapeHtml(p.name)}</strong>${p.llmWeekly ? ' · ' + escapeHtml(p.llmWeekly.split('\n')[0]!) : ''}</div>
        <div class="who">健康分 ${p.healthScore.toFixed(1)}</div>
      </div>`).join('')}</div>
  </section>` : ''}
</div>
</div>
${renderConsentBanner({ demo: opts.demo === true })}
<script>${CONSENT_BANNER_SCRIPT}</script>
</body>
</html>`;
}

function renderWeeklySummary(snap: OverviewSnapshot): string {
  // Round-1 QA P1 (EM): previous version repeated the same numbers that
  // appear in each section header right below (本周交付 5 · 本周交付 5 兵
  // 突出表现 2 · 突出表现 2). Re-shape the top line so it's a qualitative
  // judgement, not a leading duplicate of the counts.
  const delivered = (snap.highlights ?? []).filter((h) => ['commit', 'push', 'pr', 'release', 'tag'].includes(h.type)).length;
  const concerns = snap.attention.length;
  const standoutN = snap.members.filter((m) => m.stateBadge === 'active' && m.deltaVs7dAvgPct > 0.1).length;
  const dormantN = snap.projects.filter((p) => p.state === 'dormant').length;
  // Pick one qualitative sentence based on the dominant signal. The exact
  // counts live in the section headers below — no need to pre-print them.
  let judgement: string;
  if (delivered === 0 && concerns === 0) {
    judgement = '本周窗口内无明显交付与关注项 — 团队节奏处于低谷或数据稀疏。';
  } else if (concerns === 0 && standoutN > 0) {
    judgement = '本周交付稳健、无待跟进项；下方有节奏突出的成员表现。';
  } else if (concerns > 0 && dormantN > 0) {
    judgement = '本周有需要跟进的关注项，叠加沉睡项目；建议优先看下方"需要看一眼"段。';
  } else if (concerns > 0) {
    judgement = '本周有需要跟进的关注项；下方按严重度排序。';
  } else if (dormantN > 0) {
    judgement = '本周交付正常，但有沉睡项目需要安排接手或归档。';
  } else {
    judgement = '本周节奏平稳，交付落地。';
  }
  void delivered; void concerns; void standoutN; void dormantN;
  return `<div class="rt-brief" aria-label="weekly summary"><div>${judgement}</div></div>`;
}

function verbLabel(type: HighlightEvent['type']): string {
  switch (type) {
    case 'commit': return '提交';
    case 'push': return '推送';
    case 'pr': return 'PR';
    case 'release': return '发版';
    case 'tag': return '打标';
    case 'risky': return '高风险';
    default: return type;
  }
}

function stateBadgeLabel(b: MemberSnapshot['stateBadge']): string {
  switch (b) {
    case 'active': return '推进中';
    case 'quiet': return '安静';
    case 'stuck': return '进展受阻';
    case 'needs_help': return '需支援';
    case 'low_activity': return '本周参与不多';
    default: return String(b);
  }
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Touch ProjectSnapshot type so unused-import warning silenced; the type
// is referenced indirectly through `OverviewSnapshot['projects']`.
const _typeReferenceTouch: ProjectSnapshot | undefined = undefined;
void _typeReferenceTouch;
