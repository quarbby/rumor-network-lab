// The fully-real version: Experiment 3 (Good Bots), with BOTH tiers real --
// Tier 1 (message text) and Tier 2 (consume/propagate/persuade judgments)
// are both live model calls, not the calibrated mock used everywhere else
// in this project. This is the version of jev/BOTSIM_LLM_PLAN.md's design
// that was never actually built until now: every prior run (including
// "experiment3-llm.cjs") kept Tier 2 as a weighted-random mock and only
// made Tier 1 real.
//
// Small scale on purpose -- real judgment calls multiply the number of live
// calls per run roughly tenfold over generation alone (per the decision
// breakdown reported in the main case: ~89% of all decisions are gates, not
// content). Usage: node experiment3-full-real.cjs

const fs = require('fs');
const path = require('path');
const { PERSONAS } = require('./personas.js');
const { generateMessage, getUsage } = require('./generate.js');
const { judgeReal } = require('./judge-real.js');

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

const N = 10, K = 4, P = 0.15, TICKS = 3, FLIP = 3, CALL_BUDGET = 60;
const ALPHA1 = 0.2;
const ALPHA3_SWEEP = [0.0, 0.4, 0.8, 1.2, 1.6, 2.0];
const REPS = 2; // fully-real judgment multiplies call count ~10x over generation alone; kept small deliberately

async function runOnce(alpha3, seed) {
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
    if (genCalls + judgeCalls >= CALL_BUDGET) return null;
    genCalls++;
    return generateMessage(personaFn());
  }
  async function decide(instructions, context) {
    if (genCalls + judgeCalls >= CALL_BUDGET) return { answer: false, confidence: 0.5, budgetExhausted: true };
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
  }

  const nBad = agents.filter(a => a.belief === 'bad').length;
  return { finalBadFraction: nBad / N, majorityReached: majorityTick !== null, ticksToMajority: majorityTick, genCalls, judgeCalls };
}

const CHECKPOINT_PATH = path.join(__dirname, 'experiment3-full-real-results.json');

function loadCheckpoint() {
  try {
    const prev = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf8'));
    return new Map(prev.results.map(r => [r.alpha3, r]));
  } catch { return new Map(); }
}

async function runOnceWithRetry(alpha3, seed, label) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await runOnce(alpha3, seed);
    } catch (err) {
      console.log(`  [${label} attempt ${attempt} failed: ${String(err.message || err).slice(0, 140)}]`);
      if (attempt === 2) return null;
      await new Promise(r => setTimeout(r, 20000));
    }
  }
}

async function main() {
  const checkpoint = loadCheckpoint();
  const results = [];
  for (const alpha3 of ALPHA3_SWEEP) {
    const already = checkpoint.get(alpha3);
    if (already && already.nRuns >= REPS) {
      console.log(`alpha3=${alpha3} ... already have ${already.nRuns} reps from checkpoint, skipping`);
      results.push(already);
      continue;
    }
    const runs = [];
    for (let r = 0; r < REPS; r++) {
      const seed = Math.round(alpha3 * 1000) * 100 + r + 1;
      const label = `alpha3=${alpha3} rep=${r + 1}/${REPS}`;
      process.stdout.write(`${label} ... `);
      const out = await runOnceWithRetry(alpha3, seed, label);
      if (out) {
        console.log(`finalBad=${out.finalBadFraction.toFixed(3)} majority=${out.majorityReached} genCalls=${out.genCalls} judgeCalls=${out.judgeCalls}`);
        runs.push(out);
      } else {
        console.log('  skipped after retry');
      }
      // checkpoint after every replication, not just every alpha3 point --
      // real-judgment reps take much longer, so losing a whole point's
      // partial progress to a late crash would be expensive.
      const usageSoFar = getUsage();
      const partialPoint = { alpha3, nRuns: runs.length, runs };
      const partialResults = [...results, partialPoint];
      fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify({
        model: usageSoFar.model,
        base: { n: N, k: K, p: P, maxTicks: TICKS, flipThreshold: FLIP, alpha1: ALPHA1, callBudgetPerRun: CALL_BUDGET },
        nReps: REPS,
        usage: { totalCalls: usageSoFar.totalCalls, totalCost: usageSoFar.totalCost, totalTokens: usageSoFar.totalTokens },
        results: partialResults
      }, null, 2));
    }
    const majRate = runs.length ? runs.filter(r => r.majorityReached).length / runs.length : null;
    const meanFinal = runs.length ? runs.reduce((a, r) => a + r.finalBadFraction, 0) / runs.length : null;
    results.push({ alpha3, nRuns: runs.length, majorityReachedRate: majRate, meanFinalBadFraction: meanFinal, runs });
  }

  const usage = getUsage();
  const out = {
    model: usage.model,
    base: { n: N, k: K, p: P, maxTicks: TICKS, flipThreshold: FLIP, alpha1: ALPHA1, callBudgetPerRun: CALL_BUDGET },
    nReps: REPS,
    usage: { totalCalls: usage.totalCalls, totalCost: usage.totalCost, totalTokens: usage.totalTokens },
    results
  };
  fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(__dirname, 'experiment3-full-real-results.md'),
    ['# Experiment 3 (Good Bots), fully real -- real Tier-1 generation + real Tier-2 judgment',
      '',
      `Model: \`${usage.model}\`. Base config: N=${N} humans, k=${K}, p=${P}, max ${TICKS} ticks, flip threshold ${FLIP}, alpha1=${ALPHA1} fixed, ${REPS} replications per alpha3 point.`,
      '',
      `**Usage:** ${usage.totalCalls} live calls (generation + judgment) · ${usage.totalTokens} tokens · $${usage.totalCost.toFixed(5)}`,
      '',
      '| alpha3 | Replications | Mean final Bad fraction |',
      '|---|---|---|',
      ...out.results.map(r => `| ${r.alpha3} | ${r.nRuns} | ${r.meanFinalBadFraction !== null && r.meanFinalBadFraction !== undefined ? r.meanFinalBadFraction.toFixed(3) : '—'} |`)
    ].join('\n') + '\n');
  console.log(`\nDone. ${usage.totalCalls} live calls, $${usage.totalCost.toFixed(5)}, ${usage.totalTokens} tokens.`);
}

main().catch(err => { console.error(err); process.exit(1); });
