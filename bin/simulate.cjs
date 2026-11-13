#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {simulate,APPROACHES}=require('../src/index.cjs');
(async()=>{
  const args=process.argv.slice(2);
  if(args.includes('--help')) {
    console.log('Usage: npm run simulate -- [config.json] [--approach 1|2|3|4]\nDefault: config/simulation.json. Credentials: package-local .env or environment.');
    for(const a of APPROACHES) console.log(`${a.id}: ${a.mode} — ${a.name}`);
    return;
  }
  let file,approach;
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--approach') {
      if(approach!==undefined) throw new Error('Specify --approach once');
      approach=APPROACHES.find(a=>String(a.id)===args[++i]);
      if(!approach) throw new Error('--approach must be 1, 2, 3, or 4');
    } else if(args[i].startsWith('--')||file) throw new Error('Use one config file and optionally --approach 1|2|3|4');
    else file=args[i];
  }
  const input=JSON.parse(fs.readFileSync(path.resolve(file||path.join(__dirname,'../config/simulation.json')),'utf8'));
  if(approach) input.mode=approach.mode;
  const startedAt=new Date().toISOString();
  const result=await simulate(input);
  const dir=path.resolve(result.config.outputDir);fs.mkdirSync(dir,{recursive:true});
  const id=`${startedAt.replace(/[:.]/g,'-')}-${crypto.randomBytes(3).toString('hex')}`;
  const output=path.join(dir,`simulation-${id}.json`);
  fs.writeFileSync(output,JSON.stringify({startedAt,finishedAt:new Date().toISOString(),nodeVersion:process.version,...result},null,2)+'\n',{flag:'wx'});
  console.log(`Approach ${result.approach.id}: ${result.approach.name}\nSaved ${result.runs.length} run(s) to ${output}`);
  for(const r of result.runs) console.log(`seed=${r.seed} accepting=${r.finalAcceptingCount}/${result.config.n} completedSteps=${r.completedSteps} complete=${r.complete} A20=${r.acceptingCountAt20??'unobserved'} budgetStopped=${r.stoppedByBudget}`);
})().catch(error=>{console.error(error.message);process.exitCode=1;});
