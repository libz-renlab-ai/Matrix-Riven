import { describe, it, expect } from 'vitest';
import { renderHeroFragment, renderKpisFragment, renderAttentionFragment, renderMembersFragment, renderProjectsFragment, renderHighlightsFragment, renderCollabFragment, sparkFromTrend } from '../_overview-fragments.js';
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
      pace: { rhythmDelta: 0, label: '稳' },
      highOutput: { count: 0, avgDeltaPct: 0 },
      todayCostUsd: 0,
    },
    members: [],
    projects: [],
    collaboration: [],
    attention: [],
    highlights: [],
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

describe('Round-7 P2 — empty state has clickable CTAs', () => {
  it('zero members + zero projects → renders /sources and /overview?demo=1 links', () => {
    const html = renderHeroFragment(makeSnapshot({ members: [], projects: [] }));
    expect(html).toContain('暂无数据');
    expect(html).toContain('href="/sources"');
    expect(html).toContain('href="/overview?demo=1"');
    expect(html).toContain('看怎么接入');
    expect(html).toContain('先看 Demo');
  });
  it('non-empty state does NOT show empty CTAs', () => {
    const html = renderHeroFragment(makeSnapshot({
      members: [{ email: 'x@y' } as never],
      projects: [{ name: 'p' } as never],
    }));
    expect(html).not.toContain('暂无数据');
    expect(html).not.toContain('看怎么接入 collector');
  });
});

describe('§5.7 — hero headline rewrites when filter active', () => {
  it('focus=blake → headline mentions blake by name, not 团队 / 今天', () => {
    const html = renderHeroFragment(makeSnapshot({
      members: [{ email: 'x@y' } as never],
      projects: [],
      attention: [{ severity: 9 } as never],
      appliedFilter: { focus: 'blake', range: 'today' } as never,
    }));
    expect(html).toContain('blake');
    expect(html).not.toContain('今天有');
    expect(html).not.toContain('今天，团队');
  });
  it('project filter → headline starts with 项目 <name>', () => {
    const html = renderHeroFragment(makeSnapshot({
      members: [{ email: 'x@y' } as never],
      projects: [{ name: 'matrix-riven' } as never],
      attention: [],
      appliedFilter: { project: 'matrix-riven', range: '7d' } as never,
    }));
    expect(html).toContain('项目');
    expect(html).toContain('matrix-riven');
    expect(html).toContain('近 7 天');
  });
  it('range only (no focus/project/state) → headline mentions window not 今天', () => {
    const html = renderHeroFragment(makeSnapshot({
      members: [{ email: 'x@y' } as never],
      projects: [],
      attention: [],
      appliedFilter: { range: '30d' } as never,
    }));
    expect(html).toContain('近 30 天');
    expect(html).not.toContain('今天，团队');
  });
  it('still keeps the filter crumb on top of the H1', () => {
    const html = renderHeroFragment(makeSnapshot({
      members: [{ email: 'x@y' } as never],
      projects: [],
      attention: [],
      appliedFilter: { focus: 'blake', range: 'today' } as never,
    }));
    expect(html).toContain('hero-filter-crumb');
    expect(html).toContain('🔍 当前聚焦');
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

describe('renderKpisFragment — placeholder replacements (P2)', () => {
  it('renders the real pace label (升/稳/缓) instead of "顺/稳"', () => {
    const html = renderKpisFragment(makeSnapshot({
      kpis: {
        teamActivity: { value: 1, deltaVsAvg: 0 },
        attention: { value: 0, deltaToday: 0, breakdown: { stuck: 0, needsHelp: 0, riskyAction: 0 } },
        projects: { active: 1, maintaining: 0, dormant: 0 },
        pace: { rhythmDelta: 0.42, label: '升' },
        highOutput: { count: 2, avgDeltaPct: 0.35 },
        todayCostUsd: 4.32,
      },
    }));
    // pace card label — label sits in kpi-num followed by <span class="unit">
    expect(html).toMatch(/kpi-pace[\s\S]*?kpi-num">升</);
    // pace trend line shows real delta percent — no longer "多数项目按期"
    expect(html).not.toContain('多数项目按期');
    expect(html).toMatch(/42%/);
  });

  it('renders 缓 when rhythmDelta < -0.2', () => {
    const html = renderKpisFragment(makeSnapshot({
      kpis: {
        teamActivity: { value: 1, deltaVsAvg: 0 },
        attention: { value: 0, deltaToday: 0, breakdown: { stuck: 0, needsHelp: 0, riskyAction: 0 } },
        projects: { active: 1, maintaining: 0, dormant: 0 },
        pace: { rhythmDelta: -0.5, label: '缓' },
        highOutput: { count: 0, avgDeltaPct: 0 },
        todayCostUsd: 0,
      },
    }));
    expect(html).toMatch(/kpi-pace[\s\S]*?kpi-num">缓</);
  });

  it('renders highOutput avg delta as "↑N% 平均" when count > 0', () => {
    const html = renderKpisFragment(makeSnapshot({
      kpis: {
        teamActivity: { value: 1, deltaVsAvg: 0 },
        attention: { value: 0, deltaToday: 0, breakdown: { stuck: 0, needsHelp: 0, riskyAction: 0 } },
        projects: { active: 1, maintaining: 0, dormant: 0 },
        pace: { rhythmDelta: 0, label: '稳' },
        highOutput: { count: 3, avgDeltaPct: 0.4 },
        todayCostUsd: 0,
      },
    }));
    expect(html).toMatch(/↑40%/);
    expect(html).toContain('平均');
    expect(html).not.toContain('对比 7 日均值</span></div>\n      <svg');
  });

  it('renders "无突出" trend + "无" big number when highOutput.count === 0 (B-main)', () => {
    const html = renderKpisFragment(makeSnapshot({
      kpis: {
        teamActivity: { value: 1, deltaVsAvg: 0 },
        attention: { value: 0, deltaToday: 0, breakdown: { stuck: 0, needsHelp: 0, riskyAction: 0 } },
        projects: { active: 1, maintaining: 0, dormant: 0 },
        pace: { rhythmDelta: 0, label: '稳' },
        highOutput: { count: 0, avgDeltaPct: 0 },
        todayCostUsd: 0,
      },
    }));
    // good card (count=0) → big number says "无" instead of "0", trend "无突出"
    expect(html).toMatch(/kpi-good[\s\S]*?kpi-num">无</);
    expect(html).toContain('无突出');
    // spend card (0 → "—"), so "$0" no longer appears
    expect(html).toMatch(/kpi-spend[\s\S]*?kpi-num">—</);
    expect(html).not.toMatch(/\$0\.00/);
  });

  it('spend card shows real $ from todayCostUsd, not ¥k tokens', () => {
    const html = renderKpisFragment(makeSnapshot({
      kpis: {
        teamActivity: { value: 1, deltaVsAvg: 0 },
        attention: { value: 0, deltaToday: 0, breakdown: { stuck: 0, needsHelp: 0, riskyAction: 0 } },
        projects: { active: 1, maintaining: 0, dormant: 0 },
        pace: { rhythmDelta: 0, label: '稳' },
        highOutput: { count: 0, avgDeltaPct: 0 },
        todayCostUsd: 4.32,
      },
    }));
    expect(html).toContain('$4.32');
    expect(html).toContain('今日消耗');
    expect(html).not.toMatch(/¥/);
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
  it('B-main: tile drops 3 stat numbers in favor of phase + trend narrative', () => {
    const html = renderMembersFragment(snapWithMembers(2));
    // Old 3-cell stat grid retired
    expect(html).not.toContain('class="mt-stat-num"');
    expect(html).not.toContain('mt-stat-label');
    expect(html).not.toContain('mt-stats');
    // Spark line + phase + trend still present
    expect((html.match(/class="mt-spark"/g) ?? []).length).toBe(2);
    expect((html.match(/class="mt-phase"/g) ?? []).length).toBe(2);
    expect((html.match(/class="mt-trend"/g) ?? []).length).toBe(2);
    // Narrative phrases from _leader-lang.ts
    expect(html).toMatch(/推进|集中|整理|完善|梳理|规划|多线/); // phaseLabel branches
    expect(html).toMatch(/加速|稳步|放缓|收尾|未活跃|才开始/); // trendLabel branches
  });
  it('B-main: tile head has a colored health dot', () => {
    const html = renderMembersFragment(snapWithMembers(1));
    expect(html).toContain('class="mt-health-dot"');
    expect(html).toMatch(/var\(--accent\)|var\(--warn\)|var\(--danger\)/);
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
  it("escapes apostrophes in onclick payload (XSS hardening)", () => {
    // 2026-05-18 round-14: onclick now emits local-part (not full email)
    // so /api/members/:id matches its local-part contract. Apostrophe in
    // local-part still must escape to &#39; — bare quote would break out
    // of the inline JS string literal.
    const snap = makeSnapshot({
      members: [{
        email: "o'reilly@x.com", displayName: "o'reilly", stateBadge: 'active',
        today: { sessions: 1, tokens: 100, estMinutes: 5, costUsd: 0.1 },
        trend7d: [1], deltaVs7dAvgPct: 0, warnings: [], topProject: 'mr',
      } as never],
    });
    const html = renderMembersFragment(snap);
    expect(html).not.toContain("'reilly'");
    expect(html).toContain("openSO('member', 'o&#39;reilly')");
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
        activeTodayPct: 0.5, activeTodayCount: 1,
      })),
    });
  }
  it('emits id="projects" wrapper', () => {
    expect(renderProjectsFragment(snapWithProjects(3))).toMatch(/^<section[^>]*id="projects"/);
  });
  it('renders a row per project', () => {
    expect((renderProjectsFragment(snapWithProjects(5)).match(/class="proj-row"/g) ?? []).length).toBe(5);
  });

  // B-main: the progress-bar / avatar-stack treatment is retired in favor of
  // a 3-line narrative row (phase · trend → latest file → N/M 人 · ETA).
  it('B-main: row shows phase + trend narrative in line 1', () => {
    const html = renderProjectsFragment(snapWithProjects(1));
    expect(html).toContain('推进新功能'); // phaseLabel(implement)
    expect(html).toMatch(/加速|稳步|放缓|收尾|未活跃|才开始/); // trendLabel
    // Old visual progress bar gone
    expect(html).not.toContain('class="proj-bar"');
    expect(html).not.toContain('proj-people-stack');
  });

  it('B-main: row shows N/M 人在做 + etaLabel in line 3', () => {
    const html = renderProjectsFragment(makeSnapshot({
      projects: [{
        name: 'mr', state: 'active', contributors: [
          { email: 'a@x.com', sharePct: 0.5 },
          { email: 'b@x.com', sharePct: 0.3 },
          { email: 'c@x.com', sharePct: 0.2 },
        ], busFactorWarning: false, trend7d: [1,1,2,2,3,3,4], phaseGuess: 'implement',
        healthScore: 7, etaDays: 5, etaConfidence: 'low',
        activeTodayPct: 2 / 3, activeTodayCount: 2,
      }],
    }));
    expect(html).toContain('2/3 人在做');
    // etaDays 5 → 约 1 周
    expect(html).toContain('约 1 周');
  });

  it('B-main: row shows latest-file narrative when lastTouch is present', () => {
    const html = renderProjectsFragment(makeSnapshot({
      computedAt: '2026-05-17T12:00:00.000Z',
      projects: [{
        name: 'mr', state: 'active', contributors: [
          { email: 'a@x.com', sharePct: 1 },
        ], busFactorWarning: false, trend7d: [1,1,2,2,3,3,4], phaseGuess: 'implement',
        healthScore: 7, etaDays: 5, etaConfidence: 'low',
        activeTodayPct: 1, activeTodayCount: 1,
        lastTouch: { filePath: '/work/proj/api/overview.ts', by: 'hrdai@example.com', ts: '2026-05-17T10:00:00.000Z' },
      }],
    }));
    expect(html).toContain('api/overview.ts');
    expect(html).toContain('hrdai');
    expect(html).toMatch(/小时前|刚刚|今天/);
  });

  it('B-main: row falls back gracefully when lastTouch is absent', () => {
    const html = renderProjectsFragment(snapWithProjects(1));
    expect(html).toContain('暂无最近编辑');
  });

  it('B-main: row has a colored health dot', () => {
    const html = renderProjectsFragment(snapWithProjects(1));
    expect(html).toContain('class="proj-health-dot"');
    expect(html).toMatch(/var\(--accent\)|var\(--warn\)|var\(--danger\)/);
  });
});

// ── B-main: 本周关键进展 + 合作热点 ─────────────────────────────────────────

describe('renderHighlightsFragment (B-main)', () => {
  it('returns empty section when no highlights', () => {
    const html = renderHighlightsFragment(makeSnapshot({ highlights: [] }));
    expect(html).toContain('id="highlights"');
    expect(html).not.toContain('highlights-list');
  });

  it('renders rows with icon + project + author + relative time', () => {
    const html = renderHighlightsFragment(makeSnapshot({
      computedAt: '2026-05-17T12:00:00.000Z',
      highlights: [
        { ts: '2026-05-17T10:00:00.000Z', type: 'commit', by: 'hrdai', project: 'Matrix-Riven', detail: 'fix: x' },
        { ts: '2026-05-16T08:00:00.000Z', type: 'push', by: 'liusy', project: 'TeamBrain', detail: 'feat: y' },
      ],
    }));
    expect(html).toContain('hrdai');
    expect(html).toContain('Matrix-Riven');
    expect(html).toContain('liusy');
    expect(html).toContain('TeamBrain');
    expect(html).toMatch(/✓|↑|◆|★|#|⚠/); // icon glyphs
    expect((html.match(/class="hl-row"/g) ?? []).length).toBe(2);
  });

  it('caps at 10 entries', () => {
    const highlights = Array.from({ length: 15 }, (_, i) => ({
      ts: `2026-05-1${i % 7}T10:00:00.000Z`, type: 'commit' as const,
      by: 'u' + i, project: 'p' + i, detail: 'd',
    }));
    const html = renderHighlightsFragment(makeSnapshot({ highlights }));
    expect((html.match(/class="hl-row"/g) ?? []).length).toBe(10);
  });

  it('escapes user-supplied detail / project / author (XSS)', () => {
    const html = renderHighlightsFragment(makeSnapshot({
      computedAt: '2026-05-17T12:00:00.000Z',
      highlights: [{
        ts: '2026-05-17T10:00:00.000Z', type: 'commit',
        by: '<script>', project: '<bad>', detail: '<x>',
      }],
    }));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<bad>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;bad&gt;');
  });
});

describe('renderCollabFragment (B-main)', () => {
  it('returns empty section when no collaboration data', () => {
    const html = renderCollabFragment(makeSnapshot({ collaboration: [] }));
    expect(html).toContain('id="collab"');
    expect(html).not.toContain('collab-list');
  });

  it('renders top 3 collisions with member list and short file path', () => {
    const html = renderCollabFragment(makeSnapshot({
      collaboration: [
        { filePath: 'packages/server/src/config.ts', members: ['liboze@x.com', 'liusy@x.com'], lastTouched: '2026-05-15T08:00:00Z' },
        { filePath: 'packages/server/src/index.ts',  members: ['alice@x.com',  'bob@x.com'],   lastTouched: '2026-05-14T08:00:00Z' },
        { filePath: 'packages/cli/src/main.ts',      members: ['carol@x.com',  'dave@x.com'],  lastTouched: '2026-05-13T08:00:00Z' },
        { filePath: 'packages/cli/src/util.ts',      members: ['eve@x.com',    'frank@x.com'], lastTouched: '2026-05-12T08:00:00Z' },
      ],
    }));
    expect((html.match(/class="collab-row"/g) ?? []).length).toBe(3);
    expect(html).toContain('src/config.ts');
    expect(html).toContain('liboze · liusy');
    // 4 total → footer link visible
    expect(html).toContain('看全部 4 处');
  });

  it('escapes user-supplied file path / members (XSS)', () => {
    const html = renderCollabFragment(makeSnapshot({
      collaboration: [
        { filePath: '<bad>/x.ts', members: ['<script>@x.com', 'b@x.com'], lastTouched: '2026-05-15T08:00:00Z' },
      ],
    }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<bad>');
  });
});

// ── P-B7: per-section top-N cap + "see all" footer ───────────────────────────

describe('top-N cap + see-all footer (P-B7)', () => {
  function snapWithAttention(n: number) {
    return makeSnapshot({
      attention: Array.from({ length: n }, (_, i) => ({
        kind: 'member' as const, refId: `u${i}@x.com`, displayName: `user${i}`,
        initials: 'u' + i, tag: '闲置', tagSeverity: 'normal' as const,
        line2: 'x', time: '03:12', severity: 10 - i,
      })),
    });
  }
  function snapWithMembers(n: number) {
    return makeSnapshot({
      members: Array.from({ length: n }, (_, i) => ({
        email: `u${i}@x.com`, displayName: `user${i}`, stateBadge: 'active' as const,
        today: { sessions: 1, tokens: 100, estMinutes: 5, costUsd: 0.1 },
        trend7d: [1], deltaVs7dAvgPct: 0, warnings: [], topProject: 'mr',
      })),
    });
  }
  function snapWithProjects(n: number) {
    return makeSnapshot({
      projects: Array.from({ length: n }, (_, i) => ({
        name: `proj${i}`, state: 'active' as const, contributors: [
          { email: 'a@x.com', sharePct: 0.5 },
        ], busFactorWarning: false, trend7d: [1,2,3,4,5,6,7], phaseGuess: 'implement' as const,
        healthScore: 7, etaDays: 5, etaConfidence: 'low' as const,
        activeTodayPct: 1, activeTodayCount: 1,
      })),
    });
  }

  it('attention with limit 3 on 5 items → 3 rows + 1 see-all footer', () => {
    const html = renderAttentionFragment(snapWithAttention(5), { limit: 3 });
    expect((html.match(/class="att-row"/g) ?? []).length).toBe(3);
    expect((html.match(/class="see-all-row"/g) ?? []).length).toBe(1);
    expect(html).toContain('看全部 5 项');
    // Round-15: dead query param removed; link now goes to /people.
    expect(html).toContain('href="/people"');
    expect(html).not.toContain('focus=attention');
  });

  it('members with limit 4 on 6 items → 4 tiles + 1 see-all footer', () => {
    const html = renderMembersFragment(snapWithMembers(6), { limit: 4 });
    expect((html.match(/class="member-tile"/g) ?? []).length).toBe(4);
    expect((html.match(/class="see-all-row"/g) ?? []).length).toBe(1);
    expect(html).toContain('看全部 6 人');
    expect(html).toContain('href="/people"');
  });

  it('projects with limit 4 on 6 items → 4 rows + 1 see-all footer', () => {
    const html = renderProjectsFragment(snapWithProjects(6), { limit: 4 });
    expect((html.match(/class="proj-row"/g) ?? []).length).toBe(4);
    expect((html.match(/class="see-all-row"/g) ?? []).length).toBe(1);
    expect(html).toContain('看全部 6 个');
    expect(html).toContain('href="/projects"');
  });

  it('no see-all footer when total <= limit (attention)', () => {
    const html = renderAttentionFragment(snapWithAttention(2), { limit: 3 });
    expect((html.match(/class="att-row"/g) ?? []).length).toBe(2);
    expect(html).not.toContain('see-all-row');
  });

  it('no see-all footer when no limit passed (members)', () => {
    const html = renderMembersFragment(snapWithMembers(6));
    expect((html.match(/class="member-tile"/g) ?? []).length).toBe(6);
    expect(html).not.toContain('see-all-row');
  });

  it('no see-all footer when no limit passed (projects)', () => {
    const html = renderProjectsFragment(snapWithProjects(6));
    expect((html.match(/class="proj-row"/g) ?? []).length).toBe(6);
    expect(html).not.toContain('see-all-row');
  });

  it('section count reflects total (not the sliced count) on attention', () => {
    const html = renderAttentionFragment(snapWithAttention(5), { limit: 3 });
    expect(html).toContain('<span class="section-count">5</span>');
  });

  it('section count reflects total (not the sliced count) on members', () => {
    const html = renderMembersFragment(snapWithMembers(6), { limit: 4 });
    expect(html).toContain('<span class="section-count">6</span>');
  });
});

// ── L-10: views prefer llm* fields with template fallbacks ────────────────────

describe('L-10 LLM narrative — hero brief box (T5)', () => {
  it('renders no .brief-box when llmBrief is absent', () => {
    const html = renderHeroFragment(makeSnapshot());
    expect(html).not.toContain('brief-box');
    expect(html).not.toContain('aria-label="leader daily brief"');
  });

  it('renders no .brief-box when llmBrief is an empty array', () => {
    const html = renderHeroFragment(makeSnapshot({ llmBrief: [] }));
    expect(html).not.toContain('brief-box');
  });

  it('renders .brief-box with all three lines when llmBrief has 3 entries', () => {
    const html = renderHeroFragment(makeSnapshot({
      llmBrief: ['第一条 brief 文案', '第二条 brief 文案', '第三条 brief 文案'],
    }));
    expect(html).toContain('class="brief-box');
    expect(html).toContain('aria-label="leader daily brief"');
    expect(html).toContain('第一条 brief 文案');
    expect(html).toContain('第二条 brief 文案');
    expect(html).toContain('第三条 brief 文案');
    // Three brief-line divs.
    expect((html.match(/class="brief-line"/g) ?? []).length).toBe(3);
  });

  it('escapes HTML in llmBrief lines so injected <script> cannot run', () => {
    const html = renderHeroFragment(makeSnapshot({
      llmBrief: ['<script>alert(1)</script>', 'ok', 'ok'],
    }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('L-10 LLM narrative — attention rewrite (T4)', () => {
  it('uses escaped llmRewrite when present and drops legacy <span class="mono">', () => {
    const html = renderAttentionFragment(makeSnapshot({
      attention: [{
        kind: 'member', refId: 'a@x.com', displayName: 'a', initials: 'a',
        tag: 't', tagSeverity: 'urgent',
        line2: '上一次停在 <span class="mono">api/overview.ts</span>',
        time: '—', severity: 9,
        llmRewrite: 'Liboze 反复重试 build 命令，已 11 小时无进展',
      }],
    }));
    expect(html).toContain('Liboze 反复重试 build 命令，已 11 小时无进展');
    // Legacy mono-span markup must not appear when LLM rewrite is used.
    expect(html).not.toContain('<span class="mono">api/overview.ts</span>');
  });

  it('escapes HTML in llmRewrite — LLM string is external content', () => {
    const html = renderAttentionFragment(makeSnapshot({
      attention: [{
        kind: 'member', refId: 'a@x.com', displayName: 'a', initials: 'a',
        tag: 't', tagSeverity: 'urgent', line2: 'fallback',
        time: '—', severity: 9,
        llmRewrite: '<script>boom</script>',
      }],
    }));
    expect(html).not.toContain('<script>boom');
    expect(html).toContain('&lt;script&gt;');
  });

  it('falls back to unescaped line2 (trusted template HTML) when llmRewrite is undefined', () => {
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

describe('L-10 LLM narrative — member tile (T2)', () => {
  function memberFixture(overrides: Partial<MemberSnapshotFixture> = {}): OverviewSnapshotFixture {
    return makeSnapshot({
      members: [{
        email: 'u0@x.com', displayName: 'user0', stateBadge: 'active',
        today: { sessions: 5, tokens: 10000, estMinutes: 30, costUsd: 1.0 },
        trend7d: [1, 2, 3, 4, 5, 6, 7], deltaVs7dAvgPct: 0.1, warnings: [], topProject: 'mr',
        ...overrides,
      } as never],
    });
  }

  it('renders two LLM lines when llmWeekly is set; phase/trend template gone', () => {
    const html = renderMembersFragment(memberFixture({ llmWeekly: '本周聚焦 overview\n卡在 e2e 测试' } as never));
    expect(html).toContain('class="m-llm"');
    expect(html).toContain('本周聚焦 overview');
    expect(html).toContain('卡在 e2e 测试');
    // Phase + trend template classes absent when LLM lines are present.
    expect(html).not.toContain('class="mt-phase"');
    expect(html).not.toContain('class="mt-trend"');
  });

  it('falls back to phase/trend template when llmWeekly is absent', () => {
    const html = renderMembersFragment(memberFixture());
    expect(html).not.toContain('class="m-llm"');
    expect(html).toContain('class="mt-phase"');
    expect(html).toContain('class="mt-trend"');
    expect(html).toMatch(/推进|集中|整理|完善|梳理|规划|多线/); // phaseLabel
    expect(html).toMatch(/加速|稳步|放缓|收尾|未活跃|才开始/); // trendLabel
  });

  it('escapes HTML in llmWeekly lines', () => {
    const html = renderMembersFragment(memberFixture({ llmWeekly: '<script>x</script>\n<b>y</b>' } as never));
    expect(html).not.toContain('<script>x</script>');
    expect(html).not.toContain('<b>y</b>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;');
  });
});

describe('L-10 LLM narrative — project row (T3)', () => {
  function projFixture(overrides: Partial<ProjectSnapshotFixture> = {}): OverviewSnapshotFixture {
    return makeSnapshot({
      computedAt: '2026-05-17T12:00:00.000Z',
      projects: [{
        name: 'mr', state: 'active' as const, contributors: [
          { email: 'a@x.com', sharePct: 1 },
        ], busFactorWarning: false, trend7d: [1,1,2,2,3,3,4], phaseGuess: 'implement' as const,
        healthScore: 7, etaDays: 5, etaConfidence: 'low' as const,
        activeTodayPct: 1, activeTodayCount: 1,
        lastTouch: { filePath: '/work/proj/api/overview.ts', by: 'hrdai@example.com', ts: '2026-05-17T10:00:00.000Z' },
        ...overrides,
      } as never],
    });
  }

  it('renders both LLM lines when llmWeekly is set; "最近:" line gone', () => {
    const html = renderProjectsFragment(projFixture({ llmWeekly: '团队在做 overview tab\n进展正常 / 待 e2e 通过' } as never));
    expect(html).toContain('团队在做 overview tab');
    expect(html).toContain('进展正常 / 待 e2e 通过');
    expect(html).not.toContain('最近:');
    expect(html).not.toContain('api/overview.ts');
    // Name + N/M 人在做 + ETA still present.
    expect(html).toContain('mr');
    expect(html).toContain('1/1 人在做');
  });

  it('falls back to phase/trend subtitle + "最近:" line when llmWeekly is absent', () => {
    const html = renderProjectsFragment(projFixture());
    expect(html).toContain('最近:');
    expect(html).toContain('api/overview.ts');
    // Phase + trend narrative still in subtitle.
    expect(html).toMatch(/推进新功能/);
  });
});

describe('L-10 LLM narrative — highlight digest (T1)', () => {
  it('renders llmDigest when present and drops raw detail', () => {
    const html = renderHighlightsFragment(makeSnapshot({
      computedAt: '2026-05-17T12:00:00.000Z',
      highlights: [{
        ts: '2026-05-17T10:00:00.000Z', type: 'push',
        by: 'liboze', project: 'Matrix-Riven',
        detail: 'git push origin foo 2>&1 | tail -4',
        llmDigest: 'Liboze 推送 foo 分支',
      }],
    }));
    expect(html).toContain('Liboze 推送 foo 分支');
    expect(html).not.toContain('git push origin foo');
    expect(html).not.toContain('tail -4');
  });

  it('falls back to raw escaped detail when llmDigest is absent', () => {
    const html = renderHighlightsFragment(makeSnapshot({
      computedAt: '2026-05-17T12:00:00.000Z',
      highlights: [{
        ts: '2026-05-17T10:00:00.000Z', type: 'commit',
        by: 'liboze', project: 'Matrix-Riven',
        detail: 'fix: x',
      }],
    }));
    expect(html).toContain('fix: x');
  });

  it('escapes llmDigest — LLM output is external content', () => {
    const html = renderHighlightsFragment(makeSnapshot({
      computedAt: '2026-05-17T12:00:00.000Z',
      highlights: [{
        ts: '2026-05-17T10:00:00.000Z', type: 'commit',
        by: 'liboze', project: 'Matrix-Riven', detail: 'd',
        llmDigest: '<script>boom</script>',
      }],
    }));
    expect(html).not.toContain('<script>boom');
    expect(html).toContain('&lt;script&gt;');
  });
});

// These shims keep the test file standalone — the project doesn't export
// per-shape Fixture types and the test file already operates with `as never`
// casts when shaping member/project/snapshot objects. Aliasing for clarity.
type MemberSnapshotFixture = Record<string, unknown>;
type ProjectSnapshotFixture = Record<string, unknown>;
type OverviewSnapshotFixture = OverviewSnapshot;
