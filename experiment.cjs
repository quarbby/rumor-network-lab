// Headless batch-experiment runner for jev_botsim.
//
// Reimplements the same mechanics as botsim.js (network, four-stage tick loop,
// jev-mock Noul gates) without any DOM, so it can run many replications fast
// and be scripted like a research experiment instead of watched in a browser.
//
// This is a SCOPED-DOWN reproduction of BotSim's experimental design (Ng &
// Carley, JASSS 2025) -- not the full 3,675-run / n=15 / 1,000-agent sweep
// from the paper. See results.md for exactly what was run and why, and for
// the deviations from the paper's scale.

const fs = require('fs');
const path = require('path');

// --- seeded RNG so every run is reproducible from its seed ---
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
  for (let i = 0; i < n; i++) {
    for (let j = 1; j <= k / 2; j++) edges.add(key(i, (i + j) % n));
  }
  const list = Array.from(edges).map(e => e.split('-').map(Number));
  edges.clear();
  for (const [a, b] of list) {
    if (rnd() < p) {
      let newB = Math.floor(rnd() * n), tries = 0;
      while ((newB === a || edges.has(key(a, newB))) && tries < 10) { newB = Math.floor(rnd() * n); tries++; }
      edges.add(key(a, newB));
    } else {
      edges.add(key(a, b));
    }
  }
  const adjacency = Array.from({ length: n }, () => []);
  for (const e of edges) {
    const [a, b] = e.split('-').map(Number);
    adjacency[a].push(b); adjacency[b].push(a);
  }
  return adjacency;
}

function judge(rnd, weight) {
  const p = clamp(weight + (rnd() - 0.5) * 0.14, 0.02, 0.98);
  return rnd() < p;
}

// One full simulation run. Returns tick-to-majority / tick-to-all-bad plus
// final composition, mirroring BotSim's two primary outcome measures.
function runOnce({ n, k, p, alpha1, alpha2, alpha3, maxTicks, flipThreshold, seed }) {
  const rnd = mulberry32(seed);
  const agents = Array.from({ length: n }, (_, i) => ({
    id: i, belief: 'good', exposureScore: 0, hasInfo: false, infoPolarity: null
  }));
  const adjacency = buildNetwork(n, k, p, rnd);

  const nBadBots = Math.round(alpha1 * n);
  const nCorrectionBots = Math.round(alpha2 * nBadBots);
  const nGoodBots = Math.round(alpha3 * nBadBots);
  const bots = [];
  for (let i = 0; i < nBadBots; i++) bots.push({ kind: 'badBot', hasInfo: false, infoPolarity: null });
  for (let i = 0; i < nCorrectionBots; i++) bots.push({ kind: 'correctionBot', hasInfo: false, infoPolarity: null });
  for (let i = 0; i < nGoodBots; i++) bots.push({ kind: 'goodBot', hasInfo: false, infoPolarity: null });
  for (const bot of bots) {
    const nLinks = 3 + Math.floor(rnd() * 3);
    bot.targets = Array.from({ length: nLinks }, () => Math.floor(rnd() * n));
  }

  let tickOfMajority = null;   // first tick Bad Humans > Good Humans
  let tickOfAllBad = null;     // first tick 100% Bad
  let decisions = 0;

  function applyExposure(target, polarity, sourceKind) {
    const weight = polarity === 'bad' ? (sourceKind === 'badBot' ? 0.55 : 0.4) : 0.35;
    decisions++;
    if (!judge(rnd, weight)) return;
    target.exposureScore += polarity === 'bad' ? 1 : -1;
  }

  for (let tick = 1; tick <= maxTicks; tick++) {
    // Generate
    for (const bot of bots) {
      const weight = bot.kind === 'badBot' ? 0.7 : 0.45;
      decisions++;
      if (judge(rnd, weight)) { bot.hasInfo = true; bot.infoPolarity = bot.kind === 'badBot' ? 'bad' : 'good'; }
    }
    for (const a of agents) {
      const weight = a.belief === 'bad' ? 0.35 : 0.3;
      decisions++;
      if (judge(rnd, weight)) { a.hasInfo = true; a.infoPolarity = a.belief; }
    }

    // Consume + propagate
    for (const bot of bots) {
      if (!bot.hasInfo) continue;
      for (const targetId of bot.targets) {
        decisions++;
        if (!judge(rnd, 0.75)) continue;
        applyExposure(agents[targetId], bot.infoPolarity, bot.kind);
      }
    }
    for (const a of agents) {
      if (!a.hasInfo) continue;
      const willingness = a.belief === 'bad' && a.infoPolarity === 'good' ? 0.05
        : a.belief === 'good' && a.infoPolarity === 'bad' ? 0.2 : 0.6;
      decisions++;
      if (!judge(rnd, willingness)) continue;
      for (const j of adjacency[a.id]) {
        decisions++;
        if (!judge(rnd, 0.65)) continue;
        applyExposure(agents[j], a.infoPolarity, 'human');
      }
    }

    // Update
    for (const a of agents) {
      if (a.exposureScore >= flipThreshold) a.belief = 'bad';
      else if (a.exposureScore <= -flipThreshold) a.belief = 'good';
      a.hasInfo = false; a.infoPolarity = null;
    }
    for (const bot of bots) { bot.hasInfo = false; bot.infoPolarity = null; }

    const nBad = agents.reduce((s, a) => s + (a.belief === 'bad' ? 1 : 0), 0);
    if (tickOfMajority === null && nBad > n / 2) tickOfMajority = tick;
    if (tickOfAllBad === null && nBad === n) { tickOfAllBad = tick; break; }
  }

  const finalBad = agents.reduce((s, a) => s + (a.belief === 'bad' ? 1 : 0), 0);
  return {
    tickOfMajority, tickOfAllBad,
    finalBadFraction: finalBad / n,
    decisions
  };
}

function mean(xs) { return xs.reduce((a, b) => a + b, 0) / xs.length; }
function stdev(xs) {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map(x => (x - m) ** 2)));
}

function summarize(runs) {
  const majorities = runs.map(r => r.tickOfMajority).filter(v => v !== null);
  const allBads = runs.map(r => r.tickOfAllBad).filter(v => v !== null);
  return {
    nRuns: runs.length,
    majorityReachedRate: majorities.length / runs.length,
    meanTicksToMajority: majorities.length ? mean(majorities) : null,
    sdTicksToMajority: majorities.length ? stdev(majorities) : null,
    allBadReachedRate: allBads.length / runs.length,
    meanTicksToAllBad: allBads.length ? mean(allBads) : null,
    sdTicksToAllBad: allBads.length ? stdev(allBads) : null,
    meanFinalBadFraction: mean(runs.map(r => r.finalBadFraction))
  };
}

// --- fixed simulation parameters for every experiment below ---
const BASE = { n: 300, k: 6, p: 0.05, maxTicks: 100, flipThreshold: 6 };
const N_REPS = 8; // scaled down from the paper's n=15 -- see results.md

function sweep(paramName, values, fixed) {
  return values.map(v => {
    const runs = [];
    for (let rep = 0; rep < N_REPS; rep++) {
      const params = { ...BASE, ...fixed, [paramName]: v, seed: hashSeed(paramName, v, rep) };
      runs.push(runOnce(params));
    }
    return { [paramName]: v, ...summarize(runs) };
  });
}

function hashSeed(name, v, rep) {
  const s = `${name}:${v}:${rep}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function linspace(lo, hi, steps) {
  return Array.from({ length: steps }, (_, i) => +(lo + (hi - lo) * (i / (steps - 1))).toFixed(3));
}

console.log('Running jev_botsim experiments (scoped-down reproduction of BotSim Experiments 1-3)...');

const experiments = {};

console.log('  Experiment 1: Bad Bot ratio (alpha1), no useful bots');
experiments.exp1_badBotOnly = sweep('alpha1', linspace(0.1, 1.0, 6), { alpha2: 0, alpha3: 0 });

console.log('  Experiment 2: Info-Correction Bot ratio (alpha2) at fixed alpha1=0.2');
experiments.exp2_correctionBots = sweep('alpha2', linspace(0, 1.5, 6), { alpha1: 0.2, alpha3: 0 });

console.log('  Experiment 3: Good Bot ratio (alpha3) at fixed alpha1=0.2');
experiments.exp3_goodBots = sweep('alpha3', linspace(0, 2.0, 6), { alpha1: 0.2, alpha2: 0 });

const outDir = __dirname;
fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ base: BASE, nReps: N_REPS, experiments }, null, 2));

// flat CSV across all three experiments
const rows = [['experiment', 'alpha1', 'alpha2', 'alpha3', 'nRuns', 'majorityReachedRate', 'meanTicksToMajority', 'sdTicksToMajority', 'allBadReachedRate', 'meanTicksToAllBad', 'sdTicksToAllBad', 'meanFinalBadFraction']];
for (const [expName, points] of Object.entries(experiments)) {
  for (const pt of points) {
    const a1 = expName === 'exp1_badBotOnly' ? pt.alpha1 : 0.2;
    const a2 = expName === 'exp2_correctionBots' ? pt.alpha2 : 0;
    const a3 = expName === 'exp3_goodBots' ? pt.alpha3 : 0;
    rows.push([expName, a1, a2, a3, pt.nRuns, pt.majorityReachedRate, pt.meanTicksToMajority, pt.sdTicksToMajority, pt.allBadReachedRate, pt.meanTicksToAllBad, pt.sdTicksToAllBad, pt.meanFinalBadFraction]);
  }
}
fs.writeFileSync(path.join(outDir, 'results.csv'), rows.map(r => r.join(',')).join('\n'));

console.log('Wrote results.json and results.csv');
console.log(JSON.stringify(experiments, null, 2));
