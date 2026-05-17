import { describe, it, expect } from 'vitest';
import { renderHeroFragment, renderKpisFragment, renderAttentionFragment, renderMembersFragment, renderProjectsFragment, sparkFromTrend } from '../_overview-fragments.js';
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
    attention: [],
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

describe('renderAttentionFragment (P-B4)', () => {
  it('returns empty section when no attention items', () => {
    const html = renderAttentionFragment(makeSnapshot({ attention: [] }));
    expect(html).toContain('id="attention"');
    expect(html).not.toContain('attention-list');
  });

  it('renders attention rows with avatar, tag, line2, arrow', () => {
    const html = renderAttentionFragment(makeSnapshot({
      attention: [{
        kind: 'member', refId: 'u@x.com', displayName: 'liboze', initials: 'li',
        tag: '闲置 11h', tagSeverity: 'urgent',
        line2: '上一次停在 api/overview.test.ts',
        time: '03:12', severity: 8,
      }],
    }));
    expect(html).toMatch(/class="att-row"/);
    expect(html).toContain('闲置 11h');
    expect(html).toMatch(/class="att-tag urgent"/);
    expect(html).toContain('liboze');
    expect(html).toContain('03:12');
    expect(html).toContain('›');
  });

  it('emits data-ref attribute for slideover wiring (P-B6)', () => {
    const html = renderAttentionFragment(makeSnapshot({
      attention: [{
        kind: 'project', refId: 'Matrix-Riven', displayName: 'Matrix-Riven', initials: 'MA',
        tag: '单点依赖', tagSeverity: 'calm',
        line2: '顶贡献者份额 &gt; 70%',
        time: '—', severity: 4,
      }],
    }));
    expect(html).toContain('data-ref="project:Matrix-Riven"');
    expect(html).toContain('data-attention="4"');
  });

  it('renders the editorial headline via attentionLead', () => {
    const html = renderAttentionFragment(makeSnapshot({
      attention: [{
        kind: 'member', refId: 'a@x.com', displayName: 'a', initials: 'a',
        tag: 't', tagSeverity: 'urgent', line2: 'x', time: '—', severity: 9,
      }],
    }));
    expect(html).toMatch(/class="attention-headline serif"/);
    expect(html).toMatch(/一件事在等你/);
  });

  it('escapes user-supplied displayName', () => {
    const html = renderAttentionFragment(makeSnapshot({
      attention: [{
        kind: 'member', refId: '<x>', displayName: '<script>', initials: 'XX',
        tag: 't', tagSeverity: 'normal', line2: '', time: '—', severity: 1,
      }],
    }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders line2 unescaped so inline <span class="mono"> works', () => {
    const html = renderAttentionFragment(makeSnapshot({
      attention: [{
        kind: 'member', refId: 'a@x.com', displayName: 'a', initials: 'a',
        tag: 't', tagSeverity: 'normal',
        line2: '上一次停在 <span class="mono">api/overview.ts</span>',
        time: '—', severity: 5,
      }],
    }));
    expect(html).toContain('<span class="mono">api/overview.ts</span>');
  });
});

describe('sparkFromTrend (P-B5)', () => {
  it('returns a flat line for empty trend', () => {
    expect(sparkFromTrend([])).toBe('M0 8 L48 8');
  });
  it('returns an SVG path starting with M', () => {
    expect(sparkFromTrend([1, 2, 3, 4, 5, 6, 7])).toMatch(/^M[\d. L]+$/);
  });
  it('places single point at x=24', () => {
    expect(sparkFromTrend([5])).toContain('24.0');
  });
});

describe('renderMembersFragment (P-B5)', () => {
  function snapWithMembers(n: number) {
    return makeSnapshot({
      members: Array.from({ length: n }, (_, i) => ({
        email: `u${i}@x.com`, displayName: `user${i}`, stateBadge: i === 0 ? 'low_activity' : 'active',
        today: { sessions: 5 + i, tokens: 10000 * (i + 1), estMinutes: 30, costUsd: 1.0 + i * 0.5 },
        trend7d: [1, 2, 3, 4, 5, 6, 7], deltaVs7dAvgPct: 0.1, warnings: [], topProject: 'mr',
      } as never)),
    });
  }

  it('emits id="members" wrapper', () => {
    expect(renderMembersFragment(snapWithMembers(3))).toMatch(/^<section[^>]*id="members"/);
  });
  it('renders a tile per member', () => {
    expect((renderMembersFragment(snapWithMembers(6)).match(/class="member-tile"/g) ?? []).length).toBe(6);
  });
  it('each tile has 3 stat numbers + 1 sparkline', () => {
    const html = renderMembersFragment(snapWithMembers(2));
    expect((html.match(/class="mt-stat-num"/g) ?? []).length).toBe(6);
    expect((html.match(/class="mt-spark"/g) ?? []).length).toBe(2);
  });
  it('includes sort buttons with data-sort attributes', () => {
    const html = renderMembersFragment(snapWithMembers(1));
    expect(html).toContain('data-sort="attention"');
    expect(html).toContain('data-sort="activity"');
    expect(html).toContain('data-sort="alpha"');
  });
  it('idle member tile has status "idle"', () => {
    const html = renderMembersFragment(snapWithMembers(2));
    expect(html).toContain('mt-status idle');
  });
});

describe('renderProjectsFragment (P-B5)', () => {
  function snapWithProjects(n: number) {
    return makeSnapshot({
      projects: Array.from({ length: n }, (_, i) => ({
        name: `proj${i}`, state: 'active', contributors: [
          { email: 'a@x.com', sharePct: 0.5 }, { email: 'b@x.com', sharePct: 0.3 },
        ], busFactorWarning: false, trend7d: [1,1,2,2,3,3,4], phaseGuess: 'implement',
        healthScore: 7, etaDays: 5, etaConfidence: 'low' as const,
      })),
    });
  }
  it('emits id="projects" wrapper', () => {
    expect(renderProjectsFragment(snapWithProjects(3))).toMatch(/^<section[^>]*id="projects"/);
  });
  it('renders a row per project', () => {
    expect((renderProjectsFragment(snapWithProjects(5)).match(/class="proj-row"/g) ?? []).length).toBe(5);
  });
  it('each row has progress bar + avatar stack', () => {
    const html = renderProjectsFragment(snapWithProjects(2));
    expect((html.match(/class="proj-bar"/g) ?? []).length).toBe(2);
    expect((html.match(/class="proj-people-stack"/g) ?? []).length).toBe(2);
  });
});
