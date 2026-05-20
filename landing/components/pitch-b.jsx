/* Pitch site — editorial sections, part B
   Narrative (T1-T5 worked example) · Signals · Flow · Safety
*/

const { useState: bUseState, useEffect: bUseEffect, useRef: bUseRef, useMemo: bUseMemo } = React;

/* ====================================================================
   6. NARRATIVE — T1-T5 as editorial chapter
   Each tier gets its own block showing how the same session's content
   gets progressively compressed up the layers.
   ==================================================================== */
function PitchNarrative() {
  return (
    <section className="pitch" id="narrative">
      <div className="wrap">
        <div className="section-head">
          <span className="eyebrow">chapter v. · five layers</span>
          <h2 style={{ marginTop: 24 }}>
            从单次会话到一句领导日报 ——<br />
            <em>五层 LLM 叙事，逐层凝缩</em>。
          </h2>
          <p className="lead">
            原始 transcript 太碎、太多、太脏，没人会读。我们用 5 层 LLM prompt 把它<em>逐层压缩</em> ——
            T1 在一次会话结束时落地，T5 是每天给 CEO 的 3 行简报。
            每层独立缓存、按 tier 计费、daily budget 守护。
            <strong>下方是同一条 session 顺着 T1 → T5 完整凝缩的真实样本。</strong>
          </p>
        </div>

        <div className="tier-chapter">
          {window.DEMO.llmTiers.map((t, i) => (
            <article key={t.key} className="tier-card reveal-up" style={{ "--delay": (i * 80) + "ms" }}>
              <div className="tier-card-head">
                <div>
                  <div className="tier-card-key serif float-soft">{t.key}</div>
                  <div className="tier-card-key-sub">{t.model}</div>
                </div>
                <div>
                  <h3 className="tier-card-title serif">{t.name}</h3>
                  <div className="tier-card-desc">{t.desc}</div>
                  <div style={{ marginTop: 14, display: "flex", gap: 14, flexWrap: "wrap" }}>
                    <span className="pill mono">{t.sub}</span>
                    <span className="pill sage mono">cache hit ≈ 60%</span>
                  </div>
                </div>
              </div>

              <div className="tier-io">
                <div>
                  <div className="tier-io-label">input · 喂给 prompt</div>
                  <pre className="tier-io-pane">{t.input}</pre>
                </div>
                <div>
                  <div className="tier-io-label out">output · 渲染到看板</div>
                  <div className="tier-io-pane out">{t.output}</div>
                </div>
              </div>
            </article>
          ))}
        </div>

        <p style={{
          fontFamily: "Newsreader, Georgia, serif",
          fontSize: 17, fontStyle: "italic", color: "var(--ink-3)",
          marginTop: 64, maxWidth: 720
        }}>
          —— 同一条 session 沿五层凝缩：47 条工具调用 → 80 字 T1 → 2 行成员 digest →
          2 行项目 digest → 1 句 attention 改写 → 1 行领导日报。
          每一层都有缓存、单测、tier 预算；任何一层失败，下面那层只是降级为模板，不会把整套关停。
        </p>
      </div>
    </section>
  );
}

/* ====================================================================
   7. SIGNALS — categorized editorial
   ==================================================================== */
function PitchSignals() {
  return (
    <section className="pitch" id="signals">
      <div className="wrap">
        <div className="section-head">
          <span className="eyebrow">chapter vi. · sixteen signals</span>
          <h2 style={{ marginTop: 24 }}>
            16 个结构化信号 —— <br />
            不是关键词检索，<em>是检测器</em>。
          </h2>
          <p className="lead">
            每个信号都是独立的 TypeScript 函数，喂团队 7 日窗口的会话快照、吐回一组命中。
            它们组合起来回答 4 个领导级问题：<strong>谁在跑、谁在卡、谁在帮、谁在飘</strong>。
            按 6 大类组织如下 —— 每条都附本次 demo dataset 的真实命中样本。
          </p>
        </div>

        <div>
          {window.DEMO.signalCategories.map((cat, i) => (
            <section key={cat.key} className="sig-cat reveal-up" style={{ "--delay": (i * 60) + "ms" }}>
              <div className="sig-cat-head">
                <div>
                  <div className="sig-cat-name serif" dangerouslySetInnerHTML={{ __html: cat.titleHtml }}></div>
                  <div className="sig-cat-meta">{cat.signals.length} signals</div>
                </div>
                <div className="sig-cat-intro">{cat.intro}</div>
              </div>
              <div className="sig-grid">
                {cat.signals.map(s => (
                  <div key={s.id} className="sig-row">
                    <div className="sig-glyph serif">{s.glyph}</div>
                    <div className="sig-body">
                      <div className="sig-name serif">{s.name}</div>
                      <div className="sig-id">{s.id}</div>
                      <div className="sig-desc">{s.desc}</div>
                      <div className="sig-example serif">↪ {s.example}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ====================================================================
   8. FLOW — sticky timeline + editorial detail
   ==================================================================== */
function PitchFlow() {
  const [active, setActive] = bUseState(0);
  const [playing, setPlaying] = bUseState(false);
  const [swap, setSwap] = bUseState(false);
  const timer = bUseRef(null);

  const goTo = (i) => {
    setSwap(true);
    setTimeout(() => {
      setActive(i);
      setSwap(false);
    }, 220);
  };

  bUseEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => {
      goTo((active + 1) % window.DEMO.flowSteps.length);
    }, 2800);
    return () => clearInterval(timer.current);
  }, [playing, active]);

  const step = window.DEMO.flowSteps[active];

  return (
    <section className="pitch" id="flow">
      <div className="wrap">
        <div className="section-head">
          <span className="eyebrow">chapter vii. · the pipeline</span>
          <h2 style={{ marginTop: 24 }}>
            一个 Stop hook 到看板 ——<br />
            <em>30 秒</em>，6 步。
          </h2>
          <p className="lead">
            每位开发者的会话结束都会触发一次完整的 6 步管线。
            每一步独立、可重启、可重放，崩溃<em>从不</em>影响 Claude Code 主流程。
            点左侧任一步骤查看细节，或开自动播放。
          </p>
        </div>

        <div className="flow-timeline">
          <div className="flow-rail-col">
            {window.DEMO.flowSteps.map((s, i) => (
              <button key={s.key}
                className={"flow-rail-item " + (i === active ? "active" : i < active ? "is-passed" : "")}
                onClick={() => { goTo(i); setPlaying(false); }}>
                <div className="flow-rail-dot">{i + 1}</div>
                <div>
                  <div className="flow-rail-title serif">{s.title}</div>
                  <div className="flow-rail-sub mono">{s.sub}</div>
                </div>
              </button>
            ))}
            <div style={{ marginTop: 18, display: "flex", gap: 10 }}>
              <button className="btn sm sage magnetic" onClick={() => setPlaying(p => !p)}>
                {playing ? "暂停" : "自动播放"}
              </button>
              <button className="btn sm ghost" onClick={() => goTo((active + 1) % window.DEMO.flowSteps.length)}>
                下一步 →
              </button>
            </div>
          </div>

          <div className={"flow-detail-col" + (swap ? " swap-out" : "")}>
            <div className="flow-detail-key serif">step {active + 1} of {window.DEMO.flowSteps.length} · <span className="mono" style={{ fontStyle: "normal", color: "var(--ink-3)" }}>{step.sub}</span></div>
            <h3 className="flow-detail-title serif">{step.title}</h3>
            <p className="flow-detail-body" dangerouslySetInnerHTML={{ __html: step.body }}></p>

            <div className="flow-metrics">
              {step.metrics.map(([k, v], i) => (
                <div key={i} className="flow-metric">
                  <div className="fm-num serif">{k}</div>
                  <div className="fm-label">{v}</div>
                </div>
              ))}
            </div>

            <FlowTerminal step={step.key} />
          </div>
        </div>
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
    ["c", "# queue snapshot — daemon detached, drains in background"],
    ["k", "$ ls ~/.riven/digital-twin/queue/"],
    ["",  "rec_ses_8f3a2c.jsonl     12.4 KB"],
    ["",  "rec_ses_8e9b14.jsonl      8.1 KB"],
    ["",  "rec_ses_8d72fa.jsonl     31.2 KB"],
    ["c", "# offline-resilient. FIFO. fsync per write."]
  ],
  redact: [
    ["c", "# before redaction"],
    ["",  "headers.authorization: \"Bearer sk-ant-abc…\""],
    ["",  "cwd: \"/Users/alex/repo/teambrain\""],
    ["",  "tool.bash.cmd: \"AKIA1234… s3 cp …\""],
    ["c", "# after"],
    ["s", "headers.authorization: \"<REDACTED:bearer>\""],
    ["s", "cwd: \"/Users/<USER>/repo/teambrain\""],
    ["s", "tool.bash.cmd: \"<REDACTED:key> s3 cp …\""]
  ],
  gzip: [
    ["k", "$ daemon flush rec_ses_8f3a2c"],
    ["",  "▸ raw:    12.4 KB"],
    ["",  "▸ gzip:    1.3 KB  (10.5×)"],
    ["k", "POST /v1/cc-sessions"],
    ["",  "  Authorization: Bearer ************"],
    ["",  "  Content-Encoding: gzip"],
    ["s", "  ← 200 OK  { ok: true, stored: 1 }"]
  ],
  persist: [
    ["k", "$ tree ~/riven-collector/alex/2026-05-20/"],
    ["",  "├── ses_8f3a2c.jsonl"],
    ["",  "├── ses_8e9b14.jsonl"],
    ["",  "└── .leadership-index.json"],
    ["c", "# inject-mock content is auto-rejected"],
    ["n", "← 200 OK { ok: true, dropped: 'inject-mock' }"]
  ],
  render: [
    ["k", "GET /api/overview?date=2026-05-20"],
    ["",  "{"],
    ["d", "  \"kpis\":        { team_total_usd: 4.32, ... },"],
    ["d", "  \"attention\":   [ { kind: \"member\", refId: ... } ],"],
    ["d", "  \"members\":     [ ... ],"],
    ["d", "  \"projects\":    [ ... ],"],
    ["d", "  \"llmBrief\":    [ \"今日团队推进顺利…\" ]"],
    ["",  "}"],
    ["c", "# ETag → 304 on unchanged poll. <200 bytes wire cost."]
  ]
};

function FlowTerminal({ step }) {
  const lines = FLOW_TERMINAL[step] || [];
  const [visible, setVisible] = bUseState([]);
  bUseEffect(() => {
    setVisible([]);
    const ts = lines.map((_, i) => setTimeout(() => setVisible(v => [...v, i]), 160 * i + 80));
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

/* ====================================================================
   9. SAFETY — The Pact (6 numbered commitments) + live demo as evidence
   ==================================================================== */
function PitchSafety() {
  return (
    <section className="pitch" id="safety">
      <div className="wrap">
        <div className="section-head">
          <span className="eyebrow">chapter viii. · the pact</span>
          <h2 style={{ marginTop: 24 }}>
            团队的工程数据是<br />
            <em>非常敏感的资产</em>。
          </h2>
          <p className="lead">
            这是我们和你的 6 条契约。每一条在仓库里都有对应的代码路径、单测、launch audit 记录。
            说到做到 —— 出处可查。
          </p>
        </div>

        <div className="pact-list">
          {window.DEMO.pact.map((p, i) => (
            <div key={i} className="pact-row reveal-up" style={{ "--delay": (i * 60) + "ms" }}>
              <div className="pact-num serif">{p.num}</div>
              <div className="pact-title serif" dangerouslySetInnerHTML={{ __html: p.title }}></div>
              <div className="pact-body" dangerouslySetInnerHTML={{ __html: p.body }}></div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 80, paddingTop: 56, borderTop: "1px solid var(--hairline)" }}>
          <span className="eyebrow">live evidence</span>
          <h3 className="serif" style={{
            fontFamily: "Newsreader, Georgia, serif", fontWeight: 400,
            fontSize: 32, marginTop: 18, maxWidth: 720,
            lineHeight: 1.15, letterSpacing: "-0.02em"
          }}>
            上面那条「敏感字段在源头被拦下」是怎么发生的 ——<br />
            <em>下方实时演示</em>。
          </h3>
          <p style={{
            fontFamily: "Newsreader, Georgia, serif",
            fontSize: 16, color: "var(--ink-2)",
            marginTop: 14, maxWidth: 660, lineHeight: 1.65
          }}>
            改改左侧输入或开关任一规则，看右侧脱敏产物如何变化。
            这正是 shared/pii/redactor 在守护进程里跑的逻辑。
          </p>

          <Redactor />
        </div>
      </div>
    </section>
  );
}

const SAMPLE_INPUT = `用户在 Bash 工具里执行了:
  curl -H "Authorization: Bearer sk-ant-api03-aBcD1234567890XyZ" \\
       https://api.example.com/v1/users

我的 cwd 是 /Users/alex/work/teambrain/packages/server，
联系邮箱 alex.example@company.io，
临时密钥 AKIA1234567890ABCDEF，
git hash 是 8f3a2c1d7e4b6f9a0c2d5e8b1f4a7c3d (sha 不该被脱敏)。`;

const RED_RULES = [
  { key: "bearer",  label: "Bearer Token", color: "#B0625A", pattern: /Bearer\s+([A-Za-z0-9_\-]+)/g,                              replace: () => "Bearer <REDACTED:bearer>" },
  { key: "apikey",  label: "API Key",      color: "#B0625A", pattern: /\b(sk-[a-zA-Z0-9_\-]+|AKIA[0-9A-Z]{16})\b/g,               replace: () => "<REDACTED:key>" },
  { key: "email",   label: "Email",        color: "#8B6B9C", pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,     replace: () => "<REDACTED:email>" },
  { key: "userpath",label: "User Path",    color: "#C8924B", pattern: /\/(Users|home)\/([A-Za-z0-9_.\-]+)/g,                      replace: (_, p1) => `/${p1}/<USER>` }
];

function Redactor() {
  const [input, setInput] = bUseState(SAMPLE_INPUT);
  const [enabled, setEnabled] = bUseState({ bearer: true, apikey: true, email: true, userpath: true });

  const { output, hits } = bUseMemo(() => {
    let text = input; const counts = {};
    RED_RULES.forEach(r => {
      counts[r.key] = 0;
      if (!enabled[r.key]) return;
      text = text.replace(r.pattern, (...args) => { counts[r.key]++; return r.replace(...args); });
    });
    return { output: text, hits: counts };
  }, [input, enabled]);

  const highlighted = bUseMemo(() => {
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
    <>
      <div className="redactor-shell">
        <div className="redactor-pane">
          <div className="redactor-pane-head">
            <span className="label">raw transcript · 开发者本地</span>
            <button className="btn ghost sm" onClick={() => setInput(SAMPLE_INPUT)}>reset</button>
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
                position: "relative", width: "100%", minHeight: 260,
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
            <span className="label">redacted payload · 上送服务端</span>
            <span className="pill sage mono">{totalHits} hits</span>
          </div>
          <div className="mono" style={{
            padding: 18, fontSize: 12.5, lineHeight: 1.75,
            whiteSpace: "pre-wrap", wordBreak: "break-word", minHeight: 260, color: "var(--ink-1)"
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
        {RED_RULES.map(r => (
          <button key={r.key} type="button"
            className={"redactor-rule" + (enabled[r.key] ? " on" : "")}
            onClick={() => setEnabled(s => ({ ...s, [r.key]: !s[r.key] }))}>
            <span className="lr-dot" style={{ background: enabled[r.key] ? r.color : "var(--ink-4)" }}></span>
            <span>{r.label}</span>
            <span className="lr-count">{hits[r.key] || 0}</span>
          </button>
        ))}
      </div>
    </>
  );
}

window.PitchNarrative = PitchNarrative;
window.PitchSignals = PitchSignals;
window.PitchFlow = PitchFlow;
window.PitchSafety = PitchSafety;
