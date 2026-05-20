// scripts/perf-leadership.mjs
import http from 'node:http';

async function timeRequest(url) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ ms: Date.now() - start, status: res.statusCode, bytes: Buffer.concat(chunks).length }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  const url = process.argv[2] ?? 'http://127.0.0.1:6066/api/overview?range=7d';
  const cold = await timeRequest(url);
  console.log(`cold: ${cold.ms}ms (${cold.bytes}B, status ${cold.status})`);
  const warm = [];
  for (let i = 0; i < 20; i++) warm.push((await timeRequest(url)).ms);
  warm.sort((a, b) => a - b);
  const p50 = warm[10], p95 = warm[19];
  console.log(`warm p50: ${p50}ms, p95: ${p95}ms`);
  // Exit-code semantics: 0 = pass, non-zero = breach (for CI later)
  if (cold.ms > 2000) { console.log('FAIL: cold > 2000ms'); process.exit(2); }
  if (p50 > 50) { console.log('FAIL: warm p50 > 50ms'); process.exit(3); }
  console.log('PASS');
}
main().catch((e) => { console.error(e); process.exit(1); });
