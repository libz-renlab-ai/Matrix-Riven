/**
 * Editorial copy templates for the leadership dashboard (P-B3 / spec §3.4).
 * Each function returns a snippet of HTML (not plain text) with <em>…</em>
 * for serif-italic emphasis. Callers must trust the output is safe HTML — do
 * NOT escape it before rendering.
 */

const CHINESE_NUMERALS = ['', '一', '两', '三', '四'];

export function heroHeadline(ctx: { attentionCount: number; highOutputCount: number }): string {
  if (ctx.attentionCount === 0) {
    return `今天，团队 <em>一切顺利</em>。<br/>没有需要立即处理的事。`;
  }
  if (ctx.attentionCount === 1) {
    return `今天，团队总体 <em>平稳</em>。<br/>但有 <em>一件事</em> 值得你看一眼。`;
  }
  if (ctx.attentionCount < 5) {
    return `今天，团队总体 <em>平稳</em>。<br/>但有 <em>${CHINESE_NUMERALS[ctx.attentionCount]}件事</em> 值得你看一眼。`;
  }
  return `今天有 <em>${ctx.attentionCount} 件事</em> 需要你留意。<br/>建议先看红色那条。`;
}

/**
 * §5.7 focus-aware hero headline. When a focus / project / state filter is
 * active, the default "今天，团队…" headline reads dissonant ("今天有 3 件事
 * 需要你留意" while the page shows only blake). Returns a filter-shaped
 * headline that describes the *subject* of the filter, not the whole team.
 */
export function focusedHeroHeadline(ctx: {
  focus?: string;
  project?: string;
  state?: string;
  stateLabel?: string;
  rangeLabel: string;
  attentionCount: number;
}): string {
  const win = ctx.rangeLabel;
  if (ctx.focus) {
    if (ctx.attentionCount === 0) {
      return `<em>${ctx.focus}</em> 在 ${win} 内 <em>没有触发关注项</em>。<br/>下面是 TA 的完整切片。`;
    }
    if (ctx.attentionCount === 1) {
      return `<em>${ctx.focus}</em> 在 ${win} 内 <em>有一件事</em> 值得你看一眼。<br/>滚动到下方继续。`;
    }
    return `<em>${ctx.focus}</em> 在 ${win} 内 <em>${ctx.attentionCount} 项</em> 值得你留意。<br/>下方按严重度排序。`;
  }
  if (ctx.project) {
    if (ctx.attentionCount === 0) {
      return `项目 <em>${ctx.project}</em>（${win}）<em>当前没有关注项</em>。<br/>下方为该项目的成员与活动切片。`;
    }
    return `项目 <em>${ctx.project}</em>（${win}）有 <em>${ctx.attentionCount} 项</em> 待处理。<br/>下方按严重度排序。`;
  }
  if (ctx.state) {
    const label = ctx.stateLabel ?? ctx.state;
    if (ctx.attentionCount === 0) {
      return `状态 = <em>${label}</em>（${win}）<em>当前无人命中</em>。`;
    }
    return `状态 = <em>${label}</em>（${win}）共 <em>${ctx.attentionCount} 人</em> 需要看一眼。`;
  }
  // No focus/project/state — just a non-today range.
  if (ctx.attentionCount === 0) {
    return `${win} 内 <em>没有需要处理的事</em>。<br/>团队节奏平稳。`;
  }
  return `${win} 内累计 <em>${ctx.attentionCount} 件事</em> 值得复盘。<br/>下方按严重度排序。`;
}

export function attentionLead(count: number): string {
  if (count === 1) return `一件事在等你 — <em>看一眼，决定要不要插手</em>。`;
  if (count < 5) return `${count} 件事在等你 — <em>看一眼，决定要不要插手</em>。`;
  return `${count} 件事需要你留意 — <em>按红/黄/灰排序，先处理最上面那条</em>。`;
}

export function idleCallout(ctx: { displayName: string; idleHours: number; lastFile?: string }): string {
  const file = ctx.lastFile ? `最后一次停在 <em>${ctx.lastFile}</em>` : `没有最近活动文件`;
  if (ctx.idleHours < 4)  return `${ctx.displayName} 现在没在打字，但 ${ctx.idleHours} 小时不算异常。${file}。`;
  if (ctx.idleHours < 12) return `${ctx.displayName} 已经 ${ctx.idleHours} 小时没动了。${file}。<em>不像是卡住，更像是没开工</em>。`;
  return `${ctx.displayName} 已经 ${ctx.idleHours} 小时没动了 — 比平常长得多。${file}。<em>建议主动问一句</em>。`;
}
