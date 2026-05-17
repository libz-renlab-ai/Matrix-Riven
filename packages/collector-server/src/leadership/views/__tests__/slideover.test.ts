import { describe, it, expect } from 'vitest';
import {
  renderSlideoverShell,
  renderMemberSlideoverFragments,
  renderProjectSlideoverFragments,
} from '../_slideover.html.js';
import type {
  MemberSnapshot,
  MemberDetail,
  ProjectSnapshot,
  ProjectDetail,
} from '../../types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMember(): MemberSnapshot {
  return {
    email: 'liboze@example.com',
    displayName: 'liboze',
    stateBadge: 'low_activity',
    today: { sessions: 88, tokens: 113000, estMinutes: 60, costUsd: 1.5 },
    trend7d: [1, 2, 3, 4, 3, 2, 1],
    deltaVs7dAvgPct: -0.1,
    warnings: ['idle 11h'],
    topProject: 'mr',
  };
}

function makeMemberDetail(overrides: Partial<MemberDetail> = {}): MemberDetail {
  return {
    toolFailureRate: 0.29,
    overContext200kCount: 0,
    iterationDensity: 2,
    riskyActions: [],
    collaborators: [],
    modelMix: { sonnet: 1 },
    webResearchCount: 0,
    sessions: [
      {
        sessionId: 'sess1',
        // Very old timestamp so computeIdleHours returns a "large" number,
        // triggering the long-form idle copy.
        capturedAt: '2024-01-01T03:12:00Z',
        projectName: 'mr',
        totalTokens: 100,
        firstPromptPreview: 'p',
        firstPromptFull: 'p',
        allPrompts: [{ ts: '2024-01-01T03:12:00Z', preview: 'p', full: 'p' }],
      },
    ],
    heatmap7x24: Array(7)
      .fill(0)
      .map(() => Array(24).fill(0)),
    topFiles: [{ path: 'api/overview.test.ts', edits: 5 }],
    focus: { distinctCwdsToday: 1, avgSessionMinutes: 10 },
    promptLengthSeries: [{ date: '2026-05-17', meanLen: 50 }],
    newSurfaceCount: 0,
    ...overrides,
  };
}

function makeProject(): ProjectSnapshot {
  return {
    name: 'Matrix-Riven',
    state: 'active',
    contributors: [
      { email: 'liboze@x.com', sharePct: 0.6 },
      { email: 'alice@x.com', sharePct: 0.4 },
    ],
    busFactorWarning: false,
    trend7d: [1, 2, 3, 4, 3, 2, 1],
    phaseGuess: 'implement',
    healthScore: 7,
    etaDays: 5,
    etaConfidence: 'low',
  };
}

function makeProjectDetail(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    todayFiles: ['src/a.ts'],
    weekFiles: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    extensionMix: { '.ts': 1 },
    testRatio: 0.3,
    milestones: [
      { ts: '2026-05-15T09:00:00Z', type: 'commit', by: 'liboze@x.com', detail: 'feat: x' },
      { ts: '2026-05-14T08:00:00Z', type: 'push', by: 'alice@x.com', detail: 'git push' },
    ],
    webResearchShare: 0.1,
    heatmap7x24: Array(7)
      .fill(0)
      .map(() => Array(24).fill(0)),
    recentFiles: [
      { path: 'src/a.ts', touches: 8 },
      { path: 'src/b.ts', touches: 3 },
    ],
    collabDensity: 0.4,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

describe('renderSlideoverShell (P-B6)', () => {
  const html = renderSlideoverShell();

  it('contains scrim + slideover + close button', () => {
    expect(html).toContain('id="scrim"');
    expect(html).toContain('id="so"');
    expect(html).toContain('so-close');
  });

  it('has the 4 empty fragment containers with stable ids', () => {
    for (const id of ['so-callout', 'so-stats', 'so-evolve', 'so-projects']) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it('wires the close handlers through window.closeSO', () => {
    // Both the scrim click and the explicit close button call window.closeSO.
    const matches = html.match(/window\.closeSO/g);
    expect(matches).toBeTruthy();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it('has fixed name / meta / avatar slots in the head', () => {
    expect(html).toContain('id="so-name"');
    expect(html).toContain('id="so-meta"');
    expect(html).toContain('id="so-avatar"');
  });
});

// ---------------------------------------------------------------------------
// Member fragments
// ---------------------------------------------------------------------------

describe('renderMemberSlideoverFragments (P-B6)', () => {
  const f = renderMemberSlideoverFragments(makeMember(), makeMemberDetail());

  it('returns exactly the 4 expected keys', () => {
    expect(Object.keys(f).sort()).toEqual(['callout', 'evolve', 'projects', 'stats']);
  });

  it('callout uses serif idle copy', () => {
    expect(f.callout).toContain('class="so-callout');
    expect(f.callout).toContain('serif');
    // The idle hours fall through to the long-form copy.
    expect(f.callout).toContain('liboze');
  });

  it('stats has 3 numbers (sessions / spend / health)', () => {
    const nums = (f.stats.match(/class="so-stat-num/g) ?? []).length;
    expect(nums).toBe(3);
  });

  it('stats includes sessions count and a percentage health number', () => {
    expect(f.stats).toContain('>88<');     // sessions
    expect(f.stats).toMatch(/\d+%/);       // health pct
  });

  it('evolve renders one row per prompt', () => {
    expect(f.evolve).toContain('so-evolve-item');
    expect(f.evolve).toContain('latest');  // first row is marked latest
  });

  it('evolve shows an empty-state row when there are no prompts', () => {
    const empty = renderMemberSlideoverFragments(makeMember(), makeMemberDetail({ sessions: [] }));
    expect(empty.evolve).toContain('没有 prompt');
  });

  it('projects shows session counts grouped by project', () => {
    expect(f.projects).toContain('mr');
    expect(f.projects).toContain('1 会话');
  });

  it('projects shows empty-state when there is no project activity', () => {
    const empty = renderMemberSlideoverFragments(makeMember(), makeMemberDetail({ sessions: [] }));
    expect(empty.projects).toContain('无项目活动');
  });

  it('escapes user-controlled text in evolve + projects (XSS guard)', () => {
    const evil = renderMemberSlideoverFragments(
      makeMember(),
      makeMemberDetail({
        sessions: [
          {
            sessionId: 'x',
            capturedAt: '2026-05-17T03:12:00Z',
            projectName: '<bad>',
            totalTokens: 1,
            firstPromptPreview: '<script>',
            firstPromptFull: '<script>',
            allPrompts: [{ ts: '2026-05-17T03:12:00Z', preview: '<script>', full: '<script>' }],
          },
        ],
      }),
    );
    expect(evil.evolve).not.toContain('<script>');
    expect(evil.evolve).toContain('&lt;script&gt;');
    expect(evil.projects).not.toContain('<bad>');
    // The full project label and the truncated proj-icon initials are both
    // escaped — the literal angle-bracket sequence must not survive.
    expect(evil.projects).toContain('&lt;bad&gt;');
    expect(evil.projects).not.toMatch(/<bad/);
  });
});

// ---------------------------------------------------------------------------
// Project fragments
// ---------------------------------------------------------------------------

describe('renderProjectSlideoverFragments (P-B6)', () => {
  const f = renderProjectSlideoverFragments(makeProject(), makeProjectDetail());

  it('returns exactly the 4 expected keys', () => {
    expect(Object.keys(f).sort()).toEqual(['callout', 'evolve', 'projects', 'stats']);
  });

  it('callout names the project and its phase', () => {
    expect(f.callout).toContain('class="so-callout');
    expect(f.callout).toContain('serif');
    expect(f.callout).toContain('Matrix-Riven');
    expect(f.callout).toContain('implement');
  });

  it('stats has 3 numbers (contributors / weekFiles / ETA)', () => {
    const nums = (f.stats.match(/class="so-stat-num/g) ?? []).length;
    expect(nums).toBe(3);
    expect(f.stats).toContain('>2<');     // contributors
    expect(f.stats).toContain('>3<');     // weekFiles
    expect(f.stats).toContain('>5<');     // etaDays
  });

  it('stats falls back to "—" when etaDays is null', () => {
    const nullEta = renderProjectSlideoverFragments(
      { ...makeProject(), etaDays: null },
      makeProjectDetail(),
    );
    expect(nullEta.stats).toContain('—');
  });

  it('evolve renders one row per milestone, top one marked latest', () => {
    expect(f.evolve).toContain('so-evolve-item');
    expect(f.evolve).toContain('latest');
    expect(f.evolve).toContain('commit');
    expect(f.evolve).toContain('feat: x');
  });

  it('evolve shows empty-state when there are no milestones', () => {
    const empty = renderProjectSlideoverFragments(makeProject(), makeProjectDetail({ milestones: [] }));
    expect(empty.evolve).toContain('暂无里程碑');
  });

  it('projects lists recent files (capped at 5)', () => {
    expect(f.projects).toContain('src/a.ts');
    expect(f.projects).toContain('src/b.ts');
  });

  it('projects shows empty-state when there are no recent files', () => {
    const empty = renderProjectSlideoverFragments(makeProject(), makeProjectDetail({ recentFiles: [] }));
    expect(empty.projects).toContain('无文件编辑');
  });

  it('escapes user-controlled milestone text (XSS guard)', () => {
    const evil = renderProjectSlideoverFragments(
      makeProject(),
      makeProjectDetail({
        milestones: [
          { ts: '2026-05-15T09:00:00Z', type: 'commit', by: 'x@x.com', detail: '<script>x</script>' },
        ],
      }),
    );
    expect(evil.evolve).not.toContain('<script>x</script>');
    expect(evil.evolve).toContain('&lt;script&gt;');
  });
});
