/* Pitch site — Hero, Problem, Product (with slideover) */

const { useState: pUseState, useEffect: pUseEffect, useRef: pUseRef, useMemo: pUseMemo } = React;

/* ====================================================================
   HERO — Newsreader serif h1 + live-counter cards + ambient pipeline
   ==================================================================== */
function PitchHero() {
  const tick = window.MR.useTick(40);
  // animate counters from base + tick-based drift to feel "live"
  const base = window.DEMO.hero;
  const t = tick;
  const captured  = base.transcriptsCaptured + Math.floor(t / 30);
  const decisions = base.decisionsExtracted  + Math.floor(t / 60);
  const redacted  = base.redactionsApplied   + Math.floor(t / 180);

  return (
    <section className="pitch" id="hero" style={{ paddingTop: 56, paddingBottom: 72 }}>
      <div className="wrap">
        <div className="hero-grid">
          <div>
            <span className="eyebrow"><span className="dot"></span>matrix·riven · v0.2 · 团队工程节奏仪表盘</span>
            <h1 style={{ marginTop: 22 }}>
              把团队的 Claude Code 会话<br />
              变成<em>可观测的工程节奏</em>。
            </h1>
            <p className="lead" style={{ marginTop: 22 }}>
              你的团队每天和 Claude Code 进行成百上千次会话 —— 每一次都揭示
              <strong style={{ color: "var(--ink-1)", fontWeight: 500 }}>谁在做什么、卡在哪、花了多少钱</strong>。
              Matrix·Riven 把这些 transcript 在源头脱敏后汇聚，跑 16 个信号检测器 + 5 层 LLM 叙事，
              30 秒近实时刷新一份会说人话的领导仪表盘。
            </p>
            <div style={{ display: "flex", gap: 12, marginTop: 32, flexWrap: "wrap" }}>
              <a className="btn primary" href="#product">
                查看真实看板
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
              </a>
              <a className="btn" href="#narrative">五层 LLM 叙事</a>
              <a className="btn ghost" href="https://github.com/libz-renlab-ai/Matrix-Riven" target="_blank" rel="noopener">GitHub ↗</a>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24, marginTop: 40 }}>
              <HeroStat num={captured.toLocaleString()}   label="transcripts captured" />
              <HeroStat num={decisions.toLocaleString()}  label="decisions extracted" />
              <HeroStat num={redacted.toLocaleString()}   label="pii fields redacted" />
            </div>
          </div>

          <HeroVisualization tick={tick} />
        </div>
      </div>
    </section>
  );
}

function HeroStat({ num, label }) {
  return (
    <div className="hero-stat">
      <div className="hero-stat-num">{num}</div>
      <div className="hero-stat-label">{label}</div>
    </div>
  );
}

/* Hero visualization — ambient data-flow with animated packets going
   from devs (left col) into the collector (right col) into the dashboard.
   All inline SVG, no external assets. */
function HeroVisualization({ tick }) {
  // 5 dev "lanes" on the left, each with a stream of packets flowing right
  const lanes = [
    { y: 80,  color: "#B85F5A", label: "alex"  },
    { y: 140, color: "#5C7A9C", label: "blake" },
    { y: 200, color: "#9B7B4F", label: "casey" },
    { y: 260, color: "#6F8B5E", label: "dana"  },
    { y: 320, color: "#8B6B9C", label: "yu"    }
  ];

  // build packets — each lane has 4 in flight at staggered phases
  const packets = [];
  lanes.forEach((lane, li) => {
    for (let i = 0; i < 4; i++) {
      const phase = ((tick * 1.3 + li * 30 + i * 80) % 320) / 320;
      const x = 80 + phase * 280;
      const alpha = phase < 0.06 ? phase * 16 : phase > 0.94 ? (1 - phase) * 16 : 1;
      packets.push({ x, y: lane.y, color: lane.color, alpha });
    }
  });

  return (
    <div className="live-viz">
      <div className="live-viz-grid"></div>
      <svg viewBox="0 0 460 540" width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
        <defs>
          <linearGradient id="rail" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%"  stopColor="rgba(122,119,111,.0)" />
            <stop offset="14%" stopColor="rgba(122,119,111,.25)" />
            <stop offset="86%" stopColor="rgba(122,119,111,.25)" />
            <stop offset="100%" stopColor="rgba(122,119,111,.0)" />
          </linearGradient>
          <filter id="soft-glow"><feGaussianBlur stdDeviation="1.2" /></filter>
        </defs>

        {/* Left column label */}
        <text x="30" y="40" fill="#7A776F" fontFamily="JetBrains Mono, monospace" fontSize="10" letterSpacing="1.2">DEVS</text>
        <text x="220" y="40" fill="#7A776F" fontFamily="JetBrains Mono, monospace" fontSize="10" letterSpacing="1.2" textAnchor="middle">COLLECTOR</text>
        <text x="410" y="40" fill="#7A776F" fontFamily="JetBrains Mono, monospace" fontSize="10" letterSpacing="1.2" textAnchor="end">DASHBOARD</text>

        {/* Dev rows — pulse + name + lane */}
        {lanes.map((l, i) => (
          <g key={i}>
            {/* lane */}
            <line x1="80" y1={l.y} x2="360" y2={l.y} stroke="url(#rail)" strokeWidth="1" strokeDasharray="2 4" />
            {/* dev marker */}
            <circle cx="60" cy={l.y} r="14" fill="white" stroke={l.color} strokeWidth="1.5" />
            <circle cx="60" cy={l.y} r="14" fill="none" stroke={l.color} strokeOpacity="0.4" strokeWidth="2">
              <animate attributeName="r" values="14;20;14" dur="2.5s" begin={`${i * 0.4}s`} repeatCount="indefinite" />
              <animate attributeName="stroke-opacity" values="0.4;0;0.4" dur="2.5s" begin={`${i * 0.4}s`} repeatCount="indefinite" />
            </circle>
            <text x="60" y={l.y + 4} fill={l.color} fontFamily="JetBrains Mono, monospace" fontSize="9" textAnchor="middle" fontWeight="600">{l.label.slice(0, 2).toUpperCase()}</text>
            <text x="20" y={l.y + 4} fill="#7A776F" fontFamily="JetBrains Mono, monospace" fontSize="10" textAnchor="start">{l.label}</text>
          </g>
        ))}

        {/* Collector box (center) */}
        <rect x="180" y="180" width="80" height="100" rx="14" fill="white" stroke="#ECEAE2" strokeWidth="1.5" />
        <rect x="180" y="180" width="80" height="22" rx="14" fill="#FBFBF8" />
        <text x="220" y="194" fill="#7A776F" fontFamily="JetBrains Mono, monospace" fontSize="9" textAnchor="middle" letterSpacing="0.5">collector</text>
        <text x="220" y="232" fill="#3F5736" fontFamily="Newsreader, Georgia, serif" fontSize="14" textAnchor="middle" fontStyle="italic">aggregator</text>
        <text x="220" y="250" fill="#7A776F" fontFamily="JetBrains Mono, monospace" fontSize="8" textAnchor="middle">16 detectors</text>
        <text x="220" y="263" fill="#7A776F" fontFamily="JetBrains Mono, monospace" fontSize="8" textAnchor="middle">T1-T5 LLM</text>

        {/* Pulse on collector */}
        <circle cx="220" cy="190" r="3" fill="#6F8B5E">
          <animate attributeName="opacity" values="1;.3;1" dur="1.5s" repeatCount="indefinite" />
        </circle>

        {/* Output rail to dashboard */}
        <line x1="260" y1="220" x2="380" y2="220" stroke="url(#rail)" strokeWidth="1" strokeDasharray="2 4" />

        {/* Dashboard preview box (right) */}
        <g>
          <rect x="370" y="170" width="76" height="100" rx="14" fill="white" stroke="#ECEAE2" strokeWidth="1.5" />
          <rect x="370" y="170" width="76" height="20" rx="14" fill="#FBFBF8" />
          <circle cx="378" cy="180" r="2" fill="#FB7185" />
          <circle cx="386" cy="180" r="2" fill="#FCD34D" />
          <circle cx="394" cy="180" r="2" fill="#34D399" />
          <rect x="376" y="200" width="64" height="6" rx="2" fill="#E8EEDF" />
          <rect x="376" y="212" width="44" height="6" rx="2" fill="#F4E9D6" />
          <rect x="376" y="224" width="54" height="6" rx="2" fill="#ECEAE2" />
          <rect x="376" y="240" width="64" height="22" rx="6" fill="#FBFBF8" stroke="#ECEAE2" />
          <text x="408" y="254" fill="#3F5736" fontFamily="Newsreader, Georgia, serif" fontSize="9" textAnchor="middle" fontStyle="italic">today</text>
        </g>

        {/* Animated packets */}
        {packets.map((p, i) => (
          <rect key={i} x={p.x} y={p.y - 4} width="18" height="8" rx="2.5"
            fill={p.color} opacity={p.alpha * 0.85} filter="url(#soft-glow)" />
        ))}

        {/* Output packets from collector to dashboard */}
        {[0, 1, 2, 3].map(i => {
          const phase = ((tick * 1.6 + i * 60) % 240) / 240;
          const x = 260 + phase * 110;
          const alpha = phase < 0.06 ? phase * 16 : phase > 0.94 ? (1 - phase) * 16 : 1;
          return <rect key={"o" + i} x={x} y="216" width="22" height="8" rx="2.5" fill="#6F8B5E" opacity={alpha * 0.9} filter="url(#soft-glow)" />;
        })}

        {/* Footer caption */}
        <text x="230" y="500" fill="#7A776F" fontFamily="Newsreader, Georgia, serif" fontSize="13" fontStyle="italic" textAnchor="middle">每个 Stop hook → 30s 内出现在仪表盘</text>
      </svg>
    </div>
  );
}

/* ====================================================================
   PROBLEM — 4 cards stating what leaders can't see today
   ==================================================================== */
function PitchProblem() {
  return (
    <section className="pitch" id="problem">
      <div className="wrap">
        <div className="section-head">
          <span className="eyebrow"><span className="dot"></span>问题</span>
          <h2>
            团队领导每天问 4 个问题<br />
            <em>没有一个能在 10 秒内答上来</em>。
          </h2>
          <p className="lead">
            Slack、Jira、GitHub、财务报表 —— 四个工具凑出来的图都是滞后的、片面的、需要自己拼。
            Matrix·Riven 的前提是：你团队最丰富的真相早就被记录在 Claude Code 的 transcript 里了，只是没人在用它。
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }} className="problem-grid">
          {window.DEMO.problems.map((p, i) => (
            <div key={i} className="card hover-lift" style={{ padding: "24px 22px" }}>
              <div className="serif" style={{
                fontSize: 28, color: "var(--accent-ink)", fontWeight: 500, marginBottom: 14,
                width: 42, height: 42, borderRadius: 12,
                background: "var(--accent-soft)",
                display: "grid", placeItems: "center"
              }}>{p.glyph}</div>
              <h3 className="serif" style={{ fontFamily: "Newsreader, Georgia, serif", fontWeight: 400, fontSize: 19, lineHeight: 1.25, letterSpacing: "-0.01em" }}>
                {p.title}
              </h3>
              <p style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.6, color: "var(--ink-2)" }}>{p.copy}</p>
            </div>
          ))}
        </div>
        <style>{`
          @media (max-width: 1000px) { .problem-grid { grid-template-columns: 1fr 1fr !important; } }
          @media (max-width: 540px) { .problem-grid { grid-template-columns: 1fr !important; } }
        `}</style>
      </div>
    </section>
  );
}

/* ====================================================================
   PRODUCT — Live product preview with slide-over
   ==================================================================== */
function PitchProduct({ openSlideover }) {
  return (
    <section className="pitch" id="product">
      <div className="wrap">
        <div className="section-head">
          <span className="eyebrow"><span className="dot"></span>产品</span>
          <h2>
            领导每天 30 秒，就<br />
            <em>读完团队当天的工程节奏</em>。
          </h2>
          <p className="lead">
            下方是 Matrix·Riven 真实看板的截图级嵌入 —— 不是设计稿，<strong style={{ color: "var(--ink-1)", fontWeight: 500 }}>布局、文案、配色、组件都直接来自仓库源码</strong>。
            点 attention 行或任意一张成员 tile，会从右侧滑出 520px 详情抽屉。
          </p>
        </div>

        <div className="product-frame">
          <div className="product-frame-chrome">
            <span className="product-frame-dot r"></span>
            <span className="product-frame-dot y"></span>
            <span className="product-frame-dot g"></span>
            <div className="product-frame-url">https://collector.riven.internal:8443/overview</div>
            <span className="pill sage mono">v0.2.x · live</span>
          </div>
          <div className="product-frame-body">
            <ProductPreview onOpen={openSlideover} />
          </div>
        </div>

        <div style={{
          marginTop: 18,
          display: "flex", gap: 24, flexWrap: "wrap",
          fontSize: 12.5, color: "var(--ink-3)"
        }}>
          <span>↗ 点击 Attention 行 / 成员卡 → 详情抽屉</span>
          <span>↗ 每行 LLM 改写均出自 T2-T4 prompt</span>
          <span>↗ 30 秒 ETag 增量刷新</span>
        </div>
      </div>
    </section>
  );
}

window.PitchHero = PitchHero;
window.PitchProblem = PitchProblem;
window.PitchProduct = PitchProduct;
