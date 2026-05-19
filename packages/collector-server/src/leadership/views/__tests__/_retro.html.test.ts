/**
 * §5.6 contract test — /retro is a *weekly* retrospective view. The T5 daily
 * brief MUST NOT leak into it. Replaced with a deterministic weekly summary.
 */

import { describe, it, expect } from 'vitest';
import { renderRetro } from '../_retro.html.js';
import type { OverviewSnapshot } from '../../types.js';

function makeSnap(overrides: Partial<OverviewSnapshot> = {}): OverviewSnapshot {
  const base = {
    schemaVersion: 1,
    range: { start: '2026-05-12T00:00:00Z', end: '2026-05-19T00:00:00Z', label: '7d' },
    computedAt: '2026-05-19T00:00:00Z',
    staleness: undefined,
    llmBrief: [
      '今日团队推进顺利：核心 dashboard 模块已上线，CI 全绿。',
      '一名工程师在 status/page.tsx 卡住两天。',
      '明日聚焦 LLM 叙事层与 OKR 联动。',
    ],
    kpis: {
      teamActivity: { value: 0, deltaVsAvg: 0 },
      attention: { value: 0, deltaToday: 0, breakdown: { stuck: 0, needsHelp: 0, riskyAction: 0 } },
      projects: { active: 0, maintaining: 0, dormant: 0 },
      todayCostUsd: 0,
      pace: { rhythmDelta: 0, label: '稳' as const },
      highOutput: { count: 0, avgDeltaPct: 0 },
    },
    members: [],
    projects: [],
    attention: [],
    highlights: [],
    collaboration: { edges: [], topPairs: [] },
    appliedFilter: undefined,
  };
  return { ...base, ...overrides } as unknown as OverviewSnapshot;
}

describe('renderRetro', () => {
  it('does NOT render the T5 daily brief at the top (it is a weekly view)', () => {
    const snap = makeSnap();
    const html = renderRetro(snap);
    expect(html).not.toContain('今日团队推进顺利');
    expect(html).not.toContain('明日聚焦');
    // No daily-brief div with a today/tomorrow oriented copy.
    expect(html).not.toMatch(/今日.{0,10}明日/);
  });

  it('renders a qualitative weekly summary judgement (not a count duplicate)', () => {
    const snap = makeSnap({
      highlights: [
        { ts: '2026-05-18T00:00:00Z', type: 'commit', by: 'alex', project: 'm', detail: 'x' },
        { ts: '2026-05-17T00:00:00Z', type: 'pr', by: 'blake', project: 'm', detail: 'y' },
      ] as unknown as OverviewSnapshot['highlights'],
      attention: [
        { kind: 'member', refId: 'x@y', displayName: 'x', initials: 'x', tag: '进展受阻', tagSeverity: 'urgent', line2: '', time: '', severity: 9 },
      ] as unknown as OverviewSnapshot['attention'],
    });
    const html = renderRetro(snap);
    expect(html).toContain('weekly summary');
    // Summary must NOT pre-print the same counts the section headers already
    // show — that was the duplicate (EM Round-1 P1).
    expect(html).not.toContain('本周累计交付 <strong>2</strong>');
    expect(html).toContain('需要跟进的关注项');
  });

  it('weekly summary collapses gracefully when zero counts', () => {
    const snap = makeSnap();
    const html = renderRetro(snap);
    expect(html).toContain('weekly summary');
    expect(html).toContain('低谷或数据稀疏');
  });

  it('still includes 本周回顾 H1 and the canonical sections', () => {
    const snap = makeSnap();
    const html = renderRetro(snap);
    expect(html).toContain('本周回顾');
    expect(html).toContain('本周交付');
    expect(html).toContain('需要看一眼');
    expect(html).toContain('突出表现');
  });
});
