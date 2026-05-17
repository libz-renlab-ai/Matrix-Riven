import { describe, it, expect } from 'vitest';
import { CLIENT_REFRESH_SCRIPT } from '../_refresh.js.js';

describe('CLIENT_REFRESH_SCRIPT (P-B5 base)', () => {
  it('exports a non-empty string', () => {
    expect(typeof CLIENT_REFRESH_SCRIPT).toBe('string');
    expect(CLIENT_REFRESH_SCRIPT.length).toBeGreaterThan(0);
  });
  it('attaches a click handler that sorts by data-sort', () => {
    expect(CLIENT_REFRESH_SCRIPT).toContain('data-sort');
    expect(CLIENT_REFRESH_SCRIPT).toContain('addEventListener');
  });
  it('defines window.openSO', () => {
    expect(CLIENT_REFRESH_SCRIPT).toContain('window.openSO');
  });
});

describe('CLIENT_REFRESH_SCRIPT slide-over wiring (P-B6)', () => {
  it('window.openSO fetches the correct API endpoint per kind', () => {
    expect(CLIENT_REFRESH_SCRIPT).toContain('/api/members/');
    expect(CLIENT_REFRESH_SCRIPT).toContain('/api/projects/');
    expect(CLIENT_REFRESH_SCRIPT).toContain('fetch(');
  });
  it('window.closeSO clears the open class and releases body scroll', () => {
    expect(CLIENT_REFRESH_SCRIPT).toContain('window.closeSO');
    expect(CLIENT_REFRESH_SCRIPT).toContain("classList.remove('open')");
    expect(CLIENT_REFRESH_SCRIPT).toContain("document.body.style.overflow = ''");
  });
  it('ESC key closes the drawer', () => {
    expect(CLIENT_REFRESH_SCRIPT).toMatch(/keydown/);
    expect(CLIENT_REFRESH_SCRIPT).toContain("'Escape'");
  });
  it('swaps the 4 _html fragments by stable slot id', () => {
    // The implementation iterates the slot list, so the literal strings must
    // be present even if construction is dynamic.
    for (const slot of ['callout', 'stats', 'evolve', 'projects']) {
      expect(CLIENT_REFRESH_SCRIPT).toContain(slot);
    }
    expect(CLIENT_REFRESH_SCRIPT).toContain('so-');
    expect(CLIENT_REFRESH_SCRIPT).toContain('_html');
  });
  it('reserves a soInterval var for P-C3 polling and clears it on close', () => {
    expect(CLIENT_REFRESH_SCRIPT).toContain('soInterval');
    expect(CLIENT_REFRESH_SCRIPT).toContain('clearInterval(soInterval)');
  });
});
