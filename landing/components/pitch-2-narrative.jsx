/* Pitch site — Five-tier LLM narrative (T1-T5) + 16 signal detectors */

const { useState: nUseState } = React;

/* ====================================================================
   FIVE-TIER LLM NARRATIVE (T1-T5)
   ==================================================================== */
function PitchNarrative() {
  const [active, setActive] = nUseState(3); // start on T4 (attention rewrite) — most demo-able

  return (
    <section className="pitch" id="narrative">
      <div className="wrap">
        <div className="section-head">
          <span className="eyebrow"><span className="dot"></span>叙事层</span>
          <h2>
            从单次会话，到一句领导日报<br />
            <em>五层 LLM 叙事，逐层凝缩</em>。
          </h2>
          <p className="lead">
            原始 transcript 太碎、太多、太脏，没人会读。我们用 5 层 LLM prompt 把它逐层压缩 ——
            T1 在一次会话结束时落地，T5 是每天给 CEO 的 3 行简报。每层都缓存可重放、按 tier 计费、daily budget 守护。
            <strong style={{ color: "var(--ink-1)", fontWeight: 500 }}> 单次完整 cycle 实测 $0.12 - $0.20。</strong>
          </p>
        </div>

        <div className="tier-picker">
          <div className="tier-list">
            {window.DEMO.llmTiers.map((t, i) => (
              <button key={t.key} className={"tier-item" + (i === active ? " active" : "")} onClick={() => setActive(i)}>
                <div className="tier-key">{t.key} · {t.model}</div>
                <div className="tier-name">{t.name}</div>
                <div className="tier-sub">{t.sub}</div>
              </button>
            ))}
          </div>

          <TierDetail tier={window.DEMO.llmTiers[active]} />
        </div>

        <div style={{
          marginTop: 18, padding: "12px 16px",
          background: "var(--accent-soft)", border: "1px solid rgba(111,139,94,.2)",
          borderRadius: "var(--r-md)",
          display: "flex", gap: 20, flexWrap: "wrap",
          fontSize: 12.5, color: "var(--accent-ink)", lineHeight: 1.55
        }}>
          <strong style={{ fontWeight: 600 }}>✦ 设计取舍 —</strong>
          <span>T1 用便宜的 haiku（输入大、输出短）</span>
          <span>T2-T5 用 sonnet（凝缩 + 改写 + 取舍）</span>
          <span>所有 prompt schema 化、单测覆盖</span>
          <span>50MB 本地缓存 · LRU + tier 加权</span>
        </div>
      </div>
    </section>
  );
}

function TierDetail({ tier }) {
  return (
    <div className="tier-detail">
      <div>
        <p style={{ fontSize: 14, lineHeight: 1.65, color: "var(--ink-2)" }}>{tier.desc}</p>
        <div className="tier-pane" style={{ marginTop: 16 }}>
          <div className="tier-pane-head">
            <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--calm)" }}></span>
            input · 喂给 prompt
          </div>
          {tier.input}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-3)", fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--accent)" }}></span>
          output · 渲染到看板
        </div>
        <div className="tier-pane output" style={{ marginTop: 10 }}>
          {tier.output}
        </div>
        <div style={{
          marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap",
          fontSize: 11, color: "var(--ink-3)"
        }}>
          <span className="pill sage mono">{tier.key}</span>
          <span className="pill mono">{tier.model}</span>
          <span className="pill mono">cache hit-rate ≈ 60%</span>
        </div>
      </div>
    </div>
  );
}

/* ====================================================================
   16 SIGNAL DETECTORS
   ==================================================================== */
function PitchSignals() {
  const [active, setActive] = nUseState(0);
  const sig = window.DEMO.signals[active];

  // Group by category for the legend
  const categories = ["节奏", "专注", "卡住", "风险", "协作", "学习"];

  return (
    <section className="pitch" id="signals">
      <div className="wrap">
        <div className="section-head">
          <span className="eyebrow"><span className="dot"></span>检测器</span>
          <h2>
            16 个结构化信号<br />
            <em>不是关键词搜索，是检测器</em>。
          </h2>
          <p className="lead">
            每个信号都是一个独立的 TypeScript 检测器，喂团队 7 日窗口的会话快照、吐回一组命中。
            它们组合起来回答 4 个领导级问题：<strong style={{ color: "var(--ink-1)", fontWeight: 500 }}>谁在跑、谁在卡、谁在帮、谁在飘</strong>。
          </p>
          <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {categories.map(c => {
              const count = window.DEMO.signals.filter(s => s.cat === c).length;
              return <span key={c} className="pill mono">{c} <span style={{ color: "var(--ink-4)" }}>· {count}</span></span>;
            })}
          </div>
        </div>

        <div className="signals-grid">
          {window.DEMO.signals.map((s, i) => (
            <button key={s.id} className={"signal-cell" + (i === active ? " active" : "")} onClick={() => setActive(i)}>
              <div className="signal-glyph">{s.glyph}</div>
              <div className="signal-name">{s.name}</div>
              <div className="signal-id">{s.cat} · {s.id}</div>
            </button>
          ))}
        </div>

        <div className="signal-detail">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div className="signal-glyph" style={{ width: 48, height: 48, borderRadius: 14, background: "var(--accent-soft)", display: "grid", placeItems: "center", fontSize: 26 }}>{sig.glyph}</div>
              <div>
                <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "var(--ink-3)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{sig.cat}</div>
                <h3 className="serif" style={{ fontFamily: "Newsreader, Georgia, serif", fontWeight: 400, fontSize: 24, marginTop: 4 }}>{sig.name}</h3>
              </div>
            </div>
            <p style={{ marginTop: 18, fontSize: 14, lineHeight: 1.65, color: "var(--ink-2)" }}>{sig.desc}</p>
            <div style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className="pill mono">id: {sig.id}</span>
              <span className="pill sage mono">unit-tested</span>
            </div>
          </div>
          <div>
            <div className="so-h" style={{ margin: "0 0 10px" }}>当前快照里的命中</div>
            <div className="serif" style={{
              padding: "16px 18px",
              background: "linear-gradient(180deg, var(--warn-soft), var(--surface-2))",
              border: "1px solid rgba(200,146,75,.18)",
              borderRadius: "var(--r-md)",
              fontSize: 14.5, lineHeight: 1.6, color: "#5C4015"
            }}>
              {sig.example}
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: "var(--ink-3)", fontFamily: "JetBrains Mono, monospace" }}>
              ↗ 命中后馈入 attention 卡 / 成员状态徽章 / 项目 busFactor / T4 改写
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

window.PitchNarrative = PitchNarrative;
window.PitchSignals = PitchSignals;
