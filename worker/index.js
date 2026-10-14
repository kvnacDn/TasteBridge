import { reserveQlooRequest } from './usage.js';
const BASE = 'https://hackathon.api.qloo.com';
const TYPE = 'urn:entity:movie';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAMPLE = [
  {name:'Member 1', seeds:['Arrival','Blade Runner 2049']},
  {name:'Member 2', seeds:['Amélie','Paddington 2']},
  {name:'Member 3', seeds:['Spirited Away','The Grand Budapest Hotel']}
];
const DEMO_CATALOG = [
  {id:'demo-robot',name:'Robot Harbour'},
  {id:'demo-atlas',name:'Midnight Atlas'},
  {id:'demo-paper',name:'Paper Sky'},
  {id:'demo-lantern',name:'Lantern Festival'},
  {id:'demo-circuit',name:'Wild Circuit'},
  {id:'demo-sunday',name:'Slow Sunday'}
];
const DEMO_ORDER = [[0,1,2,3,4,5],[0,2,5,3,4,1],[3,5,1,2,4,0]];
const cache = new Map();
let nextUpstreamAt=0;
const MAX_PLAN_BYTES = 10000;
const LIVE_PLAN_MS = 40000;

class PlanError extends Error {
  constructor(message,status=400,details={}) { super(message); this.status=status; this.details=details; }
}
export function validateInput(body) {
  if (!body || !['demo','live'].includes(body.mode)) throw new PlanError('Choose an example or Qloo live mode.');
  if (!Array.isArray(body.members) || body.members.length<2 || body.members.length>3) throw new PlanError('Use two or three members.');
  const members=body.members.map((m,i)=>{
    if (!m || !Array.isArray(m.seeds) || m.seeds.length<1 || m.seeds.length>2) throw new PlanError('Give each member one or two favourite movie titles.');
    const name=typeof m.name==='string' ? m.name.trim().slice(0,32) : 'Member '+(i+1);
    const seeds=m.seeds.map(s=>{if(typeof s!=='string'||s.trim().length<2||s.length>100)throw new PlanError('Movie titles must be 2–100 characters.');return s.trim();});
    return {name:name||'Member '+(i+1), seeds:[...new Set(seeds)]};
  });
  const fairness=body.fairness===undefined ? .65 : body.fairness;
  if (typeof fairness!=='number'||!Number.isFinite(fairness)||fairness<0||fairness>1) throw new PlanError('Balance must be between zero and one.');
  const excluded=body.excluded??[];
  if(!Array.isArray(excluded)||excluded.length>30||excluded.some(id=>typeof id!=='string'||id.length>80))throw new PlanError('The excluded-option list is invalid.');
  const choices=body.choices??{};
  if(!choices||typeof choices!=='object'||Array.isArray(choices)||Object.keys(choices).length>6||Object.entries(choices).some(([title,id])=>title.length<2||title.length>100||typeof id!=='string'||!UUID.test(id)))throw new PlanError('The confirmed movie choices are invalid.');
  return {mode:body.mode,members,fairness,excluded:[...new Set(excluded.map(id=>UUID.test(id)?id.toLowerCase():id))],choices:Object.fromEntries(Object.entries(choices).map(([title,id])=>[title.trim().toLowerCase(),id.toLowerCase()]))};
}
export function extractEntities(payload) {
  const candidates=[payload?.results?.entities,payload?.entities,payload?.results,payload?.data?.entities];
  const rows=candidates.find(Array.isArray);
  if(!rows)throw new PlanError('Qloo returned an unfamiliar response structure. Live verification is needed.',502);
  const entities=rows.filter(r=>r&&(!Array.isArray(r.types)||r.types.includes(TYPE))).map(r=>({id:r.entity_id??r.id,name:r.name??r.properties?.name,...(Number.isInteger(r.properties?.release_year)?{year:r.properties.release_year}:{})})).filter(r=>UUID.test(r.id)&&typeof r.name==='string'&&r.name.length>0).map(r=>({...r,id:r.id.toLowerCase()}));
  const seen=new Set();return entities.filter(r=>{if(seen.has(r.id))return false;seen.add(r.id);return true;});
}
export function rankCandidates(lists,joint,fairness,excluded=[]) {
  const forbidden=new Set(excluded);
  const candidates=new Map();
  lists.flat().concat(joint).forEach(e=>{if(!forbidden.has(e.id))candidates.set(e.id,e);});
  const jointRanks=new Map(joint.map((e,i)=>[e.id,i]));
  return [...candidates.values()].map(e=>{
    const support=lists.map(list=>{
      const pos=list.findIndex(r=>r.id===e.id);
      return pos<0?null:1-pos/list.length;
    });
    const conservative=support.map(s=>s??0);
    const average=conservative.reduce((a,b)=>a+b,0)/lists.length;
    const floor=Math.min(...conservative);
    return {...e,support,average,floor,score:(1-fairness)*average+fairness*floor,coverage:support.filter(x=>x!==null).length,jointRank:jointRanks.get(e.id)??Number.MAX_SAFE_INTEGER};
  }).sort((a,b)=>b.score-a.score||b.floor-a.floor||a.jointRank-b.jointRank||a.name.localeCompare(b.name));
}
async function qloo(path,params,key,fetcher,trace,deadline,env) {
  const url=new URL(path,BASE);
  for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
  const cacheKey=key+'|'+url.href;
  const hit=cache.get(cacheKey);
  if(hit&&hit.until>Date.now()){trace.push({step:path==='/search'?'Resolve movie':'Retrieve taste shortlist',source:'Qloo cache',entityCount:hit.data.length,verifiedAt:hit.verifiedAt});return hit.data;}
  const remaining=deadline-Date.now();
  if(remaining<=0)throw new PlanError('This live plan took too long. Try fewer movie seeds or try again later.',504);
  let response;
  try { await reserveQlooRequest(env); } catch(error) { throw new PlanError(error.status===429?error.message:'Live usage controls are temporarily unavailable. Try again later.',error.status===429?429:503); }
  if(Date.now()>=deadline)throw new PlanError('This live plan took too long. Try fewer movie seeds or try again later.',504);
  const started=Date.now();
  if(fetcher===fetch||env.QLOO_PACE_REQUESTS==='true'){
    const scheduled=Math.max(Date.now(),nextUpstreamAt);nextUpstreamAt=scheduled+750;
    const delay=scheduled-Date.now();
    if(delay>0)await new Promise(resolve=>setTimeout(resolve,Math.min(delay,Math.max(0,deadline-Date.now()))));
    if(Date.now()>=deadline)throw new PlanError('This live plan took too long. Try fewer movie seeds or try again later.',504);
  }
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),Math.max(1,Math.min(15000,deadline-Date.now())));
  try { response=await fetcher.call(globalThis,url.href,{method:'GET',headers:{'X-Api-Key':key,'Accept':'application/json'},redirect:'manual',signal:controller.signal}); }
  catch(error) {
    clearTimeout(timeout);
    if(Date.now()>=deadline)throw new PlanError('This live plan took too long. Try fewer movie seeds or try again later.',504);
    // Only fixed diagnostic categories leave this boundary. Never log an
    // exception's message, request, URL or headers, which may contain a secret.
    const message=typeof error?.message==='string'?error.message:'';
    const category=controller.signal.aborted?'timeout':/illegal invocation|incompatible receiver/i.test(message)?'runtime invocation':/redirect/i.test(message)?'redirect handling':/signal|abort|timeout.*function/i.test(message)?'cancellation API':/dns|resolve|hostname/i.test(message)?'name resolution':/SSL|TLS|certificate/i.test(message)?'TLS connection':/network|connection|fetch failed/i.test(message)?'network connection':'unclassified transport';
    console.warn('Qloo transport failure',{endpoint:path,category});
    throw new PlanError('Qloo could not be reached. Try again later; no demo data was substituted.',502,{upstreamFailure:category});
  }
  if(!response.ok){
    clearTimeout(timeout);
    if(response.status===401||response.status===403)throw new PlanError('Qloo access was not accepted. Check the hackathon key and approved entity access.',502);
    if(response.status===429)throw new PlanError('The Qloo request limit was reached. Please wait before trying again.',429);
    if(response.status===404&&path==='/search')return [];
    throw new PlanError('Qloo returned an error. No recommendations were invented.',502);
  }
  let payload;
  try {payload=await response.json();}catch{
    if(Date.now()>=deadline)throw new PlanError('This live plan took too long. Try fewer movie seeds or try again later.',504);
    throw new PlanError('Qloo returned an unreadable response.',502);
  } finally {clearTimeout(timeout);}
  if(Date.now()>=deadline)throw new PlanError('This live plan took too long. Try fewer movie seeds or try again later.',504);
  const data=extractEntities(payload);
  if(cache.size>=100)cache.delete(cache.keys().next().value);
  const verifiedAt=new Date().toISOString();
  cache.set(cacheKey,{data,until:Date.now()+300000,verifiedAt});
  trace.push({step:path==='/search'?'Resolve movie':'Retrieve taste shortlist',source:'Qloo live',status:response.status,entityCount:data.length,elapsedMs:Date.now()-started,verifiedAt});
  return data;
}
async function mapBounded(items,fn) {
  const output=new Array(items.length);let index=0,failed=false;
  const outcomes=await Promise.allSettled(Array.from({length:Math.min(3,items.length)},async()=>{while(index<items.length&&!failed){const current=index++;try{output[current]=await fn(items[current],current);}catch(error){failed=true;throw error;}}}));const failure=outcomes.find(r=>r.status==='rejected');if(failure)throw failure.reason;
  return output;
}
export async function runAgent(input,env={},fetcher=fetch) {
  const {mode,members,fairness,excluded,choices}=validateInput(input);
  const trace=[];
  const warnings=[];
  let lists,joint,resolved;
  if(mode==='demo') {
    members.forEach((m,i)=>{
      if(m.seeds.length!==SAMPLE[i].seeds.length||m.seeds.some((s,j)=>s!==SAMPLE[i].seeds[j]))throw new PlanError('The example uses a fixed, synthetic dataset. Load the example again, or use Qloo live for your own titles.');
    });
    lists=DEMO_ORDER.slice(0,members.length).map(order=>order.map(i=>DEMO_CATALOG[i]));
    joint=[3,2,0,5,1,4].map(i=>DEMO_CATALOG[i]);
    resolved=members.map(m=>({member:m.name,titles:m.seeds,source:'Synthetic example; seed lookup not performed'}));
    trace.push({step:'Load example shortlists',source:'Synthetic fixture'});
    warnings.push('All example candidates and rankings are synthetic. They are not Qloo data or current movie recommendations.');
  } else {
    const key=env.QLOO_API_KEY;
    if(!key)throw new PlanError('Qloo live is not connected. The owner must obtain and configure a hackathon API key first.',503);
    const deadline=Date.now()+LIVE_PLAN_MS;
    const requests=members.flatMap((member,memberIndex)=>member.seeds.map(title=>({title,memberIndex})));
    const resolutions=[];
    const searches=await mapBounded(requests,async({title,memberIndex})=>{
        const matches=await qloo('/search',{query:title,types:TYPE,take:3},key,fetcher,trace,deadline,env);
        if(!matches.length)throw new PlanError('Qloo could not resolve the title “'+title+'”. Use a more specific movie title.',422);
        const exact=matches.filter(m=>m.name.toLowerCase()===title.toLowerCase());
        const choice=choices[title.toLowerCase()];
        const selected=choice?matches.find(m=>m.id===choice):exact.length===1?exact[0]:null;
        if(choice&&!selected)throw new PlanError('The confirmed match for “'+title+'” is no longer among the returned results. Clear it and search again.',422);
        if(!selected)resolutions.push({query:title,member:members[memberIndex].name,matches});
        return {memberIndex,selected};
    });
    if(resolutions.length)throw new PlanError('Confirm the movie matches before comparing the group.',409,{resolutions});
    const seedIds=members.map((member,i)=>[...new Set(searches.filter(r=>r.memberIndex===i).map(r=>r.selected.id))]);
    resolved=members.map((member,i)=>({member:member.name,titles:searches.filter(r=>r.memberIndex===i).map(r=>r.selected.name),entityIds:seedIds[i],source:'Qloo entity search'}));
    const seen=[...new Set(seedIds.flat())];
    const excludeIds=[...new Set([...seen,...excluded.filter(id=>UUID.test(id))])];
    const shortlists=await mapBounded([...seedIds,seen],ids=>qloo('/v2/insights',{'filter.type':TYPE,'signal.interests.entities':ids.join(','),'filter.exclude.entities':excludeIds.join(','),take:30},key,fetcher,trace,deadline,env));
    lists=shortlists.slice(0,members.length);joint=shortlists.at(-1);
    if(lists.some(list=>!list.length))throw new PlanError('One member has no Qloo shortlist. Broaden that member’s seeds before comparing the group.',422);
    excluded.push(...seen);
    const forbidden=new Set(excluded),pool=[];
    // Interleave the joint list with every individual list so the bounded pool
    // cannot be filled entirely by the first member's taste.
    for(let i=0;i<30&&pool.length<40;i++)for(const list of [joint,...lists]){
      const movie=list[i];if(movie&&!forbidden.has(movie.id)&&!pool.some(r=>r.id===movie.id)&&pool.length<40)pool.push(movie);
    }
    if(!pool.length)throw new PlanError('No unseen options remain. Remove an exclusion or change the movie seeds.',422);
    const poolIds=new Set(pool.map(r=>r.id));
    lists=await mapBounded(seedIds,async ids=>{
      const rows=await qloo('/v2/insights',{'filter.type':TYPE,'signal.interests.entities':ids.join(','),'filter.results.entities':pool.map(r=>r.id).join(','),take:pool.length},key,fetcher,trace,deadline,env);
      if(rows.some(r=>!poolIds.has(r.id)))throw new PlanError('Qloo did not respect the shared candidate filter. No misleading group scores were produced.',502);
      if(!rows.length)throw new PlanError('Qloo returned no evidence for one member in the shared candidate pool. Broaden that member’s seeds.',422);
      return rows;
    });
    joint=joint.filter(r=>poolIds.has(r.id));
    trace.push({step:'Evaluate the same candidate pool for every member',source:'Qloo filtered Insights',entityCount:pool.length});
  }
  trace.push({step:'Compare each member’s evidence',source:'Rank-based support'});
  const ranked=rankCandidates(lists,joint,fairness,excluded);
  if(mode==='live'&&!ranked.some(r=>r.coverage===members.length))warnings.push('No candidate has returned evidence for every member. The current balance is constrained; broaden the movie seeds. Missing evidence is not dislike.');
  const baseline=rankCandidates(lists,joint,0,excluded)[0]??null;
  trace.push({step:'Balance the group and return options',source:'Deterministic decision tool'});
  return {mode,liveVerified:mode==='live',fairness,members:members.map(m=>m.name),resolved,options:ranked.slice(0,5),baseline,shortlistSizes:lists.map(list=>list.length),trace,warnings,method:'Support = 1 − position / returned list length, measured within the same bounded candidate pool for every member. Missing evidence is conservatively treated as zero for ranking, not as dislike. Balance weights the lowest support against average support. These relative rank indices are not probabilities, Qloo affinity scores or proof that everyone will enjoy a film. An exclusion starts a new Qloo query; indices across different candidate pools are not directly comparable.'};
}
const TOOL={name:'tastebridge_group_movie',description:'An agentic Qloo movie decision tool. Resolve preferences, compare individual and joint shortlists, return a balanced choice, and replan after feedback. A 409 response requires explicit selection from resolutions; pass confirmed IDs in choices and call again. Scores are rank indices, not Qloo affinity probabilities.',input_schema:{type:'object',required:['mode','members'],properties:{mode:{enum:['demo','live']},members:{type:'array',minItems:2,maxItems:3,items:{type:'object',required:['seeds'],properties:{name:{type:'string',maxLength:32},seeds:{type:'array',minItems:1,maxItems:2,items:{type:'string',minLength:2,maxLength:100}}}}},fairness:{type:'number',minimum:0,maximum:1},excluded:{type:'array',maxItems:30,items:{type:'string',maxLength:80}},choices:{type:'object',maxProperties:6,additionalProperties:{type:'string',pattern:'^[0-9a-fA-F-]{36}$'}}}},endpoint:'POST /api/plan'};
function headers(type='application/json; charset=utf-8') {return {'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};}
function json(data,status=200) {return new Response(JSON.stringify(data),{status,headers:headers()});}
async function readPlanBody(request) {
  if(Number(request.headers.get('content-length'))>MAX_PLAN_BYTES)throw new PlanError('The request is too large.',413);
  if(!request.body)return '';
  const reader=request.body.getReader();
  const decoder=new TextDecoder();
  let size=0,text='';
  try {
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>MAX_PLAN_BYTES){reader.cancel().catch(()=>{});throw new PlanError('The request is too large.',413);}
      text+=decoder.decode(value,{stream:true});
    }
    return text+decoder.decode();
  } finally {reader.releaseLock();}
}
export default {
  async fetch(request,env={}) {
    const url=new URL(request.url);
    if(request.method==='GET'&&url.pathname==='/api/status')return json({qlooConfigured:!!env.QLOO_API_KEY,usageControls:env.QLOO_USAGE_LIMITS==='durable'?'durable':'local validation',submissionReady:false});
    if(request.method==='GET'&&url.pathname==='/api/tool-schema')return json(TOOL);
    if(request.method==='POST'&&url.pathname==='/api/plan') {
      if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return json({error:'Use the application on its own origin.'},403);
      if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return json({error:'Send JSON.'},415);
      try {
        const text=await readPlanBody(request);
        let body;try{body=JSON.parse(text);}catch{throw new PlanError('Invalid JSON.');}
        return json(await runAgent(body,env));
      } catch(error) {return json({error:error instanceof PlanError?error.message:'The request could not be completed.',...(error instanceof PlanError?error.details:{})},error instanceof PlanError?error.status:500);}
    }
    if(request.method==='GET'&&url.pathname==='/') {
      const nonce=crypto.randomUUID().replaceAll('-','');
      return new Response(html.replaceAll('__NONCE__',nonce).replace('__LIVE_CONFIGURED__',String(!!env.QLOO_API_KEY)).replace('__WIDTH_CLASSES__',Array.from({length:101},(_,i)=>'.bar i.support-'+i+'{width:'+i+'%}').join('')),{headers:{...headers('text/html; charset=utf-8'),'content-security-policy':"default-src 'self'; script-src 'nonce-"+nonce+"'; style-src 'nonce-"+nonce+"'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'"}});
    }
    return json({error:'Not found'},404);
  }
};
const html=String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="TasteBridge helps a group choose a movie with visible trade-offs. Qloo-powered movie choices with visible evidence for every group member."><title>TasteBridge — choose together</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 32 32%27%3E%3Crect width=%2732%27 height=%2732%27 rx=%277%27 fill=%27%2318373f%27/%3E%3Cpath d=%27M8 13h16M12 8v13q0 5 8 3%27 fill=%27none%27 stroke=%27%23d7e8df%27 stroke-width=%273%27/%3E%3C/svg%3E">
<style nonce="__NONCE__">
:root{--ink:#18373f;--muted:#607478;--paper:#f5f2eb;--line:#dbe0d9;--mint:#d7e8df;--gold:#f1ba6b;--one:#478477;--two:#cd8c46;--three:#7186b4}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 system-ui,-apple-system,sans-serif}button,input,select{font:inherit}button{cursor:pointer}button:disabled{cursor:wait;opacity:.6}a{color:inherit}nav{max-width:1160px;margin:auto;padding:25px 26px;display:flex;justify-content:space-between;gap:20px;align-items:center}.brand{font-weight:750;font-size:22px;letter-spacing:-.8px}.brand span{display:inline-grid;place-items:center;background:var(--ink);color:var(--paper);border-radius:10px;width:31px;height:31px;margin-right:8px;font-size:20px}.badge{border:1px solid #c4cdc5;border-radius:30px;padding:6px 13px;font-size:12px;font-weight:650}main{max-width:1110px;margin:auto;padding:30px 26px 60px}.eyebrow{text-transform:uppercase;font-size:12px;letter-spacing:2px;font-weight:700;color:var(--muted)}h1{font-size:clamp(34px,5vw,60px);font-weight:650;letter-spacing:-2.3px;line-height:1.08;margin:14px 0 18px;max-width:820px}.intro{max-width:640px;color:var(--muted);font-size:18px;margin:0 0 32px}.setup{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:16px}.mode{display:flex;gap:3px;background:#e8e9e1;border-radius:10px;padding:4px}.mode button{border:0;background:transparent;border-radius:7px;padding:9px 14px;font-size:13px;font-weight:650}.mode button.active{background:white;box-shadow:0 1px 4px #0001}.subtle{border:0;background:transparent;color:var(--muted);font-size:13px;text-decoration:underline}.notice{padding:12px 16px;border-left:3px solid var(--gold);background:#fff9eb;font-size:13px;margin:16px 0 22px;border-radius:0 8px 8px 0}.profiles{display:grid;grid-template-columns:repeat(3,1fr);gap:15px}.profile{background:#fff;padding:22px;border:1px solid var(--line);border-radius:15px}.avatar{width:29px;height:29px;border-radius:50%;display:inline-grid;place-items:center;background:var(--mint);font-size:12px;font-weight:750;margin-right:8px}.profile:nth-child(2) .avatar{background:#f9e4c8}.profile:nth-child(3) .avatar{background:#e2e7f2}.profile h2{font-size:15px;margin:0 0 20px}.profile label{display:block;font-size:12px;color:var(--muted);margin:9px 0 5px}.profile input{width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:8px;background:#fbfcf9;color:var(--ink)}input:focus,button:focus-visible{outline:3px solid #e2b361;outline-offset:2px}.controls{display:flex;align-items:center;justify-content:space-between;gap:28px;margin:24px 0}.balance{flex:1;max-width:440px}.balance label{display:flex;justify-content:space-between;font-size:13px;font-weight:650}.balance input{width:100%;accent-color:var(--ink);margin:12px 0 3px}.axis{display:flex;justify-content:space-between;color:var(--muted);font-size:11px}.primary{border:0;background:var(--ink);color:white;padding:15px 24px;border-radius:10px;font-weight:650;min-width:190px}.status{min-height:24px;font-size:13px;color:var(--muted);margin:0 0 15px}.status.error{color:#a34233}.results{margin-top:26px}.results h2{font-size:25px;letter-spacing:-.5px;margin-bottom:5px}.results .explain{font-size:13px;color:var(--muted);margin-top:0}.options{display:grid;grid-template-columns:repeat(3,1fr);gap:15px}.option{background:white;border:1px solid var(--line);border-radius:15px;padding:20px;position:relative}.option:first-child{border-color:#90b4a3;background:#fcfffd}.option .number{font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted)}.option h3{font-size:21px;line-height:1.2;margin:8px 0 22px;min-height:50px;letter-spacing:-.5px}.metric{display:flex;justify-content:space-between;font-size:12px;margin-top:11px}.bar{height:6px;border-radius:6px;background:#eaf0eb;margin-top:5px;overflow:hidden}.bar i{display:block;height:100%;width:var(--support);background:var(--bar-color)}.bar.one{--bar-color:var(--one)}.bar.two{--bar-color:var(--two)}.bar.three{--bar-color:var(--three)}.score{margin-top:20px;display:flex;justify-content:space-between;border-top:1px solid var(--line);padding-top:13px;font-size:12px}.score strong{font-size:18px}.skip{margin-top:16px;border:1px solid var(--line);border-radius:7px;padding:7px 10px;background:white;font-size:12px;color:var(--muted)}.comparison{margin-top:16px;padding:18px 20px;background:var(--mint);border-radius:12px;font-size:13px}.method{margin-top:24px;padding:17px 20px;border:1px solid var(--line);border-radius:12px;font-size:12px;color:var(--muted)}.method summary{cursor:pointer;color:var(--ink);font-weight:650}.method ol{padding-left:20px}footer{border-top:1px solid var(--line);padding-top:22px;margin-top:44px;color:var(--muted);font-size:12px;display:flex;justify-content:space-between;gap:20px}.resolution{background:white;border:1px solid var(--line);border-radius:12px;padding:20px;margin:20px 0}.resolution h2{margin-top:0;font-size:22px}.resolution label{display:block;margin:16px 0 6px}.resolution select{display:block;width:100%;padding:12px;border:1px solid var(--line);border-radius:8px;color:var(--ink);background:white;font:inherit}.resolution button{margin-top:20px}.mode button,.subtle,.notice,.balance label,.status,.results .explain,.metric,.score,.skip,.comparison,.method,.profile label,.profile h2{font-size:14px}.axis,footer{font-size:12px}h1{font-size:clamp(32px,4vw,46px);letter-spacing:-1.5px}.intro{margin-bottom:24px}.hide{display:none}__WIDTH_CLASSES__@media(max-width:780px){main{padding:15px 18px 35px}nav{padding:18px}.profiles,.options{grid-template-columns:1fr}.profile{padding:18px}.controls{align-items:stretch;flex-direction:column;gap:17px}.balance{max-width:none}h1{letter-spacing:-1.4px}.setup{align-items:flex-start}.option h3{min-height:0}.badge{font-size:10px}.intro{font-size:16px}footer{flex-direction:column;gap:6px}}
</style></head><body><nav><div class="brand"><span>t</span>TasteBridge</div><div class="badge">QLOO AGENTIC HACKATHON · GAMEDOLL</div></nav><main><div class="eyebrow">A better plan for the whole group</div><h1>Find your next movie<br>together.</h1><p class="intro">Compare the group’s taste and see the trade-offs. Give quieter preferences a place in the decision.</p><div class="setup"><div class="mode" aria-label="Data source"><button id="demo" class="active" type="button" aria-pressed="true">Try the example</button><button id="live" type="button" aria-pressed="false">Qloo live</button></div><button id="reset" type="button" class="subtle">Load example</button></div><div class="notice" id="notice" role="status">Example mode uses synthetic candidates and rankings. It does not call Qloo or recommend real films.</div><form id="form"><div class="profiles" id="profiles"></div><div class="controls"><div class="balance"><label for="fairness"><span>Group balance</span><output id="balance-label">65%</output></label><input id="fairness" type="range" min="0" max="100" value="65"><div class="axis"><span>Average support</span><span>Include the least served member</span></div></div><button class="primary" id="run" type="submit">Find common ground</button></div></form><section id="resolution" class="resolution hide" aria-labelledby="resolution-title"><h2 id="resolution-title">Confirm the movie matches</h2><p>A title can refer to more than one film. Choose the intended match before we compare tastes.</p><div id="resolution-options"></div><button id="confirm" class="primary" type="button">Confirm &amp; compare</button></section><p class="status" id="status" aria-live="polite">Ready to compare the group.</p><section id="results" class="results hide" aria-live="polite"><h2 id="results-title">Your shared shortlist</h2><p class="explain" id="data-label"></p><div class="options" id="options"></div><div class="comparison" id="comparison"></div><details class="method"><summary>How the group choice was made</summary><ol id="trace"></ol><p id="method"></p><div id="warnings"></div><div id="resolved"></div></details></section><footer><span>Built for the Qloo Agentic Hackathon. Not submitted or awarded.</span><span>Real Qloo responses in live mode · synthetic data in example mode</span></footer></main>
<script nonce="__NONCE__">
const sample=[{name:'Member 1',seeds:['Arrival','Blade Runner 2049']},{name:'Member 2',seeds:['Amélie','Paddington 2']},{name:'Member 3',seeds:['Spirited Away','The Grand Budapest Hotel']}];
const $=s=>document.querySelector(s);let mode='demo',excluded=[],choices={},pendingResolutions=[],last=null,busy=false,generation=0,activeController=null;
function setBusy(value){busy=value;$('#run').disabled=value;for(const input of document.querySelectorAll('input'))input.disabled=value;for(const select of document.querySelectorAll('select'))select.disabled=value;$('#confirm').disabled=value;}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function load(){excluded=[];choices={};pendingResolutions=[];$('#resolution').classList.add('hide');last=null;$('#results').classList.add('hide');$('#profiles').innerHTML=sample.map((m,i)=>'<section class="profile"><h2><span class="avatar">'+(i+1)+'</span>'+m.name+'</h2>'+m.seeds.map((seed,j)=>'<label for="seed-'+i+'-'+j+'">Favourite movie '+(j+1)+'</label><input id="seed-'+i+'-'+j+'" autocomplete="off" maxlength="100" value="'+esc(seed)+'"'+(j===0?' required':'')+'>').join('')+'</section>').join('');}
function source(next){generation++;activeController?.abort();activeController=null;setBusy(false);mode=next;excluded=[];choices={};pendingResolutions=[];$('#resolution').classList.add('hide');last=null;$('#results').classList.add('hide');$('#status').classList.remove('error');$('#status').textContent=mode==='demo'?'Ready to try the example.':'Ready to compare your favourites with Qloo.';for(const id of ['demo','live']){$('#'+id).classList.toggle('active',id===mode);$('#'+id).setAttribute('aria-pressed',String(id===mode));}$('#notice').textContent=mode==='demo'?'Example mode uses synthetic candidates and rankings. It does not call Qloo or recommend real films.':'Live mode sends your movie titles to Qloo. Ambiguous matches need your confirmation. Names stay in this response, and preferences are not saved. Example data is never used as a fallback.';if(mode==='demo')load();}
function render(data){$('#resolution').classList.add('hide');last=data;$('#results').classList.remove('hide');$('#results-title').textContent=data.options.length?'Your shared shortlist':'No options remain';$('#data-label').textContent=data.mode==='demo'?'SYNTHETIC EXAMPLE · Scores demonstrate the group ranking method.':'QLOO LIVE · Support uses each member’s returned shortlist position, not a probability.';const colors=['one','two','three'];$('#options').innerHTML=data.options.slice(0,3).map((e,i)=>'<article class="option"><span class="number">'+(i===0?'Best group balance':'Alternative '+(i+1))+'</span><h3>'+esc(e.name)+'</h3>'+e.support.map((score,k)=>'<div class="metric"><span>'+esc(data.members[k])+'</span><span>'+(score===null?'No shortlist evidence':Math.round(score*100)+'/100')+'</span></div><div class="bar '+colors[k]+'"><i class="support-'+(score===null?0:Math.round(score*100))+'"></i></div>').join('')+'<div class="score"><span>Lowest support</span><strong>'+Math.round(e.floor*100)+'/100</strong></div><button class="skip" type="button" data-id="'+esc(e.id)+'">Exclude &amp; replan</button></article>').join('');const winner=data.options[0],base=data.baseline;$('#comparison').textContent=winner&&base?'Average-only pick: '+base.name+' (lowest support '+Math.round(base.floor*100)+'/100). Current balanced pick: '+winner.name+' (lowest support '+Math.round(winner.floor*100)+'/100).':'Reset exclusions to see a new shortlist.';$('#trace').innerHTML=data.trace.map(s=>'<li>'+esc(s.step)+' — '+esc(s.source)+(s.entityCount!==undefined?' · '+s.entityCount+' movies':'')+(s.status?' · HTTP '+s.status:'')+'</li>').join('');$('#method').textContent=data.method;$('#warnings').innerHTML=data.warnings.map(w=>'<p>'+esc(w)+'</p>').join('');$('#resolved').innerHTML=data.resolved.map(r=>'<p>'+esc(r.member)+': '+r.titles.map(esc).join(', ')+'</p>').join('');for(const button of document.querySelectorAll('.skip'))button.addEventListener('click',()=>{if(busy)return;excluded.push(button.dataset.id);run();});}
async function run(){
 if(busy)return;
 const current=++generation,requestedMode=mode,controller=new AbortController();
 activeController=controller;setBusy(true);last=null;$('#results').classList.add('hide');
 $('#status').classList.remove('error');$('#status').textContent=mode==='demo'?'Comparing example preferences…':'Resolving favourites and comparing Qloo taste shortlists…';
 const members=sample.map((m,i)=>({name:m.name,seeds:[0,1].map(j=>$('#seed-'+i+'-'+j).value.trim()).filter(Boolean)}));const activeQueries=new Set(members.flatMap(m=>m.seeds.map(title=>title.toLowerCase())));const confirmed=Object.fromEntries(Object.entries(choices).filter(([query])=>activeQueries.has(query)));
 try{
  const res=await fetch('/api/plan',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({mode:requestedMode,members,fairness:Number($('#fairness').value)/100,excluded,choices:confirmed})});
  const data=await res.json();
  if(current!==generation)return;
  if(res.status===409&&Array.isArray(data.resolutions)){showResolutions(data.resolutions);$('#status').textContent='Confirm the intended movies to continue.';return;}if(!res.ok)throw Error(data.error||'Could not create a plan.');
  render(data);$('#status').textContent=data.mode==='demo'?'Example complete. These are synthetic results.':'Live shortlist complete. Compare each member’s evidence before deciding.';
 }catch(error){
  if(current===generation&&error.name!=='AbortError'){$('#status').classList.add('error');$('#status').textContent=error.message;}
 }finally{if(current===generation){activeController=null;setBusy(false);}}
}
function showResolutions(rows){pendingResolutions=[...new Map(rows.map(row=>[row.query.toLowerCase(),row])).values()];$('#resolution-options').innerHTML=pendingResolutions.map((row,i)=>'<label for="choice-'+i+'">'+esc(row.query)+'</label><select id="choice-'+i+'"><option value="">Choose a movie</option>'+row.matches.map(m=>'<option value="'+esc(m.id)+'">'+esc(m.name)+(m.year?' ('+m.year+')':'')+'</option>').join('')+'</select>').join('');$('#resolution').classList.remove('hide');}
$('#confirm').addEventListener('click',()=>{if(busy)return;for(let i=0;i<pendingResolutions.length;i++){const value=$('#choice-'+i).value;if(!value){$('#status').textContent='Choose a match for every listed title.';return;}choices[pendingResolutions[i].query.toLowerCase()]=value;}return run();});
$('#form').addEventListener('submit',e=>{e.preventDefault();run();});$('#demo').addEventListener('click',()=>source('demo'));$('#live').addEventListener('click',()=>source('live'));$('#reset').addEventListener('click',()=>source('demo'));$('#fairness').addEventListener('input',()=>{$('#balance-label').textContent=$('#fairness').value+'%';});load();if(__LIVE_CONFIGURED__)source('live');
</script></body></html>`;
