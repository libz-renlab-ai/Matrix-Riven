import { describe, it, expect } from 'vitest';
import { renderMemberDetail } from '../member-detail.html.js';
import type { MemberSnapshot, MemberDetail } from '../../types.js';

function mkMember(overrides: Partial<MemberSnapshot> = {}): MemberSnapshot {
  return {
    email: 'blake@example.com',
    displayName: 'blake',
    stateBadge: 'stuck',
    today: { sessions: 3, tokens: 12300, estMinutes: 90, costUsd: 4.5 },
    trend7d: [1, 2, 0, 5, 3, 4, 2],
    deltaVs7dAvgPct: 0.2,
    warnings: ['卡住 3 天'],
    topProject: 'matrix-riven',
    ...overrides,
  };
}

function mkDetail(overrides: Partial<MemberDetail> = {}): MemberDetail {
  return {
    toolFailureRate: 0.1,
    overContext200kCount: 0,
    iterationDensity: 2.5,
    riskyActions: [],
    collaborators: [],
    modelMix: { 'claude-sonnet-4-6': 1 },
    webResearchCount: 3,
    sessions: [
      {
        sessionId: 's1',
        capturedAt: '2026-05-18T10:30:00Z',
        projectName: 'matrix-riven',
        totalTokens: 4500,
        firstPromptPreview: '修一下抽屉里的数字',
        firstPromptFull: '修一下抽屉里的数字，要显示今日 token 和消耗',
        allPrompts: [],
      },
    ],
    heatmap7x24: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0)),
    topFiles: [{ path: 'src/leadership/views/_slideover.html.ts', edits: 5 }],
    focus: { distinctCwdsToday: 1, avgSessionMinutes: 30 },
    promptLengthSeries: [],
    newSurfaceCount: 1,
    ...overrides,
  };
}

describe('renderMemberDetail', () => {
  it('renders nav + breadcrumb + hero + stats blocks', () => {
    const html = renderMemberDetail(mkMember(), mkDetail());
    expect(html).toContain('blake');
    expect(html).toContain('blake@example.com');
    expect(html).toContain('卡住');
    expect(html).toContain('返回团队');
    expect(html).toContain('matrix-riven');
  });

  it('renders 7×24 heatmap with 24 hour labels + 7 day rows', () => {
    const html = renderMemberDetail(mkMember(), mkDetail());
    expect(html).toContain('7×24 活动热力图');
    expect(html).toContain('md-heat-day-label');
    expect(html).toContain('md-heat-cell');
    // 24 hour label cells should exist
    const matches = html.match(/md-heat-hour-label/g);
    expect(matches?.length).toBe(24);
  });

  it('project breakdown sorts by tokens desc', () => {
    const detail = mkDetail({
      sessions: [
        { sessionId: 's1', capturedAt: '2026-05-18T10:00:00Z', projectName: 'small', totalTokens: 1000, firstPromptPreview: 'a', firstPromptFull: 'a', allPrompts: [] },
        { sessionId: 's2', capturedAt: '2026-05-18T11:00:00Z', projectName: 'big', totalTokens: 9000, firstPromptPreview: 'b', firstPromptFull: 'b', allPrompts: [] },
        { sessionId: 's3', capturedAt: '2026-05-18T12:00:00Z', projectName: 'med', totalTokens: 3000, firstPromptPreview: 'c', firstPromptFull: 'c', allPrompts: [] },
      ],
    });
    const html = renderMemberDetail(mkMember(), detail);
    const bigIdx = html.indexOf('>big<');
    const medIdx = html.indexOf('>med<');
    const smallIdx = html.indexOf('>small<');
    expect(bigIdx).toBeGreaterThan(0);
    expect(bigIdx).toBeLessThan(medIdx);
    expect(medIdx).toBeLessThan(smallIdx);
  });

  it('top files rendered', () => {
    const html = renderMemberDetail(mkMember(), mkDetail());
    expect(html).toContain('高频编辑文件');
    expect(html).toContain('_slideover.html.ts');
    expect(html).toContain('5 次');
  });

  it('session list with expandable details', () => {
    // 2026-05-19 QA-4 P0: section retitled from "会话列表（共 N）" to
    // "近期会话样本" with a clarifying annotation, because the prior
    // copy contradicted snapshot counters ("今日 7 / 列表共 1"). Assert
    // on the new copy plus the annotation that ties the three numbers
    // together.
    const html = renderMemberDetail(mkMember(), mkDetail());
    expect(html).toContain('近期会话样本');
    expect(html).toContain('今日 3 条');
    expect(html).toContain('近 7 天 17 条');
    expect(html).toContain('修一下抽屉');
    expect(html).toContain('<details>');
    expect(html).toContain('查看完整');
  });

  it('renders empty states gracefully', () => {
    const html = renderMemberDetail(
      mkMember({ warnings: [] }),
      mkDetail({ sessions: [], topFiles: [], heatmap7x24: [] }),
    );
    expect(html).toContain('本窗口暂无');
  });

  it('injects filter bar', () => {
    const html = renderMemberDetail(mkMember(), mkDetail(), { filterBarHtml: '<div class="filter-bar">FB</div>' });
    expect(html).toContain('filter-bar');
  });

  it('escapes HTML in name and prompts', () => {
    const html = renderMemberDetail(
      mkMember({ displayName: '<script>alert(1)</script>' }),
      mkDetail({
        sessions: [
          { sessionId: 's', capturedAt: '2026-05-18T10:00:00Z', projectName: 'p', totalTokens: 100, firstPromptPreview: '<img src=x>', firstPromptFull: '<img src=x onerror=alert(1)>', allPrompts: [] },
        ],
      }),
    );
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x onerror');
    expect(html).toContain('&lt;script&gt;');
  });
});
