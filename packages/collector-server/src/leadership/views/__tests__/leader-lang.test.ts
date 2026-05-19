import { describe, it, expect } from 'vitest';
import {
  phaseLabel, stateLabel, trendLabel, trendArrow,
  healthTier, healthLabel, healthDotColor,
  idleSince, etaLabel, shortFile,
} from '../_leader-lang.js';

describe('phaseLabel', () => {
  it.each([
    ['implement', '推进新功能'],
    ['debug',     '集中修问题'],
    ['refactor',  '整理代码结构'],
    ['test',      '完善测试'],
    ['docs',      '梳理文档'],
    ['plan',      '规划设计'],
    ['mixed',     '多线推进'],
  ])('%s → %s', (p, expected) => {
    expect(phaseLabel(p as any)).toBe(expected);
  });
});

describe('stateLabel', () => {
  it.each([
    ['active',       '正常推进'],
    ['quiet',        '本周节奏放缓'],
    ['stuck',        '进展缓慢'],
    ['needs_help',   '可能需要支援'],
    ['low_activity', '本周参与不多'],
  ])('%s → %s', (s, expected) => {
    expect(stateLabel(s as any)).toBe(expected);
  });
});

describe('trendLabel', () => {
  it('empty → 本周未活跃', () => {
    expect(trendLabel([])).toBe('本周未活跃');
    expect(trendLabel([0,0,0,0,0,0,0])).toBe('本周未活跃');
  });
  it('all-late activity → 本周才开始', () => {
    expect(trendLabel([0,0,0,5,8,12,15])).toBe('本周才开始');
  });
  it('all-early activity → 近期已收尾', () => {
    expect(trendLabel([15,12,8,5,0,0,0])).toBe('近期已收尾');
  });
  it('accelerating → 正在加速', () => {
    expect(trendLabel([1,1,2,5,8,10,15])).toBe('正在加速');
  });
  it('slowing → 逐渐放缓', () => {
    expect(trendLabel([15,10,8,5,2,1,1])).toBe('逐渐放缓');
  });
  it('steady → 稳步推进', () => {
    expect(trendLabel([5,4,6,5,5,4,6])).toBe('稳步推进');
  });
});

describe('trendArrow', () => {
  it('all zero → ·', () => {
    expect(trendArrow([0,0,0,0,0,0,0])).toBe('·');
  });
  it('steady → →', () => {
    expect(trendArrow([5,5,5,5,5,5,5])).toBe('→');
  });
  it('accelerating → ↗', () => {
    expect(trendArrow([1,2,3,4,5,7,10])).toBe('↗');
  });
  it('slowing → ↘', () => {
    expect(trendArrow([10,7,5,4,3,2,1])).toBe('↘');
  });
});

describe('healthTier / healthLabel / healthDotColor', () => {
  it('good (>= 7.5)', () => {
    expect(healthTier(8)).toBe('good');
    expect(healthLabel(8)).toBe('健康');
    expect(healthDotColor(8)).toBe('var(--accent)');
  });
  it('warn (5.0–7.4)', () => {
    expect(healthTier(6)).toBe('warn');
    expect(healthLabel(6)).toBe('需关注');
    expect(healthDotColor(6)).toBe('var(--warn)');
  });
  it('risk (< 5.0)', () => {
    expect(healthTier(3)).toBe('risk');
    expect(healthLabel(3)).toBe('亟需介入');
    expect(healthDotColor(3)).toBe('var(--danger)');
  });
});

describe('idleSince', () => {
  it('< 1h → 刚刚', () => expect(idleSince(0.3)).toBe('刚刚'));
  it('1-3h → N 小时前', () => expect(idleSince(2)).toBe('2 小时前'));
  it('4-23h → 今天早些时候', () => expect(idleSince(10)).toBe('今天早些时候'));
  it('1 day → 昨天', () => expect(idleSince(28)).toBe('昨天'));
  it('few days → N 天前', () => expect(idleSince(72)).toBe('3 天前'));
  it('about a week → 一周前', () => expect(idleSince(8 * 24)).toBe('一周前'));
  it('weeks → N 周前', () => expect(idleSince(15 * 24)).toMatch(/2 周前/));
  it('month+ → 一个月以上', () => expect(idleSince(40 * 24)).toBe('一个月以上'));
});

describe('etaLabel', () => {
  it('null → 暂无预估', () => expect(etaLabel(null)).toBe('暂无预估'));
  it('<= 1d → 今明两天', () => expect(etaLabel(1)).toBe('今明两天'));
  it('2-3d → 本周内', () => expect(etaLabel(3)).toBe('本周内'));
  it('4-7d → 约 1 周', () => expect(etaLabel(7)).toBe('约 1 周'));
  it('8-14d → 约 2 周', () => expect(etaLabel(14)).toBe('约 2 周'));
  it('large → 一个月以上', () => expect(etaLabel(40)).toBe('一个月以上'));
});

describe('shortFile', () => {
  it('returns last 2 segments', () => {
    expect(shortFile('/home/u/proj/packages/server/src/index.ts')).toBe('src/index.ts');
  });
  it('handles single-segment paths', () => {
    expect(shortFile('index.ts')).toBe('index.ts');
  });
  it('handles windows backslash', () => {
    expect(shortFile('C:\\Users\\X\\a\\b\\c.ts')).toBe('b/c.ts');
  });
  it('empty string', () => {
    expect(shortFile('')).toBe('');
  });
});
