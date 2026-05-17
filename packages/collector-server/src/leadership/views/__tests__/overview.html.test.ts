import { describe, it, expect } from 'vitest';
import { renderOverview, escapeHtml } from '../overview.html.js';
import type { OverviewSnapshot } from '../../types.js';

function fixture(): OverviewSnapshot {
  return {
    schemaVersion: 1,
    range: { start: '2026-05-08T00:00:00Z', end: '2026-05-15T00:00:00Z', label: '7d' },
    computedAt: '2026-05-15T12:00:00.000Z',
    kpis: {
      teamActivity: { value: 147, deltaVsAvg: 0 },
      attention: { value: 3, deltaToday: 0, breakdown: { stuck: 1, needsHelp: 2, riskyAction: 0 } },
      projects: { active: 4, maintaining: 2, dormant: 1 },
    },
    members: [
      { email: 'liboze@x.com', displayName: 'liboze', stateBadge: 'active', today: { sessions: 14, tokens: 892000, estMinutes: 372, costUsd: 13.2 }, trend7d: [1,2,3,4,3,5,7], deltaVs7dAvgPct: 0.18, warnings: [] },
      { email: 'liusy@x.com',  displayName: 'liusy',  stateBadge: 'stuck',  today: { sessions: 5, tokens: 50000, estMinutes: 80, costUsd: 2.1 }, trend7d: [0,0,0,1,2,3,5], deltaVs7dAvgPct: 0.5, warnings: ['tool 失败率 30%'] },
    ],
    projects: [
      { name: 'Matrix-Riven', state: 'active', contributors: [{ email: 'liboze@x.com', sharePct: 0.6 }, { email: 'liusy@x.com', sharePct: 0.4 }], busFactorWarning: false, trend7d: [1,3,5,4,4,5,7], phaseGuess: 'debug', healthScore: 7.2, etaDays: 5, etaConfidence: 'low' },
    ],
    collaboration: [
      { filePath: 'packages/shared/src/config.ts', members: ['liboze@x.com', 'liusy@x.com'], lastTouched: '2026-05-14T22:00:00.000Z' },
    ],
  };
}

describe('renderOverview', () => {
  it('returns a complete HTML document with leadership CSS embedded', () => {
    const html = renderOverview(fixture());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
    expect(html).toContain('.kpis');  // v7 KPI CSS class from _css.ts
    expect(html).toContain('<script>');  // refresh script
    expect(html).not.toContain('<script src=');  // no external scripts
  });

  it('includes all member display names', () => {
    const html = renderOverview(fixture());
    expect(html).toContain('>liboze<');
    expect(html).toContain('>liusy<');
  });

  it('mounts the v7 hero and KPI fragments', () => {
    const html = renderOverview(fixture());
    expect(html).toMatch(/id="hero"/);
    expect(html).toMatch(/id="kpis"/);
    // The attention KPI value (fixture: 3) shows on the kpi-num
    expect(html).toMatch(/class="kpi-num"[^>]*>\s*3/);
  });

  it('shows ETA disclaimer when etaDays is set', () => {
    const html = renderOverview(fixture());
    expect(html).toMatch(/5 天.{0,20}按节奏估算/);
  });

  it('shows empty state when members list is empty', () => {
    const html = renderOverview({ ...fixture(), members: [] });
    expect(html).toMatch(/没有成员活动/);
  });

  it('renders project links with URL-encoded names', () => {
    const html = renderOverview({ ...fixture(), projects: [{ ...fixture().projects[0]!, name: 'My Project' }] });
    expect(html).toContain('href="/projects/My%20Project"');
  });

  it('shows collaboration section when hits exist', () => {
    const html = renderOverview(fixture());
    expect(html).toContain('协作机会');
    expect(html).toContain('packages/shared/src/config.ts');
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML entities', () => {
    expect(escapeHtml('<>&"\'')).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});
