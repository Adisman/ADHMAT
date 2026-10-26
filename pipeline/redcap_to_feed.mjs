#!/usr/bin/env node
/**
 * ADHMAT pipeline: REDCap -> dashboard feed.
 *
 * Reads the ADHMAT National Level records from REDCap (API), calculates the dashboard
 * datasets with the same code the dashboard uses (app/adhmat-core.js), and writes ONE feed file
 * that the dashboard polls. Only the fields the dashboard needs are requested, so contact details
 * and free-text answers never leave REDCap.
 *
 * Usage:
 *   REDCAP_URL=https://redcap.example.org/api/ REDCAP_TOKEN=... node redcap_to_feed.mjs --out feed/adhmat-feed.json
 *   node redcap_to_feed.mjs --input export.csv --out feed/adhmat-feed.json     (no REDCap needed: test a file)
 * Options / environment:
 *   --out PATH          output file (default ./adhmat-feed.json)
 *   --input PATH        read a REDCap CSV/JSON export instead of calling the API
 *   REDCAP_FORM         form name (default adhmat_national_level)
 *   REDCAP_FILTER       optional REDCap filterLogic, e.g. [approval_status]='1'
 *   --strict            exit with an error if the import has warnings
 * Node 18 or later. No npm packages.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const core = [resolve(here, '../app/adhmat-core.js'), resolve(here, 'adhmat-core.js')].find(existsSync);
if (!core) { console.error('adhmat-core.js not found (expected in ../app/ or next to this script)'); process.exit(2); }
const A = require(core);
const ref = n => JSON.parse(readFileSync(resolve(here, 'reference', n), 'utf8'));
const opts = { questions: ref('questions.json'), countryTable: ref('country_table.json'), fieldMap: ref('field_map.json') };

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const out = arg('--out', 'adhmat-feed.json'), input = arg('--input'), strict = args.includes('--strict');

async function fetchRecords() {
  const url = process.env.REDCAP_URL, token = process.env.REDCAP_TOKEN;
  if (!url || !token) throw new Error('Set REDCAP_URL and REDCAP_TOKEN (or use --input).');
  const body = new URLSearchParams({ token, content: 'record', format: 'json', type: 'flat', rawOrLabel: 'raw', rawOrLabelHeaders: 'raw', exportCheckboxLabel: 'false', exportSurveyFields: 'false', returnFormat: 'json' });
  A.requiredFields(opts.questions).forEach((f, i) => body.append(`fields[${i}]`, f));
  if (process.env.REDCAP_FILTER) body.set('filterLogic', process.env.REDCAP_FILTER);
  const r = await fetch(url, { method: 'POST', body, headers: { Accept: 'application/json' } });
  const text = await r.text();
  if (!r.ok) throw new Error(`REDCap API error ${r.status}: ${text.slice(0, 200)}`);
  const j = JSON.parse(text);
  if (!Array.isArray(j)) throw new Error('REDCap API returned: ' + text.slice(0, 200));
  return j;
}

let records;
try {
  records = input ? (t => (t.trim().startsWith('[') ? JSON.parse(t) : A.parseCsv(t)))(readFileSync(input, 'utf8')) : await fetchRecords();
} catch (e) { console.error('ERROR  ', e.message); process.exit(1); }
const res = A.fromRedcapRecords(records, opts);
res.report.errors.forEach(e => console.error('ERROR  ', e));
res.report.warnings.forEach(w => console.error('WARNING', w));
res.report.info.forEach(i => console.log('INFO   ', i));
if (!res.report.ok) process.exit(1);
if (strict && res.report.warnings.length) { console.error('Stopping: --strict and warnings present.'); process.exit(1); }

// Keep generated_at unchanged when the data did not change, so open dashboards are not refreshed for nothing.
const hash = createHash('sha256').update(JSON.stringify(res.datasets)).digest('hex');
let generated = new Date().toISOString();
if (existsSync(out)) { try { const prev = JSON.parse(readFileSync(out, 'utf8')); if (prev.content_sha256 === hash) { generated = prev.generated_at; console.log('INFO    No change since the last run.'); } } catch { /* ignore */ } }
const feed = { schema: 'adhmat-feed/1', generated_at: generated, content_sha256: hash, source: { type: input ? 'file' : 'redcap', form: process.env.REDCAP_FORM || 'adhmat_national_level', records: records.length }, datasets: res.datasets };
mkdirSync(dirname(resolve(out)), { recursive: true });
writeFileSync(out, JSON.stringify(feed));
console.log(`INFO    Wrote ${out} (${(JSON.stringify(feed).length / 1024).toFixed(0)} KB, generated ${generated})`);
