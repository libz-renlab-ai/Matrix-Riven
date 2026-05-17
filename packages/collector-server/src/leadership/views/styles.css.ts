/**
 * Re-export shim for the leadership CSS module.
 *
 * The actual CSS lives in `_css.ts` (v7 Spatial tokens, locked in spec §3.4).
 * Helper functions live in `_helpers.ts`.
 *
 * Existing callers import { LEADERSHIP_CSS, avatarColor, emailInitials } from
 * './styles.css.js' — preserve those re-exports here.
 */
export { LEADERSHIP_CSS_V2 as LEADERSHIP_CSS } from './_css.js';
export { avatarColor, emailInitials } from './_helpers.js';
