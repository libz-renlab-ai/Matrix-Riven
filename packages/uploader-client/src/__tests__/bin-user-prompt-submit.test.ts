/**
 * 薄壳 bin-user-prompt-submit 最小测试（设计文档 §7）。
 *
 * 覆盖：
 *   1. 正常输入 → emitCcStatus 被调用一次，event/sessionId/cwd 正确传递。
 *   2. TEAMAGENT_DISABLED=1 → emitCcStatus 不被调用。
 *   3. stdinReader 抛错 → main() 不抛错，emitCcStatus 不被调用。
 *   4. 非法 JSON → main() 不抛错，emitCcStatus 不被调用。
 *   5. 空 stdin → main() 不抛错，emitCcStatus 不被调用。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { main } from '../bin-user-prompt-submit.js';
import { emitCcStatus } from '../realtime-emit.js';

vi.mock('../realtime-emit.js', () => ({
  emitCcStatus: vi.fn(),
}));

const ENV_KEYS = ['TEAMAGENT_DISABLED'] as const;

describe('bin-user-prompt-submit main()', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    vi.mocked(emitCcStatus).mockClear();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('正常输入：emitCcStatus 被调用一次，event/sessionId/cwd 正确', async () => {
    const stdinReader = async () =>
      JSON.stringify({ session_id: 'ses-xyz', cwd: '/home/user/repo' });

    await main(stdinReader);

    expect(emitCcStatus).toHaveBeenCalledTimes(1);
    expect(emitCcStatus).toHaveBeenCalledWith({
      event: 'user_prompt_submit',
      sessionId: 'ses-xyz',
      cwd: '/home/user/repo',
    });
  });

  it('TEAMAGENT_DISABLED=1 → emitCcStatus 不被调用', async () => {
    process.env.TEAMAGENT_DISABLED = '1';
    const stdinReader = async () =>
      JSON.stringify({ session_id: 'ses-disabled', cwd: '/home/user/repo' });

    await main(stdinReader);

    expect(emitCcStatus).not.toHaveBeenCalled();
  });

  it('stdinReader 抛错 → main() 不抛错，emitCcStatus 不被调用', async () => {
    const stdinReader = async (): Promise<string> => {
      throw new Error('stdin read failure');
    };

    await expect(main(stdinReader)).resolves.toBeUndefined();
    expect(emitCcStatus).not.toHaveBeenCalled();
  });

  it('非法 JSON → main() 不抛错，emitCcStatus 不被调用', async () => {
    const stdinReader = async () => 'not-valid-json{{{';

    await expect(main(stdinReader)).resolves.toBeUndefined();
    expect(emitCcStatus).not.toHaveBeenCalled();
  });

  it('空 stdin → main() 不抛错，emitCcStatus 不被调用', async () => {
    const stdinReader = async () => '';

    await expect(main(stdinReader)).resolves.toBeUndefined();
    expect(emitCcStatus).not.toHaveBeenCalled();
  });
});
