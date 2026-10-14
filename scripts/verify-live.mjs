import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { runAgent } from '../worker/index.js';
import { readSecret } from './secret-input.mjs';

const members = [
  {name:'Member 1', seeds:['Arrival','Blade Runner 2049']},
  {name:'Member 2', seeds:['Amélie','Paddington 2']},
  {name:'Member 3', seeds:['Spirited Away','The Grand Budapest Hotel']}
];
const report = { verifiedAt: new Date().toISOString(), baseUrl: 'https://hackathon.api.qloo.com', synthetic: false, calls: [], scenarios: [] };
try {
  const key = await readSecret();
  const fetcher = async (url, options) => {
    assert.equal(new URL(url).origin, report.baseUrl);
    assert.equal(options.method, 'GET');
    assert.equal(options.headers['X-Api-Key'], key);
    assert(!url.includes(key));
    const started = Date.now();
    let res;
    try { res = await fetch(url, { ...options, redirect: 'error' }); }
    catch { report.calls.push({ endpoint: new URL(url).pathname, status: null, elapsedMs: Date.now()-started, error:'Network request failed or timed out.' }); throw new Error('Upstream network failure.'); }
    let payload;try{payload=await res.clone().json();}catch{payload={};}
    const rows = [payload?.results?.entities, payload?.entities, payload?.results, payload?.data?.entities].find(Array.isArray);
    report.calls.push({ endpoint: new URL(url).pathname, parameters: Object.fromEntries(new URL(url).searchParams), status: res.status, elapsedMs: Date.now()-started, entityCount: rows?.length ?? null, responseKeys: Object.keys(payload ?? {}) });
    return res;
  };
  const first = await runAgent({mode:'live', members, fairness:0.65}, {QLOO_API_KEY:key,QLOO_PACE_REQUESTS:'true'}, fetcher);
  assert.equal(first.mode, 'live');
  assert.equal(first.liveVerified, true);
  assert.equal(first.resolved.length, 3);
  assert(first.options.length > 0);
  assert(first.options.every(x => !x.id.startsWith('demo-')));
  const seeds = new Set(first.resolved.flatMap(x => x.entityIds).map(x => x.toLowerCase()));
  assert(first.options.every(x => !seeds.has(x.id.toLowerCase())));
  report.scenarios.push({name:'Three-member balanced plan', result:first});
  const excluded = first.options[0].id;
  const replanned = await runAgent({mode:'live',members,fairness:0.65,excluded:[excluded]}, {QLOO_API_KEY:key,QLOO_PACE_REQUESTS:'true'}, fetcher);
  assert(replanned.options.every(x => x.id.toLowerCase() !== excluded.toLowerCase()));
  assert(replanned.options.length > 0);
  report.scenarios.push({name:'Exclude the first choice and replan', excluded, result:replanned});
  const ambiguousMembers=[{name:'Member 1',seeds:['The Arrival']},{name:'Member 2',seeds:['Paddington 2']}];
  let confirmation;
  try { await runAgent({mode:'live',members:ambiguousMembers},{QLOO_API_KEY:key,QLOO_PACE_REQUESTS:'true'},fetcher); }
  catch(error) { assert.equal(error.status,409);confirmation=error.details.resolutions; }
  assert(confirmation?.length>0);
  report.scenarios.push({name:'Real ambiguous-title lookup asks for confirmation',applicationStatus:409,resolutions:confirmation});
  const choices=Object.fromEntries(confirmation.map(r=>[r.query.toLowerCase(),r.matches[0].id]));
  const confirmed=await runAgent({mode:'live',members:ambiguousMembers,choices},{QLOO_API_KEY:key,QLOO_PACE_REQUESTS:'true'},fetcher);
  assert(confirmed.options.length>0);
  report.scenarios.push({name:'Explicit entity confirmation resumes planning',result:confirmed});
  report.passed = true;
  const serialized = JSON.stringify(report, null, 2);
  if (serialized.includes(key)) throw new Error('Credential appeared in report.');
  await fs.mkdir('verification', {recursive:true});
  await fs.writeFile('verification/live-qloo.json', serialized+'\n');
  console.log(JSON.stringify({passed:true,verifiedAt:report.verifiedAt,realCalls:report.calls.length,statuses:report.calls.map(x=>x.status),winner:first.options[0].name,replannedWinner:replanned.options[0].name,warnings:first.warnings,report:'verification/live-qloo.json'},null,2));
} catch (error) {
  report.passed = false;
  report.failure = error.status || ['QLOO_API_KEY is required.', 'Secret input is invalid.'].includes(error.message) ? error.message : 'Live workflow failed; check sanitized request statuses and application error handling.';report.applicationStatus=error.status??null;
  await fs.mkdir('verification', {recursive:true});
  await fs.writeFile('verification/live-qloo-failed.json', JSON.stringify(report,null,2)+'\n');
  console.error(JSON.stringify({passed:false,failure:report.failure,applicationStatus:report.applicationStatus,calls:report.calls.map(x=>({endpoint:x.endpoint,status:x.status,elapsedMs:x.elapsedMs,entityCount:x.entityCount}))},null,2));
  process.exitCode=1;
}
