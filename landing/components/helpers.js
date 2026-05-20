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

window.MR.useTick = function(intervalMs) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
};
