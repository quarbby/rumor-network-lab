// Live, sequential fixed-workload benchmark. Requires an OpenRouter key.
// Reads credentials privately; outputs contain only fictional scenario data.
// Run: node analysis/benchmark_jev.cjs (from the simulation directory).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');
const envFile = process.env.JEV_BENCH_ENV || path.resolve(root, '.env');
const file = fs.existsSync(envFile) ? Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/)
  .filter(x => /^\s*\w+\s*=/.test(x)).map(x => {const i=x.indexOf('=');return [x.slice(0,i).trim(),x.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];})) : {};
const key = process.env.OPENROUTER_API_KEY || file.OPENROUTER_API_KEY || file.open_router;
if (!key) throw new Error('Set OPENROUTER_API_KEY or JEV_BENCH_ENV');
const output = path.join(__dirname, 'results_jev_benchmark.json');
const report = { startedAt: new Date().toISOString(), protocol: 'Live Jev simulation followed by sequential GLM replay of identical decision contexts. Generation timings are shared between timing totals.',
  jevModel: 'typesafe/jev-1.14', generativeModel: 'z-ai/glm-5.3-flashx', seed: 42, alpha3: 0.4,
  completed: false, generation: [], jev: [], glm: [] };
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2)+'\n');
async function request(endpoint, body) {
  const start = performance.now();
  const res = await fetch('https://openrouter.ai/api/'+endpoint, {method:'POST', headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'}, body:JSON.stringify(body), signal:AbortSignal.timeout(45000)});
  const data = await res.json();
  const seconds = (performance.now()-start)/1000;
  if (!res.ok) throw new Error('HTTP '+res.status+': '+JSON.stringify(data).replaceAll(key,'[REDACTED]'));
  return {seconds, response:data};
}
const classifier = (instructions, context) => `You are a fast binary-decision classifier embedded inside a social-simulation agent-based model. You are not the agent; you are deciding, from the outside, what a realistic agent in this situation would do.\n\nDecision to make: ${instructions}\n\nSituation context (JSON): ${JSON.stringify(context)}\n\nBase rate for context: absent any other signal, this type of decision in this population is calibrated to happen roughly ${Math.round((context.baseRate ?? 0.5)*100)}% of the time -- treat this only as a weak prior, and let the specific context above move you away from it when informative.\n\nRespond with ONLY one line of strict JSON: {"answer": true or false, "confidence": <number between 0 and 1>}`;
async function generateMessage(prompt) {
  const call = await request('v1/chat/completions', {model:report.generativeModel,messages:[{role:'user',content:prompt}],temperature:0.9,max_tokens:1800});
  report.generation.push({prompt,...call});save();
  console.log('Generated message '+report.generation.length+' ('+call.seconds.toFixed(2)+' s)');
  const text=call.response.choices?.[0]?.message?.content?.trim() || '';
  return text.replace(/^["“]|["”]$/g,'');
}
async function judgeReal(instructions, context) {
  const state={context,instructions,baseRateNote:'The base rate is a weak prior, not a requirement to return a fixed frequency. Judge whether a realistic actor performs the action in the supplied situation.'};
  const call=await request('alpha/decisions',{model:report.jevModel,state,questions:{action:{type:'noul',instructions:'The actor performs the action described in instructions, given context.'}}});
  const probability=call.response.answers?.action?.noul;
  if (!(typeof probability==='number' && probability>=0 && probability<=1)) throw new Error('Invalid Jev probability');
  const answer=probability>=0.5;
  report.jev.push({instructions,context,probability,answer,...call});save();
  if (report.jev.length%10===0) console.log('Jev judgments: '+report.jev.length);
  return {answer,confidence:Math.max(probability,1-probability)};
}
(async () => {
  const source=fs.readFileSync(path.join(__dirname,'benchmark_inputs/experiment3-full-real.cjs'),'utf8');
  report.simulationSourceSHA256=crypto.createHash('sha256').update(source).digest('hex');
  const definitions=source.slice(0,source.indexOf('const CHECKPOINT_PATH')).replace(/^const .*require\([^\n]+\);\n/gm,'');
  const sandbox={module:{exports:{}},PERSONAS:require(path.join(root,'llm/personas.js')).PERSONAS,generateMessage,judgeReal};
  vm.runInNewContext(definitions+'\nmodule.exports={runOnce};',sandbox);
  const start=performance.now();report.simulation=await sandbox.module.exports.runOnce(report.alpha3,report.seed);
  report.hybridWallSeconds=(performance.now()-start)/1000;save();
  console.log('Live simulation complete; replaying '+report.jev.length+' GLM judgments.');
  for (const item of report.jev) {
    const call=await request('v1/chat/completions',{model:report.generativeModel,messages:[{role:'user',content:classifier(item.instructions,item.context)}],temperature:0.3,max_tokens:4000});
    const raw=call.response.choices?.[0]?.message?.content || '';let answer=null;
    try {const value=JSON.parse(raw.match(/\{[\s\S]*?\}/)?.[0] || raw);if(typeof value.answer==='boolean')answer=value.answer;}catch{}
    report.glm.push({decisionIndex:report.glm.length,answer,parseError:answer===null,...call});save();
    if(report.glm.length%5===0) console.log('GLM judgments: '+report.glm.length+'/'+report.jev.length);
  }
  const sum = xs => xs.reduce((a,b)=>a+b.seconds,0);
  const G=sum(report.generation),J=sum(report.jev),L=sum(report.glm);
  report.summary={messages:report.generation.length,decisions:report.jev.length,generationSeconds:G,jevJudgmentSeconds:J,glmJudgmentSeconds:L,hybridInferenceSeconds:G+J,allGenerativeInferenceSeconds:G+L,speedup:(G+L)/(G+J),decisionSpeedup:L/J,agreement:report.glm.filter((x,i)=>x.answer===report.jev[i].answer).length/report.jev.length,glmParseErrors:report.glm.filter(x=>x.parseError).length};
  report.completed=true;report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify(report.summary,null,2));
})().catch(error=>{report.error=String(error.message).replaceAll(key,'[REDACTED]');save();console.error(report.error);process.exitCode=1;});
