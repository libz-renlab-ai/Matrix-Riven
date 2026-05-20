/* VC short-pitch page — concise, visual, outcome-focused. */

const { useState: vUseState, useEffect: vUseEffect, useRef: vUseRef } = React;

/* ────────────────────────────────────────────────────────────
   Mini visualisations for the hero + showcase gallery
   ──────────────────────────────────────────────────────────── */

function MiniDashboardHero() {
  return (
    <div className="mini-frame">
      <div className="mini-frame-chrome">
        <span className="dot r"></span><span className="dot y"></span><span className="dot g"></span>
        <span className="url">collector.riven.internal/overview</span>
      </div>
      <div className="hero-mini-body">
        {/* Small T5 brief */}
        <div style={{
          padding: "12px 14px",
          background: "var(--surface)",
          borderLeft: "3px solid var(--accent-ink)",
          borderRadius: 10,
          boxShadow: "var(--shadow-1)"
        }}>
          <div style={{ fontSize: 9.5, fontFamily: "JetBrains Mono, monospace", color: "var(--ink-3)", letterSpacing: "0.08em", textTransform: "uppercase" }}>T5 · 领导日报</div>
          <div className="serif" style={{ fontSize: 13, lineHeight: 1.55, marginTop: 6, color: "var(--ink-1)" }}>
            今日团队推进顺利：核心 dashboard 模块已上线，CI 全绿。<br />
            一名工程师在 status/page.tsx 受阻 2 天，建议安排结对排查。
          </div>
        </div>
        {/* KPI mini */}
        <MiniKpis />
        {/* attention */}
        <MiniAttention />
      </div>
    </div>
  );
}

function MiniKpis() {
  const cards = [
    { lbl: "需要关注", num: "2", unit: "项", dot: "var(--warn)", path: "M0 12 Q 8 8, 14 10 T 28 6 T 44 3" },
    { lbl: "高产出",   num: "2", unit: "人", dot: "var(--accent)", path: "M0 13 Q 8 11, 14 8 T 28 6 T 44 3" },
    { lbl: "今日 $",   num: "$4.32", unit: "", dot: "var(--calm)", path: "M0 10 Q 8 11, 14 8 T 28 10 T 44 9" },
    { lbl: "整体节奏", num: "稳",   unit: "", dot: "var(--ink-2)", path: "M0 10 Q 8 10, 14 11 T 28 9 T 44 10" }
  ];
  return (
    <div className="kmini">
      {cards.map((c, i) => (
        <div key={i} className="kmini-cell">
          <div className="kmini-label"><span className="kmini-dot" style={{ background: c.dot }}></span>{c.lbl}</div>
          <div className="kmini-num">{c.num}{c.unit && <span className="unit">{c.unit}</span>}</div>
          <svg className="kmini-spark" viewBox="0 0 44 16"><path d={c.path} stroke={c.dot} strokeWidth="1.3" fill="none" strokeLinecap="round" /></svg>
        </div>
      ))}
    </div>
  );
}

function MiniAttention() {
  const items = window.DEMO.attention;
  return (
    <div className="amini">
      <div className="amini-head">
        <div style={{ width: 18, height: 18, borderRadius: 6, background: "var(--warn-soft)", color: "var(--warn)", display: "grid", placeItems: "center", flexShrink: 0 }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
        </div>
        <span>有 <em>{items.length} 件事</em>值得你今天看一眼。</span>
      </div>
      {items.map((a, i) => (
        <div key={i} className="amini-row">
          <div className={"amini-av " + a.avatarClass}>{a.initials}</div>
          <div className="amini-body">
            <div className="nm">{a.displayName}<span className="tag" style={{
              background: a.tagSeverity === "calm" ? "var(--calm-soft)" : a.tagSeverity === "urgent" ? "var(--danger-soft)" : "var(--warn-soft)",
              color: a.tagSeverity === "calm" ? "#4F6175" : a.tagSeverity === "urgent" ? "#7E3F38" : "#8C6228"
            }}>{a.tag}</span></div>
            <div className="line2">{a.llmRewrite}</div>
          </div>
          <div className="amini-time">{a.time}</div>
        </div>
      ))}
    </div>
  );
}

function MiniMembers() {
  return (
    <div className="mmini">
      {window.DEMO.members.map(m => {
        const path = window.MR.sparkFromTrend(m.trend7d, 32, 11);
        const sparkColor = m.status === "idle" ? "#C8924B" : "#6F8B5E";
        return (
          <div key={m.email} className="mmini-tile">
            <div className="mmini-row1">
              <div className={"mmini-av " + m.avatarClass}>{m.initials}<span className={"stat " + m.status}></span></div>
              <div>
                <div className="mmini-name">{m.displayName}</div>
                <div className="mmini-sub">{m.today.sessions || "—"} 会话</div>
              </div>
            </div>
            <div className="mmini-narrative">
              <div>{m.llmWeekly[0]}</div>
              <div className="l2">{m.llmWeekly[1]}</div>
            </div>
            <svg className="mmini-spark" viewBox="0 0 32 11"><path d={path} stroke={sparkColor} strokeWidth="1.1" fill="none" strokeLinecap="round" /></svg>
          </div>
        );
      })}
    </div>
  );
}

function MiniSlideover() {
  const m = window.DEMO.members[1]; // blake
  const d = window.DEMO.memberDetail.blake;
  return (
    <div className="somini">
      <div className="somini-head">
        <div className={"somini-av " + m.avatarClass}>{m.initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="somini-name">{m.displayName}</div>
          <div className="somini-meta">{m.email} · 进展受阻</div>
        </div>
      </div>
      <div className="somini-body">
        <div className="somini-callout" dangerouslySetInnerHTML={{ __html: "💡 " + d.callout }}></div>
        <div className="somini-stats">
          <div className="somini-stat"><div className="somini-stat-num">{d.stats.rhythm}</div><div className="somini-stat-lbl">本周节奏</div></div>
          <div className="somini-stat"><div className="somini-stat-num">{d.stats.focus}</div><div className="somini-stat-lbl">焦点</div></div>
          <div className="somini-stat"><div className="somini-stat-num">{d.stats.state}</div><div className="somini-stat-lbl">状态</div></div>
        </div>
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8,
          marginTop: 10, padding: "10px 12px",
          background: "var(--surface-2)", borderRadius: 10
        }}>
          {[
            { v: d.usage.sessions, l: "会话" },
            { v: d.usage.tokens, l: "token" },
            { v: "$" + d.usage.cost, l: "今日 $" }
          ].map((s, i) => (
            <div key={i} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 600 }} className="tnum">{s.v}</div>
              <div style={{ fontSize: 9.5, color: "var(--ink-3)", marginTop: 2 }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MiniFlow() {
  const steps = window.DEMO.flowSteps;
  const [active, setActive] = vUseState(0);
  vUseEffect(() => {
    const t = setInterval(() => setActive(a => (a + 1) % steps.length), 1800);
    return () => clearInterval(t);
  }, [steps.length]);

  return (
    <div style={{
      background: "var(--surface)", borderRadius: 14, padding: 16,
      border: "1px solid var(--hairline)"
    }}>
      <div style={{ position: "relative", marginBottom: 14, paddingTop: 4 }}>
        <div style={{ position: "absolute", top: 14, left: "4%", right: "4%", height: 2, background: "var(--hairline)", borderRadius: 2 }} />
        <div style={{
          position: "absolute", top: 14, left: "4%",
          width: `${(active / (steps.length - 1)) * 92}%`,
          height: 2, background: "var(--accent)", borderRadius: 2,
          transition: "width .8s var(--ease)"
        }} />
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${steps.length}, 1fr)` }}>
          {steps.map((s, i) => (
            <div key={s.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%",
                background: i <= active ? "var(--accent)" : "var(--surface-2)",
                border: i <= active ? "2px solid var(--accent)" : "2px solid var(--hairline)",
                color: i <= active ? "white" : "var(--ink-3)",
                display: "grid", placeItems: "center",
                fontFamily: "JetBrains Mono, monospace", fontSize: 11, fontWeight: 700,
                transition: "all .35s var(--spring)",
                boxShadow: i === active ? "0 0 0 5px var(--accent-soft)" : "none"
              }}>{i + 1}</div>
              <div style={{ fontSize: 9.5, fontFamily: "JetBrains Mono, monospace", color: i === active ? "var(--ink-1)" : "var(--ink-4)", letterSpacing: "0.04em" }}>{s.key}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="serif" style={{ fontSize: 16, color: "var(--ink-1)", fontWeight: 500, marginTop: 6 }}>{steps[active].title}</div>
      <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>{steps[active].sub}</div>
      <div style={{ display: "flex", gap: 18, marginTop: 14 }}>
        {steps[active].metrics.map(([k, v], i) => (
          <div key={i}>
            <div className="serif" style={{ fontSize: 22, color: "var(--accent-ink)", fontWeight: 400, letterSpacing: "-0.02em" }}>{k}</div>
            <div className="mono" style={{ fontSize: 10, color: "var(--ink-3)", marginTop: 2, letterSpacing: "0.04em", textTransform: "uppercase" }}>{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   PAGE
   ──────────────────────────────────────────────────────────── */

function VcApp() {
  vUseEffect(() => { window.MR.installRevealObserver(); }, []);
  vUseEffect(() => {
    // Magnetic
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

      {/* HERO */}
      <section className="vc-hero">
        <div className="wrap">
          <div className="vc-hero-grid">
            <div>
              <span className="eyebrow sage reveal-up">matrix·riven · v0.2 · ai-native engineering leadership</span>
              <h1 style={{ marginTop: 28 }}>
                <span className="line"><span>看见团队的</span></span><br />
                <span className="line"><span>Claude Code 时刻 ——</span></span><br />
                <span className="line"><span><em className="shimmer">在它结束的 30 秒内</em>。</span></span>
              </h1>
              <p className="vc-tagline reveal-up" style={{ "--delay": "320ms" }}>
                每位开发者每天和 AI 进行成百上千次工程会话。
                Matrix·Riven 把这些 transcript 在源头脱敏后汇聚 —— 跑 16 个信号检测器 + 5 层 LLM 叙事 ——
                让团队领导第一次<em>真正看见</em>工程在发生什么。
              </p>
              <div className="vc-cta-row reveal-up" style={{ "--delay": "460ms" }}>
                <a className="btn primary magnetic" href="detail.html">看完整介绍 →</a>
                <a className="btn magnetic" href="https://github.com/libz-renlab-ai/Matrix-Riven" target="_blank" rel="noopener">GitHub ↗</a>
              </div>
              <div className="vc-meta-row reveal-up" style={{ "--delay": "600ms" }}>
                <span className="pip">已在 12 个团队上线</span>
                <span>·</span>
                <span>v0.2.x · TypeScript 93.6%</span>
                <span>·</span>
                <span>Apache-2.0</span>
              </div>
            </div>
            <div className="reveal-scale" style={{ "--delay": "200ms" }}>
              <MiniDashboardHero />
            </div>
          </div>
        </div>
      </section>

      {/* IN THE DASHBOARD — visual showcase 2x2 */}
      <section className="pitch" id="dashboard-views">
        <div className="wrap">
          <div className="vc-head">
            <h2 className="reveal-up">
              一个仪表盘，<br /><em>四种回答领导问题的方式</em>。
            </h2>
            <div className="sub reveal-up" style={{ "--delay": "120ms" }}>每个视图都是同一份 30 秒鲜活数据的不同切面。下面是实际渲染。</div>
          </div>

          <div className="vc-gallery">
            <div className="vc-tile reveal-up" style={{ "--delay": "0ms" }}>
              <div className="vc-tile-eyebrow">view i. · daily brief + kpis</div>
              <h3 className="serif">3 行<em>领导日报</em>，4 张浮动 KPI。</h3>
              <p>翻开仪表盘就读到：今天发生了什么、什么需要看、明天聚焦哪。 KPI 卡按 30 秒滚动刷新，自带 7 日 sparkline 趋势。</p>
              <div className="mini-frame">
                <div className="mini-frame-chrome">
                  <span className="dot r"></span><span className="dot y"></span><span className="dot g"></span>
                  <span className="url">/overview</span>
                </div>
                <div className="mini-body">
                  <div style={{
                    padding: "10px 14px",
                    background: "var(--surface)",
                    borderLeft: "3px solid var(--accent-ink)",
                    borderRadius: 8
                  }}>
                    <div className="serif" style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-1)" }}>
                      今日团队推进顺利：核心 dashboard 模块已上线，CI 全绿。
                    </div>
                  </div>
                  <MiniKpis />
                </div>
              </div>
            </div>

            <div className="vc-gallery-row" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 20 }}>
              <div className="vc-tile reveal-up" style={{ "--delay": "120ms" }}>
                <div className="vc-tile-eyebrow">view ii. · attention</div>
                <h3 className="serif"><em>需要你看一眼</em>。</h3>
                <p>16 个检测器命中 + T4 改写：每条 attention 都是「结论 + 建议 + 出处」一行写完。</p>
                <MiniAttention />
              </div>

              <div className="vc-tile reveal-up" style={{ "--delay": "240ms" }}>
                <div className="vc-tile-eyebrow">view iii. · drill-down</div>
                <h3 className="serif">点开，<em>看到一个工程师的一周</em>。</h3>
                <p>520px 抽屉：T2 衬线短文 + 今日 token / $ 三联 + 近期会话主题。不渲染原文 —— 想看原文留 audit log。</p>
                <MiniSlideover />
              </div>
            </div>

            <div className="vc-tile reveal-up" style={{ "--delay": "360ms" }}>
              <div className="vc-tile-eyebrow">view iv. · members grid</div>
              <h3 className="serif">每位成员，<em>两行 T2 衬线</em>。</h3>
              <p>每张 tile 是 LLM T2 层的成员周 digest。状态点、健康灯、7 日 sparkline、最近活跃时间一并就位 —— 不是花瓶动效，每个像素都对应一个真问题的答案。</p>
              <MiniMembers />
            </div>

            <div className="vc-tile reveal-up" style={{ "--delay": "480ms" }}>
              <div className="vc-tile-eyebrow">view v. · 30s pipeline</div>
              <h3 className="serif">从 Stop hook 到看板，<em>6 步</em>。</h3>
              <p>每个开发者会话结束 30 秒内出现。带 PII 脱敏、gzip 压缩、ETag 缓存。</p>
              <MiniFlow />
            </div>
          </div>
        </div>
      </section>

      {/* OUTCOMES — what changes when you have it */}
      <section className="pitch" id="outcomes">
        <div className="wrap">
          <div className="vc-head">
            <h2 className="reveal-up">
              团队领导<br /><em>第一次能直接回答</em>。
            </h2>
            <div className="sub reveal-up" style={{ "--delay": "120ms" }}>三个真实场景 —— 从 1:1 之前到 PTO 排期，从周会到 OKR 复盘。</div>
          </div>

          <div className="vc-outcomes">
            <div className="vc-outcome reveal-up" style={{ "--delay": "0ms" }}>
              <div className="o-eyebrow">case · 1:1 之前</div>
              <h3 className="serif">早 2 小时<em>发现卡住</em>，结对当天就排上。</h3>
              <div className="o-body">
                Blake 在 status/page.tsx 反复尝试 useEffect 类型收敛已 2 天 —— 32% 工具失败率、4 次连续类型主题 prompt。
                T4 改写直接告诉你「建议结对排查」。你不用打开 4 个 tab 拼图。
              </div>
              <div className="o-metric">
                <div className="o-metric-val serif"><em>2h</em></div>
                <div className="o-metric-lbl">从信号到行动的时差</div>
              </div>
            </div>

            <div className="vc-outcome reveal-up" style={{ "--delay": "120ms" }}>
              <div className="o-eyebrow">case · 单点依赖预警</div>
              <h3 className="serif">CI 流水线<em>只剩 1 人独撑</em>，PTO 前补上接手人。</h3>
              <div className="o-body">
                devops-pipelines busFactor=true 已经 14 天。Attention 卡直接挂在 hero —— casey 下周休假前已经把第二位贡献者拉进来了。
                等出事再发现，是组织级风险。
              </div>
              <div className="o-metric">
                <div className="o-metric-val serif"><em>0</em></div>
                <div className="o-metric-lbl">事后救火事件 (过去 90 天)</div>
              </div>
            </div>

            <div className="vc-outcome reveal-up" style={{ "--delay": "240ms" }}>
              <div className="o-eyebrow">case · 周会重构</div>
              <h3 className="serif">从 60 分钟拉通会，<em>到 15 分钟看板对齐</em>。</h3>
              <div className="o-body">
                T3 项目周 digest + T5 领导日报开会前 30 秒读完。每个项目本周进展、阻塞、ETA 全部已经定稿。
                团队从汇报模式切到讨论模式。
              </div>
              <div className="o-metric">
                <div className="o-metric-val serif"><em>−75</em>%</div>
                <div className="o-metric-lbl">同步会时间</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TRACTION strip */}
      <section className="pitch tight" id="traction">
        <div className="wrap">
          <div className="vc-head">
            <h2 className="reveal-up">关键指标</h2>
            <div className="sub reveal-up" style={{ "--delay": "120ms" }}>每个数都能在仓库源码或运行实测里找到出处。</div>
          </div>
          <div className="vc-traction">
            <TractionCell val="12"     unit=""   label="teams connected" />
            <TractionCell val="18.4"   unit="k"  label="transcripts captured" />
            <TractionCell val="0.16"   unit="$"  label="avg llm cost / cycle" prefix="<" />
            <TractionCell val="30"     unit="s"  label="time to insight" />
          </div>
        </div>
      </section>

      {/* CTA — quiet */}
      <section className="pitch tight" id="cta">
        <div className="wrap-narrow">
          <div className="vc-cta-stage reveal-up">
            <span className="eyebrow sage">get on it</span>
            <h2 className="serif">
              5 分钟接入你的团队 ——<br />
              <em className="shimmer">看 30 秒内出现的第一行数据</em>。
            </h2>
            <p>
              新部署？看 INSTALL.md。先想感受产品？打开<a className="link" href="detail.html">完整介绍</a>，
              里面有 5 层 LLM 叙事、16 个检测器、6 步管线、6 条 PII 安全契约的全部细节。
            </p>
            <div className="vc-cta-actions">
              <a className="btn primary magnetic" href="https://github.com/libz-renlab-ai/Matrix-Riven" target="_blank" rel="noopener">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5a12 12 0 00-3.79 23.4c.6.1.82-.26.82-.58v-2c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.1-.75.08-.74.08-.74 1.21.09 1.85 1.25 1.85 1.25 1.08 1.84 2.83 1.31 3.52 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.46-1.33-5.46-5.93 0-1.31.47-2.38 1.24-3.22-.13-.31-.54-1.53.12-3.18 0 0 1.01-.32 3.31 1.23a11.5 11.5 0 016 0c2.3-1.55 3.31-1.23 3.31-1.23.66 1.65.25 2.87.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.47 5.92.43.37.82 1.1.82 2.22v3.29c0 .32.22.7.83.58A12 12 0 0012 .5z"/></svg>
                GitHub
              </a>
              <a className="btn magnetic" href="detail.html">完整介绍 →</a>
              <a className="btn ghost" href="#dashboard-views">回看产品</a>
            </div>
          </div>
        </div>
      </section>

      <footer className="wrap pitch-foot">
        <div className="ft-col">
          <h4>Matrix·Riven</h4>
          <p>团队工程节奏仪表盘。把 Claude Code 会话变成<em style={{ fontStyle: "italic", color: "var(--accent-ink)" }}>可观测的工程节奏</em>。</p>
          <div className="mono" style={{ marginTop: 18, fontSize: 11.5, color: "var(--ink-3)" }}>v0.2.x · Apache-2.0</div>
        </div>
        <div className="ft-col">
          <h4>资料</h4>
          <ul>
            <li><a className="link" href="detail.html">完整介绍（13 章）</a></li>
            <li><a className="link" href="https://github.com/libz-renlab-ai/Matrix-Riven/blob/main/README.md" target="_blank" rel="noopener">README</a></li>
            <li><a className="link" href="https://github.com/libz-renlab-ai/Matrix-Riven/blob/main/INSTALL.md" target="_blank" rel="noopener">INSTALL.md</a></li>
          </ul>
        </div>
        <div className="ft-col">
          <h4>外联</h4>
          <ul>
            <li><a className="link" href="https://github.com/libz-renlab-ai/Matrix-Riven" target="_blank" rel="noopener">GitHub Repo</a></li>
            <li>libz-renlab-ai / Matrix-Riven</li>
          </ul>
        </div>
      </footer>
    </>
  );
}

function VcNav() {
  return (
    <nav className="vc-nav fade-in">
      <a href="index.html" className="pitch-brand">
        <div className="pitch-brand-mark"></div>
        <span>Matrix·Riven</span>
      </a>
      <div className="vc-nav-meta">
        <span><span className="dot"></span>v0.2.x · 12 teams</span>
        <a className="link" href="detail.html">完整介绍</a>
      </div>
      <a className="nav-cta magnetic" href="https://github.com/libz-renlab-ai/Matrix-Riven" target="_blank" rel="noopener">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5a12 12 0 00-3.79 23.4c.6.1.82-.26.82-.58v-2c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.1-.75.08-.74.08-.74 1.21.09 1.85 1.25 1.85 1.25 1.08 1.84 2.83 1.31 3.52 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.46-1.33-5.46-5.93 0-1.31.47-2.38 1.24-3.22-.13-.31-.54-1.53.12-3.18 0 0 1.01-.32 3.31 1.23a11.5 11.5 0 016 0c2.3-1.55 3.31-1.23 3.31-1.23.66 1.65.25 2.87.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.47 5.92.43.37.82 1.1.82 2.22v3.29c0 .32.22.7.83.58A12 12 0 0012 .5z"/></svg>
        GitHub
      </a>
    </nav>
  );
}

function TractionCell({ val, unit, label, prefix }) {
  const [ref, displayed] = window.MR.useCountUp((prefix || "") + val + unit, { duration: 1600 });
  return (
    <div className="vc-traction-cell reveal-up" ref={ref}>
      <div className="vc-traction-num serif tnum">{displayed}</div>
      <div className="vc-traction-lbl">{label}</div>
    </div>
  );
}

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
    let tx = 0, ty = 0, cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    let raf = 0, running = false;
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
      const t = e.target && e.target.closest && e.target.closest("a, button, .vc-tile, .vc-outcome, .mini-frame, .vc-traction-cell");
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
