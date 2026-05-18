/**
 * Public transparency page — what matrix-riven ingests, where the numbers
 * come from, and which signals fire. Reachable at `/sources`. No auth (it's
 * pure documentation of the architecture, no team data).
 */

import { LEADERSHIP_CSS } from './styles.css.js';
import { CONSENT_BANNER_CSS, CONSENT_BANNER_SCRIPT, renderConsentBanner } from './_consent-banner.html.js';

interface SourceRow {
  source: string;
  // 2026-05-18 round-7 audit P2: `ingest` is now rendered as innerHTML so
  // we can use <code> spans for paths/identifiers. Inputs come from the
  // hardcoded list below — no user content reaches this field. If you
  // add a row, sanitise any dynamic substrings yourself.
  ingestHtml: string;
  signals: string;
}

const SOURCES: SourceRow[] = [
  { source: 'Claude Code transcript (.jsonl)',
    ingestHtml: 'Stop-hook uploads each session to collector at <code>POST /v1/cc-sessions</code>.',
    signals: '活跃会话数 · tool 调用 · 失败率 · session 时长 · prompt 长度 · 改动文件' },
  { source: 'Envelope metadata',
    ingestHtml: '<code>user_id</code>, <code>machine_id</code>, <code>cwd</code>, <code>project_name</code>, <code>captured_at</code>, riven 客户端版本',
    signals: '成员归属 · 项目归属 · 时间窗口' },
  { source: 'Git remote (<code>git remote -v</code> 抓自 transcript)',
    ingestHtml: '从会话里的 Bash 命令解析出 <code>owner/repo</code>',
    signals: '项目识别（避免 cwd 噪音） · github 主项目区分' },
  { source: 'API token usage',
    ingestHtml: '每条 message 的 <code>tokens.{input,output,cacheRead,cacheCreation}</code>',
    signals: '今日 $ 消耗 · model mix · 200k context 溢出 · 高产出判定' },
  { source: 'Tool-use 模式',
    ingestHtml: 'Edit/Write/MultiEdit 文件路径、Bash 命令文本、WebSearch query',
    signals: '专注度 · 风险动作 · 学习面 · 协作热区（同文件 / 同 cwd）' },
  { source: 'LLM 叙事 cache',
    ingestHtml: '<code>~/.matrix-riven/llm-cache/v1.jsonl</code> · JSONL 增量 · 50MB 软上限 · 内容键',
    signals: 'T1 session digest · T2 周报 · T3 项目 · T4 attention rewrite · T5 daily brief' },
];

// 2026-05-18 round-7 audit: IDs dense-renumbered 1-16 so a customer
// reading the table sees no gaps. The previous #1-5 / #10-18 / P*-*
// numbering was internal (matched the design doc's signal IDs) but read
// as "where are #6-#9?" + "#17/#18 exist while header says 16 个".
const DETECTORS = [
  { id: '1',  name: '节奏放缓',            fires: '会话量 / 主项目命中率两条线都低于阈值（仅团队基线对比，非绝对判断）' },
  { id: '2',  name: '卡住 (stuck)',       fires: '同 cwd 多次 session · 无 commit · 工具失败累计' },
  { id: '3',  name: '阻塞 (blockers)',    fires: 'Bash 失败率 > 阈值 · 反复同命令 · 缺权限错误' },
  { id: '4',  name: '求助 (help-needed)', fires: 'WebSearch + risky-action + 错误率同时升高' },
  { id: '5',  name: '协作命中',           fires: '同文件 / 同 cwd 在 24h 内被 ≥2 人触碰' },
  { id: '6',  name: '工具失败率',         fires: 'tool.isError 比例超过团队中位数 + 2σ' },
  { id: '7',  name: '上下文溢出',         fires: 'input tokens ≥ 200k（接近 hard limit）' },
  { id: '8',  name: '迭代密度',           fires: '同 session 内用户消息数 > 阈值' },
  { id: '9',  name: 'Prompt 长度异常',    fires: '平均用户 prompt 字符数 > 团队 P90' },
  { id: '10', name: '风险动作',           fires: '危险 Bash 模式（rm -rf, force-push, drop, kill）' },
  { id: '11', name: 'L1 redaction 命中',  fires: 'session 内 PII 模式命中次数（envelope 已脱敏）' },
  { id: '12', name: '$ 成本异常',         fires: '今日单人花费 > 团队 P75 · 单 session 单价异常' },
  { id: '13', name: 'Model mix',          fires: 'opus / sonnet / haiku 选用比例（沉重模型偏好）' },
  { id: '14', name: '学习面 (learning)',  fires: '新出现的工具 / 库 / 文件夹（首次 touch）' },
  { id: '15', name: '项目 status + ETA',  fires: 'phase 分类 · 健康分 · ETA 天数 · stale 判定' },
  { id: '16', name: '项目 health + 节奏', fires: 'health 7d 平均 · 节奏升/稳/缓 · bus-factor' },
];

export function renderSources(): string {
  // Note: `source` and `ingestHtml` may contain <code> markup we own. They
  // never accept user input — see SOURCES literal above. `signals` is plain
  // text and escaped.
  const sources = SOURCES.map((s) => `
      <tr>
        <td><strong>${s.source}</strong></td>
        <td>${s.ingestHtml}</td>
        <td>${escapeHtml(s.signals)}</td>
      </tr>`).join('');
  const detectors = DETECTORS.map((d) => `
      <tr>
        <td class="sp-id">${escapeHtml(d.id)}</td>
        <td><strong>${escapeHtml(d.name)}</strong></td>
        <td>${escapeHtml(d.fires)}</td>
      </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>数据来源 · Matrix-Riven</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${LEADERSHIP_CSS}
${CONSENT_BANNER_CSS}
.sp-page { max-width:1100px; margin:0 auto; padding:48px 40px; }
.sp-page h1 { font-family:'Newsreader',serif; font-size:32px; color:var(--ink-1); margin:0 0 8px; font-weight:500; }
.sp-page .lead { font-size:15px; color:var(--ink-2); margin:0 0 36px; max-width:760px; line-height:1.6; }
.sp-page h2 { font-family:'Newsreader',serif; font-size:22px; color:var(--ink-1); margin:36px 0 14px; font-weight:500; }
.sp-page table { width:100%; border-collapse:collapse; background:var(--surface); border-radius:var(--r-lg); overflow:hidden; box-shadow:var(--shadow-1); }
.sp-page th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-3); padding:12px 16px; background:var(--surface-2,#fafaf7); border-bottom:1px solid var(--hairline); font-weight:500; }
.sp-page td { padding:12px 16px; font-size:13.5px; line-height:1.5; color:var(--ink-2); vertical-align:top; border-bottom:1px solid var(--hairline); }
.sp-page td strong { color:var(--ink-1); font-weight:500; }
.sp-page tr:last-child td { border-bottom:none; }
.sp-id { font-family:ui-monospace, 'Menlo', monospace; font-size:11.5px; color:var(--ink-3); width:60px; }
.sp-back { font-size:13px; color:var(--ink-3); margin-bottom:24px; display:inline-block; text-decoration:none; border-bottom:1px solid var(--ink-5); }
</style>
</head>
<body>
<div class="shell">
<div class="sp-page">
  <a class="sp-back" href="/landing">← 返回 landing</a>
  <h1>这个看板上的数字，都从哪里来。</h1>
  <p class="lead">Matrix-Riven 不爬日历、不读邮件、不接 Slack。它只读一件事：你团队 Claude Code 客户端上传到<strong>本地</strong> collector 的 session transcript。<br>这意味着「工程师在 Claude 里输的每一句话」都会被 leadership 看到（PII 模式除外）。<a href="#retain" style="color:var(--ink-2);border-bottom:1px solid var(--ink-5);">下面有详细列表</a>，请在部署前如实告知团队。</p>

  <h2>数据来源</h2>
  <table>
    <thead><tr><th style="width:30%;">来源</th><th style="width:35%;">如何摄入</th><th>驱动哪些信号</th></tr></thead>
    <tbody>${sources}</tbody>
  </table>

  <h2>信号检测器（16 个）</h2>
  <table>
    <thead><tr><th style="width:60px;">ID</th><th style="width:25%;">名称</th><th>触发条件</th></tr></thead>
    <tbody>${detectors}</tbody>
  </table>

  <h2>不做什么</h2>
  <table>
    <tbody>
      <tr><td><strong>不读邮件 / 日历 / Slack</strong></td><td>这些数据从来不进 collector。</td></tr>
      <tr><td><strong>不外发给第三方</strong></td><td>除了 <code>claude -p</code> 本身访问 Anthropic API（脱敏后），不向任何外部服务转发。</td></tr>
      <tr><td><strong>不持久化原始密钥 / token</strong></td><td>PII 脱敏管线 (<code>packages/shared/src/pii/redactor.ts</code>) 在写盘前去掉 emails / 绝对路径 / 看起来像 secret 的字符串。</td></tr>
      <tr><td><strong>不无限增长</strong></td><td>LLM cache 50MB 软上限 + 最老条目淘汰；transcript collector 按下方「保留窗口」自动清理。</td></tr>
    </tbody>
  </table>

  <h2 id="retain">会保留什么（请如实告知团队）</h2>
  <p class="lead" style="margin-top:6px;">为保证看板能解释「他在卡什么 / 他问了什么 / 谁动了哪段代码」，下面这些内容会以原文形式落盘到本地 collector：</p>
  <table>
    <tbody>
      <tr><td><strong>user prompt 正文</strong></td><td>除上面 PII 模式外，<em>原文保留</em>。也就是「他都问了什么」这一栏看到的就是工程师当时输的字。一些团队会把它当成内部聊天对话——请如实告诉团队成员，prompt 内容会被 leadership 看到。</td></tr>
      <tr><td><strong>assistant 回复 / tool 调用</strong></td><td>结构化字段保留（工具名、文件路径、命令文本、token 数）；assistant 回复正文 <em>仅</em> 进 LLM 叙事 cache，不在 UI 直接渲染。</td></tr>
      <tr><td><strong>Bash 命令文本</strong></td><td>原文保留。用于风险动作检测与协作识别。</td></tr>
      <tr><td><strong>仓库路径 / 文件名</strong></td><td>原文保留（含 <code>cwd</code>、改动文件相对路径）。绝对路径中的 <code>/Users/&lt;name&gt;</code> 段会被 L1 redactor 替换。</td></tr>
    </tbody>
  </table>

  <h2 id="retention">保留窗口</h2>
  <p class="lead" style="margin-top:6px;">默认值如下，可通过环境变量覆盖。<strong>仅设置上限</strong>，没有上限不是产品行为而是 ops 失误，请告知团队。</p>
  <table>
    <tbody>
      <tr><td><strong>session transcript（含 prompt 正文）</strong></td><td>默认 <strong>30 天</strong>；可通过 <code>RIVEN_TRANSCRIPT_RETENTION_DAYS</code> 缩短到 7 / 14 / 自定义。EU 部署建议 ≤ 14 天。服务启动时 + 之后每 24 小时自动清理，到期后整文件删除（不可恢复）。</td></tr>
      <tr><td><strong>聚合 envelope</strong></td><td>v1 不单独存储聚合 envelope —— 所有数据都从 transcript 文件计算。transcript 被清理后下次扫描时 envelope 数据自然消失。<em>envelope 的生命周期等于上一行的 transcript 保留窗口。</em>如需更长的聚合数据，请单独导出 <code>/api/overview</code> 快照。</td></tr>
      <tr><td><strong>LLM 叙事 cache</strong></td><td>50MB 硬上限 + LRU 淘汰；按内容键索引，不按时间。</td></tr>
      <tr><td><strong>L2 audit 日志</strong></td><td>记录 ingest + redaction 事件；默认与 transcript 同保留窗口。</td></tr>
    </tbody>
  </table>

  <h2 id="rights">成员数据权利</h2>
  <p class="lead" style="margin-top:6px;">v1 不提供自助删除界面，但下面的操作 ops 必须能在 30 天内完成：</p>
  <table>
    <tbody>
      <tr><td><strong>查看「关于我的所有数据」</strong></td><td>GET <code>/api/members/&lt;localpart&gt;?demo=0</code> 返回该成员在窗口内的全部 envelope 字段 + sample prompts。可由 ops 导出 JSON 给该成员。</td></tr>
      <tr><td><strong>删除「关于我的所有数据」</strong></td><td>ops 删除 <code>$RIVEN_COLLECTOR_DIR/&lt;email&gt;/</code> 整目录。下次扫描自动从所有面板消失。</td></tr>
      <tr><td><strong>撤回授权</strong></td><td>该成员在自己的机器上卸载 Claude Code hook（停止上传新 session）；既有数据按上面的删除路径处理。</td></tr>
      <tr><td><strong>未实现 · 留作 v2</strong></td><td>per-engineer 同意状态服务端持久化、专用的「我的数据」自助页面、自动按祈使保留期清理、跨 jurisdiction 模板。GDPR / 工会场景部署需先补这些 + DPIA。</td></tr>
    </tbody>
  </table>
</div>
</div>
${renderConsentBanner({ demo: false })}
<script>${CONSENT_BANNER_SCRIPT}</script>
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
