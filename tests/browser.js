const {chromium}=require('playwright');const http=require('http'),fs=require('fs'),path=require('path');
const srv=http.createServer((q,r)=>{let p=path.join('app',q.url.split('?')[0]);if(q.url.startsWith('/feed-live.json'))p='app/'+global.FEED;try{const d=fs.readFileSync(p);r.writeHead(200,{'content-type':p.endsWith('.html')?'text/html':p.endsWith('.js')?'text/javascript':'application/json'});r.end(d)}catch(e){r.writeHead(404);r.end()}}).listen(8765);
global.FEED='../tests/feed1.json';
(async()=>{const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1400,height:900}});const pg=await ctx.newPage();
const errs=[];pg.on('pageerror',e=>errs.push(e.message));pg.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
const ok=(c,m)=>console.log(c?'PASS':'FAIL',m);
const U='http://localhost:8765/continental-insights.html';
await pg.goto(U);await pg.waitForTimeout(500);
ok(await pg.isVisible('#welcome'),'welcome shown first');
ok(/Load test data/.test(await pg.textContent('#loadSample')),'welcome has test data button');
await pg.click('#loadSample');await pg.waitForTimeout(800);
ok(!(await pg.isVisible('#welcome')),'dashboard shown after test data');
ok((await pg.textContent('.ac-head .ac-pill')).trim()==='Test data','pill says Test data');
const done0=await pg.evaluate(()=>dash.data('countries').data.filter(c=>c.m1_status==='Complete').length);console.log('test complete',done0);
await pg.screenshot({path:'/tmp/s1.png'});
// import
await pg.click('#loadSample2');await pg.waitForTimeout(300);
ok(await pg.isVisible('#dp'),'panel opens');
await pg.setInputFiles('#dp-file','tests/bad.csv');await pg.waitForTimeout(400);
ok(/Cannot import/.test(await pg.textContent('#dp-report')),'bad file rejected');
await pg.setInputFiles('#dp-file','app/test-data/ADHMAT_TEST_partial_export_12_countries.csv');await pg.waitForTimeout(500);
console.log((await pg.textContent('#dp-report')).slice(0,400));
await pg.screenshot({path:'/tmp/s2.png'});
await pg.click('.dp-primary');await pg.waitForTimeout(900);
ok((await pg.textContent('.ac-head .ac-pill')).trim()==='REDCap data','pill REDCap data');
const st=await pg.evaluate(()=>({n:dash.data('countries').data.length,m1:dash.data('countries').data.filter(c=>c.m1_status==='Complete').length,ns:dash.data('countries').data.filter(c=>c.m1_status==='Not started').length}));console.log(st);
ok(st.n===55&&st.m1===10&&st.ns===44,'imported counts (12 records: 10 complete+... )');
await pg.click('[data-close]');await pg.waitForTimeout(200);
for(const t of ['overview','compare','evidence','input','about']){const el=await pg.$('[data-tab="'+t+'"]');if(el){await el.click();await pg.waitForTimeout(250)}}
await pg.screenshot({path:'/tmp/s3.png'});
// persistence
await pg.reload();await pg.waitForTimeout(1200);
ok(!(await pg.isVisible('#welcome')),'after reload: no welcome');
ok((await pg.textContent('.ac-head .ac-pill')).trim()==='REDCap data','after reload: REDCap data persisted');
ok(/Imported/.test(await pg.textContent('#sample-note')),'note updated');
// feed
await pg.click('#loadSample2');await pg.fill('#dp-url','http://localhost:8765/feed-live.json');await pg.selectOption('#dp-min','1');await pg.check('#dp-on');await pg.click('#dp-now');await pg.waitForTimeout(1200);
console.log(await pg.textContent('#dp-feedmsg'));
ok((await pg.textContent('.ac-head .ac-pill')).trim()==='Live feed','pill Live feed');
let m1=await pg.evaluate(()=>dash.data('countries').data.filter(c=>c.m1_status==='Complete').length);
global.FEED='../tests/feed2.json';await pg.click('#dp-now');await pg.waitForTimeout(1200);
let m2=await pg.evaluate(()=>dash.data('countries').data.filter(c=>c.m1_status==='Complete').length);console.log('feed update',m1,'->',m2);ok(m2>m1,'feed update changes dashboard');
await pg.screenshot({path:'/tmp/s4.png'});
// delete
await pg.reload();await pg.waitForTimeout(1500);
ok((await pg.textContent('.ac-head .ac-pill')).trim()==='Live feed','feed data persists on reload (feed followed)');
pg.on('dialog',d=>d.accept());
await pg.click('#loadSample2');await pg.waitForTimeout(300);await pg.click('text=Delete all saved data');await pg.waitForTimeout(800);
ok((await pg.textContent('.ac-head .ac-pill')).trim()==='Test data','delete all -> test data');
console.log('errors:',errs);await b.close();srv.close();})();
