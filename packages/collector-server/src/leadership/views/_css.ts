/**
 * v7 Spatial design system — locked in spec §3.4.
 *
 * CSS variables, body styles, nav/hero/KPI/attention/members/projects/slideover
 * blocks copied verbatim from
 *   .superpowers/brainstorm/2613-1778952522/content/dashboard-redesign-v7-spatial.html
 * (P-B1). Do NOT alter values without updating that reference HTML first.
 *
 * Phase 1 legacy selectors (.lh-*) are appended at the end so existing
 * renderers (overview.html.ts, member-detail.html.ts, project-detail.html.ts)
 * keep working. They will be removed in P-B6 once those renderers migrate to
 * v7 selectors.
 */
export const LEADERSHIP_CSS_V2 = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;450;500;600;700&family=JetBrains+Mono:wght@400;500&family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap');

/* ===== v7 Spatial — verbatim from dashboard-redesign-v7-spatial.html ===== */

  /* ===== TOKENS ===== */
  :root {
    /* Background — warm, paper-like */
    --bg:         #F7F6F2;
    --bg-elev:   #FAFAF7;
    --surface:    #FFFFFF;
    --surface-2: #FBFBF8;

    /* Ink — gentle, not pure black */
    --ink-1:     #1C1B19;
    --ink-2:     #45433E;
    --ink-3:     #7A776F;
    --ink-4:     #A8A59C;
    --ink-5:     #D8D5CB;
    --hairline:  #ECEAE2;

    /* Single sage accent + muted status */
    --accent:    #6F8B5E;          /* sage */
    --accent-soft:#E8EEDF;
    --accent-ink:#3F5736;

    --warn:      #C8924B;          /* soft amber */
    --warn-soft: #F4E9D6;
    --danger:    #B0625A;          /* dusty terracotta */
    --danger-soft:#F1DCD7;
    --calm:      #8A9AAA;          /* soft slate */
    --calm-soft: #E5EBF0;

    /* Depth */
    --shadow-1:  0 1px 2px rgba(28,27,25,.04), 0 4px 16px rgba(28,27,25,.04);
    --shadow-2:  0 1px 3px rgba(28,27,25,.05), 0 12px 32px rgba(28,27,25,.06);
    --shadow-3:  0 2px 6px rgba(28,27,25,.06), 0 24px 64px rgba(28,27,25,.10);
    --shadow-lift: 0 1px 2px rgba(28,27,25,.04), 0 8px 28px rgba(28,27,25,.08);

    /* Radius */
    --r-sm: 10px;
    --r-md: 14px;
    --r-lg: 20px;
    --r-xl: 28px;

    /* Motion */
    --ease: cubic-bezier(.2,.7,.2,1);
    --spring: cubic-bezier(.34,1.56,.64,1);
  }

  /* ===== DARK THEME ===== */
  /* Activated by html[data-theme="dark"] (set by the nav toggle below).
   * Same token names, deeper inks; everything else (KPIs, sparklines,
   * tile backgrounds, hairlines) flips automatically through the
   * existing var(--ink-*) / var(--surface) consumers. */
  :root[data-theme="dark"] {
    --bg:         #0E0F11;
    --bg-elev:    #14161A;
    --surface:    #1A1D22;
    --surface-2:  #20242A;
    --ink-1:      #F2F0EA;
    --ink-2:      #C3C0B7;
    --ink-3:      #8C887E;
    --ink-4:      #66635A;
    --ink-5:      #3A3933;
    --hairline:   #2A2D33;
    --accent:     #95B47E;
    --accent-soft:#2A3520;
    --accent-ink: #B5D499;
    --warn:       #D9A56A;
    --warn-soft:  #3D2F18;
    --danger:     #C9756B;
    --danger-soft:#3A1F1B;
    --calm:       #98A7B7;
    --calm-soft:  #1E262E;
    --shadow-1:   0 1px 2px rgba(0,0,0,.4), 0 4px 16px rgba(0,0,0,.3);
    --shadow-2:   0 1px 3px rgba(0,0,0,.5), 0 12px 32px rgba(0,0,0,.4);
    --shadow-3:   0 2px 6px rgba(0,0,0,.5), 0 24px 64px rgba(0,0,0,.5);
    --shadow-lift:0 1px 2px rgba(0,0,0,.5), 0 8px 28px rgba(0,0,0,.5);
  }

  /* ===== RESET ===== */
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body {
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    background: var(--bg);
    color: var(--ink-1);
    font-size: 14px;
    line-height: 1.5;
    font-feature-settings: 'cv11', 'ss01', 'tnum';
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    letter-spacing: -0.005em;
  }

  /* Mesh background — extremely subtle warmth */
  body::before {
    content:'';
    position: fixed; inset: 0;
    background:
      radial-gradient(800px 600px at 10% -10%, rgba(111,139,94,.06), transparent 60%),
      radial-gradient(700px 500px at 100% 0%, rgba(200,146,75,.04), transparent 55%),
      radial-gradient(900px 700px at 50% 110%, rgba(138,154,170,.04), transparent 60%);
    pointer-events: none;
    z-index: 0;
  }

  ::selection { background: var(--accent-soft); color: var(--accent-ink); }

  .tnum { font-feature-settings: 'tnum'; font-variant-numeric: tabular-nums; }
  .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
  .serif { font-family: 'Newsreader', 'Iowan Old Style', Georgia, serif; font-feature-settings: normal; }

  /* ===== LAYOUT ===== */
  .shell {
    position: relative; z-index: 1;
    max-width: 1320px;
    margin: 0 auto;
    padding: 32px 40px 80px;
  }

  /* ===== TOP NAV — frosted bar ===== */
  .nav {
    position: sticky; top: 16px;
    z-index: 50;
    background: rgba(255,255,255,.72);
    backdrop-filter: blur(20px) saturate(180%);
    -webkit-backdrop-filter: blur(20px) saturate(180%);
    border: 1px solid rgba(255,255,255,.6);
    box-shadow: var(--shadow-1);
    border-radius: var(--r-xl);
    padding: 10px 20px 10px 22px;
    display: flex;
    align-items: center;
    gap: 28px;
    margin-bottom: 32px;
  }
  .brand {
    display: flex; align-items: center; gap: 10px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  .brand-mark {
    width: 22px; height: 22px;
    border-radius: 7px;
    background: linear-gradient(135deg, var(--accent), #97B080);
    box-shadow: 0 1px 2px rgba(111,139,94,.4), inset 0 -1px 0 rgba(0,0,0,.08);
  }
  .tabs {
    display: flex; align-items: center; gap: 4px;
    margin-left: 8px;
    flex: 1;
  }
  .tab {
    padding: 7px 14px;
    border-radius: 10px;
    color: var(--ink-3);
    font-weight: 450;
    font-size: 13.5px;
    cursor: pointer;
    transition: all .2s var(--ease);
    position: relative;
  }
  .tab:hover { color: var(--ink-1); background: rgba(28,27,25,.04); }
  .tab.active {
    color: var(--ink-1);
    background: rgba(28,27,25,.06);
    font-weight: 500;
  }
  .nav-meta {
    color: var(--ink-3);
    font-size: 12.5px;
    display: flex; align-items: center; gap: 14px;
  }
  .live-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 0 rgba(111,139,94,.5);
    animation: pulse 2.2s ease-in-out infinite;
  }
  @keyframes pulse {
    0%,100% { box-shadow: 0 0 0 0 rgba(111,139,94,.5); }
    50%     { box-shadow: 0 0 0 8px rgba(111,139,94,0);}
  }
  .avatar-me {
    width: 28px; height: 28px; border-radius: 50%;
    background: linear-gradient(135deg, #E8DCC8, #C8B7A0);
    color: #5C4A2E; font-size: 11.5px; font-weight: 600;
    display: grid; place-items: center;
    border: 1px solid rgba(255,255,255,.8);
    box-shadow: 0 1px 2px rgba(0,0,0,.06);
  }

  /* ===== EDITORIAL HEADER ===== */
  .hero {
    padding: 8px 4px 24px;
    display: flex; justify-content: space-between; align-items: flex-end;
    gap: 24px;
  }
  .hero h1 {
    font-family: 'Newsreader', Georgia, serif;
    font-weight: 400;
    font-size: 36px;
    line-height: 1.1;
    letter-spacing: -0.02em;
    color: var(--ink-1);
  }
  .hero h1 em {
    font-style: italic;
    color: var(--accent-ink);
  }
  .hero .sub {
    color: var(--ink-3);
    font-size: 13.5px;
    margin-top: 8px;
  }
  .hero-meta {
    text-align: right;
    color: var(--ink-3);
    font-size: 12.5px;
    line-height: 1.6;
  }
  .hero-meta strong { color: var(--ink-1); font-weight: 500; }

  /* ===== KPI ROW — soft floating pills ===== */
  .kpis {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 14px;
    margin-bottom: 28px;
  }
  .kpi {
    background: var(--surface);
    border-radius: var(--r-lg);
    padding: 20px 22px;
    box-shadow: var(--shadow-1);
    transition: transform .3s var(--ease), box-shadow .3s var(--ease);
    cursor: pointer;
    position: relative;
    overflow: hidden;
  }
  .kpi:hover { transform: translateY(-2px); box-shadow: var(--shadow-2); }
  .kpi-label {
    font-size: 11.5px;
    color: var(--ink-3);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 500;
    margin-bottom: 14px;
    display: flex; align-items: center; gap: 8px;
  }
  .kpi-dot { width: 6px; height: 6px; border-radius: 50%; }
  .kpi-warn .kpi-dot { background: var(--warn); }
  .kpi-good .kpi-dot { background: var(--accent); }
  .kpi-spend .kpi-dot { background: var(--calm); }
  .kpi-pace .kpi-dot { background: var(--ink-2); }
  .kpi-num {
    font-size: 36px;
    font-weight: 500;
    letter-spacing: -0.03em;
    line-height: 1;
    color: var(--ink-1);
  }
  .kpi-num .unit {
    font-size: 14px; color: var(--ink-3); font-weight: 400;
    margin-left: 4px;
  }
  .kpi-trend {
    margin-top: 12px;
    font-size: 12px;
    color: var(--ink-3);
    display: flex; align-items: center; gap: 6px;
  }
  .kpi-trend .up { color: var(--accent-ink); }
  .kpi-trend .down { color: var(--danger); }
  .kpi-spark {
    position: absolute;
    right: 18px; top: 18px;
    width: 64px; height: 22px;
    opacity: .85;
  }

  /* ===== SECTION HEAD ===== */
  .section { margin-bottom: 36px; }
  .section-head {
    display: flex; align-items: baseline; justify-content: space-between;
    margin-bottom: 14px;
    padding: 0 4px;
  }
  .section-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--ink-2);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    display: flex; align-items: center; gap: 10px;
  }
  .section-count {
    background: var(--ink-5);
    color: var(--ink-2);
    font-size: 11px;
    padding: 2px 7px;
    border-radius: 999px;
    font-weight: 500;
    letter-spacing: 0;
    text-transform: none;
  }
  .section-aside { color: var(--ink-3); font-size: 12px; }
  .section-aside a { color: var(--ink-2); text-decoration: none; border-bottom: 1px solid var(--ink-5); padding-bottom: 1px; }
  .section-aside a:hover { color: var(--ink-1); border-color: var(--ink-3); }

  /* ===== ATTENTION CARD — the editorial centerpiece ===== */
  .attention {
    background: var(--surface);
    border-radius: var(--r-xl);
    box-shadow: var(--shadow-2);
    overflow: hidden;
    border: 1px solid rgba(200,146,75,.12);
  }
  .attention-head {
    padding: 18px 24px 14px;
    border-bottom: 1px solid var(--hairline);
    display: flex; align-items: center; gap: 12px;
    background: linear-gradient(180deg, rgba(244,233,214,.45), transparent);
  }
  .attention-icon {
    width: 28px; height: 28px; border-radius: 9px;
    background: var(--warn-soft);
    color: var(--warn);
    display: grid; place-items: center;
    flex-shrink: 0;
  }
  .attention-headline {
    font-family: 'Newsreader', Georgia, serif;
    font-size: 17px;
    color: var(--ink-1);
    letter-spacing: -0.01em;
  }
  .attention-headline em { font-style: italic; color: var(--warn); font-weight: 500; }
  .attention-list { padding: 4px 0; }
  .att-row {
    display: grid;
    grid-template-columns: 38px 1fr auto auto;
    gap: 16px;
    align-items: center;
    padding: 16px 24px;
    cursor: pointer;
    border-bottom: 1px solid var(--hairline);
    transition: background .2s var(--ease);
  }
  .att-row:last-child { border-bottom: none; }
  .att-row:hover { background: var(--surface-2); }
  .att-avatar {
    width: 38px; height: 38px; border-radius: 50%;
    display: grid; place-items: center;
    font-size: 13px; font-weight: 600;
    color: white;
    box-shadow: inset 0 -1px 0 rgba(0,0,0,.1), 0 1px 2px rgba(0,0,0,.06);
  }
  .att-body { min-width: 0; }
  .att-line1 {
    font-size: 14px; color: var(--ink-1);
    display: flex; align-items: baseline; gap: 8px;
    margin-bottom: 3px;
  }
  .att-line1 strong { font-weight: 600; }
  .att-tag {
    font-size: 11px; padding: 2px 8px;
    border-radius: 999px;
    background: var(--warn-soft); color: #8C6228;
    font-weight: 500;
  }
  .att-tag.urgent { background: var(--danger-soft); color: #7E3F38; }
  .att-tag.calm { background: var(--calm-soft); color: #4F6175; }
  .att-line2 {
    font-size: 12.5px; color: var(--ink-3);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .att-line2 .mono { color: var(--ink-2); font-size: 11.5px; }
  .att-time {
    font-size: 12px; color: var(--ink-3);
    font-variant-numeric: tabular-nums;
  }
  .att-arrow {
    color: var(--ink-4);
    transition: transform .2s var(--ease), color .2s var(--ease);
  }
  .att-row:hover .att-arrow { color: var(--ink-2); transform: translateX(2px); }

  /* ===== MEMBERS GRID — soft floating tiles ===== */
  .members {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 14px;
  }
  .member-tile {
    background: var(--surface);
    border-radius: var(--r-lg);
    padding: 18px 18px 16px;
    box-shadow: var(--shadow-1);
    cursor: pointer;
    transition: transform .3s var(--ease), box-shadow .3s var(--ease);
    position: relative;
  }
  .member-tile:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-lift);
  }
  .mt-head {
    display: flex; align-items: center; gap: 12px;
    margin-bottom: 14px;
  }
  .mt-avatar {
    width: 36px; height: 36px; border-radius: 50%;
    display: grid; place-items: center;
    font-size: 13px; font-weight: 600;
    color: white;
    box-shadow: inset 0 -1px 0 rgba(0,0,0,.1), 0 1px 2px rgba(0,0,0,.06);
    position: relative;
  }
  .mt-status {
    position: absolute; bottom: -1px; right: -1px;
    width: 11px; height: 11px; border-radius: 50%;
    border: 2.5px solid var(--surface);
  }
  .mt-status.active { background: var(--accent); }
  .mt-status.idle { background: var(--ink-4); }
  .mt-status.warn { background: var(--warn); }
  .mt-name {
    font-size: 14px; font-weight: 600;
    color: var(--ink-1);
    line-height: 1.2;
  }
  .mt-sub {
    font-size: 11.5px; color: var(--ink-3);
    margin-top: 2px;
  }
  .mt-where {
    font-size: 12.5px; color: var(--ink-2);
    margin-bottom: 14px;
    line-height: 1.4;
    min-height: 36px;
  }
  .mt-where .where-label { color: var(--ink-4); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; display: block; margin-bottom: 2px; }
  .mt-where .where-val { color: var(--ink-1); font-weight: 500; }
  .mt-stats {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 8px;
    padding-top: 12px;
    border-top: 1px solid var(--hairline);
  }
  .mt-stat-num {
    font-size: 13px; font-weight: 600; color: var(--ink-1);
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
  }
  .mt-stat-label {
    font-size: 10.5px; color: var(--ink-4);
    margin-top: 2px; letter-spacing: 0.02em;
  }
  .mt-spark {
    position: absolute;
    top: 18px; right: 18px;
    width: 48px; height: 16px;
    opacity: .7;
  }

  /* ===== PROJECTS LIST — narrative rows ===== */
  .projects-list {
    background: var(--surface);
    border-radius: var(--r-xl);
    box-shadow: var(--shadow-1);
    overflow: hidden;
  }
  .proj-row {
    display: grid;
    grid-template-columns: 1fr 200px 140px 80px 24px;
    gap: 20px;
    align-items: center;
    padding: 18px 24px;
    border-bottom: 1px solid var(--hairline);
    cursor: pointer;
    transition: background .2s var(--ease);
  }
  .proj-row:last-child { border-bottom: none; }
  .proj-row:hover { background: var(--surface-2); }
  .proj-name {
    font-size: 14px; font-weight: 500; color: var(--ink-1);
    display: flex; align-items: center; gap: 10px;
  }
  .proj-icon {
    width: 28px; height: 28px; border-radius: 9px;
    background: var(--accent-soft);
    color: var(--accent-ink);
    display: grid; place-items: center;
    font-size: 12px; font-weight: 600;
  }
  .proj-sub {
    font-size: 11.5px; color: var(--ink-3); font-weight: 400;
    margin-top: 2px;
  }
  .proj-bar {
    height: 5px; background: var(--hairline);
    border-radius: 999px; overflow: hidden;
  }
  .proj-bar-fill {
    height: 100%; background: var(--accent);
    border-radius: 999px;
    transition: width .8s var(--ease);
  }
  .proj-bar-fill.warn { background: var(--warn); }
  .proj-bar-fill.calm { background: var(--calm); }
  .proj-progress-label {
    font-size: 11.5px; color: var(--ink-3); margin-top: 5px;
    font-variant-numeric: tabular-nums;
  }
  .proj-people {
    display: flex;
    align-items: center;
  }
  .proj-people-stack { display: flex; }
  .proj-people .av-sm {
    width: 22px; height: 22px; border-radius: 50%;
    border: 2px solid var(--surface);
    margin-left: -6px;
    font-size: 9.5px;
    font-weight: 600;
    color: white;
    display: grid; place-items: center;
    box-shadow: 0 0 0 .5px rgba(0,0,0,.04);
  }
  .proj-people .av-sm:first-child { margin-left: 0; }
  .proj-people-extra {
    margin-left: 8px;
    font-size: 11.5px; color: var(--ink-3);
  }
  .proj-eta {
    font-size: 12.5px; color: var(--ink-2);
    font-variant-numeric: tabular-nums;
  }
  .proj-eta.slip { color: var(--warn); }
  .proj-eta.danger { color: var(--danger); }
  .proj-arrow { color: var(--ink-4); }

  /* ===== SLIDE-OVER ===== */
  .scrim {
    position: fixed; inset: 0;
    background: rgba(28,27,25,.18);
    backdrop-filter: blur(4px);
    opacity: 0; pointer-events: none;
    transition: opacity .35s var(--ease);
    z-index: 90;
  }
  .scrim.open { opacity: 1; pointer-events: auto; }
  .slideover {
    position: fixed;
    right: 16px; top: 16px; bottom: 16px;
    width: 520px;
    background: var(--surface);
    border-radius: var(--r-xl);
    box-shadow: var(--shadow-3);
    z-index: 100;
    transform: translateX(calc(100% + 24px));
    transition: transform .45s var(--spring);
    overflow: hidden;
    display: flex; flex-direction: column;
  }
  .slideover.open { transform: translateX(0); }
  .so-head {
    padding: 24px 28px 20px;
    border-bottom: 1px solid var(--hairline);
    display: flex; align-items: center; gap: 14px;
    background: linear-gradient(180deg, var(--surface-2), transparent);
  }
  .so-avatar {
    width: 48px; height: 48px; border-radius: 50%;
    background: linear-gradient(135deg, #B85F5A, #D87B71);
    color: white; font-size: 16px; font-weight: 600;
    display: grid; place-items: center;
    box-shadow: inset 0 -1px 0 rgba(0,0,0,.1), 0 2px 6px rgba(184,95,90,.25);
    position: relative;
  }
  .so-avatar .so-status {
    position: absolute; bottom: 0; right: 0;
    width: 14px; height: 14px; border-radius: 50%;
    background: var(--ink-4);
    border: 3px solid var(--surface);
  }
  .so-id .so-name { font-size: 17px; font-weight: 600; color: var(--ink-1); letter-spacing: -0.01em; }
  .so-id .so-meta { font-size: 12.5px; color: var(--ink-3); margin-top: 2px; }
  .so-close {
    margin-left: auto;
    width: 32px; height: 32px; border-radius: 10px;
    background: transparent; border: 0;
    color: var(--ink-3); cursor: pointer;
    display: grid; place-items: center;
    transition: background .2s var(--ease);
  }
  .so-close:hover { background: var(--surface-2); color: var(--ink-1); }
  .so-body { overflow-y: auto; padding: 22px 28px 32px; flex: 1; }
  .so-callout {
    background: var(--warn-soft);
    border-radius: var(--r-md);
    padding: 14px 16px;
    margin-bottom: 22px;
    display: flex; gap: 12px;
    border: 1px solid rgba(200,146,75,.18);
  }
  .so-callout-icon { color: var(--warn); flex-shrink: 0; margin-top: 2px; }
  .so-callout-text {
    font-family: 'Newsreader', Georgia, serif;
    font-size: 14px; line-height: 1.55;
    color: #6B4A1F;
  }
  .so-callout-text em { font-style: italic; }
  .so-section { margin-bottom: 26px; }
  .so-h {
    font-size: 11.5px; font-weight: 500;
    color: var(--ink-3);
    text-transform: uppercase; letter-spacing: 0.08em;
    margin-bottom: 12px;
  }
  .so-stats {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 1px;
    background: var(--hairline);
    border-radius: var(--r-md);
    overflow: hidden;
  }
  .so-stat {
    background: var(--surface);
    padding: 14px 16px;
  }
  .so-stat-num { font-size: 22px; font-weight: 500; color: var(--ink-1); letter-spacing: -0.02em; line-height: 1; font-variant-numeric: tabular-nums; }
  .so-stat-label { font-size: 11px; color: var(--ink-3); margin-top: 6px; letter-spacing: 0.02em; }
  .so-evolve { display: flex; flex-direction: column; gap: 12px; }
  .so-evolve-item {
    display: grid;
    grid-template-columns: 60px 1fr;
    gap: 12px;
    align-items: flex-start;
  }
  .so-evolve-time {
    font-size: 11px; color: var(--ink-4);
    font-family: 'JetBrains Mono', monospace;
    padding-top: 1px;
  }
  .so-evolve-text {
    font-family: 'Newsreader', Georgia, serif;
    font-size: 13.5px; color: var(--ink-1);
    line-height: 1.5;
    padding-left: 12px;
    border-left: 2px solid var(--hairline);
  }
  .so-evolve-item.latest .so-evolve-text { border-left-color: var(--warn); color: var(--ink-1); }
  .so-evolve-item.latest .so-evolve-time { color: var(--warn); font-weight: 500; }

  /* ===== UTILITIES ===== */
  .av-color-1 { background: linear-gradient(135deg, #B85F5A, #D87B71); }
  .av-color-2 { background: linear-gradient(135deg, #5C7A9C, #82A0BD); }
  .av-color-3 { background: linear-gradient(135deg, #9B7B4F, #BF9E73); }
  .av-color-4 { background: linear-gradient(135deg, #6F8B5E, #97B080); }
  .av-color-5 { background: linear-gradient(135deg, #8B6B9C, #AC8FBD); }
  .av-color-6 { background: linear-gradient(135deg, #C8924B, #DDAE73); }

  /* Faint entrance */
  .fade-in { animation: fade .5s var(--ease) both; }
  @keyframes fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

/* === Phase 1 legacy selectors, removed in P-B6 === */
/* These .lh-* tokens and rules back the existing Phase 1 renderers
 * (overview.html.ts, member-detail.html.ts, project-detail.html.ts).
 * They live alongside v7 until P-B3..P-B6 migrate every renderer to v7
 * selectors, then this block is deleted. Do not add new .lh-* rules. */
:root {
  --bg-page: #f9fafb;
  --bg-card: #ffffff;
  --bg-subtle: #f4f4f5;
  --text-primary: #111827;
  --text-secondary: #6b7280;
  --text-muted: #9ca3af;
  --border: #e5e7eb;
  --shadow-sm: 0 1px 2px rgba(0,0,0,.04);
  --shadow-md: 0 1px 3px rgba(0,0,0,.06);
  --color-blue: #3b82f6;
  --color-blue-bg: #dbeafe;
  --color-green: #16a34a;
  --color-green-bg: #dcfce7;
  --color-amber: #d97706;
  --color-amber-bg: #fed7aa;
  --color-red: #dc2626;
  --color-red-bg: #fee2e2;
  --color-gray: #71717a;
  --color-gray-bg: #f4f4f5;
  --radius: 10px;
  --pad: 16px;
  --gap: 12px;
}

a { color: var(--color-blue); text-decoration: none; }
a:hover { text-decoration: underline; }

.lh-container {
  max-width: 1280px;
  margin: 0 auto;
  padding: 24px;
}

.lh-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 20px;
}
.lh-topbar h1 { margin: 0; font-size: 20px; font-weight: 600; }
.lh-topbar .lh-meta { color: var(--text-secondary); font-size: 13px; }
.lh-topbar .lh-refresh-tag {
  display: inline-block; padding: 4px 10px; border-radius: 16px;
  background: var(--color-blue-bg); color: var(--color-blue);
  font-size: 12px; font-weight: 500; margin-left: 8px;
}

.lh-kpi-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--gap);
  margin-bottom: 24px;
}
.lh-kpi-card {
  background: var(--bg-card);
  padding: var(--pad);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
}
.lh-kpi-card .label {
  color: var(--text-secondary);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-bottom: 6px;
}
.lh-kpi-card .value {
  font-size: 32px;
  font-weight: 600;
  line-height: 1.1;
  color: var(--text-primary);
}
.lh-kpi-card .sub {
  color: var(--text-secondary);
  font-size: 12px;
  margin-top: 6px;
}
.lh-kpi-card .delta { font-weight: 500; }
.lh-kpi-card .delta.pos { color: var(--color-green); }
.lh-kpi-card .delta.neg { color: var(--color-red); }

.lh-section-h {
  font-size: 14px;
  font-weight: 600;
  margin: 20px 0 12px 0;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.lh-member-list,
.lh-project-list,
.lh-collab-list {
  display: grid;
  gap: 8px;
}

.lh-member-card,
.lh-project-card,
.lh-collab-card {
  background: var(--bg-card);
  padding: 12px 16px;
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  transition: box-shadow 0.15s, transform 0.15s;
  text-decoration: none;
  color: inherit;
}
.lh-member-card:hover,
.lh-project-card:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
  text-decoration: none;
}

.lh-avatar {
  width: 32px; height: 32px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 600; font-size: 12px;
  flex-shrink: 0;
}
.lh-member-info { flex: 1; min-width: 0; }
.lh-member-name { font-weight: 600; color: var(--text-primary); }
.lh-member-meta { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }

.lh-badge {
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}
.lh-badge.ok { background: var(--color-green-bg); color: var(--color-green); }
.lh-badge.warn { background: var(--color-amber-bg); color: var(--color-amber); }
.lh-badge.stuck { background: var(--color-red-bg); color: var(--color-red); }
.lh-badge.quiet { background: var(--color-gray-bg); color: var(--color-gray); }
.lh-badge.low { background: var(--color-gray-bg); color: var(--color-gray); }
.lh-badge.help { background: var(--color-amber-bg); color: var(--color-amber); }

.lh-sparkline {
  display: inline-flex;
  align-items: flex-end;
  height: 24px;
  gap: 2px;
  margin: 0 8px;
}
.lh-sparkline span {
  display: inline-block;
  width: 4px;
  background: var(--color-blue);
  border-radius: 1px;
  opacity: 0.5;
}
.lh-sparkline span:last-child { opacity: 1; }

.lh-heatmap {
  display: grid;
  grid-template-columns: 40px repeat(24, 1fr);
  gap: 2px;
  margin: 12px 0;
}
.lh-heatmap .lh-hm-label {
  font-size: 11px;
  color: var(--text-secondary);
  text-align: right;
  padding-right: 4px;
}
.lh-heatmap .lh-hm-cell {
  height: 14px;
  background: var(--color-blue);
  border-radius: 2px;
}

.lh-detail-h1 {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 16px;
}
.lh-detail-h1 .back { font-size: 13px; color: var(--color-blue); }
.lh-detail-h1 h2 { margin: 0; font-size: 22px; font-weight: 600; }
.lh-detail-h1 .email { color: var(--text-secondary); font-size: 13px; }

.lh-detail-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--gap);
  margin-bottom: 20px;
}
.lh-detail-cards .lh-kpi-card .value { font-size: 22px; }

.lh-sessions-list { margin-top: 16px; }
.lh-session-item {
  background: var(--bg-card);
  padding: 12px 16px;
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  margin-bottom: 8px;
}
.lh-session-meta { font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; }
.lh-session-preview { color: var(--text-primary); font-size: 13px; }
.lh-session-item details summary {
  cursor: pointer; color: var(--color-blue); font-size: 12px; margin-top: 6px;
}
.lh-session-item details[open] summary { color: var(--text-secondary); }
.lh-session-full {
  white-space: pre-wrap;
  background: var(--bg-subtle);
  padding: 8px;
  border-radius: 6px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-primary);
}

.lh-eta-note {
  font-size: 11px;
  color: var(--color-amber);
  font-style: italic;
  margin-top: 4px;
}

.lh-bus-warning {
  background: var(--color-amber-bg);
  color: var(--color-amber);
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  margin-top: 8px;
}

.lh-empty {
  background: var(--bg-card);
  padding: 24px;
  border-radius: var(--radius);
  text-align: center;
  color: var(--text-secondary);
}

.lh-stack-bar {
  display: flex;
  height: 16px;
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-subtle);
  margin: 8px 0;
}
.lh-stack-bar > span {
  display: block;
  height: 100%;
}

table.lh-table { width: 100%; border-collapse: collapse; font-size: 13px; }
table.lh-table th { text-align: left; color: var(--text-secondary); font-weight: 500; padding: 6px 8px; border-bottom: 1px solid var(--border); }
table.lh-table td { padding: 6px 8px; border-bottom: 1px solid var(--bg-subtle); }
table.lh-table tr:last-child td { border-bottom: none; }

@media (max-width: 720px) {
  .lh-kpi-row { grid-template-columns: 1fr; }
  .lh-container { padding: 16px; }
}
`;
