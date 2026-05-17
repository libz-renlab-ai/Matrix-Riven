import { describe, it, expect } from 'vitest';
import { heroHeadline, attentionLead, idleCallout } from '../_copy.js';

describe('heroHeadline (P-B3)', () => {
  it('praises when 0 attention items', () => {
    const out = heroHeadline({ attentionCount: 0, highOutputCount: 4 });
    expect(out).toMatch(/顺利|平稳|没有/);
    expect(out).toContain('<em>');
  });
  it('mentions count when 1', () => {
    const out = heroHeadline({ attentionCount: 1, highOutputCount: 2 });
    expect(out).toMatch(/一件|一/);
    expect(out).toContain('<em>');
  });
  it('uses chinese counter words for 2-4', () => {
    expect(heroHeadline({ attentionCount: 2, highOutputCount: 0 })).toMatch(/两|2/);
    expect(heroHeadline({ attentionCount: 3, highOutputCount: 0 })).toMatch(/三/);
    expect(heroHeadline({ attentionCount: 4, highOutputCount: 0 })).toMatch(/四/);
  });
  it('escalates urgency when 5+', () => {
    const out = heroHeadline({ attentionCount: 6, highOutputCount: 0 });
    expect(out).toMatch(/需要|留意|建议/);
    expect(out).toContain('<em>');
  });
});

describe('attentionLead (P-B3)', () => {
  it('singular form for 1', () => {
    expect(attentionLead(1)).toMatch(/一件/);
  });
  it('count for 2-4', () => {
    expect(attentionLead(3)).toContain('3');
    expect(attentionLead(3)).toContain('<em>');
  });
  it('escalates for 5+', () => {
    expect(attentionLead(7)).toMatch(/红|黄|灰|严重|留意/);
  });
});

describe('idleCallout (P-B3)', () => {
  it('low-idle: gentle tone', () => {
    expect(idleCallout({ displayName: 'X', idleHours: 2 })).toMatch(/不算异常|短/);
  });
  it('mid-idle: questioning tone', () => {
    expect(idleCallout({ displayName: 'X', idleHours: 8, lastFile: 'a.ts' })).toMatch(/没开工|卡|不像/);
  });
  it('high-idle: action tone', () => {
    expect(idleCallout({ displayName: 'X', idleHours: 24 })).toMatch(/主动|建议|长/);
  });
  it('mentions lastFile when provided', () => {
    expect(idleCallout({ displayName: 'X', idleHours: 8, lastFile: 'api/overview.test.ts' })).toContain('api/overview.test.ts');
  });
});
