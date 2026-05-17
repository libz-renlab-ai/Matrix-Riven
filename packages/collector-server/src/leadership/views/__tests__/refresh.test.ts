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
  it('defines window.openSO as a stub (real wiring in P-B6)', () => {
    expect(CLIENT_REFRESH_SCRIPT).toContain('window.openSO');
  });
});
