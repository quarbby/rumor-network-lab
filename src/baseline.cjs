// Seeded probability model. Historical action and update rules are preserved.
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

  const history = [];
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
    history.push({ step: tick, rumorAcceptingFraction: nBad / n });
    if (tickOfMajority === null && nBad > n / 2) tickOfMajority = tick;
    if (tickOfAllBad === null && nBad === n) { tickOfAllBad = tick; break; }
  }

  const finalBad = agents.reduce((s, a) => s + (a.belief === 'bad' ? 1 : 0), 0);
  return {
    tickOfMajority, tickOfAllBad,
    history,
    finalBadFraction: finalBad / n,
    decisions
  };
}

module.exports = { runOnce };
