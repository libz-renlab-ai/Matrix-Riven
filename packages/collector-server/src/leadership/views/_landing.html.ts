/**
 * Public marketing landing page for Matrix-Riven Leadership.
 *
 * Hits `/landing` (and `/` when no auth token is configured AND no `?sid=`
 * query is present). Doesn't require auth — designed to be the first thing
 * a CTO / launch-day skeptic sees before clicking into the live dashboard.
 *
 * Self-contained: reuses LEADERSHIP_CSS so the visual identity is one and
 * the same across marketing and product.
 */

import { LEADERSHIP_CSS } from './styles.css.js';

interface LandingFeature {
  icon: string;       // 1–2 char glyph
  title: string;
  copy: string;       // 1 short sentence
  proof: string;      // concrete number / detail
}

const FEATURES: LandingFeature[] = [
  {
    icon: '✦',
    title: 'LLM 叙事层（T1–T5）',
    copy: '每天用户的 session 自动生成五层中文叙事，从单次会话总结到一句领导日报。',
    proof: '5 个 tier · haiku + sonnet · 全离线 cache · 单次 cycle <$0.20',
  },
  {
    icon: '◍',
    title: '16 个信号检测器',
    copy: '活跃 / 专注 / 节奏 / 卡住 / 求助 / 风险动作 / 协作热区 / 沉睡项目 / 单点依赖 / 学习面 ……',
    proof: '不是关键词检索，是结构化检测器；每个都有单元测试',
  },
  {
    icon: '◆',
    title: '诚实的过时数据横幅',
    copy: '数据快照超过 24 小时？我们直接在 hero 上方告诉你，不假装新鲜。',
    proof: '`<staleness>` 字段一路从 aggregator 透传到 UI',
  },
  {
    icon: '◎',
    title: '真 $ 成本遥测',
    copy: '今日 LLM 花了多少、每个 tier 多少 entries、距日预算还剩多少——都在 `/api/llm/status`。',
    proof: '`LLM_DAILY_BUDGET_USD` 95% ceiling 防超额，单 cycle 实测 $0.12–0.20',
  },
  {
    icon: '◐',
    title: '成员小波形 + 7 日节奏',
    copy: '每个成员 tile 的 sparkline 是 7 日真实活跃 trend；KPI 卡的占位小波形仅作装饰（v0.2 接真数据）。',
    proof: '7×24 热图、7 日节奏、状态徽章——数据来自同一个 snapshot',
  },
  {
    icon: '✚',
    title: 'Bearer auth + 默认 loopback',
    copy: '产线启动默认只绑 127.0.0.1；放 LAN 必须配 `RIVEN_AUTH_TOKEN`。安全是默认值，不是 opt-in。',
    proof: 'ETag/304 双向缓存，全路由响应都带 nosniff + X-Frame-Options',
  },
];

export function renderLanding(opts: { hasAuth: boolean }): string {
  const featureCards = FEATURES.map((f) => `
      <div class="lc-card">
        <div class="lc-icon">${escapeHtml(f.icon)}</div>
        <div class="lc-title">${escapeHtml(f.title)}</div>
        <div class="lc-copy">${escapeHtml(f.copy)}</div>
        <div class="lc-proof">${escapeHtml(f.proof)}</div>
      </div>`).join('');

  const ctaPrimary = opts.hasAuth
    ? `<a class="lc-cta-secondary" href="/overview">凭 token 进入实时看板 →</a>`
    : `<a class="lc-cta-primary" href="/overview?demo=1">查看 Demo 看板 →</a>
       <a class="lc-cta-secondary" href="/overview">直连真实数据 →</a>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Matrix-Riven · 领导真正能用的工程团队仪表盘</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${LEADERSHIP_CSS}
.lc-page { max-width:1080px; margin:0 auto; padding:80px 40px 120px; }
.lc-hero h1 { font-family:'Newsreader',serif; font-size:44px; line-height:1.2; color:var(--ink-1); margin:0 0 16px; font-weight:500; }
.lc-hero h1 em { font-style:normal; color:var(--accent-ink); font-weight:600; }
.lc-hero .lead { font-size:17px; line-height:1.6; color:var(--ink-2); max-width:720px; margin:0 0 24px; }
.lc-cta { display:flex; gap:14px; margin-top:32px; flex-wrap:wrap; }
.lc-cta-primary, .lc-cta-secondary { display:inline-block; padding:12px 22px; border-radius:var(--r-lg); font-size:15px; text-decoration:none; font-weight:500; }
.lc-cta-primary { background:var(--accent-ink); color:var(--surface); }
.lc-cta-secondary { background:var(--surface); color:var(--ink-1); border:1px solid var(--hairline); }
.lc-cta-primary:hover, .lc-cta-secondary:hover { box-shadow:var(--shadow-2); }
.lc-pillars { display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:16px; margin:64px 0 0; }
.lc-card { padding:24px; background:var(--surface); border:1px solid var(--hairline); border-radius:var(--r-lg); box-shadow:var(--shadow-1); }
.lc-icon { font-size:22px; color:var(--accent-ink); margin-bottom:10px; }
.lc-title { font-family:'Newsreader',serif; font-size:19px; color:var(--ink-1); margin-bottom:8px; font-weight:500; }
.lc-copy { font-size:14px; line-height:1.55; color:var(--ink-2); margin-bottom:10px; }
.lc-proof { font-size:12px; line-height:1.5; color:var(--ink-3); font-family:ui-monospace, 'Menlo', monospace; }
.lc-foot { margin-top:80px; padding-top:32px; border-top:1px solid var(--hairline); display:flex; justify-content:space-between; flex-wrap:wrap; gap:12px; font-size:12.5px; color:var(--ink-3); }
.lc-foot a { color:var(--ink-2); text-decoration:none; border-bottom:1px solid var(--ink-5); }
</style>
</head>
<body>
<div class="shell">
<div class="lc-page">
  <section class="lc-hero">
    <h1>不再看一堆 <em>0 会话 · 推进新功能 · ↘ 近期已收尾</em>。<br>看每个人在做什么、谁卡住了、今天团队真正进展到哪。</h1>
    <p class="lead">Matrix-Riven 不是又一个 Notion 看板。它直接读你团队的 Claude Code transcript，跑 16 个信号检测器 + 五层 LLM 叙事，每 30 秒给你一份会说人话的仪表盘——而且诚实地告诉你数据多新、花了多少钱、谁该挪一下。</p>
    <div class="lc-cta">${ctaPrimary}</div>
  </section>

  <section class="lc-pillars">
    ${featureCards}
  </section>

  <footer class="lc-foot">
    <div>Matrix-Riven · Leadership Edition · v0.1</div>
    <div>
      <a href="/overview">实时看板</a> ·
      <a href="/retro">本周回顾</a> ·
      <a href="/sources">数据来源</a> ·
      <a href="/api/llm/status">LLM Status</a>
    </div>
  </footer>
</div>
</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
