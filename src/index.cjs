const model = require('./model.js');
const { runOnce } = require('./live.cjs');
const { createBackend } = require('./providers.cjs');
async function simulate(input={}, { backendFactory=createBackend }={}) {
  const config=model.validateConfig(input), runs=[];
  for(let replication=0;replication<config.runs;replication++) {
    const seed=(config.seed+replication)>>>0;
    runs.push(config.mode==='probability' ? model.runProbability(config,seed) :
      await runOnce(config,seed,backendFactory(config)));
  }
  const complete=runs.filter(r=>r.complete);
  const counts=complete.map(r=>r.acceptingCountAtHorizon);
  const mean=counts.length?counts.reduce((a,b)=>a+b,0)/counts.length:null;
  return {schemaVersion:3,specification:'signed-exposure-v1',
    approach:model.APPROACHES.find(a=>a.mode===config.mode),config,runs,
    summary:{completedRuns:complete.length,incompleteRuns:runs.length-complete.length,
      meanAcceptingCount:mean,sampleSD:counts.length>1?Math.sqrt(counts.reduce((sum,v)=>sum+(v-mean)**2,0)/(counts.length-1)):null}};
}
module.exports={simulate,validateConfig:model.validateConfig,defaults:model.defaults,APPROACHES:model.APPROACHES};
