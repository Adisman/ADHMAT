// Pipeline test against a mock REDCap API.  Run from the repository root:  node tests/test_pipeline.mjs
import http from 'node:http'; import { readFileSync, mkdtempSync } from 'node:fs'; import { execFile } from 'node:child_process'; import { createRequire } from 'node:module'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
const require = createRequire(import.meta.url), A = require('../app/adhmat-core.js');
const recs = A.parseCsv(readFileSync('app/test-data/ADHMAT_TEST_partial_export_12_countries.csv', 'utf8'));
const dir = mkdtempSync(join(tmpdir(), 'adhmat-')); let seen;
const srv = http.createServer((q, r) => { let b = ''; q.on('data', c => b += c); q.on('end', () => {
  const p = new URLSearchParams(b); seen = p;
  if (p.get('token') !== 'GOOD') { r.writeHead(403); r.end('{"error":"invalid token"}'); return; }
  const f = [...p.keys()].filter(k => k.startsWith('fields[')).map(k => p.get(k));
  r.writeHead(200, { 'content-type': 'application/json' });
  r.end(JSON.stringify(recs.map(x => Object.fromEntries(Object.entries(x).filter(([k]) => f.includes(k.split('___')[0]))))));
}); }).listen(0);
const port = srv.address().port, run = env => new Promise(res => execFile('node', ['pipeline/redcap_to_feed.mjs', '--out', join(dir, 'feed.json')], { env: { ...process.env, ...env }, encoding: 'utf8' }, (e, so, se) => res({ code: e ? e.code : 0, so, se })));
let fail = 0; const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fail++; };
const good = await run({ REDCAP_URL: `http://localhost:${port}/api/`, REDCAP_TOKEN: 'GOOD' });
ok(good.code === 0, 'API run succeeds');
const feed = JSON.parse(readFileSync(join(dir, 'feed.json'), 'utf8'));
ok(feed.schema === 'adhmat-feed/1' && feed.datasets.countries.length === 55, 'feed has 55 country rows');
const file = A.fromRedcapRecords(recs, { questions: JSON.parse(readFileSync('pipeline/reference/questions.json')), countryTable: JSON.parse(readFileSync('pipeline/reference/country_table.json')), fieldMap: JSON.parse(readFileSync('pipeline/reference/field_map.json')) });
ok(JSON.stringify(feed.datasets) === JSON.stringify(file.datasets), 'API result equals file import');
const fields = [...seen.keys()].filter(k => k.startsWith('fields[')).map(k => seen.get(k));
ok(!fields.some(f => /focal|email|phone|approval|lead_/.test(f)), 'no contact or approval fields requested');
const again = await run({ REDCAP_URL: `http://localhost:${port}/api/`, REDCAP_TOKEN: 'GOOD' });
ok(/No change/.test(again.so) && JSON.parse(readFileSync(join(dir, 'feed.json'), 'utf8')).generated_at === feed.generated_at, 'unchanged data keeps generated_at');
const bad = await run({ REDCAP_URL: `http://localhost:${port}/api/`, REDCAP_TOKEN: 'BAD' });
ok(bad.code === 1 && /403/.test(bad.se), 'bad token fails cleanly');
srv.close(); process.exit(fail ? 1 : 0);
