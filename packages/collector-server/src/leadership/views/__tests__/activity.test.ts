import { describe, it, expect } from 'vitest';
import { renderActivityPage } from '../activity.html.js';
import type { ActivityFeedSnapshot, ActivityEvent } from '../../types.js';

function mkSnap(overrides: Partial<ActivityFeedSnapshot> = {}): ActivityFeedSnapshot {
  return {
    schemaVersion: 1,
    range: { start: '2026-05-11T00:00:00Z', end: '2026-05-18T12:00:00Z', label: '7d' },
    events: [],
    hasMore: false,
    computedAt: '2026-05-18T12:00:00Z',
    ...overrides,
  };
}

function ev(t: ActivityEvent['type'], ts: string, by: string, summary: string, project = 'p1', detail?: ActivityEvent['detail']): ActivityEvent {
  return { type: t, ts, by, project, summary, detail };
}

describe('renderActivityPage', () => {
  it('renders nav + hero + empty state when no events', () => {
    const html = renderActivityPage(mkSnap());
    expect(html).toContain('活动流');
    expect(html).toContain('没有活动');
  });

  it('groups events by date with 今天 / 昨天 headers in the server-local timezone', () => {
    const now = new Date();
    // Local yesterday at noon — unambiguously the previous LOCAL calendar day.
    const yNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12, 0, 0).toISOString();
    const snap = mkSnap({
      events: [
        ev('session', now.toISOString(), 'alice@x', 'today event'),
        ev('commit', yNoon, 'bob@x', 'yesterday event'),
        ev('session', '2026-05-10T08:00:00Z', 'casey@x', 'older event'),
      ],
    });
    const html = renderActivityPage(snap);
    expect(html).toContain('今天');
    expect(html).toContain('昨天');
    // Older events label by their LOCAL calendar date.
    const old = new Date('2026-05-10T08:00:00Z');
    const oldKey = `${old.getFullYear()}-${String(old.getMonth() + 1).padStart(2, '0')}-${String(old.getDate()).padStart(2, '0')}`;
    expect(html).toContain(oldKey);
  });

  it('renders the event time in the server-local timezone (not UTC)', () => {
    const ts = '2026-05-18T10:30:00Z';
    const d = new Date(ts);
    const localHhMm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const snap = mkSnap({
      events: [ev('session', ts, 'alice@x.com', 'hello prompt', 'matrix-riven')],
    });
    const html = renderActivityPage(snap);
    expect(html).toContain(localHhMm);
    // Regression guard: on a non-UTC host the local time must differ from the
    // raw UTC slice the renderer used to print.
    if (d.getTimezoneOffset() !== 0) {
      expect(html).not.toContain(`activity-time">${ts.slice(11, 16)}<`);
    }
    expect(html).toContain('📝');
    expect(html).toContain('alice'); // local-part only
    expect(html).toContain('matrix-riven');
    expect(html).toContain('hello prompt');
  });

  it('commit / push / release have distinct icons and row classes', () => {
    const snap = mkSnap({
      events: [
        ev('commit', '2026-05-18T10:00:00Z', 'a@x', 'feat: x'),
        ev('push', '2026-05-18T10:01:00Z', 'a@x', 'push to main'),
        ev('release', '2026-05-18T10:02:00Z', 'a@x', 'v1'),
      ],
    });
    const html = renderActivityPage(snap);
    expect(html).toContain('✅');
    expect(html).toContain('🚀');
    expect(html).toContain('🏷️');
    expect(html).toContain('activity-row-commit');
    expect(html).toContain('activity-row-push');
    expect(html).toContain('activity-row-release');
  });

  it('session with promptFull renders an expand <details>', () => {
    const snap = mkSnap({
      events: [
        ev('session', '2026-05-18T10:00:00Z', 'a@x', 'short preview', 'p', {
          promptFull: 'short preview\nplus additional lines\nfor inline expand',
        }),
      ],
    });
    const html = renderActivityPage(snap);
    expect(html).toContain('<details');
    expect(html).toContain('查看完整 prompt');
    expect(html).toContain('plus additional lines');
  });

  it('hasMore + nextCursor renders "加载更早" link', () => {
    const snap = mkSnap({
      events: [ev('session', '2026-05-18T10:00:00Z', 'a@x', 'last on this page')],
      hasMore: true,
      nextCursor: '2026-05-17T08:00:00Z',
    });
    const html = renderActivityPage(snap);
    expect(html).toContain('加载更早');
    expect(html).toContain('before=2026-05-17T08%3A00%3A00Z');
  });

  it('injects filter bar HTML when provided', () => {
    const html = renderActivityPage(mkSnap(), { filterBarHtml: '<div class="filter-bar">FB</div>' });
    expect(html).toContain('filter-bar');
  });

  it('escapes HTML in summary', () => {
    const snap = mkSnap({
      events: [ev('session', '2026-05-18T10:00:00Z', 'a@x', '<img src=x onerror=alert(1)>')],
    });
    const html = renderActivityPage(snap);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('§5.8: sub-header carries a live last-tick timestamp with data-computed-at', () => {
    const snap = mkSnap();
    const html = renderActivityPage(snap);
    expect(html).toContain('id="activity-last-tick"');
    expect(html).toContain('data-computed-at="2026-05-18T12:00:00Z"');
    expect(html).toContain('最近一次');
    // Client-side ticker script lives in the page.
    expect(html).toContain('activity-last-tick');
    expect(html).toMatch(/setInterval\(tick/);
  });
});
