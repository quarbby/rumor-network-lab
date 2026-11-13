#!/usr/bin/env node
// Static preview only. No API proxy and no access to .env, outputs, or Git files.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const allowed=new Map([['/','index.html'],['/index.html','index.html'],['/web/style.css','web/style.css'],
  ['/web/app.js','web/app.js'],['/src/model.js','src/model.js']]);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
const server=http.createServer((req,res)=>{
  const file=allowed.get(new URL(req.url,'http://localhost').pathname);
  if(!file||!['GET','HEAD'].includes(req.method)){res.writeHead(404);res.end('Not found');return;}
  res.setHeader('Content-Type',types[path.extname(file)]);res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method==='HEAD'){res.end();return;}fs.createReadStream(path.join(root,file)).pipe(res);
});
server.listen(Number(process.env.PORT||8765),'127.0.0.1',()=>console.log(`Rumor Network Lab: http://127.0.0.1:${server.address().port}`));
