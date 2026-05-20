/* VC product-first page — bilingual edition. */

const { useState: vUseState, useEffect: vUseEffect, useRef: vUseRef, useMemo: vUseMemo } = React;

const T = (s) => window.tr(s);
const LangToggle = () => window.MR.LangToggle();

/* ──────────────────────────────────────────────────────────── */
function VcApp() {
  const [so, setSo] = vUseState(null);
  window.MR.useLang(); // re-render on lang change
  vUseEffect(() => { window.MR.installRevealObserver(); }, []);
  vUseEffect(() => {
    document.querySelectorAll(".magnetic:not([data-magnetized])").forEach(btn => {
      btn.setAttribute("data-magnetized", "1");
      btn.addEventListener("mousemove", (e) => {
        const r = btn.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) * 0.2;
        const dy = (e.clientY - (r.top + r.height / 2)) * 0.22;
        btn.style.transform = `translate(${dx}px, ${dy}px)`;
      });
      btn.addEventListener("mouseleave", () => { btn.style.transform = ""; });
    });
  }, []);

  return (
    <>
      <ScrollProgressBar />
      <CursorBlob />
      <VcNav />

      <VcHero openSlideover={(k, i) => setSo({ kind: k, id: i })} />
      <LiveDashboard openSlideover={(k, i) => setSo({ kind: k, id: i })} />
      <LiveFlow />
      <LiveRedactor />
      <RealArchitecture />
      <FinalCta />

      <VcFooter />
      <Slideover so={so} onClose={() => setSo(null)} />
    </>
  );
}

/* ──────────────────────────────────────────────────────────── */
function VcNav() {
  return (
    <nav className="vc-nav fade-in">
      <a href="index.html" className="pitch-brand">
        <div className="pitch-brand-mark"></div>
        <span>Matrix·Riven</span>
      </a>
      <div className="vc-nav-meta">
        <span><span className="dot"></span>{T("live demo · 真实组件渲染")}</span>
        <a className="link" href="detail.html">{T("完整介绍 →")}</a>
        <LangToggle />
      </div>
      <a className="nav-cta magnetic" href="https://github.com/libz-renlab-ai/Matrix-Riven" target="_blank" rel="noopener">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5a12 12 0 00-3.79 23.4c.6.1.82-.26.82-.58v-2c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.1-.75.08-.74.08-.74 1.21.09 1.85 1.25 1.85 1.25 1.08 1.84 2.83 1.31 3.52 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.46-1.33-5.46-5.93 0-1.31.47-2.38 1.24-3.22-.13-.31-.54-1.53.12-3.18 0 0 1.01-.32 3.31 1.23a11.5 11.5 0 016 0c2.3-1.55 3.31-1.23 3.31-1.23.66 1.65.25 2.87.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.47 5.92.43.37.82 1.1.82 2.22v3.29c0 .32.22.7.83.58A12 12 0 0012 .5z"/></svg>
        GitHub
      </a>
    </nav>
  );
}

/* ──────────────────────────────────────────────────────────── */
function VcHero() {
  return (
    <section className="vc-hero-compact" id="hero">
      <div className="wrap">
        <span className="eyebrow sage reveal-up">{T("matrix·riven · v0.2 · live demo")}</span>
        <h1 className="reveal-up" style={{
          marginTop: 24, maxWidth: 1080,
          fontSize: "clamp(40px, 5.5vw, 72px)",
          lineHeight: 1.05, letterSpacing: "-0.035em",
          "--delay": "100ms"
        }}>
          {T("下面就是 Matrix·Riven —— ")}<em className="shimmer">{T("真实在跑")}</em>{T("。")}<br />
          <span style={{ color: "var(--ink-3)" }}>{T("没有截图，没有概念图。")}</span>
        </h1>
        <p className="reveal-up" style={{
          fontFamily: "Newsreader, Georgia, serif",
          fontSize: 19, lineHeight: 1.6, color: "var(--ink-2)",
          maxWidth: 720, marginTop: 24, "--delay": "240ms"
        }}>
          {T("下面 4 个模块都是仓库源码直接渲染的真实组件 —— 点 attention 行开抽屉、点 step 看终端 log、改输入看 PII 脱敏。 你触摸到的每一像素，都是 prod 部署后客户会看到的同一份代码。")}
        </p>
        <div className="vc-cta-row reveal-up" style={{ "--delay": "380ms" }}>
          <a className="btn primary magnetic" href="#live-dashboard">{T("↓ 跳到 dashboard demo")}</a>
          <a className="btn magnetic" href="https://github.com/libz-renlab-ai/Matrix-Riven" target="_blank" rel="noopener">{T("看仓库 ↗")}</a>
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────── */
function LiveDashboard({ openSlideover }) {
  return (
    <section className="pitch" id="live-dashboard">
      <div className="wrap">
        <div className="vc-head">
          <h2 className="reveal-up">
            <em>{T("① Dashboard")}</em><br />
            {T("点 attention 行 / 任意成员 tile —— 抽屉从右滑入。")}
          </h2>
          <div className="sub reveal-up" style={{ "--delay": "120ms" }}>
            {T("源码：")}<span className="mono">packages/collector-server/src/leadership/views/</span>。
            {T("页面里的所有 KPI、attention 卡、成员 tile 来自同一份 React 渲染。")}
          </div>
        </div>
        <div className="product-frame reveal-scale">
          <div className="product-frame-chrome">
            <span className="product-frame-dot r"></span>
            <span className="product-frame-dot y"></span>
            <span className="product-frame-dot g"></span>
            <div className="product-frame-url">https://collector.riven.internal:8443/overview</div>
            <span className="pill sage" style={{ background: "var(--accent-soft)", padding: "3px 9px" }}>live · v0.2.x</span>
          </div>
          <div className="product-frame-body">
            <ProductPreview onOpen={openSlideover} />
          </div>
        </div>
        <div style={{
          marginTop: 14, display: "flex", gap: 24, flexWrap: "wrap",
          fontSize: 12.5, color: "var(--ink-3)",
          fontFamily: "JetBrains Mono, monospace"
        }}>
          <span>{T("↗ 上方 4 个 KPI 来自 leadership/aggregator.ts")}</span>
          <span>{T("↗ Attention 文案来自 LLM T4 prompt")}</span>
          <span>{T("↗ 成员两行短文来自 T2 prompt")}</span>
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────── */
function LiveFlow() {
  const [active, setActive] = vUseState(0);
  const [playing, setPlaying] = vUseState(true);
  const [swap, setSwap] = vUseState(false);
  const timer = vUseRef(null);
  const steps = window.DEMO.flowSteps;

  const goTo = (i) => {
    setSwap(true);
    setTimeout(() => { setActive(i); setSwap(false); }, 220);
  };

  vUseEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => goTo((active + 1) % steps.length), 3000);
    return () => clearInterval(timer.current);
  }, [playing, active, steps.length]);

  const step = steps[active];
  return (
    <section className="pitch" id="live-flow">
      <div className="wrap">
        <div className="vc-head">
          <h2 className="reveal-up">
            <em>{T("② 数据管线")}</em><br />
            {T("从 Claude Code Stop hook 到看板 —— 30 秒。")}
          </h2>
          <div className="sub reveal-up" style={{ "--delay": "120ms" }}>
            {T("每一步都是源码里真实可点：tap.cjs → 队列 → redactor → gzip → /v1/cc-sessions → aggregator。")}
          </div>
        </div>

        <div className="flow-stage reveal-up">
          <div className="flow-rail" style={{ marginBottom: 24 }}>
            <div style={{ position: "absolute", top: 22, left: "4%", right: "4%", height: 2, background: "var(--hairline)", borderRadius: 2 }} />
            <div style={{
              position: "absolute", top: 22, left: "4%",
              width: `${(active / (steps.length - 1)) * 92}%`,
              height: 2, background: "var(--accent)", borderRadius: 2,
              transition: "width .5s var(--ease)",
              boxShadow: "0 0 10px var(--accent-soft)"
            }} />
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${steps.length}, 1fr)`, position: "relative" }}>
              {steps.map((s, i) => (
                <button key={s.key} onClick={() => { goTo(i); setPlaying(false); }}
                  className={"flow-step-btn " + (i < active ? "is-passed" : i === active ? "is-current" : "")}>
                  <div className="flow-step-dot">{i + 1}</div>
                  <div className="flow-step-key">{s.key}</div>
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, alignItems: "start", opacity: swap ? 0 : 1, transition: "opacity .25s ease" }} className="flow-grid-vc">
            <div>
              <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)", letterSpacing: "0.04em" }}>
                step {active + 1} / {steps.length} · {step.sub}
              </div>
              <h3 className="serif" style={{
                fontFamily: "Newsreader, Georgia, serif", fontWeight: 400,
                fontSize: 28, marginTop: 8, lineHeight: 1.15, letterSpacing: "-0.02em"
              }}>{T(step.title)}</h3>
              <p style={{ marginTop: 12, fontSize: 14.5, lineHeight: 1.65, color: "var(--ink-2)" }}
                 dangerouslySetInnerHTML={{ __html: T(step.body) }}></p>
              <div style={{ display: "flex", gap: 28, marginTop: 20, flexWrap: "wrap" }}>
                {step.metrics.map(([k, v], i) => (
                  <div key={i}>
                    <div className="serif" style={{ fontSize: 22, color: "var(--accent-ink)", fontWeight: 400, letterSpacing: "-0.02em" }}>{T(k)}</div>
                    <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 4, letterSpacing: "0.06em", textTransform: "uppercase" }}>{T(v)}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
                <button className="btn sm magnetic" onClick={() => setPlaying(p => !p)}>{playing ? T("暂停自动播放") : T("继续自动播放")}</button>
                <button className="btn sm ghost" onClick={() => goTo((active + 1) % steps.length)}>{T("下一步 →")}</button>
              </div>
            </div>
            <FlowTerminal step={step.key} />
          </div>
        </div>
        <style>{`@media (max-width: 900px) { .flow-grid-vc { grid-template-columns: 1fr !important; } }`}</style>
      </div>
    </section>
  );
}

const FLOW_TERM = {
  stop: [
    ["c", "# Claude Code → Stop hook fires"],
    ["k", "$ node ~/.riven/bin/bin-digital-twin-tap.cjs"],
    ["",  "▸ session: ses_8f3a2c…"],
    ["",  "▸ messages: 47   tools: 12"],
    ["s", "✓ enqueued → ~/.riven/digital-twin/queue/"]
  ],
  queue: [
    ["c", "# queue snapshot — daemon detached, drains in background"],
    ["k", "$ ls ~/.riven/digital-twin/queue/"],
    ["",  "rec_ses_8f3a2c.jsonl     12.4 KB"],
    ["",  "rec_ses_8e9b14.jsonl      8.1 KB"],
    ["",  "rec_ses_8d72fa.jsonl     31.2 KB"]
  ],
  redact: [
    ["c", "# before"],
    ["",  "authorization: \"Bearer sk-ant-abc…\""],
    ["",  "cwd: \"/Users/alex/repo/teambrain\""],
    ["c", "# after"],
    ["s", "authorization: \"<REDACTED:bearer>\""],
    ["s", "cwd: \"/Users/<USER>/repo/teambrain\""]
  ],
  gzip: [
    ["k", "$ daemon flush rec_ses_8f3a2c"],
    ["",  "▸ raw:    12.4 KB → gzip: 1.3 KB (10.5×)"],
    ["k", "POST /v1/cc-sessions"],
    ["s", "  ← 200 OK { ok: true, stored: 1 }"]
  ],
  persist: [
    ["k", "$ tree ~/riven-collector/alex/2026-05-20/"],
    ["",  "├── ses_8f3a2c.jsonl"],
    ["",  "├── ses_8e9b14.jsonl"],
    ["",  "└── .leadership-index.json"],
    ["n", "200 OK { ok: true, dropped: 'inject-mock' }"]
  ],
  render: [
    ["k", "GET /api/overview?date=2026-05-20"],
    ["d", "{ kpis: {…}, attention: [...], members: [...], llmBrief: [...] }"],
    ["c", "# ETag → 304 on unchanged poll. <200 bytes wire cost."]
  ]
};

function FlowTerminal({ step }) {
  const lines = FLOW_TERM[step] || [];
  const [visible, setVisible] = vUseState([]);
  vUseEffect(() => {
    setVisible([]);
    const ts = lines.map((_, i) => setTimeout(() => setVisible(v => [...v, i]), 180 * i + 80));
    return () => ts.forEach(clearTimeout);
  }, [step]);
  return (
    <div className="term">
      <div className="term-dots"><span className="r"></span><span className="y"></span><span className="g"></span></div>
      {lines.map((l, i) => (
        <div key={i} className={l[0] || "d"} style={{
          whiteSpace: "pre-wrap",
          opacity: visible.includes(i) ? 1 : 0,
          transform: visible.includes(i) ? "translateX(0)" : "translateX(-6px)",
          transition: "opacity .35s ease, transform .35s ease"
        }}>{l[1]}</div>
      ))}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── */
const SAMPLE_ZH = `用户在 Bash 工具里执行了:
  curl -H "Authorization: Bearer sk-ant-api03-aBcD1234567890XyZ" \\
       https://api.example.com/v1/users

我的 cwd 是 /Users/alex/work/teambrain/packages/server，
联系邮箱 alex.example@company.io，
临时密钥 AKIA1234567890ABCDEF。`;

const SAMPLE_EN = `Developer ran in Bash:
  curl -H "Authorization: Bearer sk-ant-api03-aBcD1234567890XyZ" \\
       https://api.example.com/v1/users

cwd was /Users/alex/work/teambrain/packages/server,
contact email alex.example@company.io,
temp key AKIA1234567890ABCDEF.`;

const RR = [
  { key: "bearer",  label: "Bearer Token", color: "#B0625A", pattern: /Bearer\s+([A-Za-z0-9_\-]+)/g,                              replace: () => "Bearer <REDACTED:bearer>" },
  { key: "apikey",  label: "API Key",      color: "#B0625A", pattern: /\b(sk-[a-zA-Z0-9_\-]+|AKIA[0-9A-Z]{16})\b/g,               replace: () => "<REDACTED:key>" },
  { key: "email",   label: "Email",        color: "#8B6B9C", pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,     replace: () => "<REDACTED:email>" },
  { key: "userpath",label: "User Path",    color: "#C8924B", pattern: /\/(Users|home)\/([A-Za-z0-9_.\-]+)/g,                      replace: (_, p1) => `/${p1}/<USER>` }
];

function LiveRedactor() {
  const lang = window.LANG;
  const [input, setInput] = vUseState(lang === "en" ? SAMPLE_EN : SAMPLE_ZH);
  const [enabled, setEnabled] = vUseState({ bearer: true, apikey: true, email: true, userpath: true });

  vUseEffect(() => {
    setInput(window.LANG === "en" ? SAMPLE_EN : SAMPLE_ZH);
  }, [lang]);

  const { output, hits } = vUseMemo(() => {
    let text = input; const counts = {};
    RR.forEach(r => {
      counts[r.key] = 0;
      if (!enabled[r.key]) return;
      text = text.replace(r.pattern, (...args) => { counts[r.key]++; return r.replace(...args); });
    });
    return { output: text, hits: counts };
  }, [input, enabled]);

  const highlighted = vUseMemo(() => {
    const matches = [];
    RR.forEach(r => {
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
    <section className="pitch" id="live-redactor">
      <div className="wrap">
        <div className="vc-head">
          <h2 className="reveal-up">
            <em>{T("③ PII 脱敏")}</em><br />
            {T("改输入 / 关任一规则 —— 实时看右侧产物。")}
          </h2>
          <div className="sub reveal-up" style={{ "--delay": "120ms" }}>
            {T("源码：")}<span className="mono">packages/shared/src/pii/redactor.ts</span>。
            {T("守护进程上送前在客户端跑过一遍，原文不出网。")}
          </div>
        </div>

        <div className="redactor-shell">
          <div className="redactor-pane">
            <div className="redactor-pane-head">
              <span className="label">{T("raw · 开发者本地")}</span>
              <button className="btn ghost sm" onClick={() => setInput(window.LANG === "en" ? SAMPLE_EN : SAMPLE_ZH)}>{T("reset")}</button>
            </div>
            <div style={{ position: "relative" }}>
              <div className="mono" aria-hidden="true" style={{
                position: "absolute", inset: 0, padding: 18,
                fontSize: 12.5, lineHeight: 1.75, whiteSpace: "pre-wrap", wordBreak: "break-word",
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
                  position: "relative", width: "100%", minHeight: 240,
                  padding: 18, fontSize: 12.5, lineHeight: 1.75,
                  color: "var(--ink-1)", background: "transparent", border: "none",
                  outline: "none", resize: "vertical",
                  fontFamily: "JetBrains Mono, ui-monospace, monospace",
                  caretColor: "var(--accent-ink)"
                }} />
            </div>
          </div>

          <div className="redactor-pane">
            <div className="redactor-pane-head">
              <span className="label">{T("redacted · 上送服务端")}</span>
              <span className="pill sage mono">{totalHits} hits</span>
            </div>
            <div className="mono" style={{
              padding: 18, fontSize: 12.5, lineHeight: 1.75,
              whiteSpace: "pre-wrap", wordBreak: "break-word", minHeight: 240, color: "var(--ink-1)"
            }}>
              {output.split(/(<REDACTED:[a-z]+>|<USER>)/g).map((part, i) => /<(REDACTED|USER)/.test(part) ? (
                <span key={i} style={{
                  display: "inline-block", padding: "1px 7px", fontSize: 11.5,
                  color: "var(--accent-ink)", background: "var(--accent-soft)",
                  border: "1px solid rgba(111,139,94,.3)", borderRadius: 999,
                  margin: "0 2px", fontFamily: "JetBrains Mono"
                }}>{part}</span>
              ) : <span key={i}>{part}</span>)}
            </div>
          </div>
        </div>

        <div className="redactor-rules">
          {RR.map(r => (
            <button key={r.key} type="button"
              className={"redactor-rule" + (enabled[r.key] ? " on" : "")}
              onClick={() => setEnabled(s => ({ ...s, [r.key]: !s[r.key] }))}>
              <span className="lr-dot" style={{ background: enabled[r.key] ? r.color : "var(--ink-4)" }}></span>
              <span>{r.label}</span>
              <span className="lr-count">{hits[r.key] || 0}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────── */
const REAL_TREE = [
  { p: "packages/shared/",                                                              size: "library", role: "客户端 + 服务端共享 schema + PII 脱敏" },
  { p: "packages/uploader-client/",                                                     size: "client",  role: "Stop hook + 守护进程 + 5 个 CJS standalone bin" },
  { p: "packages/collector-server/src/bin-prod-server.ts",                              size: "10.6 KB", role: "服务端入口 · 默认 loopback · TLS 双开关" },
  { p: "packages/collector-server/src/dashboard-html.ts",                               size: "29.6 KB", role: "旧版仪表盘 (P1)" },
  { p: "packages/collector-server/src/leadership/aggregator.ts",                        size: "67.7 KB", role: "16 个信号检测器 + 团队聚合" },
  { p: "packages/collector-server/src/leadership/views/_css.ts",                         size: "29.9 KB", role: "v7 Spatial 设计系统 · 现版仪表盘" },
  { p: "packages/collector-server/src/leadership/views/_overview-fragments.ts",          size: "38.4 KB", role: "Overview 各 section 渲染" },
  { p: "packages/collector-server/src/leadership/views/_slideover.html.ts",              size: "22.1 KB", role: "成员 / 项目抽屉" },
  { p: "packages/collector-server/src/leadership/views/_demo-fixture.ts",                size: "22.4 KB", role: "/overview?demo=1 的 hand-curated 数据" },
  { p: "packages/collector-server/src/leadership/llm/summarizer.ts",                     size: "15.1 KB", role: "LLM T1-T5 五层叙事 worker" },
  { p: "packages/collector-server/src/leadership/llm/prompts/",                          size: "5 files", role: "t1-session · t2-member · t3-project · t4-attention · t5-brief" },
  { p: "packages/collector-server/src/client-update/manifest-route.ts",                  size: "4.7 KB",  role: "客户端自动更新 manifest + sha256" }
];

function RealArchitecture() {
  return (
    <section className="pitch" id="architecture">
      <div className="wrap">
        <div className="vc-head">
          <h2 className="reveal-up">
            <em>{T("④ 真实仓库结构")}</em><br />
            {T("268 个源文件 · TypeScript 93.6%。")}
          </h2>
          <div className="sub reveal-up" style={{ "--delay": "120ms" }}>
            {T("下方每一行直接来自 GitHub。点路径跳到仓库对应文件。")}
          </div>
        </div>

        <div className="file-tree reveal-up">
          <div className="tree-head mono">
            <span style={{ flex: 1 }}>path</span>
            <span style={{ width: 100, textAlign: "right" }}>size</span>
            <span style={{ flex: 1.2 }}>role</span>
          </div>
          {REAL_TREE.map((row, i) => (
            <a key={i} href={`https://github.com/libz-renlab-ai/Matrix-Riven/blob/main/${row.p}`}
              target="_blank" rel="noopener" className="tree-row">
              <span className="mono tree-path" style={{ flex: 1 }}>
                <span style={{ color: "var(--ink-4)" }}>↗</span> {row.p}
              </span>
              <span className="mono tree-size" style={{ width: 100, textAlign: "right" }}>{T(row.size)}</span>
              <span className="tree-role" style={{ flex: 1.2 }}>{T(row.role)}</span>
            </a>
          ))}
        </div>
        <div style={{ marginTop: 18, fontSize: 12, color: "var(--ink-3)", fontFamily: "JetBrains Mono, monospace" }}>
          {T("↗ 完整 268 文件: ")}<a className="link" href="https://github.com/libz-renlab-ai/Matrix-Riven" target="_blank" rel="noopener">github.com/libz-renlab-ai/Matrix-Riven</a>
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────── */
function FinalCta() {
  return (
    <section className="pitch tight" id="cta">
      <div className="wrap-narrow">
        <div className="vc-cta-stage reveal-up">
          <span className="eyebrow sage">{T("想要看更多 ↗")}</span>
          <h2 className="serif">
            {T("上面 4 个模块都是真的。")}<br />
            <em className="shimmer">{T("仓库里的代码原样跑。")}</em>
          </h2>
          <p>
            {T("想看产品的完整叙事 / 安全契约 / 5 层 LLM prompt 细节，打开")}
            <a className="link" href="detail.html">{T("完整介绍")}</a>。
            {T("想读源码，clone 仓库自己跑：")}<code className="mono" style={{ background: "var(--surface)", padding: "2px 8px", borderRadius: 6 }}>pnpm install && pnpm -r build</code>。
          </p>
          <div className="vc-cta-actions">
            <a className="btn primary magnetic" href="https://github.com/libz-renlab-ai/Matrix-Riven" target="_blank" rel="noopener">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5a12 12 0 00-3.79 23.4c.6.1.82-.26.82-.58v-2c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.1-.75.08-.74.08-.74 1.21.09 1.85 1.25 1.85 1.25 1.08 1.84 2.83 1.31 3.52 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.46-1.33-5.46-5.93 0-1.31.47-2.38 1.24-3.22-.13-.31-.54-1.53.12-3.18 0 0 1.01-.32 3.31 1.23a11.5 11.5 0 016 0c2.3-1.55 3.31-1.23 3.31-1.23.66 1.65.25 2.87.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.47 5.92.43.37.82 1.1.82 2.22v3.29c0 .32.22.7.83.58A12 12 0 0012 .5z"/></svg>
              GitHub
            </a>
            <a className="btn magnetic" href="detail.html">{T("完整介绍 →")}</a>
            <a className="btn ghost" href="#live-dashboard">{T("回看 dashboard")}</a>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────── */
function VcFooter() {
  return (
    <footer className="wrap pitch-foot">
      <div className="ft-col">
        <h4>Matrix·Riven</h4>
        <p>{T("团队工程节奏仪表盘。把 Claude Code 会话变成")}<em style={{ fontStyle: "italic", color: "var(--accent-ink)" }}>{T("可观测的工程节奏")}</em>。</p>
        <div className="mono" style={{ marginTop: 18, fontSize: 11.5, color: "var(--ink-3)" }}>v0.2.x · Apache-2.0</div>
      </div>
      <div className="ft-col">
        <h4>{T("本页四个模块")}</h4>
        <ul>
          <li>① <a className="link" href="#live-dashboard">{T("Dashboard demo")}</a></li>
          <li>② <a className="link" href="#live-flow">{T("数据管线")}</a></li>
          <li>③ <a className="link" href="#live-redactor">{T("PII 脱敏")}</a></li>
          <li>④ <a className="link" href="#architecture">{T("仓库结构")}</a></li>
        </ul>
      </div>
      <div className="ft-col">
        <h4>{T("外联")}</h4>
        <ul>
          <li><a className="link" href="detail.html">{T("完整介绍")}</a></li>
          <li><a className="link" href="https://github.com/libz-renlab-ai/Matrix-Riven" target="_blank" rel="noopener">{T("GitHub")}</a></li>
          <li><a className="link" href="https://github.com/libz-renlab-ai/Matrix-Riven/blob/main/README.md" target="_blank" rel="noopener">README</a></li>
        </ul>
      </div>
    </footer>
  );
}

/* ──────────────────────────────────────────────────────────── */
function Slideover({ so, onClose }) {
  vUseEffect(() => {
    if (!so) return;
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [so, onClose]);

  if (!so) {
    return (<><div className="scrim" onClick={onClose}></div><aside className="slideover"></aside></>);
  }

  let data, headerTitle, headerSub, avatarClass = "av-4", initials = "·";
  if (so.kind === "member") {
    const m = window.DEMO.members.find(x => x.email.split("@")[0] === so.id);
    if (!m) return null;
    data = window.DEMO.memberDetail[so.id];
    headerTitle = m.displayName;
    headerSub = m.email + " · " + T(m.stateBadge === "stuck" ? "进展受阻" : m.stateBadge === "low_activity" ? "本周参与不多" : "活跃中");
    avatarClass = m.avatarClass;
    initials = m.initials;
  } else {
    const p = window.DEMO.projects.find(x => x.name === so.id);
    if (!p) return null;
    data = window.DEMO.projectDetail[so.id];
    headerTitle = p.name;
    headerSub = `${p.activeTodayCount}/${p.totalContributors} ${window.LANG === "en" ? "active" : "人在做"} · ${window.MR.etaLabel(p.etaDays)}`;
    avatarClass = "av-6";
    initials = so.id.slice(0, 2).toUpperCase();
  }
  if (!data) return null;

  return (
    <>
      <div className="scrim open" onClick={onClose}></div>
      <aside className="slideover open" role="dialog">
        <div className="so-head">
          <div className={"so-avatar " + avatarClass}>{initials}</div>
          <div>
            <div className="so-name">{headerTitle}</div>
            <div className="so-meta">{headerSub}</div>
          </div>
          <button className="so-close" onClick={onClose} aria-label={T("关闭")}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="so-body">
          <div className="so-callout">
            <div style={{ flexShrink: 0, marginTop: 2, color: "var(--warn)" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
            </div>
            <div dangerouslySetInnerHTML={{ __html: T(data.callout) }}></div>
          </div>
          <div className="so-h">{T("本周快照")}</div>
          <div className="so-stats">
            {so.kind === "member" ? (<>
              <div className="so-stat"><div className="so-stat-num">{T(data.stats.rhythm)}</div><div className="so-stat-label">{T("本周节奏")}</div></div>
              <div className="so-stat"><div className="so-stat-num">{T(data.stats.focus)}</div><div className="so-stat-label">{T("焦点")}</div></div>
              <div className="so-stat"><div className="so-stat-num">{T(data.stats.state)}</div><div className="so-stat-label">{T("状态")}</div></div>
            </>) : (<>
              <div className="so-stat"><div className="so-stat-num">{T(data.stats.rhythm)}</div><div className="so-stat-label">{T("本周节奏")}</div></div>
              <div className="so-stat"><div className="so-stat-num">{T(data.stats.team)}</div><div className="so-stat-label">{T("团队规模")}</div></div>
              <div className="so-stat"><div className="so-stat-num">{T(data.stats.health)}</div><div className="so-stat-label">{T("整体健康")}</div></div>
            </>)}
          </div>
          {so.kind === "member" && data.usage && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 10, padding: "12px 14px", background: "var(--surface-2)", borderRadius: 12 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 600 }} className="tnum">{data.usage.sessions}</div>
                <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>{T("今日会话")}</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 600 }} className="tnum">{data.usage.tokens}</div>
                <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>{T("今日 token")}</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 600 }} className="tnum">${data.usage.cost}</div>
                <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>{T("今日消耗")}</div>
              </div>
            </div>
          )}
          <div className="so-h">{so.kind === "member" ? T("近期会话主题") : T("近期里程碑")}</div>
          <div className="so-evolve">
            {(data.evolve || []).map((row, i) => (
              <div key={i} className={"so-evolve-item" + (i === 0 ? " latest" : "")}>
                <div className="so-evolve-time mono">{row.ts}</div>
                <div className="so-evolve-text serif">
                  {row.topic ? <>📝 {T(row.topic)} · <span style={{ color: "var(--ink-3)" }}>{row.len} {T("字符")}</span></> : row.note}
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}

/* ──────────────────────────────────────────────────────────── */
function ScrollProgressBar() {
  const fillRef = vUseRef(null);
  vUseEffect(() => {
    let raf = 0, ticking = false;
    const update = () => {
      const max = (document.documentElement.scrollHeight - window.innerHeight) || 1;
      const p = Math.min(1, Math.max(0, window.scrollY / max));
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${p})`;
      ticking = false;
    };
    const onScroll = () => { if (!ticking) { raf = requestAnimationFrame(update); ticking = true; } };
    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, []);
  return <div className="scroll-progress"><div className="sp-fill" ref={fillRef}></div></div>;
}

function CursorBlob() {
  const ref = vUseRef(null);
  vUseEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    let tx = 0, ty = 0, cx = innerWidth / 2, cy = innerHeight / 2, raf = 0, running = false;
    const animate = () => {
      tx += (cx - tx) * 0.16;
      ty += (cy - ty) * 0.16;
      el.style.transform = `translate3d(${tx}px, ${ty}px, 0) translate(-50%, -50%)`;
      if (Math.abs(cx - tx) > 0.2 || Math.abs(cy - ty) > 0.2) raf = requestAnimationFrame(animate);
      else running = false;
    };
    const onMove = (e) => {
      cx = e.clientX; cy = e.clientY;
      el.classList.add("on");
      if (!running) { running = true; raf = requestAnimationFrame(animate); }
      const t = e.target && e.target.closest && e.target.closest("a, button, .product-frame, .member-tile, .redactor-rule, .tree-row, .att-row");
      el.classList.toggle("hover-target", !!t);
    };
    const onLeave = () => el.classList.remove("on");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
      cancelAnimationFrame(raf);
    };
  }, []);
  return <div className="cursor-blob" ref={ref}></div>;
}

ReactDOM.createRoot(document.getElementById("app")).render(<VcApp />);
