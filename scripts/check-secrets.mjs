import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
const names=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const failures=[];
for(const name of names){
  let body;try{body=await fs.readFile(name,'utf8');}catch{continue;}
  if(/hack_[a-zA-Z0-9]{24,}/.test(body))failures.push(name);
}
if(failures.length){console.error(JSON.stringify({passed:false,files:failures}));process.exitCode=1;}
else console.log('No issued Qloo key found in tracked or deliverable source files.');
