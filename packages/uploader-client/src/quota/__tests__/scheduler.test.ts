import { describe, it, expect } from 'vitest';
import {
  loadLastHourlyScanAt,
  shouldRunHourlyScan,
  recordHourlyScanFired,
  type SchedulerReadDeps,
  type SchedulerWriteDeps,
} from '../scheduler.js';

const FENCE = '/fake/home/.teamagent/digital-twin/last-hourly-scan.txt';
const LOCK = `${FENCE}.lock`;

describe('shouldRunHourlyScan', () => {
  it('returns true when lastScanAt is null (never fired before)', () => {
    expect(
      shouldRunHourlyScan({
        lastScanAt: null,
        now: new Date('2026-05-11T12:00:00.000Z'),
        windowMinutes: 55,
      }),
    ).toBe(true);
  });

  it('returns true when elapsed time exceeds windowMinutes', () => {
    const lastScanAt = new Date('2026-05-11T12:00:00.000Z');
    const now = new Date(lastScanAt.getTime() + 60 * 60_000); // 60 min later
    expect(shouldRunHourlyScan({ lastScanAt, now, windowMinutes: 55 })).toBe(true);
  });

  it('returns false when elapsed time is under windowMinutes', () => {
    const lastScanAt = new Date('2026-05-11T12:00:00.000Z');
    const now = new Date(lastScanAt.getTime() + 30 * 60_000); // 30 min later
    expect(shouldRunHourlyScan({ lastScanAt, now, windowMinutes: 55 })).toBe(false);
  });

  it('returns true at the exact boundary (elapsed === windowMinutes * 60_000)', () => {
    const lastScanAt = new Date('2026-05-11T12:00:00.000Z');
    const now = new Date(lastScanAt.getTime() + 55 * 60_000);
    expect(shouldRunHourlyScan({ lastScanAt, now, windowMinutes: 55 })).toBe(true);
  });

  it('returns true when clock jumps backwards (lastScanAt > now)', () => {
    const lastScanAt = new Date('2026-05-11T12:00:00.000Z');
    const now = new Date(lastScanAt.getTime() - 10 * 60_000); // 10 min earlier
    expect(shouldRunHourlyScan({ lastScanAt, now, windowMinutes: 55 })).toBe(true);
  });
});

describe('loadLastHourlyScanAt', () => {
  it('returns null when the fence file does not exist', () => {
    const deps: SchedulerReadDeps = {
      existsSync: () => false,
      readFileSync: () => {
        throw new Error('should not be called');
      },
    };
    expect(loadLastHourlyScanAt(FENCE, deps)).toBeNull();
  });

  it('parses a valid ISO timestamp', () => {
    const iso = '2026-05-11T12:34:56.000Z';
    const deps: SchedulerReadDeps = {
      existsSync: () => true,
      readFileSync: () => iso,
    };
    const result = loadLastHourlyScanAt(FENCE, deps);
    expect(result).not.toBeNull();
    expect(result!.toISOString()).toBe(iso);
  });

  it('returns null when content is not a valid date string', () => {
    const deps: SchedulerReadDeps = {
      existsSync: () => true,
      readFileSync: () => 'this is definitely not an iso timestamp',
    };
    expect(loadLastHourlyScanAt(FENCE, deps)).toBeNull();
  });

  it('returns null when readFileSync throws', () => {
    const deps: SchedulerReadDeps = {
      existsSync: () => true,
      readFileSync: () => {
        throw new Error('EACCES');
      },
    };
    expect(loadLastHourlyScanAt(FENCE, deps)).toBeNull();
  });

  it('returns null when file content is empty/whitespace', () => {
    const deps: SchedulerReadDeps = {
      existsSync: () => true,
      readFileSync: () => '   \n\t  ',
    };
    expect(loadLastHourlyScanAt(FENCE, deps)).toBeNull();
  });
});

interface CallLog {
  mkdirCalls: Array<{ path: string; recursive: boolean }>;
  openCalls: Array<{ path: string; flags: string }>;
  writeSyncCalls: Array<{ fd: number; data: string }>;
  closeCalls: number[];
  unlinkCalls: string[];
  writeFileCalls: Array<{ path: string; data: string }>;
}

function makeCallLog(): CallLog {
  return {
    mkdirCalls: [],
    openCalls: [],
    writeSyncCalls: [],
    closeCalls: [],
    unlinkCalls: [],
    writeFileCalls: [],
  };
}

function happyDeps(log: CallLog): SchedulerWriteDeps {
  return {
    mkdirSync: (p, opts) => {
      log.mkdirCalls.push({ path: p, recursive: opts.recursive });
    },
    openSync: (p, flags) => {
      log.openCalls.push({ path: p, flags });
      return 42; // fake fd
    },
    writeSync: (fd, data) => {
      log.writeSyncCalls.push({ fd, data });
    },
    closeSync: (fd) => {
      log.closeCalls.push(fd);
    },
    unlinkSync: (p) => {
      log.unlinkCalls.push(p);
    },
    writeFileSync: (p, data) => {
      log.writeFileCalls.push({ path: p, data });
    },
  };
}

describe('recordHourlyScanFired', () => {
  it("returns 'fired' on the success path: writes ISO to fencePath, creates parent dir, cleans up .lock", () => {
    const log = makeCallLog();
    const now = new Date('2026-05-11T12:00:00.000Z');
    const result = recordHourlyScanFired(FENCE, now, happyDeps(log));
    expect(result).toBe('fired');
    // fence written with ISO timestamp
    expect(log.writeFileCalls).toEqual([
      { path: FENCE, data: now.toISOString() },
    ]);
    // parent dir created with recursive
    expect(log.mkdirCalls.length).toBe(1);
    expect(log.mkdirCalls[0]!.recursive).toBe(true);
    // O_EXCL lock attempted with 'wx' on sibling .lock
    expect(log.openCalls).toEqual([{ path: LOCK, flags: 'wx' }]);
    // lock fd closed and lock file unlinked
    expect(log.closeCalls).toEqual([42]);
    expect(log.unlinkCalls).toEqual([LOCK]);
  });

  it("returns 'lost-race' when openSync throws EEXIST (concurrent caller won)", () => {
    const log = makeCallLog();
    const deps: SchedulerWriteDeps = {
      ...happyDeps(log),
      openSync: () => {
        const err = new Error('EEXIST: file already exists') as NodeJS.ErrnoException;
        err.code = 'EEXIST';
        throw err;
      },
    };
    const now = new Date('2026-05-11T12:00:00.000Z');
    const result = recordHourlyScanFired(FENCE, now, deps);
    expect(result).toBe('lost-race');
    // We must NOT have written to the fence file
    expect(log.writeFileCalls).toEqual([]);
    // We must NOT have unlinked someone else's lock
    expect(log.unlinkCalls).toEqual([]);
  });

  it("tolerates a final unlinkSync of .lock failing (best-effort cleanup, must not throw)", () => {
    const log = makeCallLog();
    const deps: SchedulerWriteDeps = {
      ...happyDeps(log),
      unlinkSync: () => {
        throw new Error('EBUSY: unlink raced with something else');
      },
    };
    const now = new Date('2026-05-11T12:00:00.000Z');
    expect(() => recordHourlyScanFired(FENCE, now, deps)).not.toThrow();
    // Even when unlink fails we still report 'fired' because the fence
    // file is already written.
    const result = recordHourlyScanFired(FENCE, now, deps);
    expect(result).toBe('fired');
  });

  it("tolerates mkdirSync failure on a non-EEXIST path (best-effort, must not throw)", () => {
    const log = makeCallLog();
    const deps: SchedulerWriteDeps = {
      ...happyDeps(log),
      mkdirSync: () => {
        throw new Error('EACCES: permission denied');
      },
    };
    const now = new Date('2026-05-11T12:00:00.000Z');
    expect(() => recordHourlyScanFired(FENCE, now, deps)).not.toThrow();
    // mkdir failure should not crash; openSync still runs and we get 'fired'.
    const result = recordHourlyScanFired(FENCE, now, deps);
    expect(result).toBe('fired');
  });

  it("tolerates closeSync failure (best-effort, must not throw)", () => {
    const log = makeCallLog();
    const deps: SchedulerWriteDeps = {
      ...happyDeps(log),
      closeSync: () => {
        throw new Error('EBADF: bad file descriptor');
      },
    };
    const now = new Date('2026-05-11T12:00:00.000Z');
    expect(() => recordHourlyScanFired(FENCE, now, deps)).not.toThrow();
    const result = recordHourlyScanFired(FENCE, now, deps);
    expect(result).toBe('fired');
    // Despite close failing, we still attempt the unlink.
    expect(log.unlinkCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("propagates writeFileSync failure (the fence write is load-bearing)", () => {
    // If we cannot write the fence file, the caller cannot trust the
    // 'fired' return. The deps interface should not silently swallow this.
    const log = makeCallLog();
    const deps: SchedulerWriteDeps = {
      ...happyDeps(log),
      writeFileSync: () => {
        throw new Error('ENOSPC: no space left on device');
      },
    };
    const now = new Date('2026-05-11T12:00:00.000Z');
    expect(() => recordHourlyScanFired(FENCE, now, deps)).toThrow(/ENOSPC/);
    // Even on write failure we must still clean up the lock so the next
    // caller isn't stuck behind a stale .lock forever.
    expect(log.closeCalls).toEqual([42]);
    expect(log.unlinkCalls).toEqual([LOCK]);
  });
});
