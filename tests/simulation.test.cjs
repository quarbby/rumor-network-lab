const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {simulate,validateConfig,APPROACHES}=require('../src/index.cjs');
const model=require('../src/model.js');
function backend(answer=true){
  const calls=[];
  return {calls,generateMessage:async(prompt,meta)=>{calls.push({task:'generation',...meta});return 'A simulated message.';},
    judgeReal:async(instructions,context,meta)=>{calls.push({task:'decision',...meta,context,instructions});return {answer,probability:answer?1:0};}};
}
test('the default N=30 run reproduces the manuscript and every delivery explains its beliefs',async()=>{
  const result=await simulate({}, {backendFactory:()=>{throw new Error('No provider permitted');}}),run=result.runs[0];
  assert.equal(result.schemaVersion,3);assert.equal(run.acceptingCountAt20,7);
  assert.equal(run.messagesSent,301);assert.equal(run.deliveries,1193);
  assert.equal(run.history.length,21);assert.equal(run.completedSteps,20);
  assert.deepEqual(result,await simulate());
  assert.deepEqual(run.history.at(-1).beliefs.flatMap((b,i)=>b==='accept'?[i]:[]),[3,13,16,17,24,27,29]);
  const scores=Array(30).fill(0),beliefs=Array(30).fill('reject');
  for(let step=1;step<=20;step++){
    for(const m of run.messages.filter(m=>m.step===step)){
      if(m.senderRole==='human')assert.equal(m.category,beliefs[m.senderId]==='accept'?'rumor':'counter-rumor');
      for(const id of m.recipients)scores[id]+=m.category==='rumor'?1:-1;
    }
    for(let i=0;i<30;i++){if(scores[i]>=3)beliefs[i]='accept';else if(scores[i]<=-3)beliefs[i]='reject';}
    assert.deepEqual(run.history[step].scores,scores);assert.deepEqual(run.history[step].beliefs,beliefs);
  }
  assert.equal(run.network.adjacency.reduce((n,a)=>n+a.length,0)/2,60);
});
test('Approach 2 adds real generation requests without changing probability draws or belief results',async()=>{
  const first=(await simulate()).runs[0];
  const b=backend();b.judgeReal=async()=>{throw new Error('Approach 2 must not request action decisions');};
  const second=(await simulate({mode:'probability-llm'},{backendFactory:()=>b})).runs[0];
  assert.deepEqual(second.network,first.network);assert.deepEqual(second.history,first.history);
  assert.equal(second.generationCalls,301);assert.equal(second.decisionCalls,0);
  assert.ok(second.messages.every(m=>m.text==='A simulated message.'));
  assert.deepEqual(second.messages.map(({text,...m})=>m),first.messages.map(({text,...m})=>m));
});
test('all four approaches share delivery, network, and threshold rules for identical actions',async()=>{
  const sendingProbabilities={rumorBot:1,counterRumorBot:1,acceptingHuman:1,rejectingHuman:1};
  const runs=[];
  for(const a of APPROACHES)runs.push((await simulate({mode:a.mode,sendingProbabilities},{backendFactory:()=>backend()})).runs[0]);
  for(const r of runs){assert.deepEqual(r.history,runs[0].history);assert.deepEqual(r.network,runs[0].network);assert.equal(r.messagesSent,840);}
  assert.equal(runs[1].decisionCalls,0);assert.equal(runs[2].decisionCalls,840);assert.equal(runs[3].decisionCalls,840);
});
test('model-based actions only ask about sending and receive messages from the previous completed step',async()=>{
  const b=backend();
  const run=(await simulate({mode:'llm',n:3,k:2,rumorBots:1,counterRumorBots:0,maxTicks:2,flipThreshold:1}, {backendFactory:()=>b})).runs[0];
  const decisions=b.calls.filter(c=>c.task==='decision');
  assert.equal(decisions.length,8);
  assert.ok(decisions.every(c=>c.instructions==='Should this agent send a message to its contacts in this step?'));
  for(const c of decisions.filter(c=>c.context.role==='human')){
    const prev=run.history[c.step-1];assert.equal(c.context.belief,prev.beliefs[c.agentId]);
    assert.equal(c.context.exposureScore,prev.scores[c.agentId]);
    assert.ok(c.context.previousMessages.every(m=>Number(m.id.split('-')[0])===c.step-1));
  }
});
test('thresholds retain belief between limits and repeated contacts count as repeated exposures',()=>{
  const c=validateConfig(),s=model.createRun(c);
  const event=(category,n)=>[{step:1,id:'example',senderId:30,senderRole:'rumorBot',category,text:null,recipients:Array(n).fill(0)}];
  model.commitStep(s,1,event('rumor',3),[]);assert.equal(s.humans[0].belief,'accept');assert.equal(s.humans[0].score,3);
  model.commitStep(s,2,event('counter-rumor',1),[]);assert.equal(s.humans[0].belief,'accept');assert.equal(s.humans[0].score,2);
  model.commitStep(s,3,event('counter-rumor',5),[]);assert.equal(s.humans[0].belief,'reject');assert.equal(s.humans[0].score,-3);
});
test('early unanimous acceptance does not stop observation; no rumor bots leaves all rejecting',async()=>{
  const q={rumorBot:1,counterRumorBot:0,acceptingHuman:1,rejectingHuman:0};
  const r=(await simulate({n:3,k:2,rumorBots:12,counterRumorBots:0,flipThreshold:1,sendingProbabilities:q})).runs[0];
  assert.equal(r.history[1].acceptingCount,3);assert.equal(r.completedSteps,20);
  assert.equal((await simulate({rumorBots:0})).runs[0].acceptingCountAt20,0);
});
test('budget stops an incomplete step without changing completed states or forcing later answers false',async()=>{
  const b=backend();
  const r=(await simulate({mode:'llm',n:3,k:2,rumorBots:1,counterRumorBots:0,callBudget:3},{backendFactory:()=>b})).runs[0];
  assert.equal(r.stoppedByBudget,true);assert.equal(r.completedSteps,0);assert.equal(r.acceptingCountAt20,null);
  assert.equal(r.acceptingCountAtHorizon,null);assert.equal(r.messagesSent,0);assert.equal(r.incompleteStep.messages.length,1);
  assert.ok(r.calls.every(c=>c.committed===false));assert.equal(r.generationCalls+r.decisionCalls,3);
});
test('exact call allowance retains a completed step; a short horizon never claims A20',async()=>{
  const r=(await simulate({mode:'llm',n:3,k:2,rumorBots:1,counterRumorBots:0,maxTicks:1,callBudget:4},{backendFactory:()=>backend(false)})).runs[0];
  assert.equal(r.complete,true);assert.equal(r.completedSteps,1);assert.equal(r.stoppedByBudget,false);assert.equal(r.acceptingCountAt20,null);
});
test('invalid settings fail before inference and legacy counts migrate without the older rules',()=>{
  assert.throws(()=>validateConfig({k:3}),/even k/);assert.throws(()=>validateConfig({p:2}),/between 0 and 1/);
  assert.throws(()=>validateConfig({alpha2:1}),/removed/);assert.throws(()=>validateConfig({typo:1}),/Unknown parameter/);
  assert.throws(()=>validateConfig({sendingProbabilities:{rumorBot:2}}),/between 0 and 1/);
  assert.throws(()=>validateConfig({alpha1:.2,rumorBots:6}),/not both/);
  const c=validateConfig({alpha1:.2,alpha3:1,alpha2:0});assert.equal(c.rumorBots,6);assert.equal(c.counterRumorBots,6);
});
test('CLI writes a versioned output and accepts numbered approach selection',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rumor-cli-'));
  try{
    const config=path.join(dir,'config.json');fs.writeFileSync(config,JSON.stringify({outputDir:dir}));
    const r=spawnSync(process.execPath,['bin/simulate.cjs',config,'--approach','1'],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
    assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/A20=7/);
    const file=fs.readdirSync(dir).find(n=>n.startsWith('simulation-'));
    const data=JSON.parse(fs.readFileSync(path.join(dir,file)));assert.equal(data.schemaVersion,3);assert.equal(data.approach.id,1);
    assert.equal(data.config.n,30);assert.equal(data.runs[0].network.adjacency.length,30);
  }finally{fs.rmSync(dir,{recursive:true});}
});
