import { describe, it, expect } from 'vitest';
import { renderProjectDetail } from '../project-detail.html.js';
import type { ProjectSnapshot, ProjectDetail } from '../../types.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeHeatmap(): number[][] {
  // 7 rows × 24 cols
  return Array.from({ length: 7 }, (_, r) =>
    Array.from({ length: 24 }, (_, c) => (r === 6 && c === 10 ? 50 : r === 5 && c === 14 ? 30 : 0)),
  );
}

function makeDetail(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    todayFiles: ['src/index.ts', 'src/routes.ts'],
    weekFiles: ['src/index.ts', 'src/routes.ts', 'src/types.ts'],
    extensionMix: { '.ts': 0.6, '.md': 0.3, '.json': 0.1 },
    testRatio: 0.25,
    milestones: [
      {
        ts: '2026-05-15T09:00:00.000Z',
        type: 'commit',
        by: 'liboze@example.com',
        detail: 'feat: add routes',
      },
      {
        ts: '2026-05-15T14:00:00.000Z',
        type: 'push',
        by: 'alice@example.com',
        detail: 'git push origin main',
      },
    ],
    webResearchShare: 0.15,
    heatmap7x24: makeHeatmap(),
    recentFiles: [
      { path: 'src/index.ts', touches: 14 },
      { path: 'src/routes.ts', touches: 9 },
    ],
    collabDensity: 0.4,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<ProjectSnapshot & { detail: ProjectDetail }> = {}): ProjectSnapshot & { detail: ProjectDetail } {
  const { detail: detailOverrides, ...snapOverrides } = overrides as Partial<ProjectSnapshot> & { detail?: Partial<ProjectDetail> };
  return {
    name: 'Matrix-Riven',
    state: 'active',
    contributors: [
      { email: 'liboze@example.com', sharePct: 0.75 },  // top contributor 75% → bus factor warning
      { email: 'alice@example.com', sharePct: 0.15 },
      { email: 'bob@example.com', sharePct: 0.10 },
    ],
    busFactorWarning: true,
    trend7d: [2, 3, 5, 4, 6, 7, 8],
    phaseGuess: 'implement',
    healthScore: 8,
    etaDays: 14,
    etaConfidence: 'low',
    detail: makeDetail(detailOverrides),
    ...snapOverrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('renderProjectDetail', () => {
  it('returns a full HTML document (DOCTYPE + html + closing body)', () => {
    const html = renderProjectDetail(makeSnapshot());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</body>');
    expect(html).toContain('</html>');
  });

  it('shows project name in <title> and in the page heading', () => {
    const html = renderProjectDetail(makeSnapshot());
    expect(html).toContain('Matrix-Riven');
    // Title tag should include project name
    const titleMatch = html.match(/<title>(.*?)<\/title>/);
    expect(titleMatch).toBeTruthy();
    expect(titleMatch![1]).toContain('Matrix-Riven');
  });

  it('includes a back link to /overview', () => {
    const html = renderProjectDetail(makeSnapshot());
    expect(html).toContain('href="/overview"');
    expect(html).toContain('← Overview');
  });

  it('shows state badge with correct label', () => {
    const html = renderProjectDetail(makeSnapshot({ state: 'active' }));
    expect(html).toContain('活跃');

    const htmlMaint = renderProjectDetail(makeSnapshot({ state: 'maintaining' }));
    expect(htmlMaint).toContain('维护');
  });

  it('shows ETA disclaimer note when etaDays is non-null', () => {
    const html = renderProjectDetail(makeSnapshot({ etaDays: 14, etaConfidence: 'low' }));
    expect(html).toContain('≈ 14 天');
    expect(html).toContain('lh-eta-note');
    expect(html).toContain('基于节奏估算');
  });

  it('shows ETA missing message when etaDays is null', () => {
    const html = renderProjectDetail(makeSnapshot({ etaDays: null }));
    expect(html).toContain('数据不足');
    expect(html).not.toContain('≈');
  });

  it('shows bus-factor warning when busFactorWarning is true', () => {
    const html = renderProjectDetail(makeSnapshot({ busFactorWarning: true }));
    expect(html).toContain('<div class="lh-bus-warning">');
    expect(html).toContain('单人风险');
  });

  it('does NOT show bus-factor warning when busFactorWarning is false', () => {
    const html = renderProjectDetail(makeSnapshot({
      busFactorWarning: false,
      contributors: [
        { email: 'liboze@example.com', sharePct: 0.40 },
        { email: 'alice@example.com', sharePct: 0.35 },
        { email: 'bob@example.com', sharePct: 0.25 },
      ],
    }));
    // The warning div should not appear — CSS definition contains 'lh-bus-warning' but the div element should not
    expect(html).not.toContain('<div class="lh-bus-warning">');
    expect(html).not.toContain('单人风险');
  });

  it('renders milestones table with correct row count', () => {
    const html = renderProjectDetail(makeSnapshot());
    // Should have a milestones table with thead and tbody
    expect(html).toContain('<table class="lh-table">');
    // Two milestone rows
    expect(html).toContain('feat: add routes');
    expect(html).toContain('git push origin main');
  });

  it('shows empty milestones message when milestones array is empty', () => {
    const html = renderProjectDetail(makeSnapshot({ detail: makeDetail({ milestones: [] }) }));
    expect(html).toContain('本窗口内无里程碑事件');
  });

  it('heatmap contains exactly 168 cells (7×24)', () => {
    const html = renderProjectDetail(makeSnapshot());
    const cellMatches = html.match(/<div class="lh-hm-cell"/g);
    expect(cellMatches).toBeTruthy();
    expect(cellMatches!.length).toBe(168);
  });

  it('shows healthScore in KPI cards', () => {
    const html = renderProjectDetail(makeSnapshot({ healthScore: 8 }));
    expect(html).toContain('8/10');
  });

  it('shows state badge in the header area', () => {
    const html = renderProjectDetail(makeSnapshot({ state: 'dormant' }));
    expect(html).toContain('沉睡');
    // badge class for dormant is 'quiet'
    expect(html).toContain('lh-badge quiet');
  });

  it('renders tech stack bar with extension mix data', () => {
    const html = renderProjectDetail(makeSnapshot());
    // extensionMix has .ts, .md, .json
    expect(html).toContain('.ts');
    expect(html).toContain('.md');
    expect(html).toContain('.json');
    expect(html).toContain('lh-stack-bar');
  });

  it('renders recent files table', () => {
    const html = renderProjectDetail(makeSnapshot());
    expect(html).toContain('src/index.ts');
    expect(html).toContain('src/routes.ts');
  });

  it('shows web research share and test-edit ratio metadata', () => {
    const html = renderProjectDetail(makeSnapshot());
    // testRatio = 0.25 → "0.25"
    expect(html).toContain('0.25');
    // webResearchShare = 0.15 → "15%"
    expect(html).toContain('15');
    expect(html).toContain('web 检索占比');
  });

  it('renders contributors list with share percentages', () => {
    const html = renderProjectDetail(makeSnapshot());
    expect(html).toContain('lh-member-list');
    // Top contributor 75%
    expect(html).toContain('75.0%');
  });

  it('shows empty contributors message when contributors list is empty', () => {
    const html = renderProjectDetail(makeSnapshot({
      contributors: [],
      busFactorWarning: false,
    }));
    expect(html).toContain('无贡献者数据');
  });
});
