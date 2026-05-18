/**
 * Public transparency page — what matrix-riven ingests, where the numbers
 * come from, and which signals fire. Reachable at `/sources`. No auth (it's
 * pure documentation of the architecture, no team data).
 */

import { LEADERSHIP_CSS } from './styles.css.js';

interface SourceRow {
  source: string;
  ingest: string;
  signals: string;
}

const SOURCES: SourceRow[] = [
  { source: 'Claude Code transcript (.jsonl)',
    ingest: 'Stop-hook uploads each session to collector at `POST /v1/cc-sessions`.',
    signals: '活跃会话数 · tool 调用 · 失败率 · session 时长 · prompt 长度 · 改动文件' },
  { source: 'Envelope metadata',
    ingest: '`user_id`, `machine_id`, `cwd`, `project_name`, `captured_at`, riven 客户端版本',
    signals: '成员归属 · 项目归属 · 时间窗口' },
  { source: 'Git remote (`git remote -v` 抓自 transcript)',
    ingest: '从会话里的 Bash 命令解析出 `owner/repo`',
    signals: '项目识别（避免 cwd 噪音） · github 主项目区分' },
  { source: 'API token usage',
    ingest: '每条 message 的 `tokens.{input,output,cacheRead,cacheCreation}`',
    signals: '今日 $ 消耗 · model mix · 200k context 溢出 · 高产出判定' },
  { source: 'Tool-use 模式',
    ingest: 'Edit/Write/MultiEdit 文件路径、Bash 命令文本、WebSearch query',
    signals: '专注度 · 风险动作 · 学习面 · 协作热区（同文件 / 同 cwd）' },
  { source: 'LLM 叙事 cache',
    ingest: '`~/.matrix-riven/llm-cache/v1.jsonl` · JSONL 增量 · 50MB 软上限 · 内容键',
    signals: 'T1 session digest · T2 周报 · T3 项目 · T4 attention rewrite · T5 daily brief' },
];

const DETECTORS = [
  { id: '#1',  name: '低活跃 (slacking)',  fires: '会话量 / 主项目命中率两条线都低于阈值' },
  { id: '#2',  name: '卡住 (stuck)',       fires: '同 cwd 多次 session · 无 commit · 工具失败累计' },
  { id: '#3',  name: '阻塞 (blockers)',    fires: 'Bash 失败率 > 阈值 · 反复同命令 · 缺权限错误' },
  { id: '#4',  name: '求助 (help-needed)', fires: 'WebSearch + risky-action + 错误率同时升高' },
  { id: '#5',  name: '协作命中',           fires: '同文件 / 同 cwd 在 24h 内被 ≥2 人触碰' },
  { id: '#10', name: '工具失败率',         fires: '`tool.isError` 比例超过团队中位数 + 2σ' },
  { id: '#11', name: '上下文溢出',         fires: 'input tokens ≥ 200k（接近 hard limit）' },
  { id: '#12', name: '迭代密度',           fires: '同 session 内用户消息数 > 阈值' },
  { id: '#13', name: 'Prompt 长度异常',    fires: '平均用户 prompt 字符数 > 团队 P90' },
  { id: '#14', name: '风险动作',           fires: '危险 Bash 模式（rm -rf, force-push, drop, kill）' },
  { id: '#15', name: 'L1 redaction 命中',  fires: 'session 内 PII 模式命中次数（envelope 已脱敏）' },
  { id: '#16', name: '$ 成本异常',         fires: '今日单人花费 > 团队 P75 · 单 session 单价异常' },
  { id: '#17', name: 'Model mix',          fires: 'opus / sonnet / haiku 选用比例（沉重模型偏好）' },
  { id: '#18', name: '学习面 (learning)',  fires: '新出现的工具 / 库 / 文件夹（首次 touch）' },
  { id: 'P1-3',name: '项目 status + ETA',  fires: 'phase 分类 · 健康分 · ETA 天数 · stale 判定' },
  { id: 'P9-14',name:'项目 health + 节奏', fires: 'health 7d 平均 · 节奏升/稳/缓 · bus-factor' },
];

export function renderSources(): string {
  const sources = SOURCES.map((s) => `
      <tr>
        <td><strong>${escapeHtml(s.source)}</strong></td>
        <td>${escapeHtml(s.ingest)}</td>
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
  <p class="lead">Matrix-Riven 不爬日历、不读邮件、不接 Slack。它只读一件事：你团队 Claude Code 客户端上传到本地 collector 的 session transcript。下面是完整数据流。</p>

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
      <tr><td><strong>不持久化原始密钥 / token</strong></td><td>PII 脱敏管线 (\`packages/shared/src/pii/redactor.ts\`) 在写盘前去掉 emails / paths / secrets。</td></tr>
      <tr><td><strong>不无限增长</strong></td><td>LLM cache 50MB 软上限 + 最老条目淘汰；transcript collector 由 ops 控制保留窗口。</td></tr>
    </tbody>
  </table>
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
