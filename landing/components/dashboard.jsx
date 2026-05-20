/* Embedded preview of the live v7 Spatial dashboard. Bilingual. */

const { useState: pdState, useEffect: pdEffect } = React;

const _t = (s) => window.tr(s);

function ProductPreview({ onOpen }) {
  return (
    <div style={{ padding: 24, minHeight: 600, background: "var(--bg)" }}>
      <PreviewHero />
      <PreviewKpis />
      <PreviewAttention onOpen={onOpen} />
      <PreviewMembers onOpen={onOpen} />
    </div>
  );
}

function PreviewHero() {
  const att = window.DEMO.attention.length;
  const ho = window.DEMO.kpis.highOutput.count;
  const d = new Date(window.DEMO.computedAt);
  const en = window.LANG === "en";
  const date = en
    ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "flex-end",
      gap: 24, padding: "8px 4px 24px"
    }}>
      <div>
        <h2 className="serif" style={{ fontSize: 26, lineHeight: 1.15 }}>
          {en ? (
            <>Today, the team has <em>{att} things you should look at</em>;<br />
            and <em>{ho}</em> {ho === 1 ? "person is" : "people are"} shipping fast.</>
          ) : (
            <>今天，团队有 <em>{att} 件事需要你留意</em>；<br />
            另外 <em>{ho} 位</em>正在高速产出。</>
          )}
        </h2>
        <div style={{ color: "var(--ink-3)", fontSize: 12.5, marginTop: 8 }}>
          {date} · {en ? "near-real-time, refreshes every 30s" : "每 30 秒近实时刷新"}
        </div>
        <div style={{
          marginTop: 12, padding: "12px 14px",
          background: "var(--surface)", borderLeft: "3px solid var(--accent-ink)",
          borderRadius: "var(--r-md)", boxShadow: "var(--shadow-1)", maxWidth: 540
        }}>
          {window.DEMO.llmBrief.map((l, i) => (
            <div key={i} className="serif" style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--ink-1)" }}>{_t(l)}</div>
          ))}
        </div>
      </div>
      <div style={{ textAlign: "right", color: "var(--ink-3)", fontSize: 12, lineHeight: 1.6 }}>
        <strong style={{ color: "var(--ink-1)", fontWeight: 500 }}>{window.DEMO.members.length}</strong> {en ? "members" : "位成员"} · <strong style={{ color: "var(--ink-1)", fontWeight: 500 }}>{window.DEMO.projects.length}</strong> {en ? "projects" : "个项目"}
      </div>
    </div>
  );
}

function PreviewKpis() {
  const k = window.DEMO.kpis;
  const en = window.LANG === "en";
  const cards = [
    { cls: "warn", glow: "#C8924B", label: en ? "Attention" : "需要关注", num: String(k.attention.value), unit: en ? "" : "项",
      trend: <span>{k.attention.deltaToday < 0 ? `↓${Math.abs(k.attention.deltaToday)} ${en ? "vs yesterday" : "较昨日"}` : (en ? "flat vs yesterday" : "与昨日持平")}</span>,
      path: "M0 14 Q 12 10, 20 12 T 40 8 T 64 4" },
    { cls: "good", glow: "#6F8B5E", label: en ? "High output" : "高产出", num: String(k.highOutput.count), unit: en ? "" : "人",
      trend: <><span style={{ color: "var(--accent-ink)" }}>↑{Math.round(k.highOutput.avgDeltaPct * 100)}%</span><span> {en ? "avg" : "平均"}</span></>,
      path: "M0 16 Q 12 14, 20 10 T 40 8 T 64 4" },
    { cls: "spend", glow: "#8A9AAA", label: en ? "Today $" : "今日消耗", num: `$${k.spend.todayUsd.toFixed(2)}`, unit: "",
      trend: <span>{en ? "actual cost" : "实际成本"}</span>,
      path: "M0 12 Q 12 14, 20 10 T 40 12 T 64 10" },
    { cls: "pace", glow: "#45433E", label: en ? "Pace" : "整体节奏", num: _t(k.pace.label), unit: "",
      trend: <span>↑{Math.round(k.pace.rhythmDelta * 100)}% {en ? "vs 7-day avg" : "对比 7 日均值"}</span>,
      path: "M0 12 Q 12 11, 20 13 T 40 11 T 64 12" }
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 22 }} className="prv-kpis">
      {cards.map((c, i) => (
        <div key={i} className="card" style={{ padding: "16px 18px", position: "relative", overflow: "hidden" }}>
          <div style={{ fontSize: 11, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 500, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.glow }}></span>
            {c.label}
          </div>
          <div style={{ fontSize: 28, fontWeight: 500, letterSpacing: "-0.03em", color: "var(--ink-1)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
            {c.num}{c.unit && <span style={{ fontSize: 13, color: "var(--ink-3)", marginLeft: 4, fontWeight: 400 }}>{c.unit}</span>}
          </div>
          <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--ink-3)" }}>{c.trend}</div>
          <svg style={{ position: "absolute", right: 14, top: 14, width: 56, height: 20, opacity: .85 }} viewBox="0 0 64 22">
            <path d={c.path} stroke={c.glow} strokeWidth="1.5" fill="none" strokeLinecap="round" />
          </svg>
        </div>
      ))}
      <style>{`
        @media (max-width: 1100px) { .prv-kpis { grid-template-columns: repeat(2, 1fr) !important; } }
        @media (max-width: 600px) { .prv-kpis { grid-template-columns: 1fr !important; } }
      `}</style>
    </div>
  );
}

function PreviewAttention({ onOpen }) {
  const items = window.DEMO.attention;
  const en = window.LANG === "en";
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: "var(--ink-2)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10, padding: "0 4px", display: "flex", alignItems: "center", gap: 8 }}>
        {en ? "Needs your attention" : "需要你看一眼"}
        <span style={{ background: "var(--ink-5)", color: "var(--ink-2)", fontSize: 10.5, padding: "1px 6px", borderRadius: 999, fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>{items.length}</span>
      </div>
      <div style={{
        background: "var(--surface)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-2)",
        border: "1px solid rgba(200,146,75,.12)", overflow: "hidden"
      }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--hairline)", display: "flex", gap: 10, alignItems: "center", background: "linear-gradient(180deg, rgba(244,233,214,.45), transparent)" }}>
          <div style={{ width: 24, height: 24, borderRadius: 7, background: "var(--warn-soft)", color: "var(--warn)", display: "grid", placeItems: "center" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
          </div>
          <div className="serif" style={{ fontSize: 14.5, color: "var(--ink-1)", letterSpacing: "-0.01em" }}>
            {en ? (
              <><em style={{ fontStyle: "italic", color: "var(--warn)", fontWeight: 500 }}>{items.length} {items.length === 1 ? "thing" : "things"}</em> worth a look today.</>
            ) : (
              <>有 <em style={{ fontStyle: "italic", color: "var(--warn)", fontWeight: 500 }}>{items.length} 件事</em>值得你今天看一眼。</>
            )}
          </div>
        </div>
        {items.map((a, i) => {
          const soId = a.kind === "member" ? a.refId.split("@")[0] : a.refId;
          const tagBg = a.tagSeverity === "urgent" ? "var(--danger-soft)" : a.tagSeverity === "calm" ? "var(--calm-soft)" : "var(--warn-soft)";
          const tagColor = a.tagSeverity === "urgent" ? "#7E3F38" : a.tagSeverity === "calm" ? "#4F6175" : "#8C6228";
          return (
            <div key={i} onClick={() => onOpen(a.kind, soId)} style={{
              display: "grid", gridTemplateColumns: "34px 1fr auto auto", gap: 14, alignItems: "center",
              padding: "14px 20px",
              cursor: "pointer",
              borderBottom: i < items.length - 1 ? "1px solid var(--hairline)" : "none"
            }} onMouseEnter={e => e.currentTarget.style.background = "var(--surface-2)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <div className={"so-avatar " + a.avatarClass} style={{ width: 34, height: 34, fontSize: 12 }}>{a.initials}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, color: "var(--ink-1)", display: "flex", alignItems: "baseline", gap: 8, marginBottom: 3 }}>
                  <strong style={{ fontWeight: 600 }}>{a.displayName}</strong>
                  <span style={{ fontSize: 10.5, padding: "2px 7px", borderRadius: 999, background: tagBg, color: tagColor, fontWeight: 500 }}>{_t(a.tag)}</span>
                </div>
                <div className="serif" style={{ fontSize: 12.5, color: "var(--ink-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{_t(a.llmRewrite)}</div>
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{_t(a.time)}</div>
              <div style={{ color: "var(--ink-4)" }}>›</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PreviewMembers({ onOpen }) {
  const en = window.LANG === "en";
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 500, color: "var(--ink-2)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10, padding: "0 4px", display: "flex", alignItems: "center", gap: 8 }}>
        {en ? "Team" : "团队"}
        <span style={{ background: "var(--ink-5)", color: "var(--ink-2)", fontSize: 10.5, padding: "1px 6px", borderRadius: 999, fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>{window.DEMO.members.length}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }} className="prv-members">
        {window.DEMO.members.map(m => <PreviewMemberTile key={m.email} m={m} onOpen={onOpen} />)}
      </div>
      <style>{`
        @media (max-width: 900px) { .prv-members { grid-template-columns: repeat(2, 1fr) !important; } }
        @media (max-width: 500px) { .prv-members { grid-template-columns: 1fr !important; } }
      `}</style>
    </div>
  );
}

function PreviewMemberTile({ m, onOpen }) {
  const local = m.email.split("@")[0];
  const en = window.LANG === "en";
  const sparkColor = m.status === "idle" ? "#C8924B" : "#6F8B5E";
  const path = window.MR.sparkFromTrend(m.trend7d);
  const dotColor = window.MR.healthDotColor(m.health);
  const sub = m.deltaVs7dAvgPct > 0.2
    ? (en ? `High output ↑${Math.round(m.deltaVs7dAvgPct * 100)}%` : `高产出 ↑${Math.round(m.deltaVs7dAvgPct * 100)}%`)
    : m.stateBadge === "low_activity"
    ? (en ? "Low activity" : "本周参与不多")
    : (en ? `${m.today.sessions} sessions` : `${m.today.sessions} 会话`);

  return (
    <div className="card hover-lift" style={{ padding: "16px 16px 14px", cursor: "pointer", position: "relative" }}
      onClick={() => onOpen("member", local)}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div className={"so-avatar " + m.avatarClass} style={{ width: 34, height: 34, fontSize: 12, position: "relative" }}>
          {m.initials}
          <span style={{
            position: "absolute", bottom: -1, right: -1,
            width: 10, height: 10, borderRadius: "50%",
            border: "2.5px solid var(--surface)",
            background: m.status === "active" ? "var(--accent)" : m.status === "idle" ? "var(--ink-4)" : "var(--warn)"
          }}></span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink-1)" }}>{m.displayName}</div>
          <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>{sub}</div>
        </div>
        <div title={_t(window.MR.healthLabel(m.health))} style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor }}></div>
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-2)", marginBottom: 12 }}>
        <div style={{ color: "var(--ink-4)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>{en ? "On" : "在做"}</div>
        <div style={{ color: "var(--ink-1)", fontWeight: 500, marginTop: 2 }}>{m.topProject}</div>
      </div>
      <div style={{
        paddingTop: 10, borderTop: "1px solid var(--hairline)",
        fontFamily: "Newsreader, Georgia, serif", color: "var(--ink-2)",
        fontSize: 12.5, lineHeight: 1.5
      }}>
        <div>{_t(m.llmWeekly[0])}</div>
        <div style={{ color: "var(--ink-3)", fontSize: 11.5 }}>{_t(m.llmWeekly[1])}</div>
      </div>
      <svg style={{ position: "absolute", top: 16, right: 16, width: 44, height: 14, opacity: .7 }} viewBox="0 0 48 16">
        <path d={path} stroke={sparkColor} strokeWidth="1.2" fill="none" strokeLinecap="round" />
      </svg>
    </div>
  );
}

window.ProductPreview = ProductPreview;
