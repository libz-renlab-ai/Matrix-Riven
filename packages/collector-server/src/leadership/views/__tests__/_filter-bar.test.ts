import { describe, it, expect } from 'vitest';
import { renderFilterBar } from '../_filter-bar.html.js';
import type { FocusFilter } from '../../types.js';

function mkOpts(filter: FocusFilter, overrides: Partial<Parameters<typeof renderFilterBar>[0]> = {}) {
  return {
    filter,
    members: ['alex', 'blake', 'casey'],
    projects: ['matrix-riven', 'team-graph'],
    tab: 'overview' as const,
    ...overrides,
  };
}

describe('renderFilterBar', () => {
  it('returns empty string on retro tab', () => {
    expect(renderFilterBar(mkOpts({ range: 'today' }, { tab: 'retro' }))).toBe('');
  });

  it('default filter renders all 4 chips with "全部 X / 今日" + idle marker', () => {
    const html = renderFilterBar(mkOpts({ range: 'today' }));
    expect(html).toContain('全部成员');
    expect(html).toContain('全部项目');
    expect(html).toContain('今日');
    expect(html).toContain('全部状态');
    expect(html).toContain('点上方任一 chip 应用筛选');
    expect(html).toContain('data-active="false"');
  });

  it('focus chip active marks chip + bar as active', () => {
    const html = renderFilterBar(mkOpts({ range: 'today', focus: 'blake' }));
    expect(html).toContain('blake');
    expect(html).toContain('fb-chip-active');
    expect(html).toContain('data-active="true"');
    expect(html).toContain('↻ 清空');
    expect(html).toContain('data-fb-clear="focus"');
  });

  it('project chip active', () => {
    const html = renderFilterBar(mkOpts({ range: 'today', project: 'matrix-riven' }));
    expect(html).toContain('matrix-riven');
    expect(html).toContain('data-fb-clear="project"');
  });

  it('range !== today marks range chip active', () => {
    const html = renderFilterBar(mkOpts({ range: '7d' }));
    expect(html).toContain('近 7 天');
    expect(html).toContain('data-fb-clear="range"');
  });

  it('state chip active uses human label', () => {
    const html = renderFilterBar(mkOpts({ range: 'today', state: 'stuck' }));
    expect(html).toContain('进展受阻');
    expect(html).toContain('data-fb-clear="state"');
  });

  it('all 4 chips active simultaneously', () => {
    const html = renderFilterBar(
      mkOpts({ range: '7d', focus: 'blake', project: 'matrix-riven', state: 'stuck' }),
    );
    expect(html).toContain('blake');
    expect(html).toContain('matrix-riven');
    expect(html).toContain('近 7 天');
    expect(html).toContain('进展受阻');
    expect(html).toContain('data-active="true"');
  });

  it('member options serialised into chip data-fb-options', () => {
    const html = renderFilterBar(mkOpts({ range: 'today' }));
    // 3 members from the fixture, all should appear in the focus chip JSON
    expect(html).toMatch(/data-fb-chip="focus"[^>]*data-fb-options="[^"]*alex[^"]*blake[^"]*casey/);
  });

  it('escapes HTML in member / project names', () => {
    const html = renderFilterBar(
      mkOpts({ range: 'today' }, { members: ['<script>'], projects: ['"><img'] }),
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('"><img');
    expect(html).toContain('&lt;script&gt;');
  });

  it('demo flag surfaces in data-demo attribute', () => {
    const html = renderFilterBar(mkOpts({ range: 'today' }, { demo: true }));
    expect(html).toContain('data-demo="1"');
  });
});
