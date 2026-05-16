/**
 * Modern Card stylesheet for the Leadership Dashboard.
 *
 * Single exported string that gets inlined into each HTML page via a <style>
 * tag. Zero external CSS deps. System font stack with Chinese/CJK fallbacks.
 * Light theme, soft shadows, generous padding — per design spec §5.1-5.2.
 */
export const LEADERSHIP_CSS: string = `
:root {
  --bg-page: #f9fafb;
  --bg-card: #ffffff;
  --bg-subtle: #f4f4f5;
  --text-primary: #111827;
  --text-secondary: #6b7280;
  --text-muted: #9ca3af;
  --border: #e5e7eb;
  --shadow-sm: 0 1px 2px rgba(0,0,0,.04);
  --shadow-md: 0 1px 3px rgba(0,0,0,.06);
  --color-blue: #3b82f6;
  --color-blue-bg: #dbeafe;
  --color-green: #16a34a;
  --color-green-bg: #dcfce7;
  --color-amber: #d97706;
  --color-amber-bg: #fed7aa;
  --color-red: #dc2626;
  --color-red-bg: #fee2e2;
  --color-gray: #71717a;
  --color-gray-bg: #f4f4f5;
  --radius: 10px;
  --pad: 16px;
  --gap: 12px;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg-page);
  color: var(--text-primary);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
               'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  font-feature-settings: "tnum";
}

a { color: var(--color-blue); text-decoration: none; }
a:hover { text-decoration: underline; }

.lh-container {
  max-width: 1280px;
  margin: 0 auto;
  padding: 24px;
}

.lh-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 20px;
}
.lh-topbar h1 { margin: 0; font-size: 20px; font-weight: 600; }
.lh-topbar .lh-meta { color: var(--text-secondary); font-size: 13px; }
.lh-topbar .lh-refresh-tag {
  display: inline-block; padding: 4px 10px; border-radius: 16px;
  background: var(--color-blue-bg); color: var(--color-blue);
  font-size: 12px; font-weight: 500; margin-left: 8px;
}

.lh-kpi-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--gap);
  margin-bottom: 24px;
}
.lh-kpi-card {
  background: var(--bg-card);
  padding: var(--pad);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
}
.lh-kpi-card .label {
  color: var(--text-secondary);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-bottom: 6px;
}
.lh-kpi-card .value {
  font-size: 32px;
  font-weight: 600;
  line-height: 1.1;
  color: var(--text-primary);
}
.lh-kpi-card .sub {
  color: var(--text-secondary);
  font-size: 12px;
  margin-top: 6px;
}
.lh-kpi-card .delta { font-weight: 500; }
.lh-kpi-card .delta.pos { color: var(--color-green); }
.lh-kpi-card .delta.neg { color: var(--color-red); }

.lh-section-h {
  font-size: 14px;
  font-weight: 600;
  margin: 20px 0 12px 0;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.lh-member-list,
.lh-project-list,
.lh-collab-list {
  display: grid;
  gap: 8px;
}

.lh-member-card,
.lh-project-card,
.lh-collab-card {
  background: var(--bg-card);
  padding: 12px 16px;
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  transition: box-shadow 0.15s, transform 0.15s;
  text-decoration: none;
  color: inherit;
}
.lh-member-card:hover,
.lh-project-card:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
  text-decoration: none;
}

.lh-avatar {
  width: 32px; height: 32px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 600; font-size: 12px;
  flex-shrink: 0;
}
.lh-member-info { flex: 1; min-width: 0; }
.lh-member-name { font-weight: 600; color: var(--text-primary); }
.lh-member-meta { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }

.lh-badge {
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}
.lh-badge.ok { background: var(--color-green-bg); color: var(--color-green); }
.lh-badge.warn { background: var(--color-amber-bg); color: var(--color-amber); }
.lh-badge.stuck { background: var(--color-red-bg); color: var(--color-red); }
.lh-badge.quiet { background: var(--color-gray-bg); color: var(--color-gray); }
.lh-badge.low { background: var(--color-gray-bg); color: var(--color-gray); }
.lh-badge.help { background: var(--color-amber-bg); color: var(--color-amber); }

.lh-sparkline {
  display: inline-flex;
  align-items: flex-end;
  height: 24px;
  gap: 2px;
  margin: 0 8px;
}
.lh-sparkline span {
  display: inline-block;
  width: 4px;
  background: var(--color-blue);
  border-radius: 1px;
  opacity: 0.5;
}
.lh-sparkline span:last-child { opacity: 1; }

.lh-heatmap {
  display: grid;
  grid-template-columns: 40px repeat(24, 1fr);
  gap: 2px;
  margin: 12px 0;
}
.lh-heatmap .lh-hm-label {
  font-size: 11px;
  color: var(--text-secondary);
  text-align: right;
  padding-right: 4px;
}
.lh-heatmap .lh-hm-cell {
  height: 14px;
  background: var(--color-blue);
  border-radius: 2px;
}

.lh-detail-h1 {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 16px;
}
.lh-detail-h1 .back { font-size: 13px; color: var(--color-blue); }
.lh-detail-h1 h2 { margin: 0; font-size: 22px; font-weight: 600; }
.lh-detail-h1 .email { color: var(--text-secondary); font-size: 13px; }

.lh-detail-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--gap);
  margin-bottom: 20px;
}
.lh-detail-cards .lh-kpi-card .value { font-size: 22px; }

.lh-sessions-list { margin-top: 16px; }
.lh-session-item {
  background: var(--bg-card);
  padding: 12px 16px;
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  margin-bottom: 8px;
}
.lh-session-meta { font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; }
.lh-session-preview { color: var(--text-primary); font-size: 13px; }
.lh-session-item details summary {
  cursor: pointer; color: var(--color-blue); font-size: 12px; margin-top: 6px;
}
.lh-session-item details[open] summary { color: var(--text-secondary); }
.lh-session-full {
  white-space: pre-wrap;
  background: var(--bg-subtle);
  padding: 8px;
  border-radius: 6px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-primary);
}

.lh-eta-note {
  font-size: 11px;
  color: var(--color-amber);
  font-style: italic;
  margin-top: 4px;
}

.lh-bus-warning {
  background: var(--color-amber-bg);
  color: var(--color-amber);
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  margin-top: 8px;
}

.lh-empty {
  background: var(--bg-card);
  padding: 24px;
  border-radius: var(--radius);
  text-align: center;
  color: var(--text-secondary);
}

.lh-stack-bar {
  display: flex;
  height: 16px;
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-subtle);
  margin: 8px 0;
}
.lh-stack-bar > span {
  display: block;
  height: 100%;
}

table.lh-table { width: 100%; border-collapse: collapse; font-size: 13px; }
table.lh-table th { text-align: left; color: var(--text-secondary); font-weight: 500; padding: 6px 8px; border-bottom: 1px solid var(--border); }
table.lh-table td { padding: 6px 8px; border-bottom: 1px solid var(--bg-subtle); }
table.lh-table tr:last-child td { border-bottom: none; }

@media (max-width: 720px) {
  .lh-kpi-row { grid-template-columns: 1fr; }
  .lh-container { padding: 16px; }
}
`;

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
