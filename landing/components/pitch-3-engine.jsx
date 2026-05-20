/* Pitch site — Data Flow + PII Safety */

const { useState: eUseState, useEffect: eUseEffect, useRef: eUseRef, useMemo: eUseMemo } = React;

/* ====================================================================
   DATA FLOW — 6-step interactive timeline
   ==================================================================== */
function PitchFlow() {
  const [active, setActive] = eUseState(0);
  const [playing, setPlaying] = eUseState(false);
  const timer = eUseRef(null);

  eUseEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => setActive(a => (a + 1) % window.DEMO.flowSteps.length), 2600);
    return () => clearInterval(timer.current);
  }, [playing]);

  const step = window.DEMO.flowSteps[active];

  return (
    <section className="pitch" id="flow">
      <div className="wrap">
        <div className="section-head">
          <span className="eyebrow"><span className="dot"></span>数据流</span>
          <h2>
            一个 Stop hook 到看板，<br />
            <em>30 秒，6 步</em>。
          </h2>
          <p className="lead">
            每个开发者的 Claude Code 会话结束都会触发一次完整的 6 步管线。
            每一步可重启可重放，崩溃从不影响 Claude Code 主流程。
            点节点查看细节，或开自动播放。
          </p>
        </div>

        <div className="flow-stage">
          <div className="flow-rail">
            <div className="flow-rail-bg"></div>
            <div className="flow-rail-fill" style={{ width: `${(active / (window.DEMO.flowSteps.length - 1)) * 92}%` }}></div>
            <div className="flow-steps" style={{ gridTemplateColumns: `repeat(${window.DEMO.flowSteps.length}, 1fr)` }}>
              {window.DEMO.flowSteps.map((s, i) => (
                <button key={s.key} className={"flow-step-btn" + (i < active ? " is-passed" : i === active ? " is-current" : "")}
                  onClick={() => { setActive(i); setPlaying(false); }}>
                  <div className="flow-step-dot">{i + 1}</div>
                  <div className="flow-step-key">{s.key}</div>
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 28, alignItems: "start", marginTop: 8 }} className="flow-grid">
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className="pill sage mono">step {active + 1} / {window.DEMO.flowSteps.length}</span>
                <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>{step.sub}</span>
              </div>
              <h3 className="serif" style={{ fontFamily: "Newsreader, Georgia, serif", fontWeight: 400, fontSize: 28, marginTop: 12, lineHeight: 1.2 }}>
                {step.title}
              </h3>
              <p style={{ marginTop: 14, fontSize: 14.5, lineHeight: 1.65, color: "var(--ink-2)" }}>{step.body}</p>
              <div style={{ display: "flex", gap: 28, marginTop: 24 }}>
                {step.metrics.map(([k, v], i) => (
                  <div key={i}>
                    <div className="serif" style={{ fontFamily: "Newsreader, Georgia, serif", fontSize: 26, fontWeight: 500, color: "var(--accent-ink)", letterSpacing: "-0.02em" }}>{k}</div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 24, display: "flex", gap: 10 }}>
                <button className="btn sm" onClick={() => setPlaying(p => !p)}>
                  {playing ? "暂停" : "自动播放"}
                </button>
                <button className="btn sm ghost" onClick={() => setActive((active + 1) % window.DEMO.flowSteps.length)}>
                  下一步 →
                </button>
              </div>
            </div>

            <FlowTerminal step={step.key} />
          </div>
        </div>
        <style>{`
          @media (max-width: 900px) { .flow-grid { grid-template-columns: 1fr !important; } }
        `}</style>
      </div>
    </section>
  );
}

const FLOW_TERMINAL = {
  stop: [
    ["c", "# Claude Code → Stop hook fires"],
    ["k", "$ node ~/.riven/bin/bin-digital-twin-tap.cjs"],
    ["",  "▸ session: ses_8f3a2c…"],
    ["",  "▸ messages: 47   tools: 12"],
    ["",  "▸ cwd: /Users/alex/work/matrix-riven"],
    ["s", "✓ enqueued → ~/.riven/digital-twin/queue/"]
  ],
  queue: [
    ["c", "# queue snapshot"],
    ["k", "$ ls ~/.riven/digital-twin/queue/"],
    ["",  "rec_ses_8f3a2c.jsonl     12.4 KB"],
    ["",  "rec_ses_8e9b14.jsonl      8.1 KB"],
    ["",  "rec_ses_8d72fa.jsonl     31.2 KB"],
    ["c", "# daemon picks these up FIFO"]
  ],
  redact: [
    ["c", "# before redaction"],
    ["",  "authorization: \"Bearer sk-ant-abc…\""],
    ["",  "cwd: \"/Users/alex/repo/x\""],
    ["c", "# after"],
    ["s", "authorization: \"<REDACTED:bearer>\""],
    ["s", "cwd: \"/Users/<USER>/repo/x\""]
  ],
  gzip: [
    ["k", "$ daemon flush rec_ses_8f3a2c"],
    ["",  "▸ raw:    12.4 KB"],
    ["",  "▸ gzip:    1.3 KB  (10.5×)"],
    ["k", "POST /v1/cc-sessions"],
    ["",  "  Authorization: Bearer ************"],
    ["s", "  ← 200 OK  { ok: true, stored: 1 }"]
  ],
  persist: [
    ["k", "$ tree ~/riven-collector/alex/2026-05-20/"],
    ["",  "├── ses_8f3a2c.jsonl"],
    ["",  "├── ses_8e9b14.jsonl"],
    ["",  "└── .leadership-index.json"],
    ["c", "# mock content auto-dropped"],
    ["n", "200 OK { ok: true, dropped: 'inject-mock' }"]
  ],
  render: [
    ["k", "GET /api/overview?date=2026-05-20"],
    ["",  "{"],
    ["",  "  \"kpis\":        { team_total_usd: 4.32, ... },"],
    ["",  "  \"attention\":   [ { kind: \"member\", ... } ],"],
    ["",  "  \"members\":     [ ... ],"],
    ["",  "  \"projects\":    [ ... ],"],
    ["",  "  \"llmBrief\":    [ \"今日团队推进顺利...\" ]"],
    ["",  "}"]
  ]
};

function FlowTerminal({ step }) {
  const lines = FLOW_TERMINAL[step] || [];
  return (
    <div className="term">
      <div className="term-dots"><span className="r"></span><span className="y"></span><span className="g"></span></div>
      {lines.map((l, i) => (
        <div key={i} className={l[0] || "d"} style={{ whiteSpace: "pre-wrap" }}>{l[1]}</div>
      ))}
    </div>
  );
}

/* ====================================================================
   PII SAFETY — live redactor demo
   ==================================================================== */
const SAMPLE_INPUT = `用户在 Bash 工具里执行了:
  curl -H "Authorization: Bearer sk-ant-api03-aBcD1234567890XyZ" \\
       https://api.example.com/v1/users

我的 cwd 是 /Users/alex/work/teambrain/packages/server，
联系邮箱 alex.example@company.io，
临时密钥 AKIA1234567890ABCDEF，
git hash 是 8f3a2c1d7e4b6f9a0c2d5e8b1f4a7c3d (sha 不该被脱敏)。`;

const RED_RULES = [
  { key: "bearer",  label: "Bearer Token", color: "#B0625A", pattern: /Bearer\s+([A-Za-z0-9_\-]+)/g,                                  replace: () => "Bearer <REDACTED:bearer>" },
  { key: "apikey",  label: "API Key",      color: "#B0625A", pattern: /\b(sk-[a-zA-Z0-9_\-]+|AKIA[0-9A-Z]{16})\b/g,                   replace: () => "<REDACTED:key>" },
  { key: "email",   label: "Email",        color: "#8B6B9C", pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,         replace: () => "<REDACTED:email>" },
  { key: "userpath",label: "User Path",    color: "#C8924B", pattern: /\/(Users|home)\/([A-Za-z0-9_.\-]+)/g,                          replace: (_, p1) => `/${p1}/<USER>` }
];

function PitchSafety() {
  const [input, setInput] = eUseState(SAMPLE_INPUT);
  const [enabled, setEnabled] = eUseState({ bearer: true, apikey: true, email: true, userpath: true });

  const { output, hits } = eUseMemo(() => {
    let text = input; const counts = {};
    RED_RULES.forEach(r => {
      counts[r.key] = 0;
      if (!enabled[r.key]) return;
      text = text.replace(r.pattern, (...args) => { counts[r.key]++; return r.replace(...args); });
    });
    return { output: text, hits: counts };
  }, [input, enabled]);

  const highlighted = eUseMemo(() => {
    const matches = [];
    RED_RULES.forEach(r => {
      if (!enabled[r.key]) return;
      const re = new RegExp(r.pattern.source, r.pattern.flags);
      let m; while ((m = re.exec(input)) !== null) matches.push({ start: m.index, end: m.index + m[0].length, rule: r });
    });
    matches.sort((a, b) => a.start - b.start);
    const parts = []; let cursor = 0;
    matches.forEach(m => {
      if (m.start < cursor) return;
      if (m.start > cursor) parts.push({ text: input.slice(cursor, m.start), rule: null });
      parts.push({ text: input.slice(m.start, m.end), rule: m.rule });
      cursor = m.end;
    });
    if (cursor < input.length) parts.push({ text: input.slice(cursor), rule: null });
    return parts;
  }, [input, enabled]);

  const totalHits = Object.values(hits).reduce((a, b) => a + b, 0);

  return (
    <section className="pitch" id="safety">
      <div className="wrap">
        <div className="section-head">
          <span className="eyebrow"><span className="dot"></span>安全 & PII</span>
          <h2>
            敏感字段在<em>源头</em>就被拦下，<br />
            原文永不出网。
          </h2>
          <p className="lead">
            <code className="mono">shared/pii/redactor</code> 在守护进程的 gzip 之前先跑一遍。
            Bearer token、API key、邮箱、绝对路径中的用户名全部占位符化 ——
            <strong style={{ color: "var(--ink-1)", fontWeight: 500 }}>保留语义，不保留内容</strong>。
            改改下方输入或开关任一规则，看脱敏效果。
          </p>
        </div>

        <div className="redactor-shell">
          <div className="redactor-pane">
            <div className="redactor-pane-head">
              <span className="label">raw transcript</span>
              <button className="btn ghost sm" onClick={() => setInput(SAMPLE_INPUT)}>reset</button>
            </div>
            <div style={{ position: "relative" }}>
              <div className="mono" aria-hidden="true" style={{
                position: "absolute", inset: 0, padding: 16,
                fontSize: 12.5, lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word",
                pointerEvents: "none", color: "transparent"
              }}>
                {highlighted.map((p, i) => p.rule ? (
                  <span key={i} style={{
                    background: `color-mix(in srgb, ${p.rule.color} 22%, transparent)`,
                    color: "transparent",
                    boxShadow: `inset 0 -1.5px 0 ${p.rule.color}`
                  }}>{p.text}</span>
                ) : <span key={i}>{p.text}</span>)}
              </div>
              <textarea value={input} onChange={e => setInput(e.target.value)} spellCheck="false"
                style={{
                  position: "relative", width: "100%", minHeight: 260,
                  padding: 16, fontSize: 12.5, lineHeight: 1.7,
                  color: "var(--ink-1)", background: "transparent", border: "none",
                  outline: "none", resize: "vertical",
                  fontFamily: "JetBrains Mono, ui-monospace, monospace",
                  caretColor: "var(--accent-ink)"
                }} />
            </div>
          </div>

          <div className="redactor-pane">
            <div className="redactor-pane-head">
              <span className="label">redacted payload · 上送服务端</span>
              <span className="pill sage mono">{totalHits} hits</span>
            </div>
            <div className="mono" style={{
              padding: 16, fontSize: 12.5, lineHeight: 1.7,
              whiteSpace: "pre-wrap", wordBreak: "break-word", minHeight: 260, color: "var(--ink-1)"
            }}>
              {output.split(/(<REDACTED:[a-z]+>|<USER>)/g).map((part, i) => /<(REDACTED|USER)/.test(part) ? (
                <span key={i} style={{
                  display: "inline-block", padding: "1px 6px", fontSize: 11.5,
                  color: "var(--accent-ink)", background: "var(--accent-soft)",
                  border: "1px solid rgba(111,139,94,.3)", borderRadius: 3,
                  margin: "0 2px", fontFamily: "JetBrains Mono"
                }}>{part}</span>
              ) : <span key={i}>{part}</span>)}
            </div>
          </div>
        </div>

        <div className="redactor-rules">
          {RED_RULES.map(r => (
            <label key={r.key} className={"redactor-rule" + (enabled[r.key] ? " on" : "")}>
              <span className="lr-dot" style={{ background: enabled[r.key] ? r.color : "var(--ink-4)" }}></span>
              <span className="lr-mid">{r.label}</span>
              <span className="lr-count" style={{ color: r.color }}>{hits[r.key] || 0}</span>
              <input type="checkbox" checked={enabled[r.key]} onChange={() => setEnabled(s => ({ ...s, [r.key]: !s[r.key] }))} style={{ marginLeft: 10 }} />
            </label>
          ))}
        </div>

        <div style={{
          marginTop: 24, padding: "16px 20px",
          background: "var(--surface)", border: "1px solid var(--hairline)",
          borderRadius: "var(--r-md)",
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20
        }} className="safety-bonus-grid">
          <SafetyBonus glyph="◆" title="默认 loopback" body="prod 启动默认 HOST=127.0.0.1。上 LAN 必须显式 HOST=0.0.0.0 + RIVEN_AUTH_TOKEN。" />
          <SafetyBonus glyph="✚" title="TLS fail-loud" body="HTTPS_KEY_PATH + HTTPS_CERT_PATH 必须同时设置才启用。半成品配置 = 启动失败，不会悄悄降级到明文。" />
          <SafetyBonus glyph="◐" title="无第三方外联" body="launch audit 中移除 Google Fonts。LLM 推理走客户自己的 Anthropic API Key。/sources 公开列出每条数据来源。" />
        </div>
        <style>{`
          @media (max-width: 900px) { .safety-bonus-grid { grid-template-columns: 1fr !important; } }
        `}</style>
      </div>
    </section>
  );
}

function SafetyBonus({ glyph, title, body }) {
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "start" }}>
      <div className="serif" style={{
        width: 36, height: 36, borderRadius: 10,
        background: "var(--accent-soft)", color: "var(--accent-ink)",
        display: "grid", placeItems: "center",
        fontSize: 20, fontWeight: 500, flexShrink: 0
      }}>{glyph}</div>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink-1)" }}>{title}</div>
        <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 4, lineHeight: 1.55 }}>{body}</div>
      </div>
    </div>
  );
}

window.PitchFlow = PitchFlow;
window.PitchSafety = PitchSafety;
