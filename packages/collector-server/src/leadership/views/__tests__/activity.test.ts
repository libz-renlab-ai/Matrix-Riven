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

  it('groups events by date with 今天 / 昨天 headers', () => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const snap = mkSnap({
      events: [
        ev('session', today + 'T10:00:00Z', 'alice@x', 'today event'),
        ev('commit', yesterday + 'T09:00:00Z', 'bob@x', 'yesterday event'),
        ev('session', '2026-05-10T08:00:00Z', 'casey@x', 'older event'),
      ],
    });
    const html = renderActivityPage(snap);
    expect(html).toContain('今天');
    expect(html).toContain('昨天');
    expect(html).toContain('2026-05-10');
  });

  it('renders event row with time / icon / by / project / summary', () => {
    const snap = mkSnap({
      events: [ev('session', '2026-05-18T10:30:00Z', 'alice@x.com', 'hello prompt', 'matrix-riven')],
    });
    const html = renderActivityPage(snap);
    expect(html).toContain('10:30');
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
});
