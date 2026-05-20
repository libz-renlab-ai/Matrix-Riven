/* Pitch site — Moat + Numbers + Roadmap + CTA + Slideover (shared) */

const { useState: cUseState, useEffect: cUseEffect } = React;

/* ====================================================================
   MOAT — why this is hard to copy
   ==================================================================== */
function PitchMoat() {
  return (
    <section className="pitch" id="moat">
      <div className="wrap">
        <div className="section-head">
          <span className="eyebrow"><span className="dot"></span>护城河</span>
          <h2>
            竞品要追上来，<br />
            <em>不是抄一份 UI 的事</em>。
          </h2>
          <p className="lead">
            6 个不易复现的工程取舍。每一条都是花了若干个 launch-audit round 才落地的实际工程纪律 ——
            既是产品力，也是把买家留下来不切走的开关。
          </p>
        </div>

        <div className="moat-grid">
          {window.DEMO.moat.map((m, i) => (
            <div key={i} className="moat-card hover-lift">
              <h3 dangerouslySetInnerHTML={{ __html: m.title }}></h3>
              <div className="moat-body">{m.body}</div>
              <div className="moat-proof">{m.proof}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ====================================================================
   NUMBERS — 8 hard stats
   ==================================================================== */
function PitchNumbers() {
  return (
    <section className="pitch tight" id="numbers">
      <div className="wrap">
        <div className="section-head">
          <span className="eyebrow"><span className="dot"></span>数字</span>
          <h2>
            没有营销话术 —— <br />
            <em>每一个数都能在仓库里找到出处</em>。
          </h2>
        </div>

        <div className="numbers-grid">
          {window.DEMO.numbers.map((n, i) => (
            <div key={i} className="number-card">
              <div className="n-label">{n.label}</div>
              <div className="n-val tnum">{n.val}{n.unit && <span className="unit">{n.unit}</span>}</div>
              <div className="n-foot">{n.foot}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ====================================================================
   ROADMAP — what's already shipped vs. what's next
   ==================================================================== */
function PitchRoadmap() {
  return (
    <section className="pitch" id="roadmap">
      <div className="wrap">
        <div className="section-head">
          <span className="eyebrow"><span className="dot"></span>路线图</span>
          <h2>
            已发布的、<br />
            <em>正在发的、要发的</em>。
          </h2>
          <p className="lead">
            v0.2.x 已经稳定跑在内部多个团队上。下一个 minor 聚焦合规化（audit-log）+ 推送渠道。
            v0.4 开始才碰多组织、OKR 联动、自适应阈值这些大题目。
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }} className="roadmap-grid">
          {window.DEMO.roadmap.map((phase, i) => (
            <div key={i} className="card" style={{
              padding: 22,
              borderTop: `3px solid ${phase.color}`
            }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 14 }}>
                <span className="mono" style={{ fontSize: 11, color: phase.color, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>{phase.phase}</span>
                <span className="serif" style={{ fontFamily: "Newsreader, Georgia, serif", fontSize: 20, fontWeight: 500, color: "var(--ink-1)" }}>{phase.lbl}</span>
              </div>
              <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                {phase.items.map((item, j) => (
                  <li key={j} style={{ display: "flex", gap: 10, alignItems: "start", fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>
                    <span style={{ flexShrink: 0, color: phase.color, fontFamily: "JetBrains Mono, monospace", fontSize: 11, marginTop: 2 }}>
                      {i === 0 ? "✓" : i === 1 ? "▸" : "·"}
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <style>{`
          @media (max-width: 900px) { .roadmap-grid { grid-template-columns: 1fr !important; } }
        `}</style>
      </div>
    </section>
  );
}

/* ====================================================================
   CTA — final call
   ==================================================================== */
function PitchCta() {
  return (
    <section className="pitch tight" id="cta">
      <div className="wrap">
        <div className="cta-stage">
          <span className="eyebrow"><span className="dot"></span>get started</span>
          <h2 className="serif" style={{ marginTop: 18, fontSize: "clamp(28px, 4vw, 44px)", maxWidth: 760, marginInline: "auto" }}>
            5 分钟接入你的团队<br />
            <em>看 30 秒内出现的第一行数据</em>。
          </h2>
          <p className="lead" style={{ marginInline: "auto", marginTop: 18, textAlign: "center" }}>
            装好 Claude Code hook，配 collector 地址，剩下的它自己跑。
            想先看演示也行 —— 上方的产品 frame 是真实 demo dataset。
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 28, flexWrap: "wrap" }}>
            <a className="btn primary" href="https://github.com/libz-renlab-ai/Matrix-Riven" target="_blank" rel="noopener">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5a12 12 0 00-3.79 23.4c.6.1.82-.26.82-.58v-2c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.1-.75.08-.74.08-.74 1.21.09 1.85 1.25 1.85 1.25 1.08 1.84 2.83 1.31 3.52 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.46-1.33-5.46-5.93 0-1.31.47-2.38 1.24-3.22-.13-.31-.54-1.53.12-3.18 0 0 1.01-.32 3.31 1.23a11.5 11.5 0 016 0c2.3-1.55 3.31-1.23 3.31-1.23.66 1.65.25 2.87.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.47 5.92.43.37.82 1.1.82 2.22v3.29c0 .32.22.7.83.58A12 12 0 0012 .5z"/></svg>
              GitHub
            </a>
            <a className="btn" href="https://github.com/libz-renlab-ai/Matrix-Riven/blob/main/INSTALL.md" target="_blank" rel="noopener">看接入指南 (INSTALL.md) →</a>
            <a className="btn ghost" href="#product">回看产品演示</a>
          </div>

          <div style={{
            marginTop: 36, paddingTop: 24,
            borderTop: "1px solid var(--hairline)",
            display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12,
            color: "var(--ink-3)", fontSize: 12
          }}>
            <span className="mono">libz-renlab-ai / Matrix-Riven · v0.2.x</span>
            <span className="mono">视觉对齐自 packages/collector-server/src/leadership/views/_css.ts</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ====================================================================
   SLIDEOVER — shared (member / project drill-down)
   ==================================================================== */
function Slideover({ so, onClose }) {
  cUseEffect(() => {
    if (!so) return;
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [so, onClose]);

  if (!so) {
    return (
      <>
        <div className="scrim" onClick={onClose}></div>
        <aside className="slideover"></aside>
      </>
    );
  }

  let data, headerTitle, headerSub, avatarClass = "av-4", initials = "·";
  if (so.kind === "member") {
    const m = window.DEMO.members.find(x => x.email.split("@")[0] === so.id);
    if (!m) return null;
    data = window.DEMO.memberDetail[so.id];
    headerTitle = m.displayName;
    headerSub = m.email + " · " + (m.stateBadge === "stuck" ? "进展受阻" : m.stateBadge === "low_activity" ? "本周参与不多" : "活跃中");
    avatarClass = m.avatarClass;
    initials = m.initials;
  } else {
    const p = window.DEMO.projects.find(x => x.name === so.id);
    if (!p) return null;
    data = window.DEMO.projectDetail[so.id];
    headerTitle = p.name;
    headerSub = `${p.activeTodayCount}/${p.totalContributors} 人在做 · ${window.MR.etaLabel(p.etaDays)}`;
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
          <button className="so-close" onClick={onClose} aria-label="关闭">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="so-body">
          <div className="so-callout">
            <div style={{ flexShrink: 0, marginTop: 2, color: "var(--warn)" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
            </div>
            <div dangerouslySetInnerHTML={{ __html: data.callout }}></div>
          </div>

          {so.kind === "member" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 0 18px" }}>
              <button className="btn sm primary" style={{ borderRadius: 8 }}>起草 Slack 开场 →</button>
              <button className="btn sm" style={{ borderRadius: 8 }}>加入下次 1:1 →</button>
              <button className="btn sm ghost" style={{ borderRadius: 8 }}>看证据</button>
            </div>
          )}

          <div className="so-h">本周快照</div>
          <div className="so-stats">
            {so.kind === "member" ? (
              <>
                <div className="so-stat"><div className="so-stat-num">{data.stats.rhythm}</div><div className="so-stat-label">本周节奏</div></div>
                <div className="so-stat"><div className="so-stat-num">{data.stats.focus}</div><div className="so-stat-label">焦点</div></div>
                <div className="so-stat"><div className="so-stat-num">{data.stats.state}</div><div className="so-stat-label">状态</div></div>
              </>
            ) : (
              <>
                <div className="so-stat"><div className="so-stat-num">{data.stats.rhythm}</div><div className="so-stat-label">本周节奏</div></div>
                <div className="so-stat"><div className="so-stat-num">{data.stats.team}</div><div className="so-stat-label">团队规模</div></div>
                <div className="so-stat"><div className="so-stat-num">{data.stats.health}</div><div className="so-stat-label">整体健康</div></div>
              </>
            )}
          </div>

          {so.kind === "member" && data.usage && (
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8,
              marginTop: 10, padding: "12px 14px",
              background: "var(--surface-2)", borderRadius: "var(--r-md)"
            }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{data.usage.sessions}</div>
                <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>今日会话</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{data.usage.tokens}</div>
                <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>今日 token</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>${data.usage.cost}</div>
                <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>今日消耗</div>
              </div>
            </div>
          )}

          <div className="so-h">{so.kind === "member" ? "近期会话主题" : "近期里程碑"}</div>
          <div className="so-evolve">
            {(data.evolve || []).map((row, i) => (
              <div key={i} className={"so-evolve-item" + (i === 0 ? " latest" : "")}>
                <div className="so-evolve-time mono">{row.ts}</div>
                <div className="so-evolve-text serif">
                  {row.topic ? <>📝 {row.topic} · <span style={{ color: "var(--ink-3)" }}>{row.len} 字符</span></> : row.note}
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}

window.PitchMoat = PitchMoat;
window.PitchNumbers = PitchNumbers;
window.PitchRoadmap = PitchRoadmap;
window.PitchCta = PitchCta;
window.Slideover = Slideover;
