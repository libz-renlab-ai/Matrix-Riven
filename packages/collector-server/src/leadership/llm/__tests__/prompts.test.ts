import { describe, it, expect } from 'vitest';
import {
  buildT1Prompt,
  buildT2Prompt,
  buildT3Prompt,
  buildT4Prompt,
  buildT5Prompt,
  T1_MODEL,
  T2_MODEL,
  T3_MODEL,
  T4_MODEL,
  T5_MODEL,
  type T1Input,
  type T2Input,
  type T3Input,
  type T4Input,
  type T5Input,
} from '../prompts/index.js';

const SYSTEM_CAP = 1500;

const t1Items: T1Input[] = [
  {
    id: 's1',
    firstUserPrompt: '修一下 overview tab 的 ts 报错',
    changedFiles: ['packages/dashboard/src/status/page.tsx'],
    toolCounts: { edit: 4, bash: 2, read: 6, webFetch: 0 },
    durationMin: 12,
    errors: 1,
  },
  {
    id: 's2',
    firstUserPrompt: '加一个 /api/overview 路由',
    changedFiles: ['packages/collector-server/src/leadership/routes.ts'],
    toolCounts: { edit: 3, bash: 1, read: 4, webFetch: 0 },
    durationMin: 25,
    errors: 0,
  },
];

const t2Items: T2Input[] = [
  {
    email: 'alice@x.com',
    displayName: 'Alice',
    state: 'high_output',
    topFiles: ['overview.html.ts', 'styles.css.ts'],
    sessionDigests: ['修 overview TS 报错', '加 /api/overview 路由'],
  },
  {
    email: 'bob@x.com',
    displayName: 'Bob',
    state: 'stuck',
    topFiles: ['worker.ts'],
    sessionDigests: ['排查 worker 启动失败'],
  },
];

const t3Items: T3Input[] = [
  {
    project: 'matrix-riven',
    phase: '推进新功能',
    contributors: ['Alice', 'Bob'],
    sessionDigests: ['修 overview TS 报错', '加 /api/overview 路由'],
    recentCommits: ['feat(overview): mount route', 'fix(overview): symmetric guard'],
  },
];

const t4Items: T4Input[] = [
  {
    refId: 'r1',
    kind: 'member',
    displayName: 'Bob',
    signal: 'stuck',
    evidence: ['worker.ts 启动后立即退出', '日志显示 cache 路径未配置'],
  },
];

const t5Item: T5Input = {
  date: '2026-05-17',
  topHighlights: ['修 overview TS 报错', '加 /api/overview 路由'],
  attentionRewrites: ['worker 启动失败，建议补 cache 路径默认值'],
  topProjects: [{ name: 'matrix-riven', digest: '团队在做 LLM 叙事层' }],
};

function assertShape(out: { system: string; user: string; model: string }) {
  expect(typeof out.system).toBe('string');
  expect(typeof out.user).toBe('string');
  expect(typeof out.model).toBe('string');
  expect(out.system.length).toBeGreaterThan(0);
  expect(out.user.length).toBeGreaterThan(0);
  expect(out.model.length).toBeGreaterThan(0);
  expect(out.system).toContain('JSON');
  expect(out.system.length).toBeLessThan(SYSTEM_CAP);
  // User payload starts with an imperative directive, then a JSON object on
  // the line after the first newline. Slice past the directive and confirm
  // the JSON tail still parses.
  const nl = out.user.indexOf('\n');
  expect(nl).toBeGreaterThan(0);
  const jsonTail = out.user.slice(nl + 1);
  expect(() => JSON.parse(jsonTail)).not.toThrow();
}

describe('buildT1Prompt', () => {
  const out = buildT1Prompt(t1Items);

  it('returns {system,user,model} with non-empty strings', () => {
    assertShape(out);
  });

  it('uses the T1 haiku model by default', () => {
    expect(out.model).toBe(T1_MODEL);
    expect(out.model).toBe('claude-haiku-4-5-20251001');
  });

  it('user payload contains every input id', () => {
    for (const item of t1Items) {
      expect(out.user).toContain(item.id);
    }
  });

  it('system prompt is stable (snapshot)', () => {
    expect(out.system).toMatchSnapshot();
  });
});

describe('buildT2Prompt', () => {
  const out = buildT2Prompt(t2Items);

  it('returns {system,user,model} with non-empty strings', () => {
    assertShape(out);
  });

  it('uses the T2 haiku model by default', () => {
    expect(out.model).toBe(T2_MODEL);
    expect(out.model).toBe('claude-haiku-4-5-20251001');
  });

  it('user payload contains every input email', () => {
    for (const item of t2Items) {
      expect(out.user).toContain(item.email);
    }
  });

  it('system prompt is stable (snapshot)', () => {
    expect(out.system).toMatchSnapshot();
  });
});

describe('buildT3Prompt', () => {
  const out = buildT3Prompt(t3Items);

  it('returns {system,user,model} with non-empty strings', () => {
    assertShape(out);
  });

  it('uses the T3 haiku model by default', () => {
    expect(out.model).toBe(T3_MODEL);
    expect(out.model).toBe('claude-haiku-4-5-20251001');
  });

  it('user payload contains every input project name', () => {
    for (const item of t3Items) {
      expect(out.user).toContain(item.project);
    }
  });

  it('system prompt is stable (snapshot)', () => {
    expect(out.system).toMatchSnapshot();
  });
});

describe('buildT4Prompt', () => {
  const out = buildT4Prompt(t4Items);

  it('returns {system,user,model} with non-empty strings', () => {
    assertShape(out);
  });

  it('uses the T4 haiku model by default', () => {
    expect(out.model).toBe(T4_MODEL);
    expect(out.model).toBe('claude-haiku-4-5-20251001');
  });

  it('user payload contains every input refId', () => {
    for (const item of t4Items) {
      expect(out.user).toContain(item.refId);
    }
  });

  it('system prompt forbids the generic 需要帮助 phrase', () => {
    expect(out.system).toContain('需要帮助');
  });

  it('system prompt is stable (snapshot)', () => {
    expect(out.system).toMatchSnapshot();
  });
});

describe('buildT5Prompt', () => {
  const out = buildT5Prompt(t5Item);

  it('returns {system,user,model} with non-empty strings', () => {
    assertShape(out);
  });

  it('uses the T5 sonnet model by default', () => {
    expect(out.model).toBe(T5_MODEL);
    expect(out.model).toBe('claude-sonnet-4-6');
  });

  it('user payload contains the input date', () => {
    expect(out.user).toContain(t5Item.date);
  });

  it('system prompt is stable (snapshot)', () => {
    expect(out.system).toMatchSnapshot();
  });
});

describe('builders handle empty inputs without throwing', () => {
  it('T1 with []', () => {
    const out = buildT1Prompt([]);
    assertShape(out);
  });
  it('T2 with []', () => {
    const out = buildT2Prompt([]);
    assertShape(out);
  });
  it('T3 with []', () => {
    const out = buildT3Prompt([]);
    assertShape(out);
  });
  it('T4 with []', () => {
    const out = buildT4Prompt([]);
    assertShape(out);
  });
});
