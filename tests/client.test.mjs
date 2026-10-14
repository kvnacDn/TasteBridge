import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker,{runAgent} from '../worker/index.js';

const members=[{name:'Member 1',seeds:['Arrival','Blade Runner 2049']},{name:'Member 2',seeds:['Amélie','Paddington 2']},{name:'Member 3',seeds:['Spirited Away','The Grand Budapest Hotel']}];
function element(hidden=false){
 const classes=new Set(hidden?['hide']:[]);
 return {value:'',disabled:false,textContent:'',innerHTML:'',attributes:{},listeners:{},classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c),toggle(c,on){if(on)classes.add(c);else classes.delete(c);}},setAttribute(k,v){this.attributes[k]=v;},addEventListener(k,v){this.listeners[k]=v;}};
}
async function clientHarness(fetcher){
 const nodes=new Map();
 for(const id of ['profiles','form','run','results','status','notice','demo','live','reset','fairness','balance-label','results-title','data-label','options','comparison','trace','method','warnings','resolved','resolution','resolution-options','confirm'])nodes.set('#'+id,element(id==='results'));
 nodes.get('#fairness').value='65';
 for(let i=0;i<members.length;i++)for(let j=0;j<2;j++){const input=element();input.value=members[i].seeds[j];nodes.set('#seed-'+i+'-'+j,input);}
 const inputs=[...nodes].filter(([id])=>id.startsWith('#seed-')||id==='#fairness').map(([,node])=>node);
 const document={querySelector:s=>{if(s.startsWith('#choice-')&&!nodes.has(s))nodes.set(s,element());return nodes.get(s);},querySelectorAll:s=>s==='input'?inputs:[]};
 const context=vm.createContext({document,fetch:fetcher,AbortController});
 const page=await (await worker.fetch(new Request('https://test.invalid/'))).text();
 vm.runInContext(page.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1],context);
 return {nodes,context,inputs,run:()=>vm.runInContext('run()',context),source:mode=>nodes.get('#'+mode).listeners.click()};
}
const response=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});

test('a failed replan hides the old results and restores editable controls',async()=>{
 const fixture=await runAgent({mode:'demo',members});let calls=0;
 const ui=await clientHarness(async()=>++calls===1?response(fixture):new Response('{"error":"The request limit was reached."}',{status:429}));
 await ui.run();assert.equal(ui.nodes.get('#results').classList.contains('hide'),false);
 await ui.run();assert.equal(ui.nodes.get('#results').classList.contains('hide'),true);
 assert.match(ui.nodes.get('#status').textContent,/request limit/);
 assert.equal(ui.nodes.get('#run').disabled,false);assert(ui.inputs.every(input=>input.disabled===false));
});
test('a mode change aborts and ignores the old reply while the newer plan remains active',async()=>{
 const fixture=await runAgent({mode:'demo',members});const pending=[];
 const ui=await clientHarness((url,options)=>new Promise(resolve=>pending.push({options,resolve})));
 ui.source('live');const oldRun=ui.run();
 ui.source('demo');assert.equal(pending[0].options.signal.aborted,true);
 const newRun=ui.run();assert(ui.inputs.every(input=>input.disabled===true));
 pending[0].resolve(response({...fixture,mode:'live'}));await oldRun;
 assert.equal(ui.nodes.get('#results').classList.contains('hide'),true);assert.equal(ui.nodes.get('#run').disabled,true);
 pending[1].resolve(response(fixture));await newRun;
 assert.match(ui.nodes.get('#data-label').textContent,/SYNTHETIC EXAMPLE/);
 assert.equal(ui.nodes.get('#demo').attributes['aria-pressed'],'true');
 assert.equal(ui.nodes.get('#run').disabled,false);assert(ui.inputs.every(input=>input.disabled===false));
});


test('movie confirmation sends the selected entity and resumes the live flow',async()=>{
 const fixture=await runAgent({mode:'demo',members});const calls=[];
 const selected='11111111-1111-4111-8111-000000000077';
 const ui=await clientHarness(async(url,options)=>{
  calls.push(JSON.parse(options.body));
  return calls.length===1?new Response(JSON.stringify({error:'Confirm the movie.',resolutions:[{query:'Arrival',matches:[{id:selected,name:'Arrival',year:2016}]}]}),{status:409}):response({...fixture,mode:'live'});
 });
 ui.source('live');await ui.run();
 assert.equal(ui.nodes.get('#resolution').classList.contains('hide'),false);
 assert.match(ui.nodes.get('#resolution-options').innerHTML,/2016/);
 await ui.nodes.get('#confirm').listeners.click();assert.equal(calls.length,1);
 const option=vm.runInContext("$('#choice-0')",ui.context);option.value=selected;
 await ui.nodes.get('#confirm').listeners.click();
 assert.equal(calls.length,2);assert.equal(calls[1].choices.arrival,selected);
 assert.equal(ui.nodes.get('#resolution').classList.contains('hide'),true);
 assert.match(ui.nodes.get('#data-label').textContent,/QLOO LIVE/);
});
