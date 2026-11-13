const { performance } = require('node:perf_hooks');
const { loadConfig } = require('./config.cjs');
function createBackend(config, { fetchImpl=global.fetch, env=process.env, envPath }={}) {
  const settings=loadConfig({env,...(envPath?{envPath}:{})});
  if(config.mode==='jev'&&!settings.decisionApiKey) throw new Error('Jev requires OPENROUTER_API_KEY');
  const calls=[];
  const redact=text=>[settings.apiKey,settings.decisionApiKey].filter(Boolean)
    .reduce((result,key)=>result.split(key).join('[REDACTED]'),String(text));
  function safeUsage(usage={}) {
    const allowed=['prompt_tokens','completion_tokens','total_tokens','input_tokens','output_tokens','cost'];
    return Object.fromEntries(allowed.filter(k=>Number.isFinite(usage[k])).map(k=>[k,usage[k]]));
  }
  async function request(task,url,body,apiKey,meta) {
    const start=performance.now();
    const call={task,...meta,model:body.model,status:'pending'};
    calls.push(call);
    let response,data;
    try {
      response=await fetchImpl(url,{method:'POST',headers:{'Content-Type':'application/json',
        ...(apiKey?{Authorization:`Bearer ${apiKey}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
      if(!response.ok) throw new Error('HTTP error');
      data=await response.json();
    } catch {
      call.status='error'; call.seconds=(performance.now()-start)/1000;
      if(response) call.httpStatus=response.status;
      // Provider errors and network messages can contain credentials or bodies.
      throw new Error(`${task} request failed${response?` (HTTP ${response.status})`:''}; check provider configuration`);
    }
    call.seconds=(performance.now()-start)/1000;
    call.model=redact(data.model||body.model); call.usage=safeUsage(data.usage); call.status='ok';
    return {data,call};
  }
  async function generateMessage(prompt,meta={}) {
    const {data,call}=await request('generation',settings.baseUrl,{model:settings.model,
      messages:[{role:'user',content:prompt}],temperature:config.generationTemperature,
      max_tokens:config.generationTokenLimit},settings.apiKey,meta);
    const text=data.choices?.[0]?.message?.content?.trim();
    if(!text) {call.status='invalid';throw new Error('Generation model returned no message');}
    call.prompt=redact(prompt);call.message=redact(text);
    return call.message;
  }
  async function judgeReal(instructions,context,meta={}) {
    if(config.mode==='jev') {
      const {data,call}=await request('decision','https://openrouter.ai/api/alpha/decisions',{
        model:config.jevModel,state:{instructions,context},
        questions:{action:{type:'noul',instructions:'The agent sends a message to its contacts in this step, given the supplied context.'}}
      },settings.decisionApiKey,meta);
      const probability=data.answers?.action?.noul;
      if(!Number.isFinite(probability)||probability<0||probability>1) {
        call.status='invalid';throw new Error('Invalid Jev probability');
      }
      const answer=probability>=config.jevThreshold;
      call.decision={instructions,context,probability,answer};
      return {answer,probability};
    }
    const prompt=`Decide whether a simulated agent sends a message.\nQuestion: ${instructions}\nContext: ${JSON.stringify(context)}\nThe baseRate is a weak prior, not a required frequency. Return strict JSON only: {"answer": true or false}`;
    const {data,call}=await request('decision',settings.baseUrl,{model:settings.model,
      messages:[{role:'user',content:prompt}],temperature:config.judgmentTemperature,
      max_tokens:config.judgmentTokenLimit},settings.apiKey,meta);
    const raw=data.choices?.[0]?.message?.content||'';
    let parsed;
    try {parsed=JSON.parse(raw);} catch {call.status='invalid';throw new Error('Action model returned invalid JSON');}
    if(typeof parsed.answer!=='boolean') {call.status='invalid';throw new Error('Action model did not return a Boolean answer');}
    call.decision={instructions,context,answer:parsed.answer};
    return {answer:parsed.answer};
  }
  return {generateMessage,judgeReal,calls};
}
module.exports={createBackend};
