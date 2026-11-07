// Experiment 3 (Good Bots at fixed alpha1), run with REAL Tier-1 (GLM)
// generation instead of the calibrated jev-mock used for ../experiment.cjs's
// Experiment 3. Tier 2 (consume/propagate/persuade gates) is the same
// jev-mock as ../botsim.js / ../experiment.cjs / run-demo.cjs -- only the
// message-authoring step (Tier 1) is now a live model call per
// the two-tier design's two-tier design.
//
// Small-scale, real, API-metered calibration sweep (per the two-tier design
// section 5.1: "Calibration runs (small, full NL): far fewer replications
// (n=3-5)... used to validate that the jev-gated belief-update mechanic
// reproduces BotSim's qualitative findings"). NOT the paper's scale, and not
// the same scale as experiment.cjs's mock Experiment 3 (n=8, 300 humans) --
// see the writeup for the explicit comparison and why absolute numbers don't
// transfer across the two.
//
// Usage: node experiment3-llm.cjs
// Writes experiment3-llm-results.json + experiment3-llm-results.md in this folder.

const fs = require('fs');
const path = require('path');
const { PERSONAS } = require('./personas.js');
const { generateMessage, getUsage } = require('./generate.js');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

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
function judge(rnd, weight) {
  const p = clamp(weight + (rnd() - 0.5) * 0.14, 0.02, 0.98);
  return rnd() < p;
}

const N = 10, K = 4, P = 0.15, TICKS = 4, FLIP = 3, CALL_BUDGET = 14;
const ALPHA1 = 0.2; // fixed, matches ../experiment.cjs Experiment 3
const ALPHA2 = 0;   // no Info-Correction Bots in Experiment 3
const ALPHA3_SWEEP = [0.0, 0.4, 0.8, 1.2, 1.6, 2.0]; // same sweep as ../experiment.cjs Experiment 3
const REPS = 3; // small calibration n, per the two-tier design 5.1 (n=3-5)

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

  let calls = 0;
  async function speak(personaFn) {
    if (calls >= CALL_BUDGET) return null;
    calls++;
    await new Promise(r => setTimeout(r, 2500)); // pace calls to avoid upstream shared-pool 429s
    process.stdout.write(`    [call ${calls}/${CALL_BUDGET}]\n`);
    return generateMessage(personaFn());
  }
  function applyExposure(target, polarity) {
    target.exposureScore += polarity === 'bad' ? 1 : -1;
  }

  let majorityTick = null;
  for (let tick = 1; tick <= TICKS; tick++) {
    for (const bot of bots) {
      const weight = bot.kind === 'badBot' ? 0.8 : 0.6;
      if (!judge(rnd, weight)) continue;
      const text = await speak(bot.kind === 'badBot' ? PERSONAS.badBot : PERSONAS.goodBot);
      if (!text) continue;
      bot.hasInfo = true; bot.infoPolarity = bot.kind === 'badBot' ? 'bad' : 'good';
    }
    for (const a of agents) {
      if (a.hasInfo) continue;
      const weight = a.belief === 'bad' ? 0.3 : 0.15;
      if (!judge(rnd, weight)) continue;
      const text = await speak(a.belief === 'bad' ? PERSONAS.badHuman : PERSONAS.goodHuman);
      if (!text) continue;
      a.hasInfo = true; a.infoPolarity = a.belief;
    }
    for (const bot of bots) {
      if (!bot.hasInfo) continue;
      for (const targetId of bot.targets) {
        if (!judge(rnd, 0.75)) continue;
        applyExposure(agents[targetId], bot.infoPolarity);
      }
    }
    for (const a of agents) {
      if (!a.hasInfo) continue;
      const willingness = a.belief === 'bad' && a.infoPolarity === 'good' ? 0.05
        : a.belief === 'good' && a.infoPolarity === 'bad' ? 0.2 : 0.6;
      if (judge(rnd, willingness)) {
        for (const j of adjacency[a.id]) {
          if (!judge(rnd, 0.65)) continue;
          applyExposure(agents[j], a.infoPolarity);
        }
      }
    }
    for (const a of agents) {
      if (a.exposureScore >= FLIP) a.belief = 'bad';
      else if (a.exposureScore <= -FLIP) a.belief = 'good';
      a.hasInfo = false; a.infoText = null; a.infoPolarity = null;
    }
    for (const bot of bots) { bot.hasInfo = false; }

    const nBad = agents.filter(a => a.belief === 'bad').length;
    if (majorityTick === null && nBad > N / 2) majorityTick = tick;
  }

  const nBad = agents.filter(a => a.belief === 'bad').length;
  return { finalBadFraction: nBad / N, majorityReached: majorityTick !== null, ticksToMajority: majorityTick, callsUsed: calls };
}

const CHECKPOINT_PATH = path.join(__dirname, 'experiment3-llm-results.json');

function loadCheckpoint() {
  try {
    const prev = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf8'));
    const byAlpha3 = new Map(prev.results.map(r => [r.alpha3, r]));
    return byAlpha3;
  } catch {
    return new Map();
  }
}

async function runOnceWithRetry(alpha3, seed, label) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await runOnce(alpha3, seed);
    } catch (err) {
      console.log(`  [${label} attempt ${attempt} failed: ${err.message.slice(0, 120)}]`);
      if (attempt === 2) return null; // give up on this replication, keep the sweep going
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
      const seed = Math.round(alpha3 * 1000) * 100 + r + 1; // deterministic per (alpha3, rep)
      const label = `alpha3=${alpha3} rep=${r + 1}/${REPS}`;
      process.stdout.write(`${label} ... `);
      const out = await runOnceWithRetry(alpha3, seed, label);
      if (out) {
        console.log(`finalBad=${out.finalBadFraction.toFixed(3)} majority=${out.majorityReached} calls=${out.callsUsed}`);
        runs.push(out);
      } else {
        console.log('  skipped after retry');
      }
    }
    const majRate = runs.length ? runs.filter(r => r.majorityReached).length / runs.length : null;
    const majTicks = runs.filter(r => r.majorityReached).map(r => r.ticksToMajority);
    const meanTicks = majTicks.length ? majTicks.reduce((a, b) => a + b, 0) / majTicks.length : null;
    const meanFinal = runs.length ? runs.reduce((a, r) => a + r.finalBadFraction, 0) / runs.length : null;
    const point = { alpha3, nRuns: runs.length, majorityReachedRate: majRate, meanTicksToMajority: meanTicks, meanFinalBadFraction: meanFinal, runs };
    results.push(point);

    // Checkpoint after every alpha3 point so a later failure doesn't lose progress.
    const usageSoFar = getUsage();
    fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify({
      model: usageSoFar.model,
      base: { n: N, k: K, p: P, maxTicks: TICKS, flipThreshold: FLIP, alpha1: ALPHA1, alpha2: ALPHA2, callBudgetPerRun: CALL_BUDGET },
      nReps: REPS,
      usage: { totalCalls: usageSoFar.totalCalls, totalCost: usageSoFar.totalCost, totalTokens: usageSoFar.totalTokens },
      results
    }, null, 2));
  }

  const usage = getUsage();
  const out = {
    model: usage.model,
    base: { n: N, k: K, p: P, maxTicks: TICKS, flipThreshold: FLIP, alpha1: ALPHA1, alpha2: ALPHA2, callBudgetPerRun: CALL_BUDGET },
    nReps: REPS,
    usage: { totalCalls: usage.totalCalls, totalCost: usage.totalCost, totalTokens: usage.totalTokens },
    results
  };
  fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(out, null, 2));
  writeMarkdown(out);
  console.log(`\nDone. ${usage.totalCalls} live calls, $${usage.totalCost.toFixed(5)}, ${usage.totalTokens} tokens.`);
}

function writeMarkdown(out) {
  const lines = [];
  lines.push('# Experiment 3 (Good Bots) — real Tier-1 (GLM) generation, small-scale calibration run');
  lines.push('');
  lines.push(`Model: \`${out.model}\`. Tier 2 (consume/propagate/persuade) is the same calibrated jev-mock as ../experiment.cjs. Base config: N=${out.base.n} humans, k=${out.base.k}, p=${out.base.p}, max ${out.base.maxTicks} ticks, flip threshold ${out.base.flipThreshold}, alpha1=${out.base.alpha1} (fixed), alpha2=${out.base.alpha2} (no Correction Bots), ${out.nReps} replications per alpha3 point, call budget ${out.base.callBudgetPerRun} per run.`);
  lines.push('');
  lines.push(`**Usage:** ${out.usage.totalCalls} live calls · ${out.usage.totalTokens} tokens · $${out.usage.totalCost.toFixed(5)}`);
  lines.push('');
  lines.push('| alpha3 (Good Bots / Bad Bots) | Majority-reached rate | Mean ticks to majority | Mean final Bad fraction |');
  lines.push('|---|---|---|---|');
  for (const r of out.results) {
    lines.push(`| ${r.alpha3.toFixed(1)} | ${Math.round(r.majorityReachedRate * 100)}% | ${r.meanTicksToMajority !== null ? r.meanTicksToMajority.toFixed(1) : '—'} | ${r.meanFinalBadFraction.toFixed(3)} |`);
  }
  fs.writeFileSync(path.join(__dirname, 'experiment3-llm-results.md'), lines.join('\n') + '\n');
}

main().catch(err => { console.error(err); process.exit(1); });
