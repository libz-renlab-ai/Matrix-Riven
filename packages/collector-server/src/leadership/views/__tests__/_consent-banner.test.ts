/**
 * Round-7 P2 / autonomous — consent banner must include a scrim so
 * unacknowledged users can't click through to the underlying UI.
 */

import { describe, it, expect } from 'vitest';
import { renderConsentBanner, CONSENT_BANNER_CSS, CONSENT_BANNER_SCRIPT } from '../_consent-banner.html.js';

describe('renderConsentBanner', () => {
  it('returns empty string in demo mode (no consent gate on marketing surface)', () => {
    expect(renderConsentBanner({ demo: true })).toBe('');
  });

  it('renders banner + scrim in non-demo mode', () => {
    const html = renderConsentBanner({ demo: false });
    expect(html).toContain('id="consent-banner"');
    expect(html).toContain('id="consent-scrim"');
    expect(html).toContain('aria-modal="true"');
  });

  it('CSS defines a scrim with backdrop blur + dim', () => {
    expect(CONSENT_BANNER_CSS).toContain('.consent-scrim');
    expect(CONSENT_BANNER_CSS).toContain('inset: 0');
    expect(CONSENT_BANNER_CSS).toContain('rgba(20, 24, 36');
  });

  it('script toggles both banner and scrim "show" class together', () => {
    expect(CONSENT_BANNER_SCRIPT).toContain('consent-scrim');
    expect(CONSENT_BANNER_SCRIPT).toMatch(/banner\.classList\.add\('show'\)/);
    expect(CONSENT_BANNER_SCRIPT).toMatch(/scrim\.classList\.add\('show'\)/);
    expect(CONSENT_BANNER_SCRIPT).toMatch(/document\.body\.style\.overflow = 'hidden'/);
  });
});
