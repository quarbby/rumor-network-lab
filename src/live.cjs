const model = require('./model.js');
const { messagePrompt } = require('./personas.cjs');
const SEND_QUESTION = 'Should this agent send a message to its contacts in this step?';
async function runOnce(config, seed, backend) {
  const state=model.createRun(config,seed);
  function reserve(task) {
    if (state.generationCalls+state.decisionCalls>=config.callBudget)
      throw Object.assign(new Error('Call budget reached'),{code:'CALL_BUDGET'});
    state[task==='generation'?'generationCalls':'decisionCalls']++;
  }
  for (let step=1;step<=config.maxTicks;step++) {
    const messages=[],decisions=[];
    try {
      for (const agent of [...state.bots,...state.humans]) {
        const baseRate=model.sendingProbability(agent,config);
        const meta={step,agentId:agent.id};
        let answer, probability;
        if (config.mode==='probability-llm') {
          probability=baseRate; answer=state.rnd()<baseRate;
        } else {
          reserve('decision');
          const context={...meta,role:agent.role,belief:agent.belief??(agent.role==='rumorBot'?'accept':'reject'),
            exposureScore:agent.score??null,previousMessages:agent.previousMessages??[],baseRate,claim:config.claim};
          const result=await backend.judgeReal(SEND_QUESTION,context,meta);
          if (typeof result.answer!=='boolean') throw new Error('Action model must return a Boolean answer');
          answer=result.answer; probability=result.probability;
        }
        decisions.push({...meta,method:config.mode==='probability-llm'?'probability':config.mode,
          ...(probability===undefined?{}:{probability}),answer});
        if (!answer) continue;
        reserve('generation');
        const text=await backend.generateMessage(messagePrompt(agent,model.category(agent),config.claim),meta);
        if (typeof text!=='string'||!text.trim()) throw new Error('Generation model returned no message');
        messages.push(model.message(state,agent,step,text.trim()));
      }
      model.commitStep(state,step,messages,decisions);
    } catch(error) {
      if (error.code!=='CALL_BUDGET') throw error;
      state.stoppedByBudget=true;
      state.incompleteStep={step,messages,decisions};
      break;
    }
  }
  return model.finishRun(state,backend.calls??[]);
}
module.exports={runOnce,SEND_QUESTION};
