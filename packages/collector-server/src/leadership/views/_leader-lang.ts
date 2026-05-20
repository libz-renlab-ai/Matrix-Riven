/**
 * Leader-language translation module.
 *
 * The leadership dashboard's UI uses these helpers to convert technical signals
 * (ProjectPhase enums, MemberStateBadge enums, raw trend arrays, health scores)
 * into narrative Chinese phrases. The leader audience doesn't think in
 * "phase=implement" or "stateBadge=needs_help" — they think in "正在推进新
 * 功能" / "可能需要支援".
 *
 * All functions are pure, dependency-free, no side effects. Tests cover every
 * branch + boundary case.
 */

import type { ProjectPhase, MemberStateBadge } from '../types.js';

/** Project phase → narrative. */
export function phaseLabel(phase: ProjectPhase): string {
  switch (phase) {
    case 'implement': return '推进新功能';
    case 'debug':     return '集中修问题';
    case 'refactor':  return '整理代码结构';
    case 'test':      return '完善测试';
    case 'docs':      return '梳理文档';
    case 'plan':      return '规划设计';
    case 'mixed':     return '多线推进';
  }
}

/** Member state badge → narrative. */
export function stateLabel(state: MemberStateBadge): string {
  switch (state) {
    case 'active':       return '正常推进';
    case 'quiet':        return '本周节奏放缓';
    case 'stuck':        return '进展受阻';
    case 'needs_help':   return '可能需要支援';
    case 'low_activity': return '本周参与不多';
  }
}

/** 7-day trend → narrative classification.
 *  trend is a number[] of sessions/activity per day (oldest first).
 *
 *  Note: "本周才开始" / "近期已收尾" are detected on the tail/head of the
 *  series (last/first ~third of days all zero), not on the full half-sums.
 *  This avoids classifying `[15,12,8,5,0,0,0]` (clearly winding down to
 *  nothing) as merely "逐渐放缓" — leaders read it as "已收尾".
 */
export function trendLabel(trend: number[]): string {
  if (trend.length === 0 || trend.every(x => x === 0)) return '本周未活跃';
  const half = Math.floor(trend.length / 2);
  const earlier = trend.slice(0, half).reduce((a, b) => a + b, 0);
  const later = trend.slice(half).reduce((a, b) => a + b, 0);
  const tailLen = Math.max(1, Math.floor(trend.length / 3));
  const headAllZero = trend.slice(0, tailLen).every(x => x === 0);
  const tailAllZero = trend.slice(-tailLen).every(x => x === 0);
  if (headAllZero && later > 0) return '本周才开始';
  if (tailAllZero && earlier > 0) return '近期已收尾';
  if (later > earlier * 1.5) return '正在加速';
  if (later < earlier * 0.5) return '逐渐放缓';
  return '稳步推进';
}

/** Trend → small arrow for inline display alongside trendLabel. */
export function trendArrow(trend: number[]): '↗' | '→' | '↘' | '·' {
  if (trend.every(x => x === 0)) return '·';
  const half = Math.floor(trend.length / 2);
  const earlier = trend.slice(0, half).reduce((a, b) => a + b, 0);
  const later = trend.slice(half).reduce((a, b) => a + b, 0);
  const tailLen = Math.max(1, Math.floor(trend.length / 3));
  const headAllZero = trend.slice(0, tailLen).every(x => x === 0);
  const tailAllZero = trend.slice(-tailLen).every(x => x === 0);
  if (headAllZero && later > 0) return '↗';
  if (tailAllZero && earlier > 0) return '↘';
  if (later > earlier * 1.5) return '↗';
  if (later < earlier * 0.5) return '↘';
  return '→';
}

/** Health score 0–10 → semantic tier + CSS variable color. */
export type HealthTier = 'good' | 'warn' | 'risk';

export function healthTier(score: number): HealthTier {
  if (score >= 7.5) return 'good';
  if (score >= 5.0) return 'warn';
  return 'risk';
}

export function healthLabel(score: number): string {
  const tier = healthTier(score);
  if (tier === 'good') return '健康';
  if (tier === 'warn') return '需关注';
  return '亟需介入';
}

/** Dot color from health score, returns one of the v7 CSS variables. */
export function healthDotColor(score: number): string {
  const tier = healthTier(score);
  if (tier === 'good') return 'var(--accent)';   // sage green
  if (tier === 'warn') return 'var(--warn)';     // amber
  return 'var(--danger)';                         // dusty terracotta
}

/** Idle-hours number → friendly time-since description. */
export function idleSince(idleHours: number): string {
  if (idleHours < 1) return '刚刚';
  if (idleHours < 4) return `${Math.round(idleHours)} 小时前`;
  if (idleHours < 24) return `今天早些时候`;
  const days = Math.round(idleHours / 24);
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;
  if (days < 14) return '一周前';
  if (days < 30) return `${Math.floor(days / 7)} 周前`;
  return `一个月以上`;
}

/** ETA days → leader-friendly time estimate. */
export function etaLabel(etaDays: number | null): string {
  if (etaDays == null) return '暂无预估';
  if (etaDays <= 1) return '今明两天';
  if (etaDays <= 3) return '本周内';
  if (etaDays <= 7) return '约 1 周';
  if (etaDays <= 14) return '约 2 周';
  if (etaDays <= 30) return `约 ${Math.round(etaDays / 7)} 周`;
  return '一个月以上';
}

/** A file path → short label (last 1-2 path segments). */
export function shortFile(path: string): string {
  if (!path) return '';
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? path;
  return parts.slice(-2).join('/');
}
