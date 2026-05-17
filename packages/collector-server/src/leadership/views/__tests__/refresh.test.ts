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

describe('overview live polling (P-C2)', () => {
  it('schedules setInterval at 30s', () => {
    expect(CLIENT_REFRESH_SCRIPT).toContain('setInterval');
    expect(CLIENT_REFRESH_SCRIPT).toContain('30000');
  });
  it('sends If-None-Match header with current ETag', () => {
    expect(CLIENT_REFRESH_SCRIPT).toContain("'if-none-match'");
    expect(CLIENT_REFRESH_SCRIPT.toLowerCase()).toContain('if-none-match');
  });
  it('handles 304 by short-circuiting (no body parse)', () => {
    expect(CLIENT_REFRESH_SCRIPT).toMatch(/status\s*===\s*304/);
  });
  it('swaps 5 fragments via outerHTML', () => {
    for (const id of ['hero', 'kpis', 'attention', 'members', 'projects']) {
      expect(CLIENT_REFRESH_SCRIPT).toContain(`getElementById('${id}')`);
    }
    expect(CLIENT_REFRESH_SCRIPT).toContain('outerHTML');
  });
  it('reads/writes lastKpis from localStorage for delta badges', () => {
    expect(CLIENT_REFRESH_SCRIPT).toContain('localStorage');
    expect(CLIENT_REFRESH_SCRIPT).toContain('lh.lastKpis');
  });
  it('pulses live-dot after successful refresh', () => {
    expect(CLIENT_REFRESH_SCRIPT).toContain('live-dot');
    expect(CLIENT_REFRESH_SCRIPT).toContain('pulse');
  });
});

describe('slide-over live polling (P-C3)', () => {
  it('starts soInterval when openSO is called', () => {
    expect(CLIENT_REFRESH_SCRIPT).toContain('soInterval = setInterval');
  });
  it('cancels soInterval on closeSO', () => {
    expect(CLIENT_REFRESH_SCRIPT).toContain('clearInterval(soInterval)');
  });
  it('defines pollSO and tracks soEtag for If-None-Match', () => {
    expect(CLIENT_REFRESH_SCRIPT).toMatch(/pollSO|pollSlideover/);
    expect(CLIENT_REFRESH_SCRIPT).toContain('soEtag');
  });
  it('pollSO swaps 4 drawer fragment slots by id', () => {
    for (const slot of ['so-callout', 'so-stats', 'so-evolve', 'so-projects']) {
      expect(CLIENT_REFRESH_SCRIPT).toContain(`'${slot}'`);
    }
  });
  it('pollSO short-circuits on 304', () => {
    // After P-C3 the slide-over polling loop also short-circuits on 304,
    // and the existing P-C2 overview poll already contains a `status === 304`
    // check — so the literal must appear at least twice in the script.
    const matches = CLIENT_REFRESH_SCRIPT.match(/status\s*===\s*304/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});
