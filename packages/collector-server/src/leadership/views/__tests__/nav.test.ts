import { describe, it, expect } from 'vitest';
import { renderNav } from '../_nav.html.js';

describe('renderNav (P-B2)', () => {
  it.each(['Overview', 'People', 'Projects', 'Activity', 'Insights'])(
    'contains tab %s',
    (label) => {
      expect(renderNav('overview')).toContain(label);
    },
  );

  it('marks the active tab with class="tab active"', () => {
    const html = renderNav('people');
    expect(html).toMatch(/class="tab active"[^>]*>[^<]*People/);
  });

  it('includes brand mark and live dot', () => {
    const html = renderNav('overview');
    expect(html).toContain('class="brand-mark"');
    expect(html).toContain('class="live-dot"');
  });

  it('emits 5 anchors, one per tab', () => {
    const html = renderNav('overview');
    expect((html.match(/<a class="tab/g) ?? []).length).toBe(5);
  });

  it('default rangeLabel is "7 日窗口"', () => {
    const html = renderNav('overview');
    expect(html).toContain('7 日窗口');
  });

  it('custom rangeLabel is rendered', () => {
    const html = renderNav('overview', { rangeLabel: '30 日窗口' });
    expect(html).toContain('30 日窗口');
  });

  it('escapes rangeLabel for XSS', () => {
    const html = renderNav('overview', { rangeLabel: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('only one tab is marked active at a time', () => {
    const html = renderNav('projects');
    expect((html.match(/class="tab active"/g) ?? []).length).toBe(1);
    expect(html).toMatch(/class="tab active"[^>]*>[^<]*Projects/);
  });
});
