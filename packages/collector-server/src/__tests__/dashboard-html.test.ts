import { describe, it, expect } from 'vitest';
import { quotaBucket, DASHBOARD_HTML } from '../dashboard-html.js';

describe('quotaBucket', () => {
  it('returns "ok" for 0', () => {
    expect(quotaBucket(0)).toBe('ok');
  });

  it('returns "ok" just below the 50% threshold', () => {
    expect(quotaBucket(0.49999)).toBe('ok');
  });

  it('returns "warn" at exactly 50%', () => {
    expect(quotaBucket(0.5)).toBe('warn');
  });

  it('returns "warn" just below the 80% threshold', () => {
    expect(quotaBucket(0.79999)).toBe('warn');
  });

  it('returns "hot" at exactly 80%', () => {
    expect(quotaBucket(0.8)).toBe('hot');
  });

  it('returns "hot" at 100%', () => {
    expect(quotaBucket(1)).toBe('hot');
  });

  it('defensively returns "ok" for negative input', () => {
    expect(quotaBucket(-0.1)).toBe('ok');
  });

  it('defensively returns "ok" for NaN', () => {
    expect(quotaBucket(Number.NaN)).toBe('ok');
  });
});

describe('DASHBOARD_HTML template', () => {
  it('contains the quota bar CSS classes (qbar, qbadge)', () => {
    expect(DASHBOARD_HTML).toContain('qbar');
    expect(DASHBOARD_HTML).toContain('qbadge');
  });

  it('wires up the /api/quota fetch endpoint', () => {
    expect(DASHBOARD_HTML).toContain('/api/quota');
  });

  it('does not contain a literal </script> or </style> closing tag inside the template (would break inline parsing)', () => {
    // The template itself uses literal `</script>` and `</style>` to terminate
    // the inline blocks at the very end. We only want to assert there isn't a
    // second occurrence that would close them prematurely.
    const scriptCloses = DASHBOARD_HTML.match(/<\/script>/g) ?? [];
    const styleCloses = DASHBOARD_HTML.match(/<\/style>/g) ?? [];
    expect(scriptCloses.length).toBe(1);
    expect(styleCloses.length).toBe(1);
  });
});

describe('Overview tab hooks', () => {
  it('contains tab nav buttons for Browse and Overview', () => {
    expect(DASHBOARD_HTML).toMatch(/id=["']tab-btn-browse["']/);
    expect(DASHBOARD_HTML).toMatch(/id=["']tab-btn-overview["']/);
  });

  it('contains the Overview tab container and the 4 panel containers', () => {
    expect(DASHBOARD_HTML).toMatch(/id=["']tab-overview["']/);
    expect(DASHBOARD_HTML).toMatch(/id=["']panel-cost["']/);
    expect(DASHBOARD_HTML).toMatch(/id=["']panel-productivity["']/);
    expect(DASHBOARD_HTML).toMatch(/id=["']panel-projects["']/);
    expect(DASHBOARD_HTML).toMatch(/id=["']panel-quality["']/);
  });

  it('contains a fetch call to /api/overview', () => {
    expect(DASHBOARD_HTML).toContain('/api/overview');
  });

  it('defines an activateTab function', () => {
    expect(DASHBOARD_HTML).toContain('activateTab');
  });

  it('still wires up the Browse tab (regression: existing /api/users panel survives)', () => {
    expect(DASHBOARD_HTML).toMatch(/id=["']tab-browse["']/);
    expect(DASHBOARD_HTML).toContain('/api/users');
  });
});
