/* Shared simulation rules for Node.js and the browser. No provider code or keys. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RumorModel = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const APPROACHES = Object.freeze([
    { id: 1, mode: 'probability', name: 'Probabilistic actions + message labels' },
    { id: 2, mode: 'probability-llm', name: 'Probabilistic actions + LLM messages' },
    { id: 3, mode: 'llm', name: 'LLM actions + LLM messages' },
    { id: 4, mode: 'jev', name: 'Jev actions + LLM messages' }
  ]);
  const defaults = Object.freeze({ mode: 'probability', n: 30, k: 4, p: 0.15,
    maxTicks: 20, flipThreshold: 3, rumorBots: 6, counterRumorBots: 6, seed: 42, runs: 1,
    callBudget: 2000, jevThreshold: 0.5, jevModel: 'typesafe/jev-1.14',
    generationTemperature: 0.9, judgmentTemperature: 0.3,
    generationTokenLimit: 1800, judgmentTokenLimit: 4000,
    claim: 'The community event result was manipulated.',
    sendingProbabilities: Object.freeze({ rumorBot: 0.70, counterRumorBot: 0.45,
      acceptingHuman: 0.35, rejectingHuman: 0.30 }), outputDir: 'outputs' });
  function validateConfig(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Configuration must be an object');
    const supplied = { ...input };
    // Migrate old bot ratios without retaining the old behavioral rules.
    if (supplied.alpha2 !== undefined && supplied.alpha2 !== 0)
      throw new Error('alpha2 correction roles were removed; use counterRumorBots for fixed counter-rumor bots');
    if (supplied.alpha1 !== undefined || supplied.alpha3 !== undefined) {
      for (const key of ['alpha1', 'alpha3']) if (supplied[key] !== undefined &&
        (!Number.isFinite(supplied[key]) || supplied[key] < 0)) throw new Error(`${key} must be nonnegative`);
      if (supplied.rumorBots !== undefined || supplied.counterRumorBots !== undefined)
        throw new Error('Use bot counts or legacy ratios, not both');
      supplied.rumorBots = Math.round((supplied.alpha1 ?? 0.2) * (supplied.n ?? 30));
      supplied.counterRumorBots = Math.round((supplied.alpha3 ?? 1) * supplied.rumorBots);
    }
    delete supplied.alpha1; delete supplied.alpha2; delete supplied.alpha3;
    for (const key of Object.keys(supplied)) if (!Object.hasOwn(defaults,key)) throw new Error(`Unknown parameter: ${key}`);
    const c = { ...defaults, ...supplied };
    if (!APPROACHES.some(a => a.mode === c.mode))
      throw new Error('mode must be probability, probability-llm, llm, or jev');
    for (const key of ['n', 'k', 'maxTicks', 'flipThreshold', 'runs', 'callBudget', 'generationTokenLimit', 'judgmentTokenLimit'])
      if (!Number.isSafeInteger(c[key]) || c[key] < 1) throw new Error(`${key} must be a positive integer`);
    if (c.n < 3 || c.k % 2 || c.k >= c.n) throw new Error('Use n >= 3 and an even k smaller than n');
    for (const key of ['rumorBots', 'counterRumorBots'])
      if (!Number.isSafeInteger(c[key]) || c[key] < 0) throw new Error(`${key} must be a nonnegative integer`);
    for (const key of ['p', 'jevThreshold'])
      if (!Number.isFinite(c[key]) || c[key] < 0 || c[key] > 1) throw new Error(`${key} must be between 0 and 1`);
    for (const key of ['generationTemperature', 'judgmentTemperature'])
      if (!Number.isFinite(c[key]) || c[key] < 0 || c[key] > 2) throw new Error(`${key} must be between 0 and 2`);
    if (!Number.isInteger(c.seed) || c.seed < 0 || c.seed > 0xffffffff) throw new Error('seed must be a 32-bit unsigned integer');
    for (const key of ['outputDir', 'jevModel', 'claim'])
      if (typeof c[key] !== 'string' || !c[key].trim()) throw new Error(`${key} must be nonempty text`);
    const rates = supplied.sendingProbabilities ?? {};
    if (!rates || typeof rates !== 'object' || Array.isArray(rates)) throw new Error('sendingProbabilities must be an object');
    for (const key of Object.keys(rates)) if (!Object.hasOwn(defaults.sendingProbabilities,key)) throw new Error(`Unknown sending probability: ${key}`);
    c.sendingProbabilities = { ...defaults.sendingProbabilities, ...rates };
    for (const v of Object.values(c.sendingProbabilities)) if (!Number.isFinite(v) || v < 0 || v > 1)
      throw new Error('Sending probabilities must be between 0 and 1');
    return c;
  }
  function random(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function createRun(config, seed = config.seed) {
    const rnd = random(seed), key = (a,b) => a < b ? `${a}-${b}` : `${b}-${a}`;
    const edges = new Set();
    for (let i=0;i<config.n;i++) for (let j=1;j<=config.k/2;j++) edges.add(key(i,(i+j)%config.n));
    for (const edge of [...edges]) {
      if (rnd() >= config.p) continue;
      const [a] = edge.split('-').map(Number);
      const choices = Array.from({length:config.n},(_,i)=>i).filter(i=>i!==a && !edges.has(key(a,i)));
      if (!choices.length) continue;
      edges.delete(edge); edges.add(key(a, choices[Math.floor(rnd()*choices.length)]));
    }
    const adjacency = Array.from({length:config.n},()=>[]);
    for (const edge of edges) {
      const [a,b] = edge.split('-').map(Number);
      adjacency[a].push(b); adjacency[b].push(a);
    }
    const humans = Array.from({length:config.n},(_,id)=>({ id, role:'human', belief:'reject', score:0, previousMessages:[] }));
    const bots = Array.from({length:config.rumorBots+config.counterRumorBots},(_,i)=>({
      id:config.n+i, role:i<config.rumorBots?'rumorBot':'counterRumorBot',
      targets:Array.from({length:3+Math.floor(rnd()*3)},()=>Math.floor(rnd()*config.n))
    }));
    const state = { config, seed, rnd, humans, bots, network:{adjacency,bots},
      messages:[], decisions:[], history:[], completedSteps:0, stoppedByBudget:false,
      generationCalls:0, decisionCalls:0, incompleteStep:null };
    state.history.push(snapshot(state,0,0,0));
    return state;
  }
  function snapshot(state, step, messagesSent, deliveries) {
    const acceptingCount = state.humans.filter(a=>a.belief==='accept').length;
    return {step,acceptingCount,acceptingProportion:acceptingCount/state.config.n,
      beliefs:state.humans.map(a=>a.belief),scores:state.humans.map(a=>a.score),messagesSent,deliveries};
  }
  function sendingProbability(agent, config) {
    const role=agent.role==='human'?(agent.belief==='accept'?'acceptingHuman':'rejectingHuman'):agent.role;
    return config.sendingProbabilities[role];
  }
  function category(agent) { return agent.role==='rumorBot' || agent.belief==='accept' ? 'rumor' : 'counter-rumor'; }
  function message(state,agent,step,text=null) {
    return {id:`${step}-${agent.id}`,step,senderId:agent.id,senderRole:agent.role,
      category:category(agent),text,recipients:[...(agent.role==='human'?state.network.adjacency[agent.id]:agent.targets)]};
  }
  function commitStep(state, step, messages, decisions) {
    const delta=Array(state.config.n).fill(0), inbox=Array.from({length:state.config.n},()=>[]);
    for (const m of messages) for (const target of m.recipients) {
      delta[target]+=m.category==='rumor'?1:-1;
      inbox[target].push({id:m.id,senderId:m.senderId,category:m.category,text:m.text});
    }
    for (const a of state.humans) {
      a.score+=delta[a.id];
      if (a.score>=state.config.flipThreshold) a.belief='accept';
      else if (a.score<=-state.config.flipThreshold) a.belief='reject';
      a.previousMessages=inbox[a.id];
    }
    state.messages.push(...messages); state.decisions.push(...decisions);
    state.completedSteps=step;
    state.history.push(snapshot(state,step,messages.length,messages.reduce((n,m)=>n+m.recipients.length,0)));
  }
  function finishRun(state, calls=[]) {
    const last=state.history.at(-1), complete=state.completedSteps===state.config.maxTicks;
    const at20=state.history.find(h=>h.step===20);
    return {seed:state.seed,network:state.network,history:state.history,
      messages:state.messages,decisions:state.decisions,completedSteps:state.completedSteps,
      complete,stoppedByBudget:state.stoppedByBudget,incompleteStep:state.incompleteStep,
      finalAcceptingCount:last.acceptingCount,finalAcceptingProportion:last.acceptingProportion,
      acceptingCountAtHorizon:complete?last.acceptingCount:null,
      acceptingCountAt20:at20?at20.acceptingCount:null,
      messagesSent:state.messages.length,deliveries:state.messages.reduce((n,m)=>n+m.recipients.length,0),
      generationCalls:state.generationCalls,decisionCalls:state.decisionCalls,
      calls:calls.map(c=>({...c,committed:Number.isInteger(c.step)&&c.step<=state.completedSteps}))};
  }
  function runProbability(input={}, seed) {
    const config=validateConfig(input);
    if (config.mode!=='probability') throw new Error('Browser/local label runs use Approach 1; import real outputs for Approaches 2–4');
    const state=createRun(config,seed??config.seed);
    for (let step=1;step<=config.maxTicks;step++) {
      const messages=[], decisions=[];
      for (const agent of [...state.bots,...state.humans]) {
        const probability=sendingProbability(agent,config), answer=state.rnd()<probability;
        decisions.push({step,agentId:agent.id,method:'probability',probability,answer});
        if (answer) messages.push(message(state,agent,step));
      }
      commitStep(state,step,messages,decisions);
    }
    return finishRun(state);
  }
  return {APPROACHES,defaults,validateConfig,random,createRun,sendingProbability,category,message,commitStep,finishRun,runProbability};
});
