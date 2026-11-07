// BotSim, rebuilt with Jev
//
// Reproduces the four-stage tick loop from Ng & Carley, "BotSim: Mitigating the
// Formation of Conspiratorial Societies with Useful Bots" (JASSS 2025):
//   generate -> consume -> propagate -> update
// The paper drives each stage with a fixed probability (Pg=0.4, Pc=0.8, Pp=0.8)
// plus a raw exposure counter (flip after t=72 cumulative Bad exposures). Here
// every one of those points is replaced with a Jev `Noul` (yes/no) judgment,
// conditioned on the deciding agent's role and current belief state instead of
// a single global constant.
//
// judge() below is a calibrated mock standing in for a real call to
// `@typesafe-ai/sdk`'s `systemOne({ state, questions: { decision: Noul(instructions) } })`.
// Swap it for a real client and this file needs no other changes: every call
// site already passes (instructions, weight) and reads back {answer, confidence}.

(function () {
  const N_HUMANS = 70;          // scaled down from BotSim's 1,000 for legible rendering
  const K_NEIGHBORS = 4;        // Watts-Strogatz initial ring degree
  const REWIRE_P = 0.05;        // matches paper's small-world rewiring probability
  const MAX_TICKS = 100;
  const FLIP_THRESHOLD = 6;     // scaled down from paper's t=72 to match smaller population

  const canvas = document.getElementById('net');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const CX = W / 2, CY = H / 2, R = Math.min(W, H) * 0.38;

  const COLORS = {
    goodHuman: '#4caf6a',
    badHuman: '#5b5f73',
    badBot: '#ef5e52',
    correctionBot: '#5b9bf0',
    goodBot: '#f0c33f'
  };

  const bgGradient = (() => {
    // built lazily once ctx exists, cached per canvas size
    let cached = null;
    return () => {
      if (cached) return cached;
      const g = ctx.createRadialGradient(CX, CY, 40, CX, CY, Math.max(W, H) * 0.75);
      g.addColorStop(0, '#20243a');
      g.addColorStop(0.55, '#181a29');
      g.addColorStop(1, '#0d0e16');
      cached = g;
      return g;
    };
  })();

  function rnd() { return Math.random(); }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  // --- Watts-Strogatz small-world network over the human population ---
  function buildNetwork(n, k, p) {
    const edges = new Set();
    const key = (a, b) => a < b ? `${a}-${b}` : `${b}-${a}`;
    for (let i = 0; i < n; i++) {
      for (let j = 1; j <= k / 2; j++) {
        edges.add(key(i, (i + j) % n));
      }
    }
    // rewire
    const list = Array.from(edges).map(e => e.split('-').map(Number));
    edges.clear();
    for (const [a, b] of list) {
      if (rnd() < p) {
        let newB = Math.floor(rnd() * n);
        let tries = 0;
        while ((newB === a || edges.has(key(a, newB))) && tries < 10) {
          newB = Math.floor(rnd() * n);
          tries++;
        }
        edges.add(key(a, newB));
      } else {
        edges.add(key(a, b));
      }
    }
    const adjacency = Array.from({ length: n }, () => []);
    for (const e of edges) {
      const [a, b] = e.split('-').map(Number);
      adjacency[a].push(b);
      adjacency[b].push(a);
    }
    return adjacency;
  }

  // --- Mock stand-in for Jev's Noul (yes/no) primitive ---
  // instructions: what's being judged; weight: base probability of "yes" given the persona/context.
  function judge(instructions, weight) {
    const p = clamp(weight + (rnd() - 0.5) * 0.14, 0.02, 0.98);
    return { answer: rnd() < p, confidence: p };
  }

  let agents = [];       // human agents, indexed 0..N_HUMANS-1
  let bots = [];         // bad/correction/good bots, appended after humans
  let adjacency = [];
  let tick = 0;
  let running = false;
  let rafId = null;
  let lastStepAt = 0;
  let decisions = 0, spend = 0;
  let consumeYes = 0, consumeTotal = 0;
  let propagateYes = 0, propagateTotal = 0;
  let persuadeYes = 0, persuadeTotal = 0;
  const COST_PER_DECISION = 0.0000006;
  const STEP_INTERVAL_MS = 260;

  const els = {
    tick: document.getElementById('stat-tick'),
    good: document.getElementById('stat-good'),
    bad: document.getElementById('stat-bad'),
    consume: document.getElementById('stat-consume'),
    propagate: document.getElementById('stat-propagate'),
    persuade: document.getElementById('stat-persuade'),
    decisions: document.getElementById('stat-decisions'),
    flagged: document.getElementById('stat-flagged'),
    flagLabel: document.getElementById('flag-label'),
    timer: document.getElementById('timer'),
    runBtn: document.getElementById('run-btn'),
    resetBtn: document.getElementById('reset-btn'),
    alpha1: document.getElementById('alpha1'),
    alpha2: document.getElementById('alpha2'),
    alpha3: document.getElementById('alpha3'),
    alpha1Val: document.getElementById('alpha1-val'),
    alpha2Val: document.getElementById('alpha2-val'),
    alpha3Val: document.getElementById('alpha3-val')
  };

  function alphas() {
    return {
      a1: els.alpha1.value / 100,
      a2: els.alpha2.value / 100,
      a3: els.alpha3.value / 100
    };
  }

  function buildAgents() {
    const { a1, a2, a3 } = alphas();
    agents = Array.from({ length: N_HUMANS }, (_, i) => ({
      id: i,
      kind: 'human',
      belief: 'good',      // 'good' | 'bad'
      exposureScore: 0,    // replaces BotSim's raw exposure counter with a Jev-persuasion-weighted score
      angle: (i / N_HUMANS) * Math.PI * 2,
      hasInfo: false,
      infoPolarity: null,
      pulse: 0
    }));
    adjacency = buildNetwork(N_HUMANS, K_NEIGHBORS, REWIRE_P);

    bots = [];
    const nBadBots = Math.round(a1 * N_HUMANS);
    const nCorrectionBots = Math.round(a2 * nBadBots);
    const nGoodBots = Math.round(a3 * nBadBots);
    let bid = N_HUMANS;
    for (let i = 0; i < nBadBots; i++) bots.push(makeBot(bid++, 'badBot'));
    for (let i = 0; i < nCorrectionBots; i++) bots.push(makeBot(bid++, 'correctionBot'));
    for (let i = 0; i < nGoodBots; i++) bots.push(makeBot(bid++, 'goodBot'));

    // attach each bot to a small random set of human neighbors
    for (const bot of bots) {
      const nLinks = 3 + Math.floor(rnd() * 3);
      bot.targets = [];
      for (let i = 0; i < nLinks; i++) bot.targets.push(Math.floor(rnd() * N_HUMANS));
    }
  }

  function makeBot(id, kind) {
    const total = N_HUMANS + bots.length;
    return {
      id,
      kind,
      angle: null, // placed on an outer ring, computed at draw time
      hasInfo: false,
      infoPolarity: null,
      pulse: 0
    };
  }

  function resetStats() {
    tick = 0; decisions = 0; spend = 0;
    consumeYes = 0; consumeTotal = 0;
    propagateYes = 0; propagateTotal = 0;
    persuadeYes = 0; persuadeTotal = 0;
    els.tick.textContent = '0';
    els.good.textContent = '–'; els.bad.textContent = '–';
    els.consume.textContent = '–'; els.propagate.textContent = '–'; els.persuade.textContent = '–';
    els.decisions.textContent = '0';
    els.flagged.textContent = 'not yet'; els.flagLabel.textContent = 'Conspiratorial society';
    els.timer.textContent = '00:00';
  }

  function nodePos(angle, radius) {
    return { x: CX + Math.cos(angle) * radius, y: CY + Math.sin(angle) * radius };
  }

  function colorFor(node) {
    if (node.kind === 'human') return node.belief === 'bad' ? COLORS.badHuman : COLORS.goodHuman;
    if (node.kind === 'badBot') return COLORS.badBot;
    if (node.kind === 'correctionBot') return COLORS.correctionBot;
    return COLORS.goodBot;
  }

  // Curved edge that bows gently toward the ring's center, so the mesh reads
  // as a soft woven net instead of a hard star of straight chords.
  function curvedLine(pa, pb, bow) {
    const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
    const cx = mx + (CX - mx) * bow, cy = my + (CY - my) * bow;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.quadraticCurveTo(cx, cy, pb.x, pb.y);
    ctx.stroke();
  }

  function glow(color, blur) {
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
  }
  function noGlow() { ctx.shadowBlur = 0; }

  function drawStar(x, y, r, points, color) {
    ctx.save();
    glow(color, 10);
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const rad = i % 2 === 0 ? r : r * 0.45;
      const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawDiamond(x, y, r, color) {
    ctx.save();
    glow(color, 9);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.75, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.75, y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawBurst(x, y, r, color) {
    ctx.save();
    glow(color, 12);
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? r : r * 0.4;
      const a = (i / 10) * Math.PI * 2;
      const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function draw() {
    ctx.fillStyle = bgGradient();
    ctx.fillRect(0, 0, W, H);

    // faint guide ring
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, Math.PI * 2);
    ctx.stroke();

    // edges (human-human contact network), soft curved lines
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let i = 0; i < N_HUMANS; i++) {
      for (const j of adjacency[i]) {
        if (j <= i) continue;
        curvedLine(nodePos(agents[i].angle, R), nodePos(agents[j].angle, R), 0.12);
      }
    }

    // bot links (outer ring -> targets)
    const botRadius = R * 1.3;
    bots.forEach((bot, i) => {
      bot.angle = (i / Math.max(1, bots.length)) * Math.PI * 2 + 0.3;
      const pa = nodePos(bot.angle, botRadius);
      ctx.strokeStyle = bot.kind === 'badBot' ? 'rgba(239,94,82,0.22)'
        : bot.kind === 'correctionBot' ? 'rgba(91,155,240,0.22)' : 'rgba(240,195,63,0.22)';
      for (const t of bot.targets) {
        curvedLine(pa, nodePos(agents[t].angle, R), -0.08);
      }
    });

    // human nodes: soft glowing dots, brighter ring for a recent belief-moving exposure
    for (const a of agents) {
      const p = nodePos(a.angle, R);
      const color = colorFor(a);
      ctx.save();
      glow(color, a.pulse > 0 ? 14 : 6);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, a.pulse > 0 ? 7.5 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (a.pulse > 0) {
        ctx.strokeStyle = `rgba(255,255,255,${0.5 * a.pulse})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7.5 + (1 - a.pulse) * 6, 0, Math.PI * 2);
        ctx.stroke();
        a.pulse -= 0.045;
      }
    }
    noGlow();

    // bot nodes: distinct little icons so roles read at a glance
    for (const bot of bots) {
      const p = nodePos(bot.angle, botRadius);
      if (bot.kind === 'badBot') drawBurst(p.x, p.y, 7, COLORS.badBot);
      else if (bot.kind === 'correctionBot') drawDiamond(p.x, p.y, 7, COLORS.correctionBot);
      else drawStar(p.x, p.y, 7.5, 5, COLORS.goodBot);
    }
    noGlow();
  }

  function stageGenerate() {
    // Generate: does this agent put out a new piece of information this tick?
    for (const bot of bots) {
      const weight = bot.kind === 'badBot' ? 0.7 : 0.45;
      const { answer } = judge('Does this agent generate a new piece of information this tick, given its role?', weight);
      decisions++;
      if (answer) {
        bot.hasInfo = true;
        bot.infoPolarity = bot.kind === 'badBot' ? 'bad' : 'good';
      }
    }
    for (const a of agents) {
      const weight = a.belief === 'bad' ? 0.35 : 0.3;
      const { answer } = judge('Does this human agent generate a new piece of information this tick?', weight);
      decisions++;
      if (answer) { a.hasInfo = true; a.infoPolarity = a.belief; }
    }
  }

  function stageConsumeAndPropagate() {
    // Bots push info to their attached human targets.
    for (const bot of bots) {
      if (!bot.hasInfo) continue;
      for (const targetId of bot.targets) {
        const target = agents[targetId];
        consumeTotal++;
        const consume = judge('Does the receiving agent consume (attend to) this incoming message?', 0.75);
        decisions++;
        if (!consume.answer) continue;
        consumeYes++;
        applyExposure(target, bot.infoPolarity, bot.kind);
      }
    }
    // Humans propagate to their network neighbors.
    for (const a of agents) {
      if (!a.hasInfo) continue;
      const willingness = a.belief === 'bad' && a.infoPolarity === 'good' ? 0.05
        : a.belief === 'good' && a.infoPolarity === 'bad' ? 0.2
        : 0.6;
      propagateTotal++;
      const propagate = judge('Does this agent propagate its held information to its network neighbors?', willingness);
      decisions++;
      if (!propagate.answer) continue;
      propagateYes++;
      for (const j of adjacency[a.id]) {
        const neighbor = agents[j];
        consumeTotal++;
        const consume = judge('Does the neighboring agent consume this incoming message?', 0.65);
        decisions++;
        if (!consume.answer) continue;
        consumeYes++;
        applyExposure(neighbor, a.infoPolarity, 'human');
      }
    }
  }

  function applyExposure(target, polarity, sourceKind) {
    persuadeTotal++;
    const weight = polarity === 'bad' ? (sourceKind === 'badBot' ? 0.55 : 0.4) : 0.35;
    const persuade = judge('Is this exposure persuasive enough to move the receiving agent\'s belief?', weight);
    decisions++;
    if (!persuade.answer) return;
    persuadeYes++;
    target.exposureScore += polarity === 'bad' ? 1 : -1;
    target.pulse = 1;
  }

  function stageUpdate() {
    for (const a of agents) {
      if (a.exposureScore >= FLIP_THRESHOLD) a.belief = 'bad';
      else if (a.exposureScore <= -FLIP_THRESHOLD) a.belief = 'good';
      a.hasInfo = false; a.infoPolarity = null;
    }
    for (const bot of bots) { bot.hasInfo = false; bot.infoPolarity = null; }
  }

  function stepTick() {
    stageGenerate();
    stageConsumeAndPropagate();
    stageUpdate();
    tick++;

    const nGood = agents.filter(a => a.belief === 'good').length;
    const nBad = N_HUMANS - nGood;
    els.tick.textContent = tick.toLocaleString();
    els.good.textContent = nGood + ' (' + Math.round((nGood / N_HUMANS) * 100) + '%)';
    els.bad.textContent = nBad + ' (' + Math.round((nBad / N_HUMANS) * 100) + '%)';
    if (consumeTotal) els.consume.textContent = Math.round((consumeYes / consumeTotal) * 100) + '%';
    if (propagateTotal) els.propagate.textContent = Math.round((propagateYes / propagateTotal) * 100) + '%';
    if (persuadeTotal) els.persuade.textContent = Math.round((persuadeYes / persuadeTotal) * 100) + '%';
    els.decisions.textContent = decisions.toLocaleString();

    if (nBad === N_HUMANS) {
      els.flagged.textContent = 'tick ' + tick;
      running = false;
    }
    if (tick >= MAX_TICKS) running = false;
  }

  function fmtTime(s) {
    const mm = Math.floor(s / 60).toString().padStart(2, '0');
    const ss = Math.floor(s % 60).toString().padStart(2, '0');
    return `${mm}:${ss}`;
  }

  let startTime = 0;
  function loop(now) {
    if (!startTime) startTime = now;
    const elapsedS = (now - startTime) / 1000;
    els.timer.textContent = fmtTime(elapsedS);

    if (running && now - lastStepAt > STEP_INTERVAL_MS) {
      stepTick();
      lastStepAt = now;
    }
    draw();

    if (running) {
      rafId = requestAnimationFrame(loop);
    } else {
      els.runBtn.disabled = false;
    }
  }

  function reset() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    startTime = 0; lastStepAt = 0;
    buildAgents();
    resetStats();
    els.runBtn.disabled = false;
    draw();
  }

  function run() {
    if (running) return;
    running = true;
    els.runBtn.disabled = true;
    startTime = 0; lastStepAt = 0;
    rafId = requestAnimationFrame(loop);
  }

  els.runBtn.addEventListener('click', () => { reset(); run(); });
  els.resetBtn.addEventListener('click', reset);
  for (const [slider, label, id] of [[els.alpha1, els.alpha1Val, 'alpha1'], [els.alpha2, els.alpha2Val, 'alpha2'], [els.alpha3, els.alpha3Val, 'alpha3']]) {
    slider.addEventListener('input', () => {
      label.textContent = (slider.value / 100).toFixed(2);
      reset();
    });
  }

  buildAgents();
  resetStats();
  draw();
  run();
})();
