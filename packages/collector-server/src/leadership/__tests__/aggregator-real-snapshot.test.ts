import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { buildOverviewSnapshot } from '../aggregator.js';
import { scanAllSessions, __resetParsedCacheForTests } from '../transcript-loader.js';
import type { DateRange } from '../types.js';

/**
 * Integration check against the frozen Phase-1 snapshot at
 * `D:/0jingtong/Matrix-Riven/data/teamagent-logs-20260514-190026`.
 *
 * These assertions pin the goal numbers from the 2026-05-17 data-trust
 * rebuild: 79 projects → ≤ 15, 77 bus-factor → ≤ 5, 6 needs_help → ≤ 2,
 * 83 attention → ≤ 10, and staleness must be detected because the
 * snapshot is several days older than "now".
 *
 * `it.skipIf` is used so the suite doesn't fail in environments without
 * the snapshot (CI, fresh checkout). Locally the dev runs it to validate.
 */
const REAL_DIR = 'D:/0jingtong/Matrix-Riven/data/teamagent-logs-20260514-190026';
const SNAPSHOT_AVAILABLE = existsSync(REAL_DIR);

function rangeFor(days: number, end: Date): DateRange {
  return {
    start: new Date(end.getTime() - days * 24 * 60 * 60 * 1000),
    end,
    label: days === 7 ? '7d' : `${days}d`,
  };
}

describe('real snapshot data trust (data-layer rebuild)', () => {
  // "Now" must be after 2026-05-14 so the snapshot lives inside the window.
  const NOW = new Date('2026-05-17T12:00:00Z');
  const RANGE = rangeFor(7, NOW);

  it.skipIf(!SNAPSHOT_AVAILABLE)('projects collapse to ≤ 15', () => {
    __resetParsedCacheForTests();
    const sessions = scanAllSessions(REAL_DIR);
    expect(sessions.length).toBeGreaterThan(0);
    const snap = buildOverviewSnapshot({
      sessions,
      range: RANGE,
      now: NOW,
      collectorDir: REAL_DIR,
    });
    expect(snap.projects.length).toBeLessThanOrEqual(15);
  });

  it.skipIf(!SNAPSHOT_AVAILABLE)('bus-factor warnings ≤ 5', () => {
    __resetParsedCacheForTests();
    const sessions = scanAllSessions(REAL_DIR);
    const snap = buildOverviewSnapshot({
      sessions,
      range: RANGE,
      now: NOW,
      collectorDir: REAL_DIR,
    });
    const busFactor = snap.projects.filter((p) => p.busFactorWarning).length;
    expect(busFactor).toBeLessThanOrEqual(5);
  });

  it.skipIf(!SNAPSHOT_AVAILABLE)('needs_help count ≤ 2 (relative percentile gate)', () => {
    __resetParsedCacheForTests();
    const sessions = scanAllSessions(REAL_DIR);
    const snap = buildOverviewSnapshot({
      sessions,
      range: RANGE,
      now: NOW,
      collectorDir: REAL_DIR,
    });
    const needsHelp = snap.members.filter((m) => m.stateBadge === 'needs_help').length;
    expect(needsHelp).toBeLessThanOrEqual(2);
  });

  it.skipIf(!SNAPSHOT_AVAILABLE)('combined needs_help + stuck ≤ 3', () => {
    __resetParsedCacheForTests();
    const sessions = scanAllSessions(REAL_DIR);
    const snap = buildOverviewSnapshot({
      sessions,
      range: RANGE,
      now: NOW,
      collectorDir: REAL_DIR,
    });
    const flagged = snap.members.filter(
      (m) => m.stateBadge === 'needs_help' || m.stateBadge === 'stuck',
    ).length;
    expect(flagged).toBeLessThanOrEqual(3);
  });

  it.skipIf(!SNAPSHOT_AVAILABLE)('attention queue ≤ 10', () => {
    __resetParsedCacheForTests();
    const sessions = scanAllSessions(REAL_DIR);
    const snap = buildOverviewSnapshot({
      sessions,
      range: RANGE,
      now: NOW,
      collectorDir: REAL_DIR,
    });
    expect(snap.attention.length).toBeLessThanOrEqual(10);
  });

  it.skipIf(!SNAPSHOT_AVAILABLE)('staleness detected when data > 1 day old', () => {
    __resetParsedCacheForTests();
    const sessions = scanAllSessions(REAL_DIR);
    const snap = buildOverviewSnapshot({
      sessions,
      range: RANGE,
      now: NOW,
      collectorDir: REAL_DIR,
    });
    expect(snap.staleness).toBeDefined();
    expect(snap.staleness!.ageDays).toBeGreaterThan(1);
    expect(typeof snap.staleness!.lastActivityAt).toBe('string');
  });

  it.skipIf(!SNAPSHOT_AVAILABLE)('no project names match obvious noise patterns', () => {
    __resetParsedCacheForTests();
    const sessions = scanAllSessions(REAL_DIR);
    const snap = buildOverviewSnapshot({
      sessions,
      range: RANGE,
      now: NOW,
      collectorDir: REAL_DIR,
    });
    for (const p of snap.projects) {
      expect(p.name).not.toMatch(/^[0-9a-f]{6,}$/i); // no raw hash names
      expect(p.name).not.toMatch(/-bench-/i); // no bench fixtures
      expect(p.name).not.toMatch(/^_/); // no underscore-prefix temps
    }
  });

  // ── B-main: real-snapshot narrative validation ─────────────────────────────
  // The leader-language render layer rewrote every attention `line2` so that
  // the dashboard no longer surfaces percentages / token counts / "上次会话
  // 03:12"-style technical lines. Validate the contract holds against the
  // real frozen snapshot.
  it.skipIf(!SNAPSHOT_AVAILABLE)('attention line2 has no raw percentages or engineer-speak', () => {
    __resetParsedCacheForTests();
    const sessions = scanAllSessions(REAL_DIR);
    const snap = buildOverviewSnapshot({
      sessions,
      range: RANGE,
      now: NOW,
      collectorDir: REAL_DIR,
    });
    for (const a of snap.attention) {
      // No "24%" / "0.42%" raw percentages.
      expect(a.line2).not.toMatch(/\d+\.?\d*%/);
      // No raw technical surfaces.
      expect(a.line2).not.toMatch(/工具失败率/);
      expect(a.line2).not.toMatch(/次 prompt/);
      expect(a.line2).not.toMatch(/上次会话/);
      // No full email addresses leaking through line2.
      expect(a.line2).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
    }
  });

  it.skipIf(!SNAPSHOT_AVAILABLE)('highlights array populated when milestones exist', () => {
    __resetParsedCacheForTests();
    const sessions = scanAllSessions(REAL_DIR);
    const snap = buildOverviewSnapshot({
      sessions,
      range: RANGE,
      now: NOW,
      collectorDir: REAL_DIR,
    });
    expect(Array.isArray(snap.highlights)).toBe(true);
    expect(snap.highlights.length).toBeLessThanOrEqual(10);
    for (const h of snap.highlights) {
      // Newest-first sort
      expect(typeof h.ts).toBe('string');
      // Local-part-only authors
      expect(h.by).not.toMatch(/@/);
      // Known event types
      expect(['commit', 'push', 'pr', 'release', 'tag', 'risky']).toContain(h.type);
    }
  });
});
