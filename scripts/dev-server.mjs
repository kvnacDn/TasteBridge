import http from 'node:http';
import { Readable } from 'node:stream';
import worker from '../worker/index.js';

const port=Number(process.env.PORT||3000);
const server=http.createServer(async(req,res)=>{
  try {
    const origin='http://127.0.0.1:'+port;
    const init={method:req.method,headers:req.headers};
    if(!['GET','HEAD'].includes(req.method)){init.body=Readable.toWeb(req);init.duplex='half';}
    const response=await worker.fetch(new Request(new URL(req.url,origin),init),{QLOO_API_KEY:process.env.QLOO_API_KEY});
    res.writeHead(response.status,Object.fromEntries(response.headers));
    for await(const chunk of response.body??[])res.write(chunk);
    res.end();
  }catch{res.writeHead(500,{'content-type':'application/json'});res.end('{"error":"The local request could not be completed."}');}
});
server.listen(port,'127.0.0.1',()=>console.log('TasteBridge local development: http://127.0.0.1:'+port));
