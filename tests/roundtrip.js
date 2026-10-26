// Round trip: test datasets -> REDCap export format -> importer -> must equal the test datasets.
// Run from the repository root:  node tests/roundtrip.js
const fs = require('fs'), A = require('../app/adhmat-core.js');
const R = n => JSON.parse(fs.readFileSync('pipeline/reference/' + n, 'utf8'));
const ds = JSON.parse(fs.readFileSync('app/test-data/ADHMAT_TEST_feed.json', 'utf8')).datasets;
const opts = { questions: R('questions.json'), countryTable: R('country_table.json'), fieldMap: R('field_map.json') };
const recs = A.toRedcapRecords(ds, opts), out = A.fromRedcapCsv(A.toCsv(A.recordHeaders(recs), recs), opts);
let bad = 0;
function cmp(name, a, b, key, ignore) {
  const m = new Map(a.map(x => [key(x), x])); let n = 0;
  for (const y of b) { const x = m.get(key(y)); if (!x) { n++; continue; }
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
      let vx = x[k] === undefined ? null : x[k], vy = y[k] === undefined ? null : y[k];
      if (['emerging', 'factors', 'support_from'].includes(k)) { vx = vx && vx.split('|').sort().join('|'); vy = vy && vy.split('|').sort().join('|'); }
      if (ignore && ignore(k, x)) continue;
      if (JSON.stringify(vx) !== JSON.stringify(vy)) { n++; console.log(name, key(y), k, vx, vy); } } }
  if (a.length !== b.length) { n++; console.log(name, 'length', a.length, b.length); }
  console.log(name, n ? 'DIFFS ' + n : 'identical'); bad += n;
}
cmp('countries', ds.countries, out.datasets.countries, x => x.iso3);
cmp('subdomains', ds.subdomains, out.datasets.subdomains, x => x.c + x.domain + x.sub);
cmp('answers', ds.answers, out.datasets.answers, x => x.c + x.q);
// Module 2 evidence counts: the REDCap form has 9 evidence-class slots; a few test countries have 10 or 11, so those are capped.
cmp('module2', ds.module2, out.datasets.module2, x => x.iso3, (k, x) => /^ev_/.test(k) && ['a', 'b', 'c', 'd', 'e'].reduce((s, l) => s + (x['ev_' + l] || 0), 0) > 9);
process.exit(bad ? 1 : 0);
