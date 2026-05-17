import { describe, it, expect } from 'vitest';
import { renderHeroFragment, renderKpisFragment } from '../_overview-fragments.js';
import type { OverviewSnapshot } from '../../types.js';

function makeSnapshot(overrides: Partial<OverviewSnapshot> = {}): OverviewSnapshot {
  return {
    schemaVersion: 1,
    range: { start: '2026-05-10T00:00:00Z', end: '2026-05-17T00:00:00Z', label: '7d' },
    computedAt: '2026-05-17T14:32:00Z',
    kpis: {
      teamActivity: { value: 147, deltaVsAvg: 0.1 },
      attention: { value: 2, deltaToday: 1, breakdown: { stuck: 1, needsHelp: 0, riskyAction: 1 } },
      projects: { active: 4, maintaining: 2, dormant: 1 },
    },
    members: [],
    projects: [],
    collaboration: [],
    ...overrides,
  };
}

describe('renderHeroFragment (P-B3)', () => {
  it('wraps in <header id="hero">', () => {
    expect(renderHeroFragment(makeSnapshot())).toMatch(/^<header[^>]*id="hero"/);
  });
  it('renders serif H1 with em', () => {
    expect(renderHeroFragment(makeSnapshot())).toMatch(/<h1[^>]*serif[^>]*>[\s\S]*<em>/);
  });
  it('shows member count and project count', () => {
    const html = renderHeroFragment(makeSnapshot({
      members: Array(6).fill(null) as never,
      projects: Array(8).fill(null) as never,
    }));
    expect(html).toContain('6');
    expect(html).toContain('8');
  });
});

describe('renderKpisFragment (P-B3)', () => {
  const snap = makeSnapshot();
  it('emits 4 kpi cards', () => {
    expect((renderKpisFragment(snap).match(/class="kpi /g) ?? []).length).toBe(4);
  });
  it('each card has an SVG sparkline', () => {
    expect((renderKpisFragment(snap).match(/<svg class="kpi-spark"/g) ?? []).length).toBe(4);
  });
  it('attention card shows snapshot kpi value', () => {
    expect(renderKpisFragment(snap)).toMatch(/class="kpi-num"[^>]*>\s*2/);
  });
  it('wraps in <section id="kpis">', () => {
    expect(renderKpisFragment(snap)).toMatch(/^<section[^>]*id="kpis"/);
  });
});
