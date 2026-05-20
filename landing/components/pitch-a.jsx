/* Pitch site — editorial sections, part A
   Hero · Manifesto · Problem · Insight · Product
*/

const { useState: pUseState, useEffect: pUseEffect, useMemo: pUseMemo, useRef: pUseRef } = React;

/* ====================================================================
   1. HERO — quiet, typographic, single column
   ==================================================================== */
function PitchHero() {
  const tick = window.MR.useTick(60);
  const base = window.DEMO.hero;
  const captured  = base.transcriptsCaptured + Math.floor(tick / 40);
  const decisions = base.decisionsExtracted + Math.floor(tick / 80);
  const redacted  = base.redactionsApplied + Math.floor(tick / 240);

  const [titleRef, titleIn] = window.MR.useReveal({ threshold: 0.2 });
  const [stripRef, stripIn] = window.MR.useReveal({ threshold: 0.4 });
  const [ref1, num1] = window.MR.useCountUp(captured,  { duration: 2000 });
  const [ref2, num2] = window.MR.useCountUp(decisions, { duration: 2000, delay: 120 });
  const [ref3, num3] = window.MR.useCountUp(redacted,  { duration: 1600, delay: 240 });
  const [ref4, num4] = window.MR.useCountUp(base.teamsConnected, { duration: 1400, delay: 360 });

  return (
    <section className="pitch hero-stage" id="hero">
      <div className="wrap">
        <span className="eyebrow sage reveal-up">matrix·riven · v0.2 · 团队工程节奏仪表盘</span>
        <h1 ref={titleRef} className={titleIn ? "is-in" : ""} style={{ marginTop: 32, maxWidth: 1000 }}>
          <span className="line"><span>把团队的 Claude Code 会话</span></span><br />
          <span className="line"><span>变成 <em className="shimmer">可观测的工程节奏</em>。</span></span>
        </h1>
        <p className="reveal-up" style={{
          fontFamily: "Newsreader, Georgia, serif",
          fontSize: 22, lineHeight: 1.55, color: "var(--ink-2)",
          maxWidth: 760, marginTop: 36, letterSpacing: 0, "--delay": "320ms"
        }}>
          你团队每天和 Claude Code 进行成百上千次会话 —— 每一次都揭示
          <span style={{ color: "var(--ink-1)", fontWeight: 500 }}>谁在做什么、卡在哪、花了多少钱</span>。
          Matrix·Riven 把这些 transcript 在源头脱敏后汇聚，
          跑 16 个信号检测器加 5 层 LLM 叙事，<em style={{ color: "var(--accent-ink)", fontStyle: "italic" }}>30 秒近实时</em>刷新一份会说人话的领导仪表盘。
        </p>

        <div className="reveal-up magnetic-group" style={{ display: "flex", gap: 16, marginTop: 44, flexWrap: "wrap", "--delay": "460ms" }}>
          <a className="btn primary magnetic" href="#product">查看真实看板 →</a>
          <a className="btn magnetic" href="#narrative">看 LLM 叙事</a>
          <a className="btn ghost" href="https://github.com/libz-renlab-ai/Matrix-Riven" target="_blank" rel="noopener">GitHub ↗</a>
        </div>

        <div className="hero-meta reveal-up" style={{ "--delay": "600ms" }}>
          <span><span className="dot"></span>v0.2.x · 已在 12 个团队上线</span>
          <span>构建于 Node ≥ 22.5 · TypeScript 93.6%</span>
          <span>许可证：Apache-2.0</span>
        </div>

        <div ref={stripRef} className={"hero-strip" + (stripIn ? " is-in" : "")}>
          <div className="hero-stat">
            <div className="h-num" ref={ref1}><em>{num1.toLocaleString ? Number(num1).toLocaleString() : num1}</em></div>
            <div className="h-label">transcripts captured</div>
          </div>
          <div className="hero-stat">
            <div className="h-num" ref={ref2}>{num2.toLocaleString ? Number(num2).toLocaleString() : num2}</div>
            <div className="h-label">decisions extracted</div>
          </div>
          <div className="hero-stat">
            <div className="h-num" ref={ref3}>{num3.toLocaleString ? Number(num3).toLocaleString() : num3}</div>
            <div className="h-label">pii fields redacted</div>
          </div>
          <div className="hero-stat">
            <div className="h-num" ref={ref4}>{num4}</div>
            <div className="h-label">teams connected</div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ====================================================================
   2. MANIFESTO — newspaper essay with drop cap
   ==================================================================== */
function PitchManifesto() {
  return (
    <section className="pitch" id="manifesto">
      <div className="wrap-prose">
        <div className="essay">
          <div className="essay-aside reveal-up">
            <div className="aside-h">manifesto</div>
            <div>chapter i.</div>
            <div style={{ marginTop: 24, fontStyle: "italic", color: "var(--ink-4)", letterSpacing: 0, textTransform: "none" }}>
              "Transcripts are the<br />
              richest engineering<br />
              ledger no one is<br />
              reading."
            </div>
          </div>
          <div className="prose dropcap reveal-up" style={{ "--delay": "120ms" }}>
            {window.DEMO.manifesto.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
            <hr className="rule" style={{ margin: "32px 0", width: 60 }} />
            <p style={{ fontSize: 16, color: "var(--ink-3)", fontStyle: "italic" }}>
              本文的主张是 Matrix·Riven 全部产品设计的出发点 —— 既是技术选择的依据，也是和团队领导沟通的语境。
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ====================================================================
   3. PROBLEM — typographic list, no cards
   ==================================================================== */
function PitchProblem() {
  return (
    <section className="pitch" id="problem">
      <div className="wrap">
        <div className="section-head">
          <span className="eyebrow">chapter ii. · the gap</span>
          <h2 style={{ marginTop: 24 }}>
            团队领导每天问 4 个问题 ——<br />
            没有一个能在 <em>10 秒内</em> 答上来。
          </h2>
          <p className="lead">
            Slack 加 Jira 加 GitHub 加财务报表，四个工具凑出来的图都是滞后的、片面的、需要自己拼。
            Matrix·Riven 的前提是：你团队最丰富的真相早就被记录在 Claude Code 的 transcript 里了 —— 只是没人在用它。
          </p>
        </div>

        <div className="problem-list">
          {window.DEMO.problems.map((p, i) => (
            <div key={i} className="problem-row reveal-up" style={{ "--delay": (i * 80) + "ms" }}>
              <div className="problem-num serif">{p.num}</div>
              <div>
                <div className="problem-title serif">{p.title}</div>
              </div>
              <div className="problem-body">{p.body}</div>
            </div>
          ))}
        </div>

        <p style={{
          fontFamily: "Newsreader, Georgia, serif",
          fontSize: 16, fontStyle: "italic", color: "var(--ink-3)",
          marginTop: 48, maxWidth: 660
        }}>
          —— 当你回答其中任何一条都要打开 4 个 tab，
          团队就会停在「凭感觉」里。我们认为这一秒钟才是最贵的成本。
        </p>
      </div>
    </section>
  );
}

/* ====================================================================
   4. INSIGHT — single oversized pull quote
   ==================================================================== */
function PitchInsight() {
  return (
    <section className="pitch tight" id="insight">
      <div className="wrap-narrow">
        <div className="insight-stage">
          <span className="insight-key reveal-up">chapter iii. · the insight</span>
          <p className="pull-quote serif">
            <em>Transcript</em> 就是团队的工程账本。<br />
            它早就在那儿了，<br />
            只是没人在 <em>读</em> 它。
          </p>
          <div className="pull-quote-attrib reveal-up" style={{ "--delay": "600ms" }}>{window.DEMO.insight.attrib}</div>
        </div>
      </div>
    </section>
  );
}

/* ====================================================================
   5. PRODUCT — preview with side annotations
   ==================================================================== */
function PitchProduct({ openSlideover }) {
  return (
    <section className="pitch" id="product">
      <div className="wrap">
        <div className="section-head">
          <span className="eyebrow">chapter iv. · the dashboard</span>
          <h2 style={{ marginTop: 24 }}>
            领导 30 秒，<br />
            读完团队当天的 <em>工程节奏</em>。
          </h2>
          <p className="lead">
            下方是 Matrix·Riven 真实看板的截图级嵌入 —— 不是设计稿，
            <strong>布局、文案、配色、组件都直接来自 packages/collector-server/src/leadership/views/</strong>。
            点 attention 行或任意成员 tile，从右侧滑出 520px 详情抽屉。
          </p>
        </div>

        <div className="product-annotated">
          <div className="product-frame reveal-scale">
            <div className="product-frame-chrome">
              <span className="product-frame-dot r"></span>
              <span className="product-frame-dot y"></span>
              <span className="product-frame-dot g"></span>
              <div className="product-frame-url">https://collector.riven.internal:8443/overview</div>
              <span className="pill sage" style={{ background: "var(--accent-soft)", padding: "3px 9px" }}>v0.2.x · live</span>
            </div>
            <div className="product-frame-body">
              <ProductPreview onOpen={openSlideover} />
            </div>
          </div>

          <div className="ann-list reveal-stagger">
            <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "var(--ink-3)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 18 }}>
              what you're looking at
            </div>
            {window.DEMO.productAnnotations.map((a, i) => (
              <div key={i} className="ann-item">
                <div className="ann-tag">{a.tag}</div>
                <div style={{ fontWeight: 500, color: "var(--ink-1)", marginBottom: 4 }}>{a.title}</div>
                <div>{a.body}</div>
              </div>
            ))}

            <div style={{
              marginTop: 24, paddingTop: 18,
              borderTop: "1px dashed var(--hairline)",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 11, color: "var(--ink-3)",
              lineHeight: 1.7
            }}>
              ↗ 全部 UI 组件来自 leadership/views/<br />
              ↗ 数据为合成 fixture，结构和 prod 完全一致
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

window.PitchHero = PitchHero;
window.PitchManifesto = PitchManifesto;
window.PitchProblem = PitchProblem;
window.PitchInsight = PitchInsight;
window.PitchProduct = PitchProduct;
