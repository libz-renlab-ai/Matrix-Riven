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
    activeTodayPct: 0.5,
    activeTodayCount: 1,
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
    recentPrompts: [],
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

  it('B-main: stats block is narrative (本周节奏 / 焦点 / 状态), not raw numbers', () => {
    // Labels remain editorial; the values are now short phrases like
    // "正常推进" / "聚焦 mr" / "本周参与不多" rather than counts.
    expect(f.stats).toContain('本周节奏');
    expect(f.stats).toContain('焦点');
    expect(f.stats).toContain('状态');
    expect(f.stats).toMatch(/加速|稳步|放缓|收尾|未活跃|才开始/);
    // The old "¥" cost and bare "88 会话" surfaces are gone.
    expect(f.stats).not.toContain('¥');
    expect(f.stats).not.toMatch(/<div class="so-stat-num tnum">/);
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

  it('does not surface prompt text in evolve; escapes project name (XSS guard)', () => {
    // Round-7 QA P0 (EM + journalist): the slideover evolve section used to
    // render `p.preview` (first ~80 chars of the prompt). Now it shows only
    // a topic class + length. Prompt text — even escaped — should not appear.
    // Project names are still rendered (they're not PII), so the XSS escape
    // path on projectName is the remaining assertion.
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
    // Round-7: prompt text (escaped or not) must not appear in evolve.
    expect(evil.evolve).not.toContain('&lt;script&gt;');
    expect(evil.evolve).toMatch(/字符/);
    expect(evil.projects).not.toContain('<bad>');
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

  it('B-main: callout names the project + phaseLabel narrative (not enum)', () => {
    expect(f.callout).toContain('class="so-callout');
    expect(f.callout).toContain('serif');
    expect(f.callout).toContain('Matrix-Riven');
    expect(f.callout).toContain('推进新功能'); // phaseLabel(implement)
    // No "implement" or "healthScore=7/10" engineer-speak
    expect(f.callout).not.toMatch(/<em>implement<\/em>/);
    expect(f.callout).not.toMatch(/healthScore/);
  });

  it('B-main: stats block is narrative (本周节奏 / 团队规模 / 整体健康)', () => {
    expect(f.stats).toContain('本周节奏');
    expect(f.stats).toContain('团队规模');
    expect(f.stats).toContain('整体健康');
    expect(f.stats).toContain('位贡献者');
    expect(f.stats).toMatch(/健康|需关注|亟需介入/);
  });

  it('B-main: single-contributor projects show "（单人项目）"', () => {
    const solo = renderProjectSlideoverFragments(
      {
        ...makeProject(),
        contributors: [{ email: 'a@x.com', sharePct: 1 }],
      },
      makeProjectDetail(),
    );
    expect(solo.stats).toContain('单人项目');
  });

  it('B-main: callout reads cleanly when etaDays is null', () => {
    const nullEta = renderProjectSlideoverFragments(
      { ...makeProject(), etaDays: null },
      makeProjectDetail(),
    );
    // etaLabel(null) → '暂无预估', surfaced as a standalone clause (no
    // "预计 暂无预估" double-up).
    expect(nullEta.callout).toContain('暂无预估');
    expect(nullEta.callout).not.toContain('预计 暂无预估');
  });

  it('evolve falls back to milestones when no user prompts surfaced', () => {
    // Default fixture has recentPrompts:[] so we exercise the milestone path.
    expect(f.evolve).toContain('so-evolve-item');
    expect(f.evolve).toContain('latest');
    // milestoneLabel('commit') → '提交'
    expect(f.evolve).toContain('提交');
    expect(f.evolve).toContain('feat: x');
  });

  it('evolve prefers user prompts when recentPrompts is non-empty', () => {
    const withPrompts = renderProjectSlideoverFragments(
      makeProject(),
      makeProjectDetail({
        recentPrompts: [
          { ts: '2026-05-18T09:14:00Z', by: 'alex@x.com', preview: '修一下 graph 视图渲染抖动' },
        ],
      }),
    );
    expect(withPrompts.evolve).toContain('修一下 graph 视图渲染抖动');
    expect(withPrompts.evolve).not.toContain('提交');
    expect(withPrompts.evolve).not.toContain('feat: x');
  });

  it('evolve shows empty-state when there are no prompts and no milestones', () => {
    const empty = renderProjectSlideoverFragments(
      makeProject(),
      makeProjectDetail({ milestones: [], recentPrompts: [] }),
    );
    expect(empty.evolve).toContain('暂无活动');
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

// ---------------------------------------------------------------------------
// L-10 LLM narrative — slide-over callout (T2 / T3)
// ---------------------------------------------------------------------------

describe('renderMemberSlideoverFragments — llmWeekly callout (L-10)', () => {
  it('member callout text is the LLM digest when llmWeekly is set', () => {
    const m: MemberSnapshot = { ...makeMember(), llmWeekly: '本周聚焦 overview\n卡在 e2e 测试' };
    const f = renderMemberSlideoverFragments(m, makeMemberDetail());
    expect(f.callout).toContain('本周聚焦 overview');
    expect(f.callout).toContain('卡在 e2e 测试');
    // Template idle copy ("已经 ... 没有新动作") replaced.
    expect(f.callout).not.toContain('没有新动作');
    // Callout wrapper / icon still emitted.
    expect(f.callout).toContain('class="so-callout');
    expect(f.callout).toContain('serif');
  });

  it('member callout escapes the LLM string', () => {
    const m: MemberSnapshot = { ...makeMember(), llmWeekly: '<script>x</script>\nok' };
    const f = renderMemberSlideoverFragments(m, makeMemberDetail());
    expect(f.callout).not.toContain('<script>x</script>');
    expect(f.callout).toContain('&lt;script&gt;');
  });

  it('member callout falls back to template when llmWeekly absent', () => {
    const f = renderMemberSlideoverFragments(makeMember(), makeMemberDetail());
    // low_activity branch fires for the fixture's stateBadge.
    expect(f.callout).toContain('没有新动作');
  });
});

describe('renderProjectSlideoverFragments — llmWeekly callout (L-10)', () => {
  it('project callout text is the LLM digest when llmWeekly is set', () => {
    const p: ProjectSnapshot = { ...makeProject(), llmWeekly: '团队在做 overview\n进展正常 / 待 e2e' };
    const f = renderProjectSlideoverFragments(p, makeProjectDetail());
    expect(f.callout).toContain('团队在做 overview');
    expect(f.callout).toContain('进展正常 / 待 e2e');
    // Template phrase "推进新功能" replaced by LLM text.
    expect(f.callout).not.toContain('推进新功能');
    expect(f.callout).toContain('class="so-callout');
  });

  it('project callout escapes the LLM string', () => {
    const p: ProjectSnapshot = { ...makeProject(), llmWeekly: '<script>x</script>\nok' };
    const f = renderProjectSlideoverFragments(p, makeProjectDetail());
    expect(f.callout).not.toContain('<script>x</script>');
    expect(f.callout).toContain('&lt;script&gt;');
  });

  it('project callout falls back to template when llmWeekly absent', () => {
    const f = renderProjectSlideoverFragments(makeProject(), makeProjectDetail());
    expect(f.callout).toContain('推进新功能');
  });
});
