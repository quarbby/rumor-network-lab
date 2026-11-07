const { PERSONAS } = require('./personas.cjs');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildNetwork(n, k, p, rnd) {
  const edges = new Set();
  const key = (a, b) => a < b ? `${a}-${b}` : `${b}-${a}`;
  for (let i = 0; i < n; i++) for (let j = 1; j <= k / 2; j++) edges.add(key(i, (i + j) % n));
  const list = Array.from(edges).map(e => e.split('-').map(Number));
  edges.clear();
  for (const [a, b] of list) {
    if (rnd() < p) {
      let newB = Math.floor(rnd() * n), tries = 0;
      while ((newB === a || edges.has(key(a, newB))) && tries < 10) { newB = Math.floor(rnd() * n); tries++; }
      edges.add(key(a, newB));
    } else edges.add(key(a, b));
  }
  const adjacency = Array.from({ length: n }, () => []);
  for (const e of edges) { const [a, b] = e.split('-').map(Number); adjacency[a].push(b); adjacency[b].push(a); }
  return adjacency;
}

async function runOnce(alpha3, seed, config, backend) {
  const { n: N, k: K, p: P, maxTicks: TICKS, flipThreshold: FLIP, callBudget: CALL_BUDGET } = config;
  const ALPHA1 = config.alpha1;
  const { generateMessage, judgeReal } = backend;
  const history = [];
  let completedSteps = 0;
  let stoppedByBudget = false;
  const rnd = mulberry32(seed);
  const agents = Array.from({ length: N }, (_, i) => ({
    id: i, belief: 'good', exposureScore: 0, hasInfo: false, infoText: null, infoPolarity: null
  }));
  const adjacency = buildNetwork(N, K, P, rnd);

  const nBadBots = Math.round(ALPHA1 * N);
  const nGoodBots = Math.round(alpha3 * nBadBots);
  const bots = [];
  for (let i = 0; i < nBadBots; i++) bots.push({ id: 'B' + i, kind: 'badBot', targets: [] });
  for (let i = 0; i < nGoodBots; i++) bots.push({ id: 'G' + i, kind: 'goodBot', targets: [] });
  bots.forEach(bot => {
    const nLinks = 3 + Math.floor(rnd() * 3);
    bot.targets = Array.from({ length: nLinks }, () => Math.floor(rnd() * N));
  });

  let genCalls = 0, judgeCalls = 0;

  async function speak(personaFn) {
    if (genCalls + judgeCalls >= CALL_BUDGET) throw Object.assign(new Error('Call budget reached'), { code: 'CALL_BUDGET' });
    genCalls++;
    return generateMessage(personaFn());
  }
  async function decide(instructions, context) {
    if (genCalls + judgeCalls >= CALL_BUDGET) throw Object.assign(new Error('Call budget reached'), { code: 'CALL_BUDGET' });
    judgeCalls++;
    return judgeReal(instructions, context);
  }

  function applyExposure(target, polarity, messageText, senderKind) {
    return decide(
      "Is this exposure persuasive enough to move the receiving agent's belief?",
      { baseRate: polarity === 'bad' ? (senderKind === 'badBot' ? 0.55 : 0.4) : 0.35, messageText, polarity, senderKind, receiverBelief: target.belief }
    ).then(r => {
      if (r.answer) { target.exposureScore += polarity === 'bad' ? 1 : -1; }
      return r;
    });
  }

  let majorityTick = null;
  for (let tick = 1; tick <= TICKS; tick++) {
    const previousState = agents.map(a => ({ ...a }));
    try {
    // Generate: bots
    for (const bot of bots) {
      const baseRate = bot.kind === 'badBot' ? 0.7 : 0.45;
      const { answer } = await decide('Does this bot generate a new piece of information this tick, given its role?', { baseRate, botKind: bot.kind });
      if (!answer) continue;
      const text = await speak(bot.kind === 'badBot' ? PERSONAS.badBot : PERSONAS.goodBot);
      if (!text) continue;
      bot.hasInfo = true; bot.infoText = text; bot.infoPolarity = bot.kind === 'badBot' ? 'bad' : 'good';
    }
    // Generate: humans
    for (const a of agents) {
      if (a.hasInfo) continue;
      const baseRate = a.belief === 'bad' ? 0.35 : 0.3;
      const { answer } = await decide('Does this human agent generate a new piece of information this tick?', { baseRate, belief: a.belief });
      if (!answer) continue;
      const text = await speak(a.belief === 'bad' ? PERSONAS.badHuman : PERSONAS.goodHuman);
      if (!text) continue;
      a.hasInfo = true; a.infoText = text; a.infoPolarity = a.belief;
    }
    // Consume + propagate: bots -> targeted humans
    for (const bot of bots) {
      if (!bot.hasInfo) continue;
      for (const targetId of bot.targets) {
        const target = agents[targetId];
        const consume = await decide('Does the receiving agent consume (attend to) this incoming message?', { baseRate: 0.75, messageText: bot.infoText, senderKind: bot.kind, receiverBelief: target.belief });
        if (!consume.answer) continue;
        await applyExposure(target, bot.infoPolarity, bot.infoText, bot.kind);
      }
    }
    // Propagate: humans -> network neighbors
    for (const a of agents) {
      if (!a.hasInfo) continue;
      const willingness = a.belief === 'bad' && a.infoPolarity === 'good' ? 0.05
        : a.belief === 'good' && a.infoPolarity === 'bad' ? 0.2 : 0.6;
      const propagate = await decide('Does this agent propagate its held information to its network neighbors?', { baseRate: willingness, messageText: a.infoText, holderBelief: a.belief, infoPolarity: a.infoPolarity });
      if (!propagate.answer) continue;
      for (const j of adjacency[a.id]) {
        const neighbor = agents[j];
        const consume = await decide('Does the neighboring agent consume this incoming message?', { baseRate: 0.65, messageText: a.infoText, senderBelief: a.belief, receiverBelief: neighbor.belief });
        if (!consume.answer) continue;
        await applyExposure(neighbor, a.infoPolarity, a.infoText, 'human');
      }
    }
    // Update
    for (const a of agents) {
      if (a.exposureScore >= FLIP) a.belief = 'bad';
      else if (a.exposureScore <= -FLIP) a.belief = 'good';
      a.hasInfo = false; a.infoText = null; a.infoPolarity = null;
    }
    for (const bot of bots) { bot.hasInfo = false; bot.infoText = null; }

    const nBad = agents.filter(a => a.belief === 'bad').length;
    if (majorityTick === null && nBad > N / 2) majorityTick = tick;
    completedSteps = tick;
    history.push({ step: tick, rumorAcceptingFraction: nBad / N });
    } catch (error) {
      if (error.code !== 'CALL_BUDGET') throw error;
      agents.splice(0, agents.length, ...previousState);
      stoppedByBudget = true;
      break;
    }
  }

  const nBad = agents.filter(a => a.belief === 'bad').length;
  return { history, completedSteps, stoppedByBudget, finalBadFraction: nBad / N, majorityReached: majorityTick !== null, ticksToMajority: majorityTick, genCalls, judgeCalls };
}


module.exports = { runOnce };
