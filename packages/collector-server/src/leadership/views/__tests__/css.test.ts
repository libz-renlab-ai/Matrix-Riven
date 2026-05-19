import { describe, it, expect } from 'vitest';
import { LEADERSHIP_CSS } from '../styles.css.js';

describe('v7 Spatial design tokens (P-B1)', () => {
  const css = LEADERSHIP_CSS;
  const flat = css.replace(/\s+/g, ' ');

  it.each([
    '--bg: #F7F6F2',
    '--surface: #FFFFFF',
    '--ink-1: #1C1B19',
    '--ink-3: #7A776F',
    '--accent: #6F8B5E',
    '--accent-soft:#E8EEDF',
    '--warn: #C8924B',
    '--danger: #B0625A',
    '--calm: #8A9AAA',
    '--hairline: #ECEAE2',
    '--r-xl: 28px',
    '--r-lg: 20px',
    '--ease: cubic-bezier(.2,.7,.2,1)',
    '--spring: cubic-bezier(.34,1.56,.64,1)',
  ])('contains token %s', (token) => {
    expect(flat).toContain(token.replace(/\s+/g, ' '));
  });

  it('uses Inter, JetBrains Mono, Newsreader family stacks with native fallbacks', () => {
    // 2026-05-18 launch audit P1-B: the previous Google Fonts @import was
    // removed so every page render no longer beacons to fonts.googleapis.com
    // (the /sources page claims "不外发给第三方"). We still NAME the
    // designer-chosen families so a browser that ships them (or a future
    // self-hosted woff2) picks them up; the system-font fallbacks take over
    // otherwise.
    expect(css).not.toContain('fonts.googleapis.com');
    expect(css).not.toContain('@import url(');
    expect(css).toContain('Inter');
    expect(css).toContain('Newsreader');
  });

  it('applies three-layer radial mesh on body::before', () => {
    expect(css).toMatch(/body::before[\s\S]*radial-gradient/);
    expect((css.match(/radial-gradient/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('uses tabular-nums + cv11/ss01 ligatures by default', () => {
    expect(css).toContain('font-feature-settings');
    expect(css).toContain('tnum');
  });

  it('reexports helpers via styles.css.ts', async () => {
    const mod = await import('../styles.css.js');
    expect(typeof mod.avatarColor).toBe('function');
    expect(typeof mod.emailInitials).toBe('function');
  });
});
