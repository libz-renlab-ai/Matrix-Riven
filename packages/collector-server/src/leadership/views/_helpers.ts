/**
 * Small pure helpers used by the leadership views.
 *
 * Extracted from styles.css.ts in P-B1 so that file can be a thin re-export
 * shim while the actual CSS lives in _css.ts.
 */

/** Helper to generate a deterministic avatar background color from an email. */
export function avatarColor(email: string): string {
  const palette = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f43f5e'];
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length]!;
}

/** Initials from email local-part (uppercase, max 2 chars). */
export function emailInitials(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local.slice(0, 2).toUpperCase();
}
