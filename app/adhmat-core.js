/*!
 * ADHMAT core: REDCap import, scoring and validation (shared by browser and Node).
 * Scoring follows ADHMAT V2.5 as implemented in the REDCap form and the dashboard:
 *   sub-domain = Yes / (Yes + No) x 100 (N/A excluded)
 *   domain     = mean of the applicable sub-domain scores
 *   overall    = mean of domains A to E (DPS is supplementary and excluded)
 *   level      = <40 L1, 40-54.9 L2, 55-69.9 L3, 70-84.9 L4, >=85 L5
 * Input: REDCap flat export (CSV or API JSON), raw values, one record per country.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ADHMAT = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TOTAL_Q = 373;
  var PRIORITY = ['q_a1_2', 'q_a4_2', 'q_a4_3', 'q_a5_1', 'q_a7_3', 'q_a8_3', 'q_b11_3', 'q_b13_2', 'q_c2_3', 'q_e9_2'];
  var LEVELS = [[85, 5, 'L5 - Optimized'], [70, 4, 'L4 - Advanced'], [55, 3, 'L3 - Established'], [40, 2, 'L2 - Emerging'], [0, 1, 'L1 - Nascent']];
  var CONSENT = { '1': 'Named in continental reports', '2': 'Aggregated, not named', '3': 'Africa CDC and Member State only' };
  var CONTACT = { '1': 'Yes', '2': 'Yes, through focal point only', '3': 'No' };
  var YESNO = { '1': 'Yes', '2': 'No' };
  var EV_FIELDS = ['sodh_q1_d1_evcls', 'sodh_q1_d2_evcls', 'sodh_q1_d3_evcls', 'sodh_q7_evcls', 'sodh_q14_e1_cls', 'sodh_q14_e2_cls', 'sodh_q14_e3_cls', 'sodh_q14_e4_cls', 'sodh_q14_e5_cls'];
  var DROPDOWNS = {
    init_status: ['sodh_q3_status', { '1': 'Pilot or programme-level', '2': 'Scaling up', '3': 'Routine national implementation', '4': 'Paused or discontinued' }],
    phc_stage: ['sodh_q7_stage', null],
    barrier_response: ['sodh_q9_b1_worked', { '1': 'Yes', '2': 'Partly', '3': 'No', '4': 'Too early to say' }]
  };
  var BARRIER_AREA = { '1': 'Digital environment (governance, policy, financing, workforce)', '2': 'Architecture and data', '3': 'Applications', '4': 'Analytics', '5': 'AI and emerging technology', '6': 'Other or cross-cutting' };
  var CHECKBOXES = {
    phc_area: { fields: ['sodh_q7_type'], single: true },
    emerging: { fields: ['sodh_q5_d1_type', 'sodh_q5_d2_type'] },
    factors: { fields: ['sodh_q2_f1_type', 'sodh_q2_f2_type'] },
    support_from: { fields: ['sodh_q13_s1_src', 'sodh_q13_s2_src', 'sodh_q13_s3_src'] }
  };

  /* field_map.json supplies the choice labels for phc_stage and the checkbox codes. */
  var FM = null;
  function setFieldMap(fm) { FM = fm; }

  /* ---------- CSV ---------- */
  function parseCsv(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var rows = [], row = [], f = '', q = false, i = 0, n = text.length, c;
    while (i < n) {
      c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; }
        f += c; i++; continue;
      }
      if (c === '"') { q = true; i++; continue; }
      if (c === ',') { row.push(f); f = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; i++; continue; }
      f += c; i++;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    rows = rows.filter(function (r) { return !(r.length === 1 && r[0] === ''); });
    if (!rows.length) return [];
    var head = rows[0].map(function (h) { return h.trim(); });
    return rows.slice(1).map(function (r) { var o = {}; head.forEach(function (h, k) { o[h] = r[k] === undefined ? '' : r[k]; }); return o; });
  }
  function csvEscape(v) { v = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function toCsv(headers, rows) {
    return '﻿' + [headers.map(csvEscape).join(',')].concat(rows.map(function (r) { return headers.map(function (h) { return csvEscape(r[h]); }).join(','); })).join('\r\n') + '\r\n';
  }

  /* ---------- helpers ---------- */
  var r1 = function (x) { return Math.round(x * 10) / 10; };
  var norm = function (s) { return String(s === null || s === undefined ? '' : s).trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); };
  function levelOf(score) {
    if (score === null || score === undefined) return null;
    var r = Math.round(score * 1e6) / 1e6;
    for (var i = 0; i < LEVELS.length; i++) if (r >= LEVELS[i][0]) return LEVELS[i];
    return LEVELS[LEVELS.length - 1];
  }
  function answerValue(v) {
    var s = String(v === null || v === undefined ? '' : v).trim().toLowerCase();
    if (s === '1' || s === 'yes') return 1;
    if (s === '0' || s === 'no') return 0;
    if (s === '2' || s === 'n/a' || s === 'na') return 2;
    return null;
  }
  function numOrNull(v) {
    if (v === null || v === undefined) return null;
    var s = String(v).replace(/[\s,]/g, '').replace('%', '');
    if (s === '' || isNaN(Number(s))) return null;
    return Number(s);
  }
  function countryIndex(table) {
    var idx = { code: {}, name: {}, iso3: {} };
    table.forEach(function (t) {
      idx.code[String(t.code)] = t; idx.iso3[t.iso3] = t;
      [t.redcap_name, t.name, t.iso3].forEach(function (nm) { if (nm) idx.name[norm(nm)] = t; });
    });
    return idx;
  }
  function resolveCountry(raw, idx) {
    var s = String(raw === null || raw === undefined ? '' : raw).trim();
    if (!s) return null;
    return idx.code[s] || idx.iso3[s.toUpperCase()] || idx.name[norm(s)] || null;
  }
  function choiceLabel(map, v) {
    var s = String(v === null || v === undefined ? '' : v).trim();
    if (!s) return null;
    if (map && map[s]) return map[s];
    if (map) { var keys = Object.keys(map); for (var i = 0; i < keys.length; i++) if (norm(map[keys[i]]) === norm(s)) return map[keys[i]]; }
    return s; // label export or unknown value: keep as text
  }
  function checkboxLabels(rec, field) {
    var cb = FM && FM.checkbox && FM.checkbox[field];
    var out = [];
    if (cb) cb.forEach(function (p) { if (String(rec[field + '___' + p[0]]).trim() === '1') out.push(p[1]); });
    return out;
  }
  function evClass(v) { var s = String(v || '').trim().toUpperCase().charAt(0); return 'ABCDE'.indexOf(s) >= 0 && s ? s : null; }

  /* ---------- the importer ---------- */
  /* opts: { questions:[...], countryTable:[...], fieldMap:{...} } */
  function fromRedcapRecords(records, opts) {
    var questions = opts.questions, table = opts.countryTable;
    if (opts.fieldMap) FM = opts.fieldMap;
    var idx = countryIndex(table);
    var report = { ok: true, errors: [], warnings: [], info: [], records: records.length, imported: 0, skipped: 0, countries: [] };
    var warn = function (m) { report.warnings.push(m); }, err = function (m) { report.errors.push(m); };

    var qById = {}; questions.forEach(function (q) { qById[q.q] = q; });
    var cols = records.length ? Object.keys(records[0]) : [];
    var qCols = cols.filter(function (c) { return qById[c]; });
    if (!records.length) err('The file has no records.');
    else if (cols.indexOf('country') < 0) err('The column "country" is missing. Export the ADHMAT National Level form with the field list in the pipeline README.');
    else if (qCols.length < questions.length * 0.5) err('Only ' + qCols.length + ' of ' + questions.length + ' ADHMAT question columns were found. This does not look like an ADHMAT National Level export (flat, raw values).');
    if (report.errors.length) { report.ok = false; return { report: report, datasets: null }; }
    if (qCols.length < questions.length) warn(questions.length - qCols.length + ' question columns are absent from the export; those questions count as unanswered.');
    var hasMod2 = cols.some(function (c) { return c.indexOf('sodh_') === 0; });
    if (!hasMod2) warn('No Module 2 (sodh_) columns found; Module 2 will show as not started.');

    // one record per country: keep the most recently dated, else the last one
    var byC = {};
    records.forEach(function (rec, k) {
      var t = resolveCountry(rec.country, idx);
      if (!t) { report.skipped++; warn('Row ' + (k + 2) + ': country "' + rec.country + '" is not a recognised AU Member State; row skipped.'); return; }
      if (byC[t.iso3]) { warn('More than one record for ' + t.name + ' (record ' + (byC[t.iso3].rec.record_id || '?') + ' and ' + (rec.record_id || '?') + '); the later row was used.'); report.skipped++; }
      byC[t.iso3] = { t: t, rec: rec };
    });

    var D = { countries: [], module2: [], subdomains: [], answers: [] };
    var priSet = {}; PRIORITY.forEach(function (q) { priSet[q] = 1; });

    table.slice().sort(function (a, b) { return Number(a.code) - Number(b.code); }).forEach(function (t) {
      var hit = byC[t.iso3], rec = hit ? hit.rec : {};
      // --- Module 1 answers
      var ans = [], tally = {}, answeredRows = 0, bad = 0;
      questions.forEach(function (q) {
        var raw = rec[q.q]; if (raw === undefined || String(raw).trim() === '') return;
        var a = answerValue(raw);
        if (a === null) { bad++; return; }
        var row = { c: t.iso3, q: q.q, a: a };
        if (priSet[q.q] && a === 1) { var up = rec['up_' + q.q.slice(2)]; row.u = up && String(up).trim() !== '' ? 1 : 0; }
        ans.push(row); answeredRows++;
        if (a === 2) return;
        var k = q.domain + '|' + q.sub; var g = tally[k] = tally[k] || { domain: q.domain, sub: q.sub, sub_name: q.sub_name, yes: 0, no: 0 };
        if (a === 1) g.yes++; else g.no++;
      });
      if (bad) warn(t.name + ': ' + bad + ' answer value(s) were not Yes, No or N/A and were ignored.');
      D.answers = D.answers.concat(ans);

      var dom = {}, domN = {}, dpsScore = null;
      Object.keys(tally).sort().forEach(function (k) {
        var g = tally[k], tot = g.yes + g.no; if (!tot) return;
        var s = g.yes / tot * 100;
        D.subdomains.push({ c: t.iso3, domain: g.domain, sub: g.sub, sub_name: g.sub_name, score: r1(s), yes: g.yes, no: g.no });
        if (g.domain === 'DPS') { dpsScore = dpsScore === null ? [s] : dpsScore.concat([s]); return; }
        (dom[g.domain] = dom[g.domain] || []).push(s);
      });
      var dsc = {}; ['A', 'B', 'C', 'D', 'E'].forEach(function (L) { dsc[L] = dom[L] ? dom[L].reduce(function (a, b) { return a + b; }, 0) / dom[L].length : null; });
      var present = ['A', 'B', 'C', 'D', 'E'].filter(function (L) { return dsc[L] !== null; });
      var overall = present.length ? present.reduce(function (a, L) { return a + dsc[L]; }, 0) / present.length : null;
      var dps = dpsScore ? dpsScore.reduce(function (a, b) { return a + b; }, 0) / dpsScore.length : null;
      var lv = levelOf(overall);

      var m1 = rec.review_m1_status && /^(Complete|In progress|Not started)$/.test(rec.review_m1_status.trim()) ? rec.review_m1_status.trim() : (answeredRows >= TOTAL_Q ? 'Complete' : answeredRows > 0 ? 'In progress' : 'Not started');

      // --- Module 2
      var anyM2 = false, m2 = { iso3: t.iso3 };
      if (hit) Object.keys(rec).forEach(function (c) { if (c.indexOf('sodh_') === 0 && String(rec[c]).trim() !== '' && String(rec[c]).trim() !== '0') anyM2 = true; });
      var m2s = rec.review_m2_status && /^(Complete|In progress|Not started)$/.test(rec.review_m2_status.trim()) ? rec.review_m2_status.trim() : (anyM2 ? 'In progress' : 'Not started');
      m2.m2_status = m2s;
      if (m2s === 'Complete') {
        var stageMap = {}; (FM && FM.dropdown && FM.dropdown.sodh_q7_stage) && (stageMap = FM.dropdown.sodh_q7_stage);
        m2.init_status = choiceLabel(DROPDOWNS.init_status[1], rec[DROPDOWNS.init_status[0]]);
        m2.phc_area = checkboxLabels(rec, 'sodh_q7_type')[0] || null;
        m2.phc_stage = choiceLabel(stageMap, rec.sodh_q7_stage);
        [1, 2, 3].forEach(function (i) { m2['barrier_' + i] = choiceLabel(BARRIER_AREA, rec['sodh_q11_b' + i + '_area']); });
        m2.barrier_response = choiceLabel(DROPDOWNS.barrier_response[1], rec.sodh_q9_b1_worked);
        ['emerging', 'factors', 'support_from'].forEach(function (k) {
          var seen = {}, out = [];
          CHECKBOXES[k].fields.forEach(function (f) { checkboxLabels(rec, f).forEach(function (l) { if (!seen[l]) { seen[l] = 1; out.push(l); } }); });
          m2[k] = out.join('|');
        });
        var ev = { A: 0, B: 0, C: 0, D: 0, E: 0 };
        EV_FIELDS.forEach(function (f) { var c = evClass(rec[f]); if (c) ev[c]++; });
        ['a', 'b', 'c', 'd', 'e'].forEach(function (l) { m2['ev_' + l] = ev[l.toUpperCase()]; });
        m2.consent = choiceLabel(CONSENT, rec.data_sharing_consent);
        m2.contact_ok = choiceLabel(CONTACT, rec.sodh_contact_ok);
        m2.case_study_ok = choiceLabel(YESNO, rec.sodh_case_study_ok);
        m2.factors = m2.factors || null;
      }
      D.module2.push(m2);

      var status = m1 === 'Complete' && m2s === 'Complete' ? 'Complete' : (m1 === 'Not started' && m2s === 'Not started' ? 'Not started' : 'In progress');
      var pop = numOrNull(rec.population_covered), fac = numOrNull(rec.num_health_facilities), urb = numOrNull(rec.urban_population_pct);
      var priYes = 0, priDocs = 0; ans.forEach(function (r) { if (priSet[r.q] && r.a === 1) { priYes++; if (r.u === 1) priDocs++; } });
      D.countries.push({
        iso3: t.iso3, country: t.name, region: t.region,
        population_m: pop === null ? null : Math.round(pop / 1e4) / 100, facilities: fac, urban_pct: urb,
        status: status, m1_status: m1, m2_status: m2s,
        answered: answeredRows, completion_pct: r1(answeredRows / TOTAL_Q * 100),
        overall: overall === null ? null : r1(overall), level: lv ? lv[1] : null, level_name: lv ? lv[2] : '',
        dom_a: dsc.A === null ? null : r1(dsc.A), dom_b: dsc.B === null ? null : r1(dsc.B), dom_c: dsc.C === null ? null : r1(dsc.C),
        dom_d: dsc.D === null ? null : r1(dsc.D), dom_e: dsc.E === null ? null : r1(dsc.E), dps: dps === null ? null : r1(dps),
        priority_yes: priYes, priority_docs: priDocs
      });

      // --- cross-check against the scores REDCap itself calculated
      if (hit && rec.result_overall_score !== undefined && String(rec.result_overall_score).trim() !== '' && overall !== null) {
        var rs = numOrNull(rec.result_overall_score);
        if (rs !== null && Math.abs(rs - r1(overall)) > 0.15) warn(t.name + ': overall score computed here (' + r1(overall) + ') differs from the REDCap calculated score (' + rs + '). Check the scoring version of the form.');
      }
      if (hit) report.countries.push({ iso3: t.iso3, name: t.name, m1: m1, m2: m2s, answered: answeredRows, overall: overall === null ? null : r1(overall) });
    });
    report.imported = Object.keys(byC).length;
    report.info.push(report.imported + ' Member State record(s) imported; the other ' + (table.length - report.imported) + ' are shown as not started.');
    if (!report.imported) { report.ok = false; err('No record could be matched to a Member State.'); }
    return { report: report, datasets: D };
  }

  function fromRedcapCsv(text, opts) { return fromRedcapRecords(parseCsv(text), opts); }

  /* ---------- test REDCap export generated from the built-in test datasets ---------- */
  function toRedcapRecords(ds, opts) {
    var table = opts.countryTable, questions = opts.questions, FMx = opts.fieldMap || FM;
    var byIso = {}; table.forEach(function (t) { byIso[t.iso3] = t; });
    var ansBy = {}; ds.answers.forEach(function (a) { (ansBy[a.c] = ansBy[a.c] || {})[a.q] = a; });
    var m2By = {}; ds.module2.forEach(function (m) { m2By[m.iso3] = m; });
    var inv = function (map, label) { var ks = Object.keys(map || {}); for (var i = 0; i < ks.length; i++) if (map[ks[i]] === label) return ks[i]; return ''; };
    var cbCode = function (field, label) { var cb = FMx.checkbox[field] || []; for (var i = 0; i < cb.length; i++) if (cb[i][1] === label) return cb[i][0]; return null; };
    var recs = [];
    ds.countries.forEach(function (c, i) {
      var t = byIso[c.iso3], r = { record_id: String(i + 1), country: String(t.code), module_choice: '3' };
      r.population_covered = c.population_m === null ? '' : String(Math.round(c.population_m * 1e6));
      r.num_health_facilities = c.facilities === null ? '' : String(c.facilities);
      r.urban_population_pct = c.urban_pct === null ? '' : String(c.urban_pct);
      r.data_sharing_consent = '';
      var A = ansBy[c.iso3] || {};
      questions.forEach(function (q) { var a = A[q.q]; r[q.q] = a ? String(a.a) : ''; if (a && a.u !== undefined && PRIORITY.indexOf(q.q) >= 0) r['up_' + q.q.slice(2)] = a.u === 1 ? 'supporting_document.pdf' : ''; });
      r.review_m1_status = c.m1_status; r.review_m2_status = c.m2_status;
      r.result_overall_score = c.overall === null ? '' : String(c.overall);
      var m = m2By[c.iso3] || {};
      if (m.m2_status === 'Complete') {
        r.sodh_q3_status = inv(DROPDOWNS.init_status[1], m.init_status);
        r.sodh_q7_stage = inv(FMx.dropdown.sodh_q7_stage, m.phc_stage);
        var ar = cbCode('sodh_q7_type', m.phc_area); if (ar) r['sodh_q7_type___' + ar] = '1';
        [1, 2, 3].forEach(function (k) { r['sodh_q11_b' + k + '_area'] = inv(BARRIER_AREA, m['barrier_' + k]); });
        r.sodh_q9_b1_worked = inv(DROPDOWNS.barrier_response[1], m.barrier_response);
        var put = function (key, fields) {
          (m[key] || '').split('|').filter(Boolean).forEach(function (l) { for (var i = 0; i < fields.length; i++) { var cd = cbCode(fields[i], l); if (cd) { r[fields[i] + '___' + cd] = '1'; return; } } });
        };
        put('emerging', ['sodh_q5_d1_type', 'sodh_q5_d2_type']); put('factors', ['sodh_q2_f1_type', 'sodh_q2_f2_type']); put('support_from', ['sodh_q13_s1_src', 'sodh_q13_s2_src', 'sodh_q13_s3_src']);
        var slot = 0;
        ['a', 'b', 'c', 'd', 'e'].forEach(function (l) { for (var n = 0; n < (m['ev_' + l] || 0) && slot < EV_FIELDS.length; n++) r[EV_FIELDS[slot++]] = l.toUpperCase(); });
        r.data_sharing_consent = inv(CONSENT, m.consent); r.sodh_contact_ok = inv(CONTACT, m.contact_ok); r.sodh_case_study_ok = inv(YESNO, m.case_study_ok);
      } else if (m.m2_status === 'In progress') r.sodh_q3_status = '1';
      recs.push(r);
    });
    return recs;
  }
  function recordHeaders(recs) { var seen = {}, h = []; recs.forEach(function (r) { Object.keys(r).forEach(function (k) { if (!seen[k]) { seen[k] = 1; h.push(k); } }); }); return h; }

  /* The only REDCap fields the dashboard needs (keeps contact details and free text out of the feed). */
  function requiredFields(questions) {
    var f = ['record_id', 'country', 'population_covered', 'num_health_facilities', 'urban_population_pct', 'data_sharing_consent', 'review_m1_status', 'review_m2_status', 'result_overall_score',
      'sodh_q3_status', 'sodh_q7_stage', 'sodh_q7_type', 'sodh_q9_b1_worked', 'sodh_q11_b1_area', 'sodh_q11_b2_area', 'sodh_q11_b3_area', 'sodh_contact_ok', 'sodh_case_study_ok']
      .concat(CHECKBOXES.emerging.fields, CHECKBOXES.factors.fields, CHECKBOXES.support_from.fields, EV_FIELDS);
    questions.forEach(function (q) { f.push(q.q); });
    PRIORITY.forEach(function (q) { f.push('up_' + q.slice(2)); });
    var seen = {}; return f.filter(function (x) { return seen[x] ? false : (seen[x] = 1); });
  }

  return {
    requiredFields: requiredFields, TOTAL_Q: TOTAL_Q, PRIORITY: PRIORITY, LEVELS: LEVELS, EV_FIELDS: EV_FIELDS,
    parseCsv: parseCsv, toCsv: toCsv, setFieldMap: setFieldMap, levelOf: levelOf,
    fromRedcapRecords: fromRedcapRecords, fromRedcapCsv: fromRedcapCsv,
    toRedcapRecords: toRedcapRecords, recordHeaders: recordHeaders
  };
});
