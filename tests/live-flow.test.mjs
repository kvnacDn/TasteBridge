import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgent, extractEntities, validateInput } from '../worker/index.js';
import { RESERVE_SQL, reserveQlooRequest } from '../worker/usage.js';

const id=n=>'AAAA0000-1111-4111-8111-'+String(n).padStart(12,'0');
const members=[{name:'A',seeds:['Same Title']},{name:'B',seeds:['Unique Title']}];
const entity=(n,name,year)=>({entity_id:id(n),name,types:['urn:entity:movie'],properties:{release_year:year}});
const response=rows=>new Response(JSON.stringify({results:{entities:rows}}));

test('ambiguous movies require confirmation and no insights are requested early',async()=>{
  let insights=0;
  const fetcher=async url=>{
    const u=new URL(url);
    if(u.pathname==='/v2/insights'){insights++;return response([entity(3,'Recommendation',2025)]);}
    return response(u.searchParams.get('query')==='Same Title'?[entity(1,'Same Title',1999),entity(2,'Same Title',2025)]:[entity(4,'Unique Title',2020)]);
  };
  await assert.rejects(runAgent({mode:'live',members},{QLOO_API_KEY:'ambiguity-test'},fetcher),e=>e.status===409&&e.details.resolutions[0].matches[1].year===2025);
  assert.equal(insights,0);
  const result=await runAgent({mode:'live',members,choices:{'same title':id(2)}},{QLOO_API_KEY:'ambiguity-test'},fetcher);
  assert.equal(result.resolved[0].entityIds[0],id(2).toLowerCase());
  assert.equal(insights,5);
});

test('seed and veto IDs are removed even if upstream ignores its exclusion parameter',async()=>{
  const fetcher=async url=>{
    const u=new URL(url);
    if(u.pathname==='/search')return response([entity(u.searchParams.get('query')==='Same Title'?1:2,u.searchParams.get('query'),2020)]);
    return response(u.searchParams.has('filter.results.entities')?[entity(4,'Allowed',2020)]:[entity(1,'Seed',2020),entity(3,'Veto',2020),entity(4,'Allowed',2020)]);
  };
  const result=await runAgent({mode:'live',members,excluded:[id(3)]},{QLOO_API_KEY:'exclusion-test'},fetcher);
  assert.deepEqual(result.options.map(x=>x.id),[id(4).toLowerCase()]);
});

test('lookup data normalizes IDs, removes duplicates and filters non-movie entities',()=>{
  const rows=[entity(1,'Movie',2020),entity(1,'Duplicate',2020),{...entity(2,'Book',2020),types:['urn:entity:book']}];
  assert.deepEqual(extractEntities({results:rows}),[{id:id(1).toLowerCase(),name:'Movie',year:2020}]);
  assert.throws(()=>validateInput({mode:'live',members,choices:{'title':'not-an-id'}}),/invalid/);
});

test('Qloo concurrency is bounded to three active requests',async()=>{
  let active=0,peak=0,seed=10;
  const preferences=[{seeds:['One','Two']},{seeds:['Three','Four']},{seeds:['Five','Six']}];
  const fetcher=async url=>{
    active++;peak=Math.max(peak,active);
    await new Promise(resolve=>setTimeout(resolve,5));
    active--;
    const u=new URL(url);const ids=u.searchParams.get('filter.results.entities');return ids?response(ids.split(',').map((value,i)=>({...entity(i,'Recommendation',2020),entity_id:value}))):response([entity(seed++,u.searchParams.get('query')??'Recommendation',2020)]);
  };
  await runAgent({mode:'live',members:preferences},{QLOO_API_KEY:'concurrency-test'},fetcher);
  assert.equal(peak,3);
});

test('durable usage control refuses missing storage and exhausted counters',async()=>{
  await assert.rejects(reserveQlooRequest({QLOO_USAGE_LIMITS:'durable'}),/unavailable/);
  const statements=[];
  const DB={prepare(sql){assert.equal(sql,RESERVE_SQL);return{bind(...args){statements.push(args);return{sql,args};}};},async batch(){return[{success:true,results:[{used:2}]},{success:true,results:[]}];}};
  await assert.rejects(reserveQlooRequest({QLOO_USAGE_LIMITS:'durable',DB}),e=>e.status===429);
  assert.equal(statements[0][0],'day');assert.equal(statements[0][2],600);assert.equal(statements[1][2],90);
});

test('an upstream redirect is rejected without forwarding credentials',async()=>{
  let calls=0;
  const fetcher=async function(url,options){
    calls++;
    assert.equal(this,globalThis);
    assert.equal(new URL(url).origin,'https://hackathon.api.qloo.com');
    assert.equal(options.redirect,'manual');
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(null,{status:302,headers:{Location:'https://other.example/search'}});
  };
  await assert.rejects(runAgent({mode:'live',members},{QLOO_API_KEY:'redirect-policy-test'},fetcher),e=>e.status===502);
  assert.equal(calls,2);
});
