import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

process.stderr.write('Ready for private verification JSON on stdin (input is hidden).\n');
const input=await new Promise((resolve,reject)=>{
  let buffer='';const tty=process.stdin.isTTY;if(tty)process.stdin.setRawMode(true);process.stdin.setEncoding('utf8');
  const done=()=>{process.stdin.removeListener('data',receive);if(tty)process.stdin.setRawMode(false);process.stdin.pause();};
  const receive=chunk=>{buffer+=chunk;if(buffer.length>12000){done();reject(Error('Invalid private input.'));}else if(buffer.includes('\n')){done();try{resolve(JSON.parse(buffer.trim()));}catch{reject(Error('Invalid private input.'));}}};
  process.stdin.on('data',receive);process.stdin.resume();
});
const report={verifiedAt:new Date().toISOString(),checks:[]};
try{
  const origin='https://gamedoll-tastebridge-20261004.kdngud98.chatgpt.site';
  assert.equal(input.origin,origin);
  const headers={'Accept':'application/json'};
  if(input.bearer)headers['OAI-Sites-Authorization']='Bearer '+input.bearer;
  const statusRes=await fetch(origin+'/api/status',{headers,redirect:'error',signal:AbortSignal.timeout(20000)});
  report.checks.push({endpoint:'/api/status',status:statusRes.status});
  assert.equal(statusRes.status,200);
  const status=await statusRes.json();assert.equal(status.qlooConfigured,true);assert.equal(status.usageControls,'durable');
  const res=await fetch(origin+'/api/plan',{method:'POST',headers:{...headers,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(50000),body:JSON.stringify({mode:'live',members:[{name:'Member 1',seeds:['Arrival']},{name:'Member 2',seeds:['Paddington 2']}],fairness:0.65})});
  report.checks.push({endpoint:'/api/plan',status:res.status});
  const data=await res.json();
  if(!res.ok){report.applicationError=data.error;report.upstreamFailure=data.upstreamFailure;}
  assert.equal(res.status,200);assert.equal(data.mode,'live');assert(data.options.length>0);assert(data.trace.some(x=>x.source==='Qloo live'&&x.status===200));
  report.passed=true;report.result=data;
  const text=JSON.stringify(report,null,2);assert(!input.bearer||!text.includes(input.bearer));
  const path=process.argv[2];if(path)await fs.writeFile(path,text+'\n');
  console.log(JSON.stringify({passed:true,checks:report.checks,winner:data.options[0].name,realQlooCalls:data.trace.filter(x=>x.source==='Qloo live').length},null,2));
}catch(error){
  report.passed=false;report.failure='Deployed API verification could not complete.';report.errorKind=error.name;
  const path=process.argv[2];if(path)await fs.writeFile(path,JSON.stringify(report,null,2)+'\n');
  console.error(JSON.stringify(report));process.exitCode=1;
}
