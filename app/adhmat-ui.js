/*!
 * ADHMAT dashboard data layer (browser): REDCap import, browser storage, test data, scheduled feed.
 * Needs adhmat-core.js and the dashboard's window.dash data bus. No external dependencies.
 * Storage: IndexedDB in the visitor's own browser. Nothing is uploaded anywhere by this file.
 */
(function () {
  'use strict';
  var A = window.ADHMAT, dash = window.dash;
  if (!A || !dash) { console.error('ADHMAT: core or dashboard missing'); return; }
  var CFG = window.ADHMAT_CONFIG || {};
  var DB_NAME = 'adhmat-dashboard', MAX_SNAPSHOTS = 20;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var el = function (t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x !== undefined && x !== null) e.textContent = x; return e; };
  var json = function (id) { var n = document.getElementById(id); return n ? JSON.parse(n.textContent) : null; };
  var REF = { questions: null, countryTable: null, fieldMap: null };
  var fmtTime = function (iso) { try { return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return String(iso || ''); } };

  /* ---------- storage (IndexedDB with an in-memory fallback) ---------- */
  var mem = { snapshots: {}, kv: {} }, idb = null, persistent = true;
  function openDb() {
    return new Promise(function (res) {
      try {
        var rq = indexedDB.open(DB_NAME, 1);
        rq.onupgradeneeded = function () { var d = rq.result; d.createObjectStore('snapshots', { keyPath: 'id' }); d.createObjectStore('kv'); };
        rq.onsuccess = function () { idb = rq.result; res(true); };
        rq.onerror = rq.onblocked = function () { persistent = false; res(false); };
      } catch (e) { persistent = false; res(false); }
    });
  }
  function tx(store, mode, fn) {
    return new Promise(function (res, rej) {
      if (!idb) { try { res(fn(null, true)); } catch (e) { rej(e); } return; }
      var t = idb.transaction(store, mode), s = t.objectStore(store), out;
      try { out = fn(s, false); } catch (e) { rej(e); return; }
      t.oncomplete = function () { res(typeof IDBRequest !== 'undefined' && out instanceof IDBRequest ? out.result : out); };
      t.onerror = t.onabort = function () { rej(t.error || new Error('Storage error')); };
    });
  }
  var store = {
    put: function (snap) {
      return tx('snapshots', 'readwrite', function (s, m) { if (m) mem.snapshots[snap.id] = snap; else s.put(snap); });
    },
    get: function (id) { return tx('snapshots', 'readonly', function (s, m) { return m ? mem.snapshots[id] : s.get(id); }); },
    list: function () {
      return tx('snapshots', 'readonly', function (s, m) { return m ? Object.keys(mem.snapshots).map(function (k) { return mem.snapshots[k]; }) : s.getAll(); })
        
        .then(function (a) { a = a || []; return a.sort(function (x, y) { return (y.savedAt || '').localeCompare(x.savedAt || ''); }); });
    },
    del: function (id) { return tx('snapshots', 'readwrite', function (s, m) { if (m) delete mem.snapshots[id]; else s.delete(id); }); },
    clear: function () { return tx('snapshots', 'readwrite', function (s, m) { if (m) mem.snapshots = {}; else s.clear(); }); },
    kvGet: function (k) { return tx('kv', 'readonly', function (s, m) { return m ? mem.kv[k] : s.get(k); }); },
    kvSet: function (k, v) { return tx('kv', 'readwrite', function (s, m) { if (m) mem.kv[k] = v; else s.put(v, k); }); }
  };
  function prune() {
    return store.list().then(function (all) {
      var extra = all.filter(function (x) { return x.kind !== 'feed'; }).slice(MAX_SNAPSHOTS);
      return Promise.all(extra.map(function (x) { return store.del(x.id); }));
    });
  }

  /* ---------- labels that depend on the data source ---------- */
  function srcInfo(snap) {
    if (!snap) return { kind: 'test', label: 'test data', Label: 'Test data', updated: null, id: 'test' };
    if (snap.kind === 'feed') return { kind: 'feed', label: 'live feed data', Label: 'Live feed', updated: snap.generatedAt || snap.savedAt, id: snap.id, name: snap.name };
    return { kind: 'redcap', label: 'REDCap data', Label: 'REDCap data', updated: snap.savedAt, id: snap.id, name: snap.name };
  }
  function applyLabels() {
    var s = dash.src || srcInfo(null);
    var pill = $('#ac .ac-head .ac-pill'); if (pill) pill.textContent = s.Label;
    var note = $('#sample-note');
    if (note) {
      note.textContent = '';
      var b = el('b', null, s.kind === 'test' ? 'Test data. ' : s.Label + '. ');
      note.appendChild(b);
      var d = dash.data('countries').data || [];
      var started = d.filter(function (c) { return c.m1_status !== 'Not started'; }).length;
      note.appendChild(document.createTextNode(s.kind === 'test'
        ? 'Every score, level and answer on this page is generated to test and validate the dashboard for all 55 Member States. It is not a real assessment result. Use the Data button to import a REDCap export or connect the scheduled feed.'
        : (s.kind === 'feed' ? 'Updated ' : 'Imported ') + fmtTime(s.updated) + (s.name ? ' from ' + s.name : '') + '. ' + started + ' of ' + d.length + ' Member States have started the ADHMAT. Scores are calculated with the ADHMAT V2.5 method; results for countries that are still in progress are partial and should be validated before they are published.'));
    }
    var ver = $('#aboutVersion');
    if (ver) ver.textContent = s.kind === 'test' ? 'All figures here come from test data generated for the 55 Member States to test the layout, filters and map. Real results arrive by REDCap import or the scheduled REDCap feed, and the same views read from them.' : 'All figures here come from ' + s.label + (s.updated ? ' last updated ' + fmtTime(s.updated) : '') + '. Scores are calculated with the ADHMAT V2.5 method from the answers recorded in REDCap.';
    var btn = $('#loadSample2'); if (btn) { btn.textContent = 'Data'; btn.hidden = false; btn.title = 'Import REDCap data, switch to test data, set up the scheduled feed'; }
    var srcNote = $('#dp-current'); if (srcNote) renderCurrent();
  }

  /* ---------- activating data ---------- */
  function datasetsOf(snap) { var d = snap.datasets; return { countries: d.countries, module2: d.module2 || [], subdomains: d.subdomains || [], answers: d.answers || [] }; }
  function activateSnapshot(snap, persist) {
    dash.setDataset(datasetsOf(snap), srcInfo(snap));
    if (persist !== false) store.kvSet('active', snap.id).catch(function () {});
    applyLabels();
  }
  function activateTest() {
    dash._load(); // loads the embedded test data
    store.kvSet('active', 'test').catch(function () {});
    applyLabels();
  }
  function summarise(D) {
    var c = D.countries;
    return { countries: c.length, m1_complete: c.filter(function (x) { return x.m1_status === 'Complete'; }).length, both_complete: c.filter(function (x) { return x.status === 'Complete'; }).length, started: c.filter(function (x) { return x.m1_status !== 'Not started'; }).length };
  }

  /* ---------- importing ---------- */
  function readFile(f) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result)); }; r.onerror = function () { rej(r.error); }; r.readAsText(f); }); }
  function opts() { return { questions: REF.questions, countryTable: REF.countryTable, fieldMap: REF.fieldMap }; }
  function importText(text, name) {
    var t = text.replace(/^﻿/, '').trim(), out;
    if (t.charAt(0) === '[' || t.charAt(0) === '{') {
      var j; try { j = JSON.parse(t); } catch (e) { return { report: { ok: false, errors: ['The file is not valid JSON: ' + e.message], warnings: [], info: [] } }; }
      if (Array.isArray(j)) out = A.fromRedcapRecords(j, opts());
      else if (j.records) { out = A.fromRedcapRecords(j.records, opts()); out.generatedAt = j.generated_at; }
      else if (j.datasets && j.datasets.countries) out = fromDatasets(j);
      else return { report: { ok: false, errors: ['Unrecognised JSON. Expected a REDCap record export (array) or an ADHMAT feed file.'], warnings: [], info: [] } };
    } else out = A.fromRedcapCsv(text, opts());
    out.name = name; return out;
  }
  function fromDatasets(j) {
    var rep = { ok: true, errors: [], warnings: [], info: [], records: j.datasets.countries.length, imported: j.datasets.countries.length, skipped: 0 };
    var c = j.datasets.countries;
    if (!Array.isArray(c) || !c.length || !c[0].iso3) { rep.ok = false; rep.errors.push('The feed has no country records.'); return { report: rep }; }
    rep.info.push('Feed file with ' + c.length + ' country records' + (j.generated_at ? ', generated ' + fmtTime(j.generated_at) : '') + '.');
    return { report: rep, datasets: j.datasets, generatedAt: j.generated_at };
  }
  function saveImport(out, kind, name, id) {
    var snap = { id: id || ('imp-' + Date.now()), kind: kind, name: name, savedAt: new Date().toISOString(), generatedAt: out.generatedAt || null, summary: summarise(out.datasets), report: { warnings: out.report.warnings.slice(0, 50), info: out.report.info }, datasets: out.datasets };
    return store.put(snap).then(prune).then(function () { return snap; });
  }

  /* ---------- panel ---------- */
  var panel, lastOut = null, feedState = { cfg: { url: CFG.feedUrl || '', minutes: CFG.pollMinutes || 15, on: !!CFG.feedUrl }, last: null, msg: '' }, timer = null;
  function buildPanel() {
    panel = el('div', 'dp-wrap'); panel.id = 'dp'; panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-labelledby', 'dp-title');
    panel.innerHTML =
      '<div class="dp-back" data-close></div><aside class="dp-box" tabindex="-1">' +
      '<header><h2 id="dp-title">Data and pipeline</h2><button type="button" class="btn" data-close aria-label="Close">Close</button></header>' +
      '<section id="dp-current"></section>' +
      '<section><h3>Import a REDCap export</h3><p class="dp-sub">Export the <b>ADHMAT National Level</b> form from REDCap as CSV (raw values, all records) or JSON, then choose the file. The file is checked first; nothing is shown on the dashboard until you confirm. Data are kept in this browser only.</p>' +
      '<label class="dp-drop" id="dp-drop"><input type="file" id="dp-file" accept=".csv,.json,text/csv,application/json"><span><b>Choose a file</b> or drop it here</span></label>' +
      '<div id="dp-report" aria-live="polite"></div></section>' +
      '<section><h3>Saved datasets in this browser</h3><div id="dp-saved"></div></section>' +
      '<section><h3>Test data for validation</h3><p class="dp-sub">The built-in test set covers all 55 Member States. It is generated, not real. Use it to check the dashboard, or download it in REDCap export format to test the import and the pipeline end to end.</p>' +
      '<div class="dp-row"><button type="button" class="btn" id="dp-test">Show test data</button><button type="button" class="btn" id="dp-testcsv">Download test file (REDCap CSV)</button><button type="button" class="btn" id="dp-testfeed">Download test feed (JSON)</button></div></section>' +
      '<section><h3>Scheduled feed (REDCap pipeline)</h3><p class="dp-sub">A scheduled job reads REDCap on an agreed timetable and publishes one feed file. The dashboard checks that file while it is open and updates itself when a new version appears. See pipeline/README.md in the repository.</p>' +
      '<div class="dp-grid"><label for="dp-url">Feed URL</label><input type="url" id="dp-url" placeholder="https://…/adhmat-feed.json">' +
      '<label for="dp-min">Check every</label><select id="dp-min"><option value="1">1 minute</option><option value="5">5 minutes</option><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="360">6 hours</option><option value="1440">24 hours</option></select>' +
      '<label for="dp-on">Follow feed</label><span><input type="checkbox" id="dp-on"> Update the dashboard automatically</span></div>' +
      '<div class="dp-row"><button type="button" class="btn" id="dp-save">Save settings</button><button type="button" class="btn" id="dp-now">Check now</button></div><p class="dp-sub" id="dp-feedmsg" role="status"></p></section>' +
      '</aside>';
    $('#ac').appendChild(panel);
    panel.addEventListener('click', function (e) { if (e.target.hasAttribute('data-close')) closePanel(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) closePanel(); });
    $('#dp-file').addEventListener('change', function (e) { var f = e.target.files[0]; if (f) handleFile(f); e.target.value = ''; });
    var drop = $('#dp-drop');
    ['dragenter', 'dragover'].forEach(function (n) { drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (n) { drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { var f = e.dataTransfer.files[0]; if (f) handleFile(f); });
    $('#dp-test').addEventListener('click', function () { activateTest(); renderSaved(); });
    $('#dp-testcsv').addEventListener('click', function () { var ds = testSets(), recs = A.toRedcapRecords(ds, opts()); download('ADHMAT_test_REDCap_export.csv', 'text/csv', A.toCsv(A.recordHeaders(recs), recs)); });
    $('#dp-testfeed').addEventListener('click', function () { download('adhmat-feed-test.json', 'application/json', JSON.stringify({ schema: 'adhmat-feed/1', generated_at: new Date().toISOString(), source: { type: 'test-data', note: 'Generated test data, not real results' }, datasets: testSets() })); });
    $('#dp-save').addEventListener('click', saveFeedSettings);
    $('#dp-now').addEventListener('click', function () { saveFeedSettings().then(function () { return pollFeed(true); }); });
  }
  function testSets() { var d = dash.embedded(); return { countries: d.countries, module2: d.module2, subdomains: d.subdomains, answers: d.answers }; }
  function download(name, type, text) {
    var a = el('a'); a.href = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' })); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function openPanel() { panel.hidden = false; renderCurrent(); renderSaved(); fillFeedForm(); var b = $('.dp-box', panel); b.focus(); document.body.style.overflow = 'hidden'; }
  function closePanel() { panel.hidden = true; document.body.style.overflow = ''; var b = $('#loadSample2'); if (b && !b.hidden) b.focus(); }

  function renderCurrent() {
    var host = $('#dp-current'); if (!host) return; host.textContent = '';
    var s = dash.src || srcInfo(null), c = (dash.data('countries').data) || [];
    host.appendChild(el('h3', null, 'Showing now'));
    var line = el('p', 'dp-now'); var chip = el('span', 'dp-chip dp-' + s.kind, s.Label); line.appendChild(chip);
    line.appendChild(document.createTextNode(' ' + (s.kind === 'test' ? 'Generated test data (not real results).' : (s.kind === 'feed' ? 'Updated ' : 'Imported ') + fmtTime(s.updated) + (s.name ? ' · ' + s.name : '') + '.')));
    host.appendChild(line);
    if (c.length) { var m = summarise({ countries: c }); host.appendChild(el('p', 'dp-sub', m.started + ' of ' + m.countries + ' Member States started · ' + m.m1_complete + ' ADHMAT complete · ' + m.both_complete + ' with both modules complete.')); }
    if (!persistent) host.appendChild(el('p', 'dp-warn', 'This browser is not allowing local storage (private window or blocked site data). Imports will work for this visit only.'));
  }
  function renderSaved() {
    var host = $('#dp-saved'); if (!host) return;
    store.list().then(function (all) {
      host.textContent = '';
      if (!all.length) { host.appendChild(el('p', 'dp-sub', 'Nothing saved yet. Imported files and feed updates appear here.')); return; }
      var active = dash.src && dash.src.id;
      all.forEach(function (sn) {
        var row = el('div', 'dp-item' + (active === sn.id ? ' on' : ''));
        var info = el('div'); info.appendChild(el('b', null, sn.name || sn.id));
        info.appendChild(el('div', 'dp-sub', (sn.kind === 'feed' ? 'Feed · ' : 'File · ') + fmtTime(sn.savedAt) + ' · ' + sn.summary.started + ' of ' + sn.summary.countries + ' started, ' + sn.summary.m1_complete + ' ADHMAT complete'));
        row.appendChild(info);
        var act = el('div', 'dp-act');
        var use = el('button', 'btn', active === sn.id ? 'Showing' : 'Show'); use.type = 'button'; use.disabled = active === sn.id;
        use.addEventListener('click', function () { store.get(sn.id).then(function (f) { activateSnapshot(f); renderSaved(); }); });
        var dl = el('button', 'btn', 'Download'); dl.type = 'button';
        dl.addEventListener('click', function () { store.get(sn.id).then(function (f) { download('adhmat-' + sn.id + '.json', 'application/json', JSON.stringify({ schema: 'adhmat-feed/1', generated_at: f.generatedAt || f.savedAt, source: { type: f.kind, name: f.name }, datasets: datasetsOf(f) })); }); });
        var del = el('button', 'btn', 'Delete'); del.type = 'button';
        del.addEventListener('click', function () {
          if (!window.confirm('Delete "' + (sn.name || sn.id) + '" from this browser?')) return;
          store.del(sn.id).then(function () { if (active === sn.id) activateTest(); renderSaved(); });
        });
        act.appendChild(use); act.appendChild(dl); act.appendChild(del); row.appendChild(act); host.appendChild(row);
      });
      var all2 = el('button', 'btn', 'Delete all saved data'); all2.type = 'button';
      all2.addEventListener('click', function () { if (!window.confirm('Delete every saved dataset from this browser? The test data stay available.')) return; store.clear().then(function () { activateTest(); renderSaved(); }); });
      host.appendChild(all2);
    });
  }
  function handleFile(f) {
    var host = $('#dp-report'); host.textContent = 'Checking ' + f.name + '…'; lastOut = null;
    readFile(f).then(function (text) {
      var out = importText(text, f.name); lastOut = out; renderReport(out, f.name);
    }).catch(function (e) { host.textContent = 'Could not read the file: ' + e.message; });
  }
  function renderReport(out, name) {
    var host = $('#dp-report'); host.textContent = '';
    var r = out.report, box = el('div', 'dp-report ' + (r.ok ? (r.warnings.length ? 'warn' : 'ok') : 'bad'));
    box.appendChild(el('b', null, r.ok ? (r.warnings.length ? 'Checked, with warnings' : 'Checked, no problems found') : 'Cannot import this file'));
    var ul = el('ul');
    r.errors.forEach(function (m) { ul.appendChild(el('li', 'e', m)); });
    r.warnings.slice(0, 12).forEach(function (m) { ul.appendChild(el('li', 'w', m)); });
    if (r.warnings.length > 12) ul.appendChild(el('li', 'w', '… and ' + (r.warnings.length - 12) + ' more warnings.'));
    r.info.forEach(function (m) { ul.appendChild(el('li', 'i', m)); });
    box.appendChild(ul);
    if (r.ok && out.datasets) {
      var m = summarise(out.datasets); box.appendChild(el('p', 'dp-sub', m.started + ' started · ' + m.m1_complete + ' ADHMAT complete · ' + m.both_complete + ' both modules complete.'));
      var row = el('div', 'dp-row'), go = el('button', 'btn dp-primary', 'Save and show on the dashboard'); go.type = 'button';
      go.addEventListener('click', function () {
        go.disabled = true;
        saveImport(out, 'redcap', name).then(function (snap) { activateSnapshot(snap); renderSaved(); host.textContent = ''; toast('Imported ' + name + ' and saved it in this browser.'); }).catch(function (e) { host.textContent = 'Could not save: ' + e.message; });
      });
      var no = el('button', 'btn', 'Discard'); no.type = 'button'; no.addEventListener('click', function () { host.textContent = ''; lastOut = null; });
      row.appendChild(go); row.appendChild(no); box.appendChild(row);
    }
    host.appendChild(box);
  }
  function toast(msg) {
    var t = $('#dp-toast') || (function () { var n = el('div', 'dp-toast'); n.id = 'dp-toast'; n.setAttribute('role', 'status'); $('#ac').appendChild(n); return n; })();
    t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 5000);
  }

  /* ---------- feed polling ---------- */
  function fillFeedForm() { $('#dp-url').value = feedState.cfg.url || ''; $('#dp-min').value = String(feedState.cfg.minutes || 15); $('#dp-on').checked = !!feedState.cfg.on; renderFeedMsg(); }
  function renderFeedMsg() { var m = $('#dp-feedmsg'); if (m) m.textContent = feedState.msg || (feedState.cfg.on && feedState.cfg.url ? 'Following the feed every ' + feedState.cfg.minutes + ' minutes while this page is open.' : 'Feed not connected.'); }
  function saveFeedSettings() {
    feedState.cfg = { url: $('#dp-url').value.trim(), minutes: Number($('#dp-min').value) || 15, on: $('#dp-on').checked };
    feedState.msg = ''; return store.kvSet('feed', feedState.cfg).then(function () { schedule(); renderFeedMsg(); });
  }
  function schedule() {
    clearInterval(timer); timer = null;
    if (feedState.cfg.on && feedState.cfg.url) timer = setInterval(function () { if (!document.hidden) pollFeed(false); }, Math.max(1, feedState.cfg.minutes) * 60000);
  }
  function pollFeed(manual) {
    var url = feedState.cfg.url; if (!url) { feedState.msg = 'Enter the feed URL first.'; renderFeedMsg(); return Promise.resolve(); }
    feedState.msg = 'Checking the feed…'; renderFeedMsg();
    return fetch(url, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }).then(function (text) {
      var out = importText(text, 'REDCap feed');
      if (!out.report.ok) throw new Error(out.report.errors[0]);
      var stamp = out.generatedAt || null;
      return store.get('feed-latest').then(function (prev) {
        if (prev && stamp && prev.generatedAt === stamp && !manual) { feedState.msg = 'Feed checked ' + fmtTime(new Date().toISOString()) + ': no new data.'; renderFeedMsg(); return; }
        return saveImport(out, 'feed', 'REDCap feed', 'feed-latest').then(function (snap) {
          feedState.msg = 'Feed checked ' + fmtTime(new Date().toISOString()) + ': ' + (prev && prev.generatedAt === stamp ? 'already up to date.' : 'new data received.');
          if (feedState.cfg.on || (dash.src && dash.src.id === 'feed-latest')) { activateSnapshot(snap); toast('Dashboard updated from the REDCap feed.'); }
          renderFeedMsg(); if (!panel.hidden) renderSaved();
        });
      });
    }).catch(function (e) { feedState.msg = 'Could not read the feed: ' + e.message + '. The dashboard keeps the data it already has.'; renderFeedMsg(); });
  }

  /* ---------- start up ---------- */
  function init() {
    REF.questions = json('d-questions'); REF.countryTable = json('d-country_table'); REF.fieldMap = json('d-field_map');
    A.setFieldMap(REF.fieldMap);
    buildPanel();
    var head = $('#loadSample2'); if (head) { head.hidden = true; head.addEventListener('click', function (e) { e.stopImmediatePropagation(); openPanel(); }, true); }
    // welcome screen: second route in
    var w = $('#welcome');
    if (w) {
      var h2 = $('h2', w), p = $('p', w), b = $('#loadSample');
      if (h2) h2.textContent = 'Load data to explore the dashboard';
      if (p) p.textContent = 'Import a REDCap export (CSV or JSON), connect the scheduled REDCap feed, or load the built-in test data for all 55 African Union Member States. Nothing is shown until you choose.';
      if (b) b.textContent = 'Load test data';
      var imp = el('button', 'loadbtn', 'Import REDCap data'); imp.type = 'button'; imp.style.marginLeft = '10px'; imp.addEventListener('click', openPanel);
      if (b) b.parentNode.insertBefore(imp, b.nextSibling);
    }
    window.addEventListener('dash:data', function () { if (dash.src && dash.src.kind === 'test') store.kvSet('active', 'test').catch(function () {}); applyLabels(); });
    openDb().then(function () { return Promise.all([store.kvGet('active'), store.kvGet('feed')]); }).then(function (v) {
      var active = v[0], f = v[1]; if (f) feedState.cfg = f;
      var msg = $('#loadMsg');
      var boot = active && active !== 'test' ? store.get(active) : Promise.resolve(null);
      return boot.then(function (snap) {
        if (snap) { activateSnapshot(snap, false); toast('Showing saved data: ' + (snap.name || snap.id) + '.'); }
        else if (active === 'test') activateTest();
        else if (feedState.cfg.on && feedState.cfg.url) { if (msg) msg.textContent = 'Reading the feed…'; return pollFeed(true); }
        schedule();
      });
    }).catch(function (e) { console.error(e); });
    var qs = new URLSearchParams(location.search);
    if (qs.get('feed')) { feedState.cfg = { url: qs.get('feed'), minutes: Number(qs.get('every')) || 15, on: true }; store.kvSet('feed', feedState.cfg); }
    document.addEventListener('visibilitychange', function () { if (!document.hidden && feedState.cfg.on && feedState.cfg.url && timer) pollFeed(false); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.ADHMAT_UI = { open: function () { openPanel(); }, store: store, pollFeed: function () { return pollFeed(true); } };
})();
