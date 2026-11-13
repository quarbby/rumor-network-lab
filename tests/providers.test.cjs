const test=require('node:test'),assert=require('node:assert/strict');
const {createBackend}=require('../src/providers.cjs');
const {defaults}=require('../src/index.cjs');
const env={LLM_PROVIDER:'local',LOCAL_LLM_MODEL:'test-model',OPENROUTER_API_KEY:'test-placeholder'};
const options={env,envPath:'/nonexistent/rumor-test.env'};
test('Jev uses typed probabilities, retains a local generator, and never logs credentials',async()=>{
  const requests=[];
  const b=createBackend({...defaults,mode:'jev',jevThreshold:.6},{...options,fetchImpl:async(url,opts)=>{
    requests.push({url,body:JSON.parse(opts.body)});
    return {ok:true,json:async()=>url.endsWith('/decisions')?{answers:{action:{noul:.55}},usage:{cost:.001,extraSecret:'test-placeholder'}}:
      {choices:[{message:{content:'A simulated message.'}}],usage:{}}};
  }});
  assert.equal(await b.generateMessage('test prompt',{step:1,agentId:0}),'A simulated message.');
  assert.equal((await b.judgeReal('Send?',{baseRate:.5},{step:1,agentId:0})).answer,false);
  assert.equal(requests[0].body.temperature,.9);assert.equal(requests[0].body.model,'test-model');
  assert.equal(requests[1].url,'https://openrouter.ai/api/alpha/decisions');
  assert.equal(b.calls[1].decision.probability,.55);assert.equal(b.calls[1].step,1);
  assert.ok(!JSON.stringify(b.calls).includes('test-placeholder'));
});
test('strict JSON decisions reject malformed answers without silent probability fallback',async()=>{
  for(const content of ['not JSON','{"answer":"yes"}']){
    const b=createBackend({...defaults,mode:'llm'},{...options,fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content}}]})})});
    await assert.rejects(()=>b.judgeReal('Send?',{}),/invalid JSON|Boolean/);assert.equal(b.calls[0].status,'invalid');
  }
});
test('network and provider failures never expose a key or raw response body',async()=>{
  const b=createBackend({...defaults,mode:'llm'},{...options,fetchImpl:async()=>{throw new Error('sensitive test-placeholder');}});
  await assert.rejects(()=>b.generateMessage('test'),e=>!e.message.includes('test-placeholder'));
  assert.ok(!JSON.stringify(b.calls).includes('test-placeholder'));
  const http=createBackend({...defaults,mode:'llm'},{...options,fetchImpl:async()=>({ok:false,status:401,json:async()=>({error:'test-placeholder'})})});
  await assert.rejects(()=>http.generateMessage('test'),/HTTP 401/);
  assert.ok(!JSON.stringify(http.calls).includes('test-placeholder'));
});
test('redacts credential echoes in model text and omits unrelated provider metadata',async()=>{
  const b=createBackend({...defaults,mode:'llm'},{...options,fetchImpl:async()=>({ok:true,json:async()=>({
    choices:[{message:{content:'echo test-placeholder'}}],usage:{cost:.1,private:'test-placeholder'}})})});
  assert.equal(await b.generateMessage('test'),'echo [REDACTED]');
  assert.ok(!JSON.stringify(b.calls).includes('test-placeholder'));
});
