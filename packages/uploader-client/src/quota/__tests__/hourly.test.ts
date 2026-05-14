import { describe, it, expect, beforeEach } from 'vitest';
import {
  runHourlyScanIfDue,
  utcDateString,
  projectDirFromTranscriptPath,
  type HourlyScanDeps,
} from '../hourly.js';
import type { DigitalTwinConfig, CcSessionQuotaBlock } from '@matrix-riven/shared';
import type { ProbeQuotaResult } from '../probe.js';
import type { LocalSession } from '../../incremental/scan.js';
import type { TapSessionInput, TapSessionResult } from '../../hooks/tap-session.js';

const HOME = '/fake/home';
const NOW = new Date('2026-05-11T03:00:00.000Z');

function makeConfig(overrides: Partial<DigitalTwinConfig> = {}): DigitalTwinConfig {
  return {
    schema_version: '1',
    identity: { user_id: 'duck@libz.ai', machine_id: 'host-1' },
    uploader: {
      enabled: true,
      endpoint: 'http://collector:8080',
      token: 'tk',
    },
    ...overrides,
  };
}

const quotaOk: CcSessionQuotaBlock = {
  subscription_tier: 'max/default_claude_max_20x',
  five_hour_utilization: 0.35,
  seven_day_utilization: 0.42,
  five_hour_reset_at: 1778481000,
  seven_day_reset_at: 1778626800,
  probed_at: NOW.toISOString(),
  stale: false,
};

function fetchSessionsResponse(ids: string[]): Response {
  return new Response(
    JSON.stringify({ sessions: ids.map((id) => ({ id, ext: 'jsonl' })) }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function makeDeps(
  options: {
    fetchSessions?: (url: string) => Response;
    probeResult?: ProbeQuotaResult;
    locals?: LocalSession[];
    cacheBefore?: CcSessionQuotaBlock | null;
    lastScanAt?: Date | null;
    fenceOutcome?: 'fired' | 'lost-race';
    credentialsPresent?: boolean;
    tapResult?: TapSessionResult;
  } = {},
): { deps: HourlyScanDeps; cacheStore: { current: CcSessionQuotaBlock | null }; tappedInputs: TapSessionInput[] } {
  const cacheStore = { current: options.cacheBefore ?? null };
  const tappedInputs: TapSessionInput[] = [];
  const deps: HourlyScanDeps = {
    fetch: (async (url: string | URL) => {
      const s = String(url);
      if (s.startsWith('http://collector:8080/api/sessions')) {
        const responder = options.fetchSessions;
        if (responder) return responder(s);
        return fetchSessionsResponse([]);
      }
      throw new Error('unexpected fetch ' + s);
    }) as unknown as typeof fetch,
    probeQuota: async () =>
      options.probeResult ?? { kind: 'ok', quota: quotaOk },
    loadOAuthCredentials: (() =>
      options.credentialsPresent === false
        ? null
        : { accessToken: 'sk-ant-test', tier: 'max/default_claude_max_20x', expiresAt: null }) as HourlyScanDeps['loadOAuthCredentials'],
    loadLastHourlyScanAt: () => options.lastScanAt ?? null,
    recordHourlyScanFired: () => options.fenceOutcome ?? 'fired',
    loadQuotaCache: () => cacheStore.current,
    saveQuotaCache: (_p, q) => {
      cacheStore.current = q;
    },
    listLocalSessions: () => options.locals ?? [],
    tapSession: (input) => {
      tappedInputs.push(input);
      return options.tapResult ?? { status: 'tapped', payloadPath: 'p', metadataPath: 'm' };
    },
  };
  return { deps, cacheStore, tappedInputs };
}

describe('utcDateString', () => {
  it('formats a Date as UTC YYYY-MM-DD', () => {
    expect(utcDateString(new Date('2026-05-11T03:00:00.000Z'))).toBe('2026-05-11');
    expect(utcDateString(new Date('2026-12-31T23:59:59.999Z'))).toBe('2026-12-31');
    // Midnight UTC rolls into next day in the toISOString format.
    expect(utcDateString(new Date('2026-05-12T00:00:00.000Z'))).toBe('2026-05-12');
  });
});

describe('projectDirFromTranscriptPath', () => {
  it('extracts the project dir basename from a posix-style path', () => {
    expect(
      projectDirFromTranscriptPath('/home/u/.claude/projects/-Users-foo-proj/sess.jsonl'),
    ).toBe('-Users-foo-proj');
  });
  it('extracts the project dir basename from a windows-style path', () => {
    expect(
      projectDirFromTranscriptPath(
        'C:\\Users\\u\\.claude\\projects\\C--Users-u-proj\\sess.jsonl',
      ),
    ).toBe('C--Users-u-proj');
  });
});

describe('runHourlyScanIfDue', () => {
  beforeEach(() => {
    // no-op — each test passes its own deps.
  });

  it('skips with reason=disabled when quota_probe.enabled is false', async () => {
    const config = makeConfig({ quota_probe: { enabled: false } });
    const { deps } = makeDeps();
    const outcome = await runHourlyScanIfDue({ home: HOME, config, now: NOW }, deps);
    expect(outcome).toEqual({ kind: 'skipped', reason: 'disabled' });
  });

  it('skips with reason=paused when uploader.enabled is false', async () => {
    const config = makeConfig({
      uploader: { enabled: false, endpoint: 'x', token: null },
    });
    const { deps } = makeDeps();
    const outcome = await runHourlyScanIfDue({ home: HOME, config, now: NOW }, deps);
    expect(outcome).toEqual({ kind: 'skipped', reason: 'paused' });
  });

  it('skips with reason=too-soon when shouldRunHourlyScan returns false', async () => {
    const config = makeConfig();
    const recentScan = new Date(NOW.getTime() - 10 * 60 * 1000); // 10 min ago
    const { deps } = makeDeps({ lastScanAt: recentScan });
    const outcome = await runHourlyScanIfDue({ home: HOME, config, now: NOW }, deps);
    expect(outcome).toEqual({ kind: 'skipped', reason: 'too-soon' });
  });

  it('skips with reason=lost-race when fence write loses', async () => {
    const config = makeConfig();
    const { deps } = makeDeps({ fenceOutcome: 'lost-race' });
    const outcome = await runHourlyScanIfDue({ home: HOME, config, now: NOW }, deps);
    expect(outcome).toEqual({ kind: 'skipped', reason: 'lost-race' });
  });

  it('happy path: probes, fetches server list, enqueues diff with quota', async () => {
    const config = makeConfig();
    const locals: LocalSession[] = [
      {
        transcriptPath: '/fake/home/.claude/projects/-Users-foo-proj/s1.jsonl',
        sessionId: 's1',
        mtimeMs: NOW.getTime(),
      },
      {
        transcriptPath: '/fake/home/.claude/projects/-Users-foo-proj/s2.jsonl',
        sessionId: 's2',
        mtimeMs: NOW.getTime(),
      },
    ];
    const { deps, tappedInputs, cacheStore } = makeDeps({
      locals,
      fetchSessions: () => fetchSessionsResponse([]),
    });
    const outcome = await runHourlyScanIfDue({ home: HOME, config, now: NOW }, deps);
    expect(outcome.kind).toBe('fired');
    if (outcome.kind === 'fired') {
      expect(outcome.uploaded).toEqual(['s1', 's2']);
      expect(outcome.quotaSource).toBe('fresh-probe');
      expect(outcome.hadQuota).toBe(true);
    }
    expect(tappedInputs).toHaveLength(2);
    expect(tappedInputs[0]!.quota).toEqual(quotaOk);
    expect(tappedInputs[0]!.cwd).toBe('-Users-foo-proj');
    // Cache was persisted with the fresh probe.
    expect(cacheStore.current).toEqual(quotaOk);
  });

  it('skips already-known sessions (server has 1 of 2 local)', async () => {
    const config = makeConfig();
    const locals: LocalSession[] = [
      {
        transcriptPath: '/fake/home/.claude/projects/-p/a.jsonl',
        sessionId: 'a',
        mtimeMs: NOW.getTime(),
      },
      {
        transcriptPath: '/fake/home/.claude/projects/-p/b.jsonl',
        sessionId: 'b',
        mtimeMs: NOW.getTime(),
      },
    ];
    const { deps, tappedInputs } = makeDeps({
      locals,
      fetchSessions: () => fetchSessionsResponse(['a']),
    });
    const outcome = await runHourlyScanIfDue({ home: HOME, config, now: NOW }, deps);
    expect(outcome.kind).toBe('fired');
    if (outcome.kind === 'fired') {
      expect(outcome.uploaded).toEqual(['b']);
    }
    expect(tappedInputs.map((t) => t.sessionId)).toEqual(['b']);
  });

  it('uses cache (markStale) when probe returns auth-failed', async () => {
    const config = makeConfig();
    const cached: CcSessionQuotaBlock = { ...quotaOk, stale: false, probed_at: '2026-05-11T01:00:00Z' };
    const { deps, tappedInputs } = makeDeps({
      locals: [
        {
          transcriptPath: '/fake/home/.claude/projects/-p/x.jsonl',
          sessionId: 'x',
          mtimeMs: NOW.getTime(),
        },
      ],
      probeResult: { kind: 'auth-failed', status: 401 },
      cacheBefore: cached,
    });
    const outcome = await runHourlyScanIfDue({ home: HOME, config, now: NOW }, deps);
    expect(outcome.kind).toBe('fired');
    if (outcome.kind === 'fired') {
      expect(outcome.quotaSource).toBe('cache-stale');
      expect(outcome.hadQuota).toBe(true);
    }
    expect(tappedInputs[0]!.quota?.stale).toBe(true);
  });

  it('persists 429-with-headers quota and surfaces source=rate-limited-headers', async () => {
    const config = makeConfig();
    const partial: CcSessionQuotaBlock = {
      ...quotaOk,
      five_hour_utilization: 1.0,
      stale: true,
    };
    const { deps, tappedInputs, cacheStore } = makeDeps({
      locals: [
        {
          transcriptPath: '/fake/home/.claude/projects/-p/y.jsonl',
          sessionId: 'y',
          mtimeMs: NOW.getTime(),
        },
      ],
      probeResult: { kind: 'rate-limited', status: 429, quota: partial },
    });
    const outcome = await runHourlyScanIfDue({ home: HOME, config, now: NOW }, deps);
    if (outcome.kind === 'fired') {
      expect(outcome.quotaSource).toBe('rate-limited-headers');
    }
    expect(tappedInputs[0]!.quota).toEqual(partial);
    expect(cacheStore.current).toEqual(partial);
  });

  it('produces hadQuota=false + source=none when probe fails AND cache empty', async () => {
    const config = makeConfig();
    const { deps, tappedInputs } = makeDeps({
      locals: [
        {
          transcriptPath: '/fake/home/.claude/projects/-p/z.jsonl',
          sessionId: 'z',
          mtimeMs: NOW.getTime(),
        },
      ],
      probeResult: { kind: 'network-error', detail: 'ECONNREFUSED' },
      cacheBefore: null,
    });
    const outcome = await runHourlyScanIfDue({ home: HOME, config, now: NOW }, deps);
    if (outcome.kind === 'fired') {
      expect(outcome.hadQuota).toBe(false);
      expect(outcome.quotaSource).toBe('none');
    }
    // tapSession got called but without a quota field.
    expect(tappedInputs[0]!.quota).toBeUndefined();
  });

  it('uses cache when OAuth credentials are missing (no probe attempted)', async () => {
    const config = makeConfig();
    let probeCalled = false;
    const cached: CcSessionQuotaBlock = { ...quotaOk, stale: false };
    const { deps } = makeDeps({
      credentialsPresent: false,
      cacheBefore: cached,
      locals: [],
    });
    // Override the probe to detect if it was called.
    deps.probeQuota = async () => {
      probeCalled = true;
      return { kind: 'ok', quota: quotaOk };
    };
    const outcome = await runHourlyScanIfDue({ home: HOME, config, now: NOW }, deps);
    if (outcome.kind === 'fired') {
      expect(outcome.quotaSource).toBe('cache-stale');
      expect(outcome.hadQuota).toBe(true);
    }
    expect(probeCalled).toBe(false);
  });

  it('treats server fetch failure as "server empty" — uploads everything local', async () => {
    const config = makeConfig();
    const { deps, tappedInputs } = makeDeps({
      locals: [
        {
          transcriptPath: '/fake/home/.claude/projects/-p/q.jsonl',
          sessionId: 'q',
          mtimeMs: NOW.getTime(),
        },
      ],
      fetchSessions: () => new Response('boom', { status: 500 }),
    });
    const outcome = await runHourlyScanIfDue({ home: HOME, config, now: NOW }, deps);
    if (outcome.kind === 'fired') {
      expect(outcome.uploaded).toEqual(['q']);
    }
    expect(tappedInputs).toHaveLength(1);
  });

  // Issue #283: outer try/catch turns unexpected throws into a tagged outcome,
  // so the orchestrator's "never throws" contract is independent of caller.
  it('returns skipped:error when inner code throws unexpectedly', async () => {
    const config = makeConfig();
    const { deps } = makeDeps();
    // Force the fence write to throw.
    deps.recordHourlyScanFired = () => {
      throw new Error('disk on fire');
    };
    const outcome = await runHourlyScanIfDue({ home: HOME, config, now: NOW }, deps);
    expect(outcome.kind).toBe('skipped');
    if (outcome.kind === 'skipped') {
      expect(outcome.reason).toBe('error');
      expect(outcome.error).toContain('disk on fire');
    }
  });

  it('filters out sessions whose mtime is on a different UTC day', async () => {
    const config = makeConfig();
    const yesterday = new Date('2026-05-10T15:00:00Z');
    const { deps, tappedInputs } = makeDeps({
      locals: [
        {
          transcriptPath: '/fake/home/.claude/projects/-p/today.jsonl',
          sessionId: 'today',
          mtimeMs: NOW.getTime(),
        },
        {
          transcriptPath: '/fake/home/.claude/projects/-p/yest.jsonl',
          sessionId: 'yest',
          mtimeMs: yesterday.getTime(),
        },
      ],
    });
    const outcome = await runHourlyScanIfDue({ home: HOME, config, now: NOW }, deps);
    if (outcome.kind === 'fired') {
      expect(outcome.uploaded).toEqual(['today']);
    }
    expect(tappedInputs.map((t) => t.sessionId)).toEqual(['today']);
  });
});
