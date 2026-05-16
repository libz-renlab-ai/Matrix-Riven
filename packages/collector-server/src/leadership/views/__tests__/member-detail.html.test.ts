import { describe, it, expect } from 'vitest';
import { renderMemberDetail } from '../member-detail.html.js';
import type { MemberSnapshot, MemberDetail, SessionSummary } from '../../types.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeHeatmap(): number[][] {
  // 7 rows × 24 cols
  return Array.from({ length: 7 }, (_, r) =>
    Array.from({ length: 24 }, (_, c) => (r === 6 && c === 10 ? 50 : r === 5 && c === 14 ? 30 : 0)),
  );
}

function makeDetail(overrides: Partial<MemberDetail> = {}): MemberDetail {
  const shortSession: SessionSummary = {
    sessionId: 'sess-001',
    capturedAt: '2026-05-15T08:30:00.000Z',
    projectName: 'Matrix-Riven',
    totalTokens: 12000,
    firstPromptPreview: 'Fix the login bug',       // 17 chars – fits in 200
    firstPromptFull: 'Fix the login bug',           // same → no details element
  };
  const longPrompt = 'A'.repeat(260);
  const longSession: SessionSummary = {
    sessionId: 'sess-002',
    capturedAt: '2026-05-15T14:00:00.000Z',
    projectName: 'Matrix-Riven',
    totalTokens: 88000,
    firstPromptPreview: longPrompt.slice(0, 200),  // 200 chars
    firstPromptFull: longPrompt,                    // 260 chars → needs details
  };
  return {
    toolFailureRate: 0.12,
    overContext200kCount: 2,
    iterationDensity: 3.5,
    riskyActions: [
      {
        ts: '2026-05-15T09:00:00.000Z',
        sessionId: 'sess-001',
        pattern: 'rm -rf',
        snippet: 'rm -rf /tmp/build',
      },
    ],
    collaborators: [
      { withEmail: 'liusy@example.com', sharedFiles: ['src/index.ts', 'src/routes.ts'] },
    ],
    modelMix: { sonnet: 0.7, haiku: 0.3 },
    webResearchCount: 5,
    sessions: [shortSession, longSession],
    heatmap7x24: makeHeatmap(),
    topFiles: [
      { path: 'packages/collector-server/src/index.ts', edits: 14 },
      { path: 'packages/shared/src/types.ts', edits: 6 },
    ],
    ...overrides,
  };
}

function makeSnapshot(detailOverrides: Partial<MemberDetail> = {}): MemberSnapshot & { detail: MemberDetail } {
  return {
    email: 'liboze@example.com',
    displayName: 'liboze',
    stateBadge: 'active',
    today: { sessions: 8, tokens: 450000, estMinutes: 240, costUsd: 9.75 },
    trend7d: [2, 3, 4, 5, 4, 6, 8],
    deltaVs7dAvgPct: 0.22,
    warnings: ['context 爆炸 2次'],
    topProject: 'Matrix-Riven',
    detail: makeDetail(detailOverrides),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('renderMemberDetail', () => {
  it('returns a full HTML document (DOCTYPE + html + closing body)', () => {
    const html = renderMemberDetail(makeSnapshot());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</body>');
    expect(html).toContain('</html>');
  });

  it('includes display name in the <title>', () => {
    const html = renderMemberDetail(makeSnapshot());
    expect(html).toContain('<title>liboze');
  });

  it('includes a back link to /overview', () => {
    const html = renderMemberDetail(makeSnapshot());
    expect(html).toContain('href="/overview"');
    expect(html).toContain('← Overview');
  });

  it('heatmap contains 7 row labels and 168 cells (7×24)', () => {
    const html = renderMemberDetail(makeSnapshot());
    // Count <div class="lh-hm-cell" elements (not CSS definitions)
    const cellMatches = html.match(/<div class="lh-hm-cell"/g);
    expect(cellMatches).toBeTruthy();
    expect(cellMatches!.length).toBe(168);
    // Count row labels
    const labels = ['7d前', '6d前', '5d前', '4d前', '3d前', '昨日', '今日'];
    for (const label of labels) {
      expect(html).toContain(label);
    }
  });

  it('shows firstPromptPreview truncated to ≤200 chars and adds <details> when full > preview', () => {
    const html = renderMemberDetail(makeSnapshot());
    // The long session has a preview of 200 A's, full of 260 A's → needs details
    expect(html).toContain('<details>');
    expect(html).toContain('展开全文');
  });

  it('does NOT render <details> when full text equals preview', () => {
    // Short session: firstPromptPreview === firstPromptFull → no details
    // We isolate by using a snapshot with only the short session
    const snap = makeSnapshot({ sessions: [makeDetail().sessions[0]!] });
    const html = renderMemberDetail(snap);
    expect(html).not.toContain('<details>');
  });

  it('shows empty-state message when sessions list is empty', () => {
    const snap = makeSnapshot({ sessions: [] });
    const html = renderMemberDetail(snap);
    expect(html).toContain('没有 session');
  });

  it('omits the risky-actions section when there are no risky actions', () => {
    const snap = makeSnapshot({ riskyActions: [] });
    const html = renderMemberDetail(snap);
    expect(html).not.toContain('风险动作');
  });
});
