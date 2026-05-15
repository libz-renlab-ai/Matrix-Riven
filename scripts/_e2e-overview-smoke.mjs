// One-shot E2E smoke: seed disk, start the built prod-server, hit /api/overview, verify shape.
// Not part of the test suite (it shells out to the built CJS bundle), but a confidence
// check before pushing the leadership-overview branch. Safe to delete after merge.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();
const collectorDir = mkdtempSync(join(tmpdir(), 'riven-overview-e2e-'));
console.log(`[e2e] collector dir = ${collectorDir}`);

const date = '2026-05-15';
const userDir = join(collectorDir, 'alice@x', date);
mkdirSync(userDir, { recursive: true });

// Use forward-slash paths so the JS source itself can't accidentally interpret
// "\U" / "\a" / "\p" as JS string escapes. node:path's basename on Windows
// handles both separators.
const cwdLiteral = 'D:/work/projects/my-app';

const snap1 = {
  schema_version: 1, session_id: 's1', user_id: 'alice@x',
  ts: '2026-05-15T10:00:00.000Z', event: 'user_prompt_submit',
  cost_usd: 1.5, turn_count: 5, tool_calls_total: 10, tool_calls_failed: 1,
  session_started_at: '2026-05-15T09:30:00.000Z',
  cwd: cwdLiteral, git_branch: 'main',
  model: 'claude-opus-4-7', session_health: 'NORMAL',
};
const snap2 = {
  ...snap1, ts: '2026-05-15T10:30:00.000Z',
  cost_usd: 2.75, turn_count: 8, tool_calls_total: 15, tool_calls_failed: 2,
};
writeFileSync(
  join(userDir, 's1.cc-status.jsonl'),
  JSON.stringify(snap1) + '\n' + JSON.stringify(snap2) + '\n',
);
writeFileSync(
  join(userDir, 's1.meta.json'),
  JSON.stringify({ l1_redaction_count: 3, l2_redaction_count: 1 }),
);
console.log('[e2e] seeded snapshots + meta');

const env = { ...process.env, PORT: '0', HOST: '127.0.0.1', RIVEN_COLLECTOR_DIR: collectorDir };
const child = spawn(
  process.execPath,
  [join(root, 'packages/collector-server/dist/bin-prod-server.cjs')],
  { env, stdio: ['ignore', 'pipe', 'pipe'] },
);

let portResolve;
const portPromise = new Promise((r) => { portResolve = r; });
const parseLine = (s) => {
  const m = s.match(/127\.0\.0\.1:(\d+)/);
  if (m) portResolve(Number(m[1]));
};
child.stdout.on('data', (c) => parseLine(c.toString()));
child.stderr.on('data', (c) => { const s = c.toString(); process.stderr.write(s); parseLine(s); });

let exitCode = 0;
try {
  const port = await Promise.race([
    portPromise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('server start timeout')), 10000)),
  ]);
  console.log(`[e2e] server up on :${port}`);

  const res = await fetch(`http://127.0.0.1:${port}/api/overview?date=${date}`);
  const body = await res.json();
  console.log(`[e2e] /api/overview status=${res.status}`);
  console.log(JSON.stringify(body, null, 2));

  const assert = (cond, msg) => {
    if (!cond) { console.error('FAIL:', msg); exitCode = 1; }
    else { console.log('PASS:', msg); }
  };
  assert(res.status === 200, 'HTTP 200');
  assert(body.date === date, `date === ${date}`);
  assert(typeof body.generated_at === 'string', 'generated_at is string');
  assert(body.cost.team_total_usd === 2.75, 'team_total_usd === 2.75 (latest snapshot cost)');
  assert(body.cost.per_user[0]?.cost_usd === 2.75, 'cost.per_user[0].cost_usd === 2.75');
  assert(body.productivity.per_user[0]?.turn_count === 8, 'productivity.per_user[0].turn_count === 8');
  assert(body.projects.top_cwd[0]?.cwd_basename === 'my-app',
    `projects.top_cwd[0].cwd_basename === my-app (got ${body.projects.top_cwd[0]?.cwd_basename})`);
  assert(body.projects.top_git_branch[0]?.git_branch === 'main', 'top_git_branch[0] === main');
  assert(body.quality.team_total_redactions === 3, 'team_total_redactions === 3 (l1 only)');
  assert(body.quality.redactions_per_user[0]?.redaction_count === 3, 'redactions_per_user[0] === 3');
  assert(body.quality.tool_failures_per_user[0]?.tool_calls_failed === 2,
    'tool_failures_per_user[0] === 2');

  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  assert(html.includes('id="tab-btn-browse"'), 'dashboard has tab-btn-browse');
  assert(html.includes('id="tab-btn-overview"'), 'dashboard has tab-btn-overview');
  assert(html.includes('id="panel-cost"'), 'dashboard has panel-cost');
  assert(html.includes('id="panel-quality"'), 'dashboard has panel-quality');
  assert(html.includes('Matrix Riven Collector'), 'dashboard title = Matrix Riven Collector');
  assert(!html.includes('TeamAgent Collector'), 'dashboard NO LONGER says TeamAgent Collector');

  const defRes = await fetch(`http://127.0.0.1:${port}/api/overview`);
  assert(defRes.status === 200, 'default-date HTTP 200');
  const defBody = await defRes.json();
  assert(/^\d{4}-\d{2}-\d{2}$/.test(defBody.date),
    `default date is YYYY-MM-DD (got ${defBody.date})`);

  const badRes = await fetch(`http://127.0.0.1:${port}/api/overview?date=2026-13-99`);
  assert(badRes.status === 400, 'bad date HTTP 400');
} finally {
  child.kill();
  rmSync(collectorDir, { recursive: true, force: true });
  console.log('[e2e] cleanup done');
  process.exitCode = exitCode;
}
