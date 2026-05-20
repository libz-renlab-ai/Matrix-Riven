/* Pitch site — editorial sections, part C
   Moat · Numbers · Roadmap · CTA · Footer · Slideover (shared)
*/

const { useState: cUseState, useEffect: cUseEffect } = React;

/* ====================================================================
   10. MOAT — 2-col editorial grid
   ==================================================================== */
function PitchMoat() {
  return (
    <section className="pitch" id="moat">
      <div className="wrap">
        <div className="section-head">
          <span className="eyebrow">chapter ix. · why this is hard</span>
          <h2 style={{ marginTop: 24 }}>
            竞品要追上来 ——<br />
            <em>不只是抄一份 UI 的事</em>。
          </h2>
          <p className="lead">
            6 个不易复现的工程取舍。每一条都是花了若干 launch-audit round 才落地的实际工程纪律 ——
            既是产品力，也是把买家留下来的开关。
          </p>
        </div>

        <div className="moat-list">
          {window.DEMO.moat.map((m, i) => (
            <div key={i} className="moat-cell reveal-up" style={{ "--delay": (i * 60) + "ms" }}>
              <div className="moat-h serif" dangerouslySetInnerHTML={{ __html: m.title }}></div>
              <div className="moat-body">{m.body}</div>
              <div className="moat-proof">↪ {m.proof}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ====================================================================
   11. NUMBERS — 4 big + 4 supporting
   ==================================================================== */
function PitchNumbers() {
  return (
    <section className="pitch" id="numbers">
      <div className="wrap">
        <div className="section-head">
          <span className="eyebrow">chapter x. · in numbers</span>
          <h2 style={{ marginTop: 24 }}>
            没有营销话术 ——<br />
            每一个数都能在 <em>仓库</em> 里找到出处。
          </h2>
        </div>

        <div className="numbers-feature">
          {window.DEMO.featureNumbers.map((n, i) => (
            <FeatureNumber key={i} n={n} idx={i} />
          ))}
        </div>

        <div className="numbers-side">
          {window.DEMO.sideNumbers.map((n, i) => (
            <SideNumber key={i} n={n} idx={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ====================================================================
   12. ROADMAP — editorial vertical list
   ==================================================================== */
function PitchRoadmap() {
  return (
    <section className="pitch" id="roadmap">
      <div className="wrap">
        <div className="section-head">
          <span className="eyebrow">chapter xi. · roadmap</span>
          <h2 style={{ marginTop: 24 }}>
            已发布的、<br />
            正在发的、<em>要发的</em>。
          </h2>
          <p className="lead">
            v0.2.x 已经稳定跑在内部多个团队上。下一个 minor 聚焦合规化（audit-log）与推送渠道。
            v0.4 开始才碰多组织、OKR 联动、自适应阈值这些大题目。
          </p>
        </div>

        <div className="roadmap-list">
          {window.DEMO.roadmap.map((phase, i) => (
            <div key={i} className={"roadmap-row reveal-up " + phase.cls} style={{ "--delay": (i * 100) + "ms" }}>
              <div className="rm-when">
                {phase.phase}
                <span className="rm-when-lbl serif">{phase.lbl}</span>
              </div>
              <div className="rm-items">
                {phase.items.map((item, j) => (
                  <div key={j} className="rm-item">
                    <span className="rm-mark">{i === 0 ? "✓" : i === 1 ? "▸" : "·"}</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ====================================================================
   13. CTA — minimal close
   ==================================================================== */
function PitchCta() {
  return (
    <section className="pitch tight" id="cta">
      <div className="wrap-narrow">
        <div className="cta-stage reveal-up">
          <span className="eyebrow sage">get on it</span>
          <h2 className="serif" style={{ fontSize: "clamp(36px, 5vw, 64px)" }}>
            5 分钟接入你的团队 ——<br />
            <em className="shimmer">看 30 秒内出现的第一行数据</em>。
          </h2>
          <p style={{
            fontFamily: "Newsreader, Georgia, serif",
            fontSize: 18, color: "var(--ink-2)",
            lineHeight: 1.65, maxWidth: 580, margin: "0 auto"
          }}>
            装好 Claude Code hook，配 collector 地址，剩下的它自己跑。
            想先看演示也行 —— 上方的产品 frame 是真实 demo dataset。
          </p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", marginTop: 40, flexWrap: "wrap" }}>
            <a className="btn primary magnetic" href="https://github.com/libz-renlab-ai/Matrix-Riven" target="_blank" rel="noopener">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5a12 12 0 00-3.79 23.4c.6.1.82-.26.82-.58v-2c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.1-.75.08-.74.08-.74 1.21.09 1.85 1.25 1.85 1.25 1.08 1.84 2.83 1.31 3.52 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.46-1.33-5.46-5.93 0-1.31.47-2.38 1.24-3.22-.13-.31-.54-1.53.12-3.18 0 0 1.01-.32 3.31 1.23a11.5 11.5 0 016 0c2.3-1.55 3.31-1.23 3.31-1.23.66 1.65.25 2.87.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.47 5.92.43.37.82 1.1.82 2.22v3.29c0 .32.22.7.83.58A12 12 0 0012 .5z"/></svg>
              GitHub
            </a>
            <a className="btn magnetic" href="https://github.com/libz-renlab-ai/Matrix-Riven/blob/main/INSTALL.md" target="_blank" rel="noopener">看接入指南 →</a>
            <a className="btn ghost" href="#product">回看产品演示</a>
          </div>
        </div>
      </div>
    </section>
  );
}

/* FeatureNumber: count-up on entrance */
function FeatureNumber({ n, idx }) {
  const [ref, val] = window.MR.useCountUp(n.val, { duration: 1800, delay: idx * 120 });
  return (
    <div className="nf-cell" ref={ref}>
      <div className="nf-label">{n.label}</div>
      <div className="nf-num serif tnum">
        {val}{n.unit && <span className="unit">{n.unit}</span>}
      </div>
      <div className="nf-foot">{n.foot}</div>
    </div>
  );
}

function SideNumber({ n, idx }) {
  const [ref, val] = window.MR.useCountUp(n.val, { duration: 1400, delay: idx * 80 });
  return (
    <div className="ns-cell" ref={ref}>
      <div className="ns-label">{n.label}</div>
      <div className="ns-num serif tnum">{val}{n.unit && <span className="unit">{n.unit}</span>}</div>
      <div className="ns-foot">{n.foot}</div>
    </div>
  );
}

/* ====================================================================
   FOOTER
   ==================================================================== */
function PitchFooter() {
  return (
    <footer className="wrap">
      <div className="pitch-foot">
        <div className="ft-col">
          <h4>Matrix·Riven</h4>
          <p>
            一份团队工程节奏仪表盘。<br />
            从 TeamBrain monorepo 拆分而来，目标：把 Claude Code 会话变成<em style={{ fontStyle: "italic", color: "var(--accent-ink)" }}>可观测的工程节奏</em>。
          </p>
          <div className="mono" style={{ marginTop: 18, fontSize: 11.5, color: "var(--ink-3)" }}>v0.2.x · Apache-2.0</div>
        </div>
        <div className="ft-col">
          <h4>包</h4>
          <ul>
            <li>@matrix-riven/shared</li>
            <li>@matrix-riven/uploader-client</li>
            <li>@matrix-riven/collector-server</li>
          </ul>
        </div>
        <div className="ft-col">
          <h4>外联</h4>
          <ul>
            <li><a className="link" href="https://github.com/libz-renlab-ai/Matrix-Riven" target="_blank" rel="noopener">GitHub Repo</a></li>
            <li><a className="link" href="https://github.com/libz-renlab-ai/Matrix-Riven/blob/main/README.md" target="_blank" rel="noopener">README</a></li>
            <li><a className="link" href="https://github.com/libz-renlab-ai/Matrix-Riven/blob/main/INSTALL.md" target="_blank" rel="noopener">INSTALL.md</a></li>
          </ul>
        </div>
      </div>
    </footer>
  );
}

/* ====================================================================
   SLIDEOVER — shared drill-down for member/project
   ==================================================================== */
function Slideover({ so, onClose }) {
  cUseEffect(() => {
    if (!so) return;
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [so, onClose]);

  if (!so) {
    return (<>
      <div className="scrim" onClick={onClose}></div>
      <aside className="slideover"></aside>
    </>);
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
              <button className="btn sm sage">起草 Slack 开场 →</button>
              <button className="btn sm">加入下次 1:1 →</button>
              <button className="btn sm ghost">看证据</button>
            </div>
          )}

          <div className="so-h">本周快照</div>
          <div className="so-stats">
            {so.kind === "member" ? (<>
              <div className="so-stat"><div className="so-stat-num">{data.stats.rhythm}</div><div className="so-stat-label">本周节奏</div></div>
              <div className="so-stat"><div className="so-stat-num">{data.stats.focus}</div><div className="so-stat-label">焦点</div></div>
              <div className="so-stat"><div className="so-stat-num">{data.stats.state}</div><div className="so-stat-label">状态</div></div>
            </>) : (<>
              <div className="so-stat"><div className="so-stat-num">{data.stats.rhythm}</div><div className="so-stat-label">本周节奏</div></div>
              <div className="so-stat"><div className="so-stat-num">{data.stats.team}</div><div className="so-stat-label">团队规模</div></div>
              <div className="so-stat"><div className="so-stat-num">{data.stats.health}</div><div className="so-stat-label">整体健康</div></div>
            </>)}
          </div>

          {so.kind === "member" && data.usage && (
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8,
              marginTop: 10, padding: "12px 14px",
              background: "var(--surface-2)", borderRadius: 12
            }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 600 }} className="tnum">{data.usage.sessions}</div>
                <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>今日会话</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 600 }} className="tnum">{data.usage.tokens}</div>
                <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>今日 token</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 600 }} className="tnum">${data.usage.cost}</div>
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
window.PitchFooter = PitchFooter;
window.Slideover = Slideover;
