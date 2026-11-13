'use strict';
const model=globalThis.RumorModel;
const $=id=>document.getElementById(id);
let mode='probability',report=null;
const colors={reject:'#176b91',accept:'#b85c23',rumorBot:'#b85c23',counterRumorBot:'#72539a'};
function notice(text,error=false){$('notice').textContent=text;$('notice').className=error?'error':'';}
function getConfig(){
  const input=Object.fromEntries(new FormData($('settings')));
  for(const key of Object.keys(input))if(key!=='claim')input[key]=Number(input[key]);
  return model.validateConfig({...input,mode});
}
function selectMode(next){
  mode=next;
  for(const b of document.querySelectorAll('.approach')){
    const selected=b.dataset.mode===mode;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));
  }
  const a=model.APPROACHES.find(x=>x.mode===mode);
  $('command').textContent=`npm run approach:${a.id}`;
  $('run-button').textContent=mode==='probability'?'Run Approach 1 locally':'Download configuration for Node.js';
  $('mode-note').textContent=mode==='probability'?'Runs in your browser using probability rules. No API key or model requests.':
    `Approach ${a.id} runs through the Node.js package. Download its configuration, run the command below, then load the saved JSON here. Keys remain in your local .env file.`;
}
for(const button of document.querySelectorAll('.approach'))button.addEventListener('click',()=>selectMode(button.dataset.mode));
function download(name,data){
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function downloadConfig(){if(!$('settings').reportValidity())return;try{download('simulation.json',getConfig());notice('Save this file as config/simulation.json in the package, then run the displayed command.');}catch(e){notice(e.message,true);}}
$('download-config').addEventListener('click',downloadConfig);
$('settings').addEventListener('submit',event=>{
  event.preventDefault();if(mode!=='probability'){downloadConfig();return;}
  try{
    const config=getConfig();
    const runs=Array.from({length:config.runs},(_,i)=>model.runProbability(config,(config.seed+i)>>>0));
    report={schemaVersion:3,specification:'signed-exposure-v1',approach:model.APPROACHES[0],config,runs};
    present();notice('Approach 1 completed locally. No model requests were made.');
  }catch(e){notice(e.message,true);}
});
$('export-results').addEventListener('click',()=>{if(report)download('rumor-network-results.json',report);});
function validateReport(data){
  if(data?.schemaVersion!==3||data.specification!=='signed-exposure-v1')
    throw new Error('This viewer accepts version 3 outputs from the four-approach package. Older checkpoints use different rules; keep them separate.');
  const config=model.validateConfig(data.config);
  if(config.n>500||config.maxTicks>500||!Array.isArray(data.runs)||!data.runs.length||data.runs.length>100)
    throw new Error('Viewer limit: 500 humans, 500 steps, and 100 runs.');
  for(const run of data.runs){
    if(!Number.isInteger(run.completedSteps)||run.completedSteps<0||run.completedSteps>config.maxTicks||
       !Array.isArray(run.history)||run.history.length!==run.completedSteps+1||
       !Array.isArray(run.network?.adjacency)||run.network.adjacency.length!==config.n||
       !Array.isArray(run.network.bots)||run.network.bots.length!==config.rumorBots+config.counterRumorBots||
       !Array.isArray(run.messages)||!Array.isArray(run.decisions)||!Array.isArray(run.calls)||
       !Number.isSafeInteger(run.generationCalls)||run.generationCalls<0||!Number.isSafeInteger(run.decisionCalls)||run.decisionCalls<0||
       typeof run.complete!=='boolean'||run.complete!==(run.completedSteps===config.maxTicks))throw new Error('Incomplete or invalid saved-run structure.');
    for(const [i,frame]of run.history.entries()){
      if(frame.step!==i||!Number.isInteger(frame.acceptingCount)||frame.acceptingCount<0||frame.acceptingCount>config.n||
         !Array.isArray(frame.beliefs)||frame.beliefs.length!==config.n||frame.beliefs.some(b=>!['accept','reject'].includes(b))||
         !Array.isArray(frame.scores)||frame.scores.length!==config.n||frame.scores.some(s=>!Number.isSafeInteger(s))||
         frame.beliefs.filter(b=>b==='accept').length!==frame.acceptingCount)throw new Error('Saved beliefs do not match the accepting counts.');
    }
    for(const contacts of run.network.adjacency)if(!Array.isArray(contacts)||contacts.some(i=>!Number.isInteger(i)||i<0||i>=config.n))throw new Error('Invalid human contacts.');
    for(const b of run.network.bots)if(!['rumorBot','counterRumorBot'].includes(b.role)||!Array.isArray(b.targets)||b.targets.some(i=>!Number.isInteger(i)||i<0||i>=config.n))throw new Error('Invalid bot contacts.');
    if(run.messages.some(m=>!Number.isInteger(m.step)||m.step<1||m.step>run.completedSteps||
       !['rumor','counter-rumor'].includes(m.category)||!Array.isArray(m.recipients)||
       m.recipients.some(i=>!Number.isInteger(i)||i<0||i>=config.n)))throw new Error('Invalid saved messages.');
  }
  return {...data,config,approach:model.APPROACHES.find(a=>a.mode===config.mode)};
}
$('import-results').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  try{
    if(file.size>20*1024*1024)throw new Error('Please load an output smaller than 20 MB.');
    const parsed=validateReport(JSON.parse(await file.text()));report=parsed;
    selectMode(parsed.config.mode);
    for(const field of $('settings').elements)if(field.name&&parsed.config[field.name]!==undefined)field.value=parsed.config[field.name];
    present();notice(`Loaded ${parsed.runs.length} saved run(s). These are the saved decisions and messages, not a new model run.`);
  }catch(e){notice(e.message,true);}
});
function present(){
  $('replication').replaceChildren();
  for(const [i,run]of report.runs.entries()){
    const option=document.createElement('option');option.value=i;option.textContent=`Run ${i+1} · seed ${run.seed}`;$('replication').append(option);
  }
  $('replication').disabled=false;$('export-results').disabled=false;
  const complete=report.runs.filter(r=>r.complete).map(r=>r.history.at(-1).acceptingCount);
  $('summary').textContent=complete.length?`${complete.length} completed run(s); mean final count ${(complete.reduce((a,b)=>a+b,0)/complete.length).toFixed(2)}`:'No complete runs; no final-horizon mean';
  showRun();
}
$('replication').addEventListener('change',showRun);
function showRun(){
  if(!report)return;
  const run=report.runs[Number($('replication').value)],config=report.config;
  const last=run.history.at(-1),final=run.history.find(h=>h.step===20);
  $('count-label').textContent='Accepting at step 20';
  $('count').textContent=final?`${final.acceptingCount} / ${config.n}`:'Unobserved';
  $('fraction').textContent=final?`${(100*final.acceptingCount/config.n).toFixed(1)}% of humans`:`Last completed step ${last.step}: ${last.acceptingCount} / ${config.n}`;
  const count=run.messages.length,deliveries=run.messages.reduce((n,m)=>n+m.recipients.length,0);
  $('messages').textContent=count;$('deliveries').textContent=`Deliveries: ${deliveries}`;
  const gen=run.generationCalls,dec=run.decisionCalls;
  $('requests').textContent=gen+dec;$('request-detail').textContent=`${gen} generation · ${dec} action`;
  const time=run.calls.reduce((n,c)=>n+(Number.isFinite(c.seconds)?c.seconds:0),0);
  const billed=run.calls.filter(c=>Number.isFinite(c.usage?.cost));
  const cost=billed.reduce((n,c)=>n+c.usage.cost,0);
  $('time').textContent=gen+dec?`${time.toFixed(2)} s`:'No requests';
  $('cost').textContent=gen+dec?(billed.length===run.calls.length?`API charge: $${cost.toFixed(6)}`:`Reported charges: $${cost.toFixed(6)} (usage incomplete)`):'API charge: $0';
  $('run-badge').textContent=`Approach ${report.approach.id} · ${report.approach.name}`;
  $('completion').textContent=run.complete?`${run.completedSteps}/${config.maxTicks} steps completed`:`Incomplete: ${run.completedSteps}/${config.maxTicks} steps; request allowance reached`;
  $('final-caption').textContent=`${run.complete?'Final':'Last completed'} state · step ${last.step}`;
  $('network-note').textContent=`${config.n} humans · ${config.rumorBots} rumor bots · ${config.counterRumorBots} counter-rumor bots. Identical contacts in both panels. Each repeated bot contact contributes a delivery.`;
  drawNetwork($('initial-network'),run,run.history[0],config);
  drawNetwork($('final-network'),run,last,config);drawHistory(run,config);
  const log=$('message-log');log.replaceChildren();
  for(const m of run.messages.slice(-100)){
    const article=document.createElement('article'),meta=document.createElement('small'),text=document.createElement('div');
    meta.textContent=`Step ${m.step} · agent ${m.senderId} · ${m.category} · ${m.recipients.length} deliveries`;
    text.textContent=m.text||`[${m.category} information label]`;article.append(meta,text);log.append(article);
  }
  if(!run.messages.length)log.textContent='No messages were sent during the completed steps.';
  const decision=document.createElement('p');decision.className='note';decision.textContent=`${run.decisions.length} sending decisions in completed steps; ${run.decisions.filter(d=>d.answer).length} positive. Showing up to the last 100 messages.`;log.prepend(decision);
}
function drawNetwork(canvas,run,frame,config){
  const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);
  const center=[w/2,h/2],radius=Math.min(w,h)*.31;
  const humans=Array.from({length:config.n},(_,i)=>{const a=2*Math.PI*i/config.n-Math.PI/2;return [center[0]+radius*Math.cos(a),center[1]+radius*Math.sin(a)];});
  const bots=run.network.bots.map((b,i)=>{const a=2*Math.PI*i/Math.max(1,run.network.bots.length);return {...b,position:[center[0]+radius*1.43*Math.cos(a),center[1]+radius*1.43*Math.sin(a)]};});
  function line(a,b,color){ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.strokeStyle=color;ctx.lineWidth=.7;ctx.stroke();}
  for(const [i,neighbors]of run.network.adjacency.entries())for(const j of neighbors)if(i<j)line(humans[i],humans[j],'#c9d3d9');
  for(const b of bots)for(const target of new Set(b.targets))line(b.position,humans[target],b.role==='rumorBot'?'#e3bda3':'#d5c9e2');
  const size=config.n>100?3:6;
  for(const [i,point]of humans.entries()){
    ctx.beginPath();ctx.arc(...point,size,0,2*Math.PI);ctx.fillStyle=colors[frame.beliefs[i]];ctx.fill();ctx.strokeStyle='white';ctx.stroke();
    if(config.n<=50){ctx.font='9px sans-serif';ctx.fillStyle='#20343e';ctx.textAlign='center';ctx.fillText(String(i),point[0],point[1]-10);}
  }
  for(const b of bots){const [x,y]=b.position;ctx.fillStyle=colors[b.role];ctx.beginPath();if(b.role==='rumorBot')ctx.rect(x-5,y-5,10,10);else{ctx.moveTo(x,y-7);ctx.lineTo(x+6,y+5);ctx.lineTo(x-6,y+5);ctx.closePath();}ctx.fill();}
  canvas.setAttribute('aria-label',`Step ${frame.step}: ${frame.acceptingCount} of ${config.n} humans accept; ${bots.length} bots.`);
}
function drawHistory(run,config){
  const canvas=$('history');canvas.width=Math.max(300,Math.round(canvas.clientWidth));canvas.height=230;
  const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
  const left=42,right=w-18,top=16,bottom=h-32;
  ctx.clearRect(0,0,w,h);ctx.font='12px sans-serif';ctx.fillStyle='#60727b';
  for(let t=0;t<=4;t++){const count=Math.round(config.n*t/4),y=bottom-(bottom-top)*count/config.n;ctx.strokeStyle='#e5ebe8';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.textAlign='right';ctx.fillText(String(count),left-9,y+4);}
  ctx.beginPath();for(const [i,f]of run.history.entries()){const x=left+(right-left)*f.step/config.maxTicks,y=bottom-(bottom-top)*f.acceptingCount/config.n;i?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.strokeStyle=colors.accept;ctx.lineWidth=2.5;ctx.stroke();
  ctx.textAlign='center';ctx.fillStyle='#60727b';for(let t=0;t<=4;t++){const step=Math.round(config.maxTicks*t/4);ctx.fillText(String(step),left+(right-left)*step/config.maxTicks,bottom+18);}ctx.fillText('Completed step',w/2,h-1);
}
selectMode(mode);

window.addEventListener('resize',()=>{if(report)drawHistory(report.runs[Number($('replication').value)],report.config);});
