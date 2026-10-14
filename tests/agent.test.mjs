import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{runAgent,rankCandidates,validateInput,extractEntities} from '../worker/index.js';
const members=[{name:'A',seeds:['Arrival','Blade Runner 2049']},{name:'B',seeds:['Amélie','Paddington 2']},{name:'C',seeds:['Spirited Away','The Grand Budapest Hotel']}];
const id=n=>'11111111-1111-4111-8111-'+String(n).padStart(12,'0');
const payload=rows=>({success:true,results:{entities:rows.map(r=>({entity_id:r.id,name:r.name}))}});
test('balanced synthetic plan improves weakest support over average-only choice',async()=>{const r=await runAgent({mode:'demo',members,fairness:.65});assert.equal(r.options[0].name,'Lantern Festival');assert.equal(r.baseline.name,'Robot Harbour');assert(r.options[0].floor>r.baseline.floor);assert.equal(r.liveVerified,false);assert.match(r.warnings[0],/synthetic/);});
test('explicit exclusions survive replanning without inflating support',async()=>{const r=await runAgent({mode:'demo',members,excluded:['demo-lantern']});assert(r.options.every(x=>x.id!=='demo-lantern'));assert.equal(r.options[0].name,'Paper Sky');assert.equal(r.options[0].floor,.5);});
test('missing evidence stays null and is not called a measured dislike',()=>{const a={id:'a',name:'A'},b={id:'b',name:'B'};const r=rankCandidates([[a,b],[b]],[],.5);assert.equal(r.find(x=>x.id==='a').support[1],null);assert.equal(r.find(x=>x.id==='a').floor,0);});
test('input rejects non-finite settings, too many members and unknown demo seeds',async()=>{assert.throws(()=>validateInput({mode:'demo',members,fairness:NaN}));assert.throws(()=>validateInput({mode:'demo',members:[...members,members[0]]}));await assert.rejects(runAgent({mode:'demo',members:[{name:'A',seeds:['Other']},members[1]]}),/fixed, synthetic/);});
test('live mode cannot silently fall back without a key',async()=>{await assert.rejects(runAgent({mode:'live',members}),/not connected/);});
test('payload shape is checked rather than inventing entity IDs',()=>{assert.throws(()=>extractEntities({bad:[]}),/unfamiliar/);assert.deepEqual(extractEntities(payload([{id:id(1),name:'Valid'}])),[{id:id(1),name:'Valid'}]);assert.deepEqual(extractEntities({results:{entities:[{entity_id:'not-uuid',name:'Bad'}]}}),[]);});
test('live adapter uses correct GET endpoint/header, excludes seen titles, and fetches per-member evidence',async()=>{
 const calls=[];let seed=20;const rec=[{id:id(1),name:'Option One'},{id:id(2),name:'Option Two'}];
 const fetcher=async(url,opts)=>{calls.push({url:new URL(url),opts});return new Response(JSON.stringify(payload(url.includes('/search?')?[{id:id(seed++),name:new URL(url).searchParams.get('query')}]:rec)),{headers:{'content-type':'application/json'}});};
 const r=await runAgent({mode:'live',members:members.slice(0,2)}, {QLOO_API_KEY:'isolated-test-key'},fetcher);
 assert.equal(r.mode,'live');assert.equal(r.liveVerified,true);assert.equal(r.options.length,2);assert.equal(calls.length,9);
 for(const c of calls){assert.equal(c.url.origin,'https://hackathon.api.qloo.com');assert.equal(c.opts.method,'GET');assert.equal(c.opts.headers['X-Api-Key'],'isolated-test-key');assert(!c.url.href.includes('isolated-test-key'));}
 const insight=calls.find(c=>c.url.pathname==='/v2/insights');assert.equal(insight.url.searchParams.get('filter.type'),'urn:entity:movie');assert(insight.url.searchParams.get('filter.exclude.entities').includes(id(20)));assert.equal(insight.url.searchParams.get('take'),'30');
});
test('upstream limit and unfamiliar responses fail clearly',async()=>{await assert.rejects(runAgent({mode:'live',members:members.slice(0,2)},{QLOO_API_KEY:'limit-test'},async()=>new Response('{}',{status:429})),/request limit/);await assert.rejects(runAgent({mode:'live',members:members.slice(0,2)},{QLOO_API_KEY:'shape-test'},async()=>new Response('{"unknown":true}')),/unfamiliar/);});
test('private endpoint rejects invalid JSON and foreign browser origins',async()=>{const r=await worker.fetch(new Request('https://test.invalid/api/plan',{method:'POST',headers:{'content-type':'application/json','origin':'https://other.invalid'},body:'{}'}),{});assert.equal(r.status,403);const bad=await worker.fetch(new Request('https://test.invalid/api/plan',{method:'POST',headers:{'content-type':'application/json'},body:'{'}),{});assert.equal(bad.status,400);});
test('page and embedded client parse with a fresh nonce and visible fixture disclaimer',async()=>{const res=await worker.fetch(new Request('https://test.invalid/'),{});assert.equal(res.status,200);const html=await res.text();assert(!html.includes('__NONCE__'));assert(!html.includes('__WIDTH_CLASSES__'));assert(!html.includes('style="--support'));assert.match(html,/synthetic candidates and rankings/);const client=html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];new Function(client);assert.match(res.headers.get('content-security-policy'),/connect-src 'self'/);});

test('an oversized streamed upload is cancelled without consuming the entire body',async()=>{
 let chunks=0,cancelled=false;
 const stream=new ReadableStream({pull(controller){chunks++;controller.enqueue(new Uint8Array(4096));if(chunks===100)controller.close();},cancel(){cancelled=true;}});
 const request=new Request('https://test.invalid/api/plan',{method:'POST',headers:{'content-type':'application/json'},body:stream,duplex:'half'});
 const response=await worker.fetch(request,{});
 assert.equal(response.status,413);assert.equal(cancelled,true);assert(chunks<100);
});
test('the body limit counts UTF-8 bytes rather than JavaScript characters',async()=>{
 const body=JSON.stringify({mode:'demo',members,padding:'가'.repeat(4000)});
 assert(body.length<10000);
 const response=await worker.fetch(new Request('https://test.invalid/api/plan',{method:'POST',headers:{'content-type':'application/json'},body}),{});
 assert.equal(response.status,413);
});
test('JSON media types are normalized while misleading prefix matches are rejected',async()=>{
 const body=JSON.stringify({mode:'demo',members});
 const valid=await worker.fetch(new Request('https://test.invalid/api/plan',{method:'POST',headers:{'content-type':'Application/JSON; charset=utf-8'},body}),{});
 assert.equal(valid.status,200);
 const invalid=await worker.fetch(new Request('https://test.invalid/api/plan',{method:'POST',headers:{'content-type':'application/json-not-json'},body}),{});
 assert.equal(invalid.status,415);
});
test('the overall live deadline stops a slow plan before more upstream requests',async()=>{
 const originalNow=Date.now;let clock=originalNow(),calls=0;
 Date.now=()=>clock;
 try{
  const fetcher=async(url)=>{calls++;clock+=60000;return new Response(JSON.stringify(payload([{id:id(99),name:new URL(url).searchParams.get('query')??'Candidate'}])));};
  await assert.rejects(runAgent({mode:'live',members:members.slice(0,2)},{QLOO_API_KEY:'time-budget-test'},fetcher),error=>error.status===504&&/took too long/.test(error.message));
  assert.equal(calls,1);
 }finally{Date.now=originalNow;}
});
