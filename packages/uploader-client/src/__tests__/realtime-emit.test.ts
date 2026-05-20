/**
 * Feature #2 v3 — realtime-emit helper contract tests.
 *
 * The helper is what makes "real users" show up on the boss kanban: it reads
 * TEAMAGENT_REALTIME_URL and fires postCcStatusSnapshot fire-and-forget. The
 * production callers (SessionStart + UserPromptSubmit) just call into this
 * file; if it ever throws or blocks, the user-facing hook path breaks.
 *
 * Tests:
 *   - Unset env → no fetch, no throw.
 *   - Set env → fetch fires exactly once with the right URL + body shape.
 *   - fetch rejects (network) → emit returns synchronously, no throw.
 *   - fetch resolves with 500 → emit returns synchronously, no throw.
 *   - getUserId throws → snapshot still builds with hostname fallback.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emitCcStatus, __resetIdentityCacheForTests } from "../realtime-emit.js";

const ORIGINAL_FETCH = globalThis.fetch;
// Issue #308 /review finding #10: previous pattern
// `if (ORIGINAL) process.env.X = ORIGINAL` left the env var leaked to the
// NEXT test file when the original was undefined (which is typical CI).
// Snapshot + delete-or-restore — matching presence-command.test.ts.
//
// Issue #350 (v0.11.1): HOME + USERPROFILE join the list so the
// resolveBaseUrl() saved-config fallback (reads <HOME>/.teamagent/digital-twin.json)
// can be sandboxed to a tmpdir per-test. beforeEach deletes from the env, then
// the digital-twin-fallback tests explicitly set HOME/USERPROFILE to the
// freshly-mkdtemped sandbox. afterEach restores the original values via the
// same loop so no leak.
const ENV_KEYS = [
  "TEAMAGENT_REALTIME_URL",
  "TEAMAGENT_REALTIME_TOKEN",
  "TEAMAGENT_DISABLED",
  "TEAMAGENT_REALTIME_ALLOW_REMOTE",
  "TEAMAGENT_REALTIME_RAW_PROMPT",
  "HOME",
  "USERPROFILE",
] as const;

/**
 * Issue #350 (v0.11.1) — every test in this file sandboxes HOME / USERPROFILE
 * to a tmp dir so `resolveBaseUrl()`'s saved-config fallback (which reads
 * `<HOME>/.teamagent/digital-twin.json`) doesn't see the developer's real
 * configured endpoint. Tests that exercise the fallback path explicitly
 * `fs.writeFileSync` a config into the sandbox HOME first.
 */
let sandboxHome: string;

describe("emitCcStatus", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    // Issue #350 (v0.11.1) — point HOME / USERPROFILE at a fresh tmpdir so
    // resolveBaseUrl()'s saved-config fallback can't see the real one. The
    // loop above already deleted them; this re-sets to the sandbox so
    // homeForConfig() in realtime-emit.ts returns the sandbox path on both
    // POSIX and Windows.
    sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), "realtime-emit-test-"));
    process.env.HOME = sandboxHome;
    process.env.USERPROFILE = sandboxHome;
    __resetIdentityCacheForTests();
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    // Issue #350 (v0.11.1) — drop the tmpdir HOME. Best-effort: ignore EBUSY
    // / EPERM on Windows so a slow handle-release doesn't fail the test.
    try {
      fs.rmSync(sandboxHome, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  function writeDigitalTwinConfig(cfg: {
    enabled: boolean;
    endpoint: string;
    token?: string | null;
  }): void {
    const cfgDir = path.join(sandboxHome, ".teamagent");
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(
      path.join(cfgDir, "digital-twin.json"),
      JSON.stringify({
        schema_version: "1",
        identity: { user_id: "test@example.com", machine_id: "test-host" },
        uploader: {
          enabled: cfg.enabled,
          endpoint: cfg.endpoint,
          token: cfg.token ?? null,
        },
        consented_at: new Date().toISOString(),
      }),
    );
    __resetIdentityCacheForTests();
  }

  it("is a no-op when TEAMAGENT_REALTIME_URL is unset AND no saved digital-twin config", () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    emitCcStatus({ event: "session_start", sessionId: "s1", cwd: "/tmp" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("issue #350 — falls back to digital-twin config endpoint when env unset", async () => {
    writeDigitalTwinConfig({
      enabled: true,
      endpoint: "http://192.168.22.88:8933",
      token: "team-shared",
    });
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    emitCcStatus({ event: "session_start", sessionId: "s-cfg", cwd: "/tmp" });
    await new Promise((r) => setTimeout(r, 5));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0]!;
    // Config-derived URL bypasses the loopback gate — see resolveBaseUrl()
    // security rationale.
    expect(url).toBe("http://192.168.22.88:8933/v1/cc-status");
  });

  it("issue #350 — does NOT fall back when uploader.enabled is false", () => {
    writeDigitalTwinConfig({
      enabled: false,
      endpoint: "http://192.168.22.88:8933",
      token: "team-shared",
    });
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    emitCcStatus({ event: "session_start", sessionId: "s-paused" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("issue #350 — env URL still wins over saved config", async () => {
    writeDigitalTwinConfig({
      enabled: true,
      endpoint: "http://192.168.22.88:8933",
      token: "team-shared",
    });
    process.env.TEAMAGENT_REALTIME_URL = "http://127.0.0.1:9787";
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    emitCcStatus({ event: "session_start", sessionId: "s-env-wins" });
    await new Promise((r) => setTimeout(r, 5));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]![0]).toBe("http://127.0.0.1:9787/v1/cc-status");
  });

  it("identity-from-config: cc-status user_id matches digital-twin.json identity.user_id (no git config / hostname fallback)", async () => {
    // Regression for the ghost-user bug: when `git config user.email` returns
    // empty (non-git cwd / unset local+global), realtime-emit used to fall
    // back to `${username}@${hostname()}` while bin-uploader still wrote
    // transcripts under the configured identity. Result: same physical CC
    // session split into TWO user_id buckets on the collector.
    //
    // Fix: read `identity.user_id` from digital-twin.json FIRST, fall back to
    // getUserId() only when config is missing / has no identity.
    writeDigitalTwinConfig({
      enabled: true,
      endpoint: "http://127.0.0.1:9787",
      token: "team-shared",
    });
    process.env.TEAMAGENT_REALTIME_URL = "http://127.0.0.1:9787";
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    emitCcStatus({
      event: "session_start",
      sessionId: "s-identity-config",
      cwd: "/tmp/non-git-dir",
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string);
    // writeDigitalTwinConfig() writes identity.user_id = 'test@example.com'.
    // That MUST be the user_id on the snapshot — NOT a `${username}@${hostname}`
    // fallback derived from the runtime user.
    expect(body.user_id).toBe("test@example.com");
    expect(body.user_id).not.toMatch(/@.+\.local$/);
  });

  it("identity-from-config: empty identity.user_id falls through to getUserId() chain", async () => {
    // Edge case: config exists but identity.user_id is an empty string —
    // treat as "no usable identity" and let the existing getUserId() chain
    // (git config / hostname) take over.
    const cfgDir = path.join(sandboxHome, ".teamagent");
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(
      path.join(cfgDir, "digital-twin.json"),
      JSON.stringify({
        schema_version: "1",
        identity: { user_id: "", machine_id: "test-host" },
        uploader: { enabled: true, endpoint: "http://127.0.0.1:9787", token: null },
        consented_at: new Date().toISOString(),
      }),
    );
    __resetIdentityCacheForTests();
    process.env.TEAMAGENT_REALTIME_URL = "http://127.0.0.1:9787";
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    emitCcStatus({ event: "session_start", sessionId: "s-empty-id" });
    await new Promise((r) => setTimeout(r, 5));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    // Falls through to getUserId() — could be a real git email OR the
    // hostname fallback; either way it is NOT the literal empty string.
    expect(typeof body.user_id).toBe("string");
    expect(body.user_id.length).toBeGreaterThan(0);
    expect(body.user_id).not.toBe("");
  });

  it("fires one POST to /v1/cc-status when the URL is set", async () => {
    process.env.TEAMAGENT_REALTIME_URL = "http://127.0.0.1:9787";
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    emitCcStatus({
      event: "user_prompt_submit",
      sessionId: "s-real",
      cwd: "/Users/me/repo",
    });
    // Drain microtasks so the void-discarded promise actually fires.
    await new Promise((r) => setTimeout(r, 5));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:9787/v1/cc-status");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.event).toBe("user_prompt_submit");
    expect(body.session_id).toBe("s-real");
    expect(body.cwd).toBe("/Users/me/repo");
    expect(body.schema_version).toBe(1);
    expect(typeof body.user_id).toBe("string");
    expect(typeof body.ts).toBe("string");
  });

  it("passes bearer token when TEAMAGENT_REALTIME_TOKEN is set", async () => {
    process.env.TEAMAGENT_REALTIME_URL = "http://127.0.0.1:9787";
    process.env.TEAMAGENT_REALTIME_TOKEN = "test-token-abc";
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    emitCcStatus({ event: "session_start", sessionId: "s2" });
    await new Promise((r) => setTimeout(r, 5));
    const [, init] = fetchSpy.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer test-token-abc");
  });

  it("never throws when fetch rejects with a network error", async () => {
    process.env.TEAMAGENT_REALTIME_URL = "http://127.0.0.1:9999";
    const fetchSpy = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    expect(() =>
      emitCcStatus({ event: "session_start", sessionId: "s3" }),
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 5));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("never throws when fetch returns HTTP 500", async () => {
    process.env.TEAMAGENT_REALTIME_URL = "http://127.0.0.1:9787";
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response("boom", { status: 500 }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    expect(() =>
      emitCcStatus({ event: "session_start", sessionId: "s4" }),
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 5));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("refuses non-loopback URLs by default (SSRF / exfil guard)", () => {
    process.env.TEAMAGENT_REALTIME_URL = "http://evil.example.com:9787";
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    emitCcStatus({ event: "session_start", sessionId: "s-attack" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("allows non-loopback URLs when TEAMAGENT_REALTIME_ALLOW_REMOTE=1", async () => {
    process.env.TEAMAGENT_REALTIME_URL = "http://lan-receiver.local:9787";
    process.env.TEAMAGENT_REALTIME_ALLOW_REMOTE = "1";
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    emitCcStatus({ event: "session_start", sessionId: "s-lan" });
    await new Promise((r) => setTimeout(r, 5));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("accepts 127.0.0.1, localhost, and ::1 without the override", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    for (const host of ["http://127.0.0.1:9787", "http://localhost:9787", "http://[::1]:9787"]) {
      process.env.TEAMAGENT_REALTIME_URL = host;
      emitCcStatus({ event: "session_start", sessionId: "s-loop" });
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("rejects file:// and javascript: schemes regardless of host", () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "not-a-url"]) {
      process.env.TEAMAGENT_REALTIME_URL = url;
      emitCcStatus({ event: "session_start", sessionId: "s-bad" });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("respects TEAMAGENT_DISABLED=1 even when REALTIME_URL is set", () => {
    process.env.TEAMAGENT_REALTIME_URL = "http://127.0.0.1:9787";
    process.env.TEAMAGENT_DISABLED = "1";
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    emitCcStatus({ event: "session_start", sessionId: "s-killswitch" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("clamps non-finite contextTokens to omitted (no NaN/Infinity in body)", async () => {
    process.env.TEAMAGENT_REALTIME_URL = "http://127.0.0.1:9787";
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    emitCcStatus({
      event: "session_start",
      sessionId: "s-bad-tokens",
      contextTokens: Number.POSITIVE_INFINITY,
    });
    await new Promise((r) => setTimeout(r, 5));
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.context_tokens).toBeUndefined();
    expect(body.context_pct).toBeUndefined();
  });

  it("returns synchronously even when fetch never resolves", () => {
    process.env.TEAMAGENT_REALTIME_URL = "http://127.0.0.1:9787";
    // A fetch that hangs forever — proves we don't await it.
    let resolveLater: (v: Response) => void = () => {};
    const slowFetch = vi.fn().mockImplementation(
      () => new Promise<Response>((r) => { resolveLater = r; }),
    );
    globalThis.fetch = slowFetch as unknown as typeof fetch;
    // Warm the identity cache so the first-call git-config shell-out doesn't
    // skew the timing. After this, every call only does sync work + kick off
    // the fetch.
    emitCcStatus({ event: "warm", sessionId: "warm" });
    const start = Date.now();
    emitCcStatus({ event: "session_start", sessionId: "s5" });
    const elapsed = Date.now() - start;
    // Cached path: synchronous work only, fetch is fire-and-forget. 50ms is
    // a generous ceiling — observed elapsed is typ. <5ms on CI.
    expect(elapsed).toBeLessThan(50);
    resolveLater(new Response(null, { status: 204 }));
  });

  // Issue #308 grill §3 — raw prompt threading + privacy default
  describe("raw_prompt (issue #308 grill §3)", () => {
    async function captureBody(emit: () => void): Promise<Record<string, unknown>> {
      process.env.TEAMAGENT_REALTIME_URL = "http://127.0.0.1:9787";
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response(null, { status: 204 }),
      );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;
      emit();
      await new Promise((r) => setTimeout(r, 5));
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [, init] = fetchSpy.mock.calls[0]!;
      return JSON.parse((init as RequestInit).body as string);
    }

    it("omits raw_prompt when rawPrompt is undefined (privacy default)", async () => {
      const body = await captureBody(() => {
        emitCcStatus({ event: "user_prompt_submit", sessionId: "s-1" });
      });
      expect(body.raw_prompt).toBeUndefined();
    });

    it("omits raw_prompt when rawPrompt is empty string (filtered)", async () => {
      const body = await captureBody(() => {
        emitCcStatus({
          event: "user_prompt_submit",
          sessionId: "s-2",
          rawPrompt: "",
        });
      });
      expect(body.raw_prompt).toBeUndefined();
    });

    it("threads raw_prompt by default; opt-out via RIVEN_REALTIME_RAW_PROMPT=0 (bucket 1 G1)", async () => {
      // Bucket 1 (G1) flipped the default: raw_prompt is threaded UNLESS the
      // user explicitly sets RIVEN_REALTIME_RAW_PROMPT=0 (or legacy
      // TEAMAGENT_REALTIME_RAW_PROMPT=0). Direct callers see the same default.
      const bodyDefault = await captureBody(() => {
        emitCcStatus({
          event: "user_prompt_submit",
          sessionId: "s-3a",
          rawPrompt: "hello presence",
        });
      });
      expect(bodyDefault.raw_prompt).toBe("hello presence");

      // Explicit opt-out drops raw_prompt.
      process.env.TEAMAGENT_REALTIME_RAW_PROMPT = "0";
      try {
        const bodyOptOut = await captureBody(() => {
          emitCcStatus({
            event: "user_prompt_submit",
            sessionId: "s-3b",
            rawPrompt: "hello presence",
          });
        });
        expect(bodyOptOut.raw_prompt).toBeUndefined();
      } finally {
        delete process.env.TEAMAGENT_REALTIME_RAW_PROMPT;
      }
    });

    it("stop event accepts no rawPrompt (caller never sets it)", async () => {
      const body = await captureBody(() => {
        emitCcStatus({
          event: "stop",
          sessionId: "s-4",
          cwd: "/Users/me/repo",
        });
      });
      expect(body.event).toBe("stop");
      expect(body.raw_prompt).toBeUndefined();
    });

    it("session_end event posts with event=session_end", async () => {
      const body = await captureBody(() => {
        emitCcStatus({
          event: "session_end",
          sessionId: "s-5",
          cwd: "/Users/me/repo",
        });
      });
      expect(body.event).toBe("session_end");
    });
  });

  describe("transcript-derived metrics", () => {
    /**
     * Capture the POST body that emit produced (mocks fetch with a 204 stub
     * and reads the JSON.stringify'd init.body). Local helper so each test
     * doesn't repeat the fetch boilerplate.
     */
    async function captureBody(action: () => void): Promise<Record<string, unknown>> {
      writeDigitalTwinConfig({
        enabled: true,
        endpoint: "http://127.0.0.1:9787",
        token: "team-shared",
      });
      const fetchSpy = vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 204 }));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;
      action();
      await new Promise((r) => setTimeout(r, 5));
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      return JSON.parse(
        (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
      ) as Record<string, unknown>;
    }

    function writeTranscript(name: string, lines: object[]): string {
      const transcriptPath = path.join(sandboxHome, name);
      fs.writeFileSync(
        transcriptPath,
        lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
      );
      return transcriptPath;
    }

    it("fills turn_count / tool_calls / files_touched / model / context_tokens from a real-shape transcript", async () => {
      const transcriptPath = writeTranscript("scan-1.jsonl", [
        {
          type: "user",
          message: { role: "user", content: "hi" },
          timestamp: "2026-05-19T10:00:00.000Z",
        },
        {
          type: "assistant",
          message: {
            role: "assistant",
            model: "claude-opus-4-7",
            content: [
              { type: "text", text: "ok" },
              { type: "tool_use", name: "Edit", input: { file_path: "/a.ts" } },
              { type: "tool_use", name: "Edit", input: { file_path: "/b.ts" } },
            ],
            usage: {
              input_tokens: 100,
              cache_creation_input_tokens: 50,
              cache_read_input_tokens: 30,
              output_tokens: 10,
            },
          },
          timestamp: "2026-05-19T10:00:01.000Z",
        },
        {
          type: "user",
          message: {
            role: "user",
            content: [
              { type: "tool_result", is_error: true, content: "boom" },
            ],
          },
          timestamp: "2026-05-19T10:00:02.000Z",
        },
        {
          type: "user",
          message: { role: "user", content: "again" },
          timestamp: "2026-05-19T10:00:03.000Z",
        },
        {
          type: "assistant",
          message: {
            role: "assistant",
            model: "claude-opus-4-7",
            content: [
              { type: "tool_use", name: "Write", input: { file_path: "/a.ts" } }, // dup → set
            ],
            usage: { input_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 5 },
          },
          timestamp: "2026-05-19T10:00:04.000Z",
        },
      ]);
      const body = await captureBody(() => {
        emitCcStatus({
          event: "user_prompt_submit",
          sessionId: "scan-sess",
          cwd: "/tmp",
          transcriptPath,
        });
      });
      expect(body.turn_count).toBe(2); // 2 real user turns (third 'user' line is tool_result)
      expect(body.tool_calls_total).toBe(3); // 2 Edits + 1 Write
      expect(body.tool_calls_failed).toBe(1);
      expect(body.files_touched).toBe(2); // {/a.ts, /b.ts} de-duped
      expect(body.model).toBe("claude-opus-4-7");
      expect(body.context_tokens).toBe(200); // LATEST assistant turn
      // pct formula = Math.round((tokens / 200_000) * 100) / 100 → 2 decimal
      // places. 200/200000 = 0.001 → rounds to 0.00.
      expect(body.context_pct).toBe(0);
      expect(body.session_health).toBe("OK");
      expect(body.session_started_at).toBe("2026-05-19T10:00:00.000Z");
    });

    it("marks session_health OVER_200K when latest assistant context exceeds 200k", async () => {
      const transcriptPath = writeTranscript("scan-2.jsonl", [
        {
          type: "assistant",
          message: {
            role: "assistant",
            model: "claude-opus-4-7",
            content: [{ type: "text", text: "x" }],
            usage: {
              input_tokens: 220_000,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              output_tokens: 1,
            },
          },
          timestamp: "2026-05-19T11:00:00.000Z",
        },
      ]);
      const body = await captureBody(() => {
        emitCcStatus({
          event: "session_start",
          sessionId: "over",
          cwd: "/tmp",
          transcriptPath,
        });
      });
      expect(body.context_tokens).toBe(220_000);
      expect(body.session_health).toBe("OVER_200K");
    });

    it("ships snapshot unchanged when transcript missing / oversized / unparseable", async () => {
      const body1 = await captureBody(() => {
        emitCcStatus({
          event: "session_start",
          sessionId: "no-path",
          cwd: "/tmp",
          // no transcriptPath
        });
      });
      expect(body1.turn_count).toBeUndefined();
      expect(body1.tool_calls_total).toBeUndefined();

      const garbage = path.join(sandboxHome, "garbage.jsonl");
      fs.writeFileSync(garbage, "{not json\n{still not json\n");
      const body2 = await captureBody(() => {
        emitCcStatus({
          event: "session_start",
          sessionId: "garbage",
          cwd: "/tmp",
          transcriptPath: garbage,
        });
      });
      // Both lines fail JSON.parse — scan returns 0 turn_count, no fields
      // populated (the `if (scan.turnCount > 0)` etc guards drop them).
      expect(body2.turn_count).toBeUndefined();
      expect(body2.tool_calls_total).toBeUndefined();
    });

    it("fills quota fields from ~/.riven/digital-twin/quota-cache.json when present", async () => {
      // Mirror what `quota/state.ts:writeQuotaCache` would write — into the
      // sandbox HOME so realtime-emit reads from there. Path uses `.teamagent`
      // for legacy fallback parity with `writeDigitalTwinConfig`.
      const cacheDir = path.join(sandboxHome, ".teamagent", "digital-twin");
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(
        path.join(cacheDir, "quota-cache.json"),
        JSON.stringify({
          subscription_tier: "max/default_claude_max_20x",
          five_hour_utilization: 0.42,
          seven_day_utilization: 0.31,
          five_hour_reset_at: 1747700000,
          seven_day_reset_at: 1747800000,
          probed_at: "2026-05-19T10:00:00.000Z",
          stale: false,
        }),
      );
      __resetIdentityCacheForTests();

      const body = await captureBody(() => {
        emitCcStatus({
          event: "session_start",
          sessionId: "q-1",
          cwd: "/tmp",
        });
      });
      expect(body.subscription_tier).toBe("max/default_claude_max_20x");
      expect(body.five_hour_utilization).toBe(0.42);
      expect(body.seven_day_utilization).toBe(0.31);
      expect(body.five_hour_reset_at).toBe(1747700000);
      expect(body.seven_day_reset_at).toBe(1747800000);
      expect(body.quota_stale).toBe(false);
    });

    it("leaves quota fields unset when cache absent", async () => {
      const body = await captureBody(() => {
        emitCcStatus({
          event: "session_start",
          sessionId: "no-q",
          cwd: "/tmp",
        });
      });
      expect(body.subscription_tier).toBeUndefined();
      expect(body.five_hour_utilization).toBeUndefined();
      expect(body.seven_day_utilization).toBeUndefined();
    });
  });
});
