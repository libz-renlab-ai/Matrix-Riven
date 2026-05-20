/* Shared helpers used by the Dashboard / Slideover / explainer sections. */

const { useState, useEffect, useRef } = React;

window.MR = window.MR || {};

window.MR.healthDotColor = function(score) {
  if (typeof score !== "number" || !isFinite(score)) return "#A8A59C";
  if (score < 5)  return "#B0625A";
  if (score < 7)  return "#C8924B";
  return "#6F8B5E";
};

window.MR.healthLabel = function(score) {
  if (typeof score !== "number" || !isFinite(score)) return "未知";
  if (score < 5)  return "状态吃紧";
  if (score < 7)  return "可关注";
  return "良好";
};

window.MR.phaseLabel = function(p) {
  return ({
    implement: "推进新功能",
    debug:     "修复中",
    refactor:  "重构",
    explore:   "探索方向",
    review:    "回顾收尾",
    idle:      "暂无新工作"
  })[p] || "推进新功能";
};

window.MR.trendArrow = function(arr) {
  if (!arr || arr.length < 2) return "→";
  const mid = Math.floor(arr.length / 2);
  const earlier = arr.slice(0, mid).reduce((a, b) => a + b, 0);
  const later   = arr.slice(mid).reduce((a, b) => a + b, 0);
  if (later > earlier * 1.1) return "↗";
  if (later < earlier * 0.85) return "↘";
  return "→";
};

window.MR.trendLabel = function(arr) {
  const arrow = window.MR.trendArrow(arr);
  return ({ "↗": "稳步上行", "↘": "逐渐放缓", "→": "稳步推进" })[arrow];
};

window.MR.etaLabel = function(days) {
  if (typeof days !== "number" || days <= 0) return "暂无预估";
  if (days <= 3)  return `预计 ${days} 天内收尾`;
  if (days <= 7)  return `预计 ${days} 天内可发布`;
  if (days <= 14) return `预计 1-2 周`;
  return `预计 ${Math.round(days / 7)} 周以上`;
};

window.MR.shortFile = function(p) {
  if (!p) return "—";
  const parts = p.split("/");
  if (parts.length <= 2) return p;
  return ".../" + parts.slice(-2).join("/");
};

window.MR.idleSince = function(hours) {
  if (!isFinite(hours) || hours < 0) return "—";
  if (hours < 1)  return "刚刚活跃";
  if (hours < 24) return `${Math.floor(hours)}h 前活跃`;
  const d = Math.floor(hours / 24);
  return d === 1 ? "昨日活跃" : `${d} 天前活跃`;
};

window.MR.sparkFromTrend = function(trend, w, h) {
  w = w || 48; h = h || 16;
  if (!trend || trend.length === 0) return `M0 ${h / 2} L${w} ${h / 2}`;
  const max = Math.max(...trend, 1);
  const pts = trend.map((v, i) => {
    const x = trend.length === 1 ? w / 2 : (i / (trend.length - 1)) * w;
    const y = (h - 2) - (v / max) * (h - 4);
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  return "M" + pts.join(" L");
};

window.MR.formatHHMM = function(ts) {
  if (typeof ts !== "string") return "";
  if (ts.length >= 16 && ts[10] === "T") return ts.slice(11, 16);
  return ts;
};

window.MR.highlightIcon = function(t) {
  return ({ commit: "✓", push: "↑", pr: "◆", release: "★", tag: "#", risky: "⚠" })[t] || "·";
};

window.MR.highlightVerb = function(t) {
  return ({ commit: "提交", push: "推送", pr: "提 PR", release: "发布", tag: "打 tag", risky: "高风险操作" })[t] || "动作";
};

/* useLang — subscribe a component to global lang change events. */
window.MR.useLang = function() {
  const [, force] = useState(0);
  useEffect(() => {
    const h = () => force(n => n + 1);
    window.addEventListener("langchange", h);
    return () => window.removeEventListener("langchange", h);
  }, []);
  return [window.LANG, window.setLang];
};

/* LangToggle — small pill at the top-right of nav. Plain HTML rendered by
 * vc.jsx / app.jsx. Returns a React element. */
window.MR.LangToggle = function() {
  const [lang, setLang] = window.MR.useLang();
  return React.createElement("button", {
    className: "lang-toggle",
    title: window.tr("切换语言"),
    onClick: () => setLang(lang === "en" ? "zh" : "en"),
    type: "button"
  },
    React.createElement("span", { className: lang === "zh" ? "active" : "" }, "中"),
    React.createElement("span", { className: "sep" }, "/"),
    React.createElement("span", { className: lang === "en" ? "active" : "" }, "EN")
  );
};

window.MR.useTick = function(intervalMs) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
};

/* ───────── reveal / scroll-driven hooks ───────── */

/** IntersectionObserver-driven boolean. Attach ref to any element; isIn
 *  flips true the first time it enters viewport and stays true afterward. */
window.MR.useReveal = function(opts) {
  const ref = useRef(null);
  const [isIn, setIsIn] = useState(false);
  useEffect(() => {
    if (!ref.current || isIn) return;
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          setIsIn(true);
          obs.disconnect();
        }
      });
    }, Object.assign({ threshold: 0.15, rootMargin: "-40px 0px" }, opts || {}));
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [isIn]);
  return [ref, isIn];
};

/** Number count-up when in view. `target` can be a number or a string
 *  containing one (e.g. "30s", "<$0.20", "10×"). Returns the formatted
 *  string with the numeric part animated from 0 to target. */
window.MR.useCountUp = function(target, opts) {
  opts = opts || {};
  const dur = opts.duration || 1400;
  const delay = opts.delay || 0;
  const decimals = opts.decimals != null ? opts.decimals : null;

  // Parse the leading number out of target if it's a string
  let numeric, prefix = "", suffix = "";
  if (typeof target === "number") {
    numeric = target;
  } else {
    const s = String(target);
    const m = s.match(/^([^\d\-.]*)(-?[\d,.]+)(.*)$/);
    if (m) {
      prefix = m[1];
      numeric = parseFloat(m[2].replace(/,/g, ""));
      suffix = m[3];
    } else {
      numeric = NaN;
    }
  }

  const [ref, isIn] = window.MR.useReveal();
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!isIn || !isFinite(numeric)) return;
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const elapsed = now - start - delay;
      if (elapsed < 0) { raf = requestAnimationFrame(tick); return; }
      const t = Math.min(1, elapsed / dur);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(numeric * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isIn, numeric, dur, delay]);

  // Detect decimals from the source if not specified
  const fmt = (n) => {
    if (!isFinite(n)) return String(target);
    const d = decimals != null
      ? decimals
      : (String(numeric).includes(".") ? String(numeric).split(".")[1].length : 0);
    return n.toFixed(d);
  };

  return [ref, isFinite(numeric) ? prefix + fmt(val) + suffix : String(target)];
};

/** Scroll progress 0..1, throttled via rAF. */
window.MR.useScrollProgress = function() {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0, ticking = false;
    const update = () => {
      const max = (document.documentElement.scrollHeight - window.innerHeight) || 1;
      setP(Math.min(1, Math.max(0, window.scrollY / max)));
      ticking = false;
    };
    const onScroll = () => {
      if (!ticking) {
        raf = requestAnimationFrame(update);
        ticking = true;
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, []);
  return p;
};

/** Pointer position (raw, throttled via rAF). Returns null until first move. */
window.MR.useMousePos = function() {
  const [pos, setPos] = useState(null);
  useEffect(() => {
    let raf = 0, last = null;
    const flush = () => { if (last) setPos(last); };
    const onMove = (e) => {
      last = { x: e.clientX, y: e.clientY };
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; flush(); });
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => { window.removeEventListener("mousemove", onMove); cancelAnimationFrame(raf); };
  }, []);
  return pos;
};

/** Global reveal observer — adds .is-in to any element with one of the
 *  reveal classes the first time it enters the viewport. Call once on mount. */
window.MR.installRevealObserver = function() {
  if (window.MR._revealInstalled) return;
  window.MR._revealInstalled = true;
  const sel = [
    ".reveal-up",
    ".reveal-blur",
    ".reveal-scale",
    ".reveal-stagger > *",
    ".nf-cell",
    ".ns-cell",
    ".moat-cell",
    ".problem-row",
    ".pact-row",
    ".roadmap-row",
    ".tier-card",
    ".sig-cat",
    ".pull-quote",
    ".cta-stage",
    ".product-frame",
    ".live-viz",
    ".hero-strip"
  ].join(", ");
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add("is-in");
        obs.unobserve(e.target);
      }
    });
  }, { threshold: 0.12, rootMargin: "-40px 0px" });
  const scan = () => {
    document.querySelectorAll(sel).forEach(el => {
      if (!el.classList.contains("is-in")) obs.observe(el);
    });
  };
  scan();
  const mo = new MutationObserver(scan);
  mo.observe(document.body, { childList: true, subtree: true });
};
