import { readSecret } from './secret-input.mjs';
import fs from 'node:fs/promises';
const key=await readSecret();
const url=new URL('/v2/insights','https://hackathon.api.qloo.com');
const params={'filter.type':'urn:entity:movie','signal.interests.entities':'c7ec4ca9-1ccc-4991-b738-55f075441b3f','filter.results.entities':'34eeac82-27ff-4ebd-ba5d-5c6dad004411,e146ca3a-10fd-4c7f-acfa-ad4e9955f08e','take':'2'};
for(const [k,v]of Object.entries(params))url.searchParams.set(k,v);
try {
  const res=await fetch(url,{headers:{'X-Api-Key':key,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20000)});
  const payload=await res.json();
  const rows=payload.results?.entities??[];
  const report={verifiedAt:new Date().toISOString(),endpoint:url.pathname,parameters:params,status:res.status,responseKeys:Object.keys(payload),entities:rows.map(r=>({id:r.entity_id,name:r.name,affinity:r.query?.affinity,keys:Object.keys(r)})),error:res.ok?undefined:payload.error_msg};
  const text=JSON.stringify(report,null,2);if(text.includes(key))throw Error();
  await fs.writeFile('verification/comparison-probe.json',text+'\n');console.log(text);
  process.exitCode=res.ok&&rows.length===2?0:1;
}catch(error) { console.error(JSON.stringify({error:'Comparison probe failed. No secret was printed.',kind:error.name,code:error.cause?.code}));process.exitCode=1; }
