// Tier-1 + Tier-2 calibration run, per the two-tier design.
//
// Tier 2 (consume/propagate/persuade gates) is the same calibrated jev-mock
// used in ../botsim.js and ../experiment.cjs -- unchanged. Tier 1 is now REAL:
// every time an agent actually generates or reacts to a message, this script
// makes a live call to a GLM model on OpenRouter (the configured
// `openrouter_text_model`) to author the message text, instead of just
// tagging it Good/Bad.
//
// This is a small, real, API-metered run -- not a full-scale experiment.
// Usage: node run-demo.cjs   (writes transcript.md in this folder)

const fs = require('fs');
const path = require('path');
const { PERSONAS } = require('./personas.js');

// REPLAY=1 regenerates transcript.json/transcript-data.js from a run that
// already happened (see replay-texts.js) instead of calling the live model
// again -- used when re-deriving the structured data file for a run whose
// raw markdown transcript is already saved, without spending anything more.
const REPLAY = process.env.REPLAY === '1';
const REPLAY_META = { model: 'z-ai/glm-5.3-flashx', totalCalls: 24, totalCost: 0.01952, totalTokens: 18896 };
let generateMessage, getUsage;
if (REPLAY) {
  const queue = require('./replay-texts.js').slice();
  generateMessage = async () => queue.shift();
  getUsage = () => REPLAY_META;
} else {
  ({ generateMessage, getUsage } = require('./generate.js'));
}

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

const FIRST = ['Wren', 'Ivo', 'Tala', 'Nim', 'Vela', 'Orrin', 'Miri', 'Rook', 'Elio', 'Yuna', 'Ari', 'Fenn'];

async function main() {
  const N = 12, K = 4, P = 0.15, TICKS = 5, FLIP = 3, CALL_BUDGET = 24;
  // Same alpha convention as ../botsim.js / ../experiment.cjs: alpha1 = Bad
  // Bots as a fraction of humans; alpha2/alpha3 = Correction/Good Bots as a
  // fraction of Bad Bots. Defaults reproduce this script's original fixed
  // roster (2 Bad Bots, 1 Correction Bot, 1 Good Bot out of 12 humans).
  // REPLAY ignores overrides -- replay-texts.js is a fixed recording tied to
  // the default roster; changing bot counts would desync it from the queue.
  const ALPHA1 = !REPLAY && process.env.ALPHA1 !== undefined ? Number(process.env.ALPHA1) : 2 / N;
  const ALPHA2 = !REPLAY && process.env.ALPHA2 !== undefined ? Number(process.env.ALPHA2) : 0.5;
  const ALPHA3 = !REPLAY && process.env.ALPHA3 !== undefined ? Number(process.env.ALPHA3) : 0.5;
  const rnd = mulberry32(11);

  const agents = Array.from({ length: N }, (_, i) => ({
    id: i, nodeId: 'H' + i, name: FIRST[i], belief: 'good', exposureScore: 0, hasInfo: false, infoText: null, infoPolarity: null,
    angle: (i / N) * Math.PI * 2
  }));
  const adjacency = buildNetwork(N, K, P, rnd);

  const nBadBots = Math.round(ALPHA1 * N);
  const nCorrectionBots = Math.round(ALPHA2 * nBadBots);
  const nGoodBots = Math.round(ALPHA3 * nBadBots);
  const bots = [];
  for (let i = 0; i < nBadBots; i++) bots.push({ id: 'B' + (i + 1), name: 'unverified account' + (i ? ' ' + (i + 1) : ''), kind: 'badBot', targets: [] });
  for (let i = 0; i < nGoodBots; i++) bots.push({ id: 'G' + (i + 1), name: 'AuraSight Together' + (i ? ' ' + (i + 1) : ''), kind: 'goodBot', targets: [] });
  for (let i = 0; i < nCorrectionBots; i++) bots.push({ id: 'C' + (i + 1), name: 'Contest FactCheck' + (i ? ' ' + (i + 1) : ''), kind: 'correctionBot', targets: [] });
  bots.forEach((bot, i) => {
    bot.angle = (i / Math.max(1, bots.length)) * Math.PI * 2 + 0.3;
    const nLinks = 3 + Math.floor(rnd() * 3);
    bot.targets = Array.from({ length: nLinks }, () => Math.floor(rnd() * N));
  });
  const correctionBots = bots.filter(b => b.kind === 'correctionBot');

  const transcript = [];
  let calls = 0;

  async function speak(personaFn, ...args) {
    if (calls >= CALL_BUDGET) return null;
    calls++;
    process.stdout.write(REPLAY ? `  [replay ${calls}/${CALL_BUDGET}]\n` : `  [call ${calls}/${CALL_BUDGET}] generating...\n`);
    return REPLAY ? generateMessage() : generateMessage(personaFn(...args));
  }

  function applyExposure(target, polarity) {
    target.exposureScore += polarity === 'bad' ? 1 : -1;
  }

  for (let tick = 1; tick <= TICKS; tick++) {
    transcript.push({ type: 'tick-header', tick });

    // --- Generate: bots ---
    for (const bot of bots) {
      if (bot.kind === 'correctionBot') continue; // reactive only, handled below
      const weight = bot.kind === 'badBot' ? 0.8 : 0.6;
      if (!judge(rnd, weight)) continue;
      const persona = bot.kind === 'badBot' ? PERSONAS.badBot : PERSONAS.goodBot;
      const text = await speak(persona);
      if (!text) continue;
      bot.hasInfo = true;
      bot.infoText = text;
      bot.infoPolarity = bot.kind === 'badBot' ? 'bad' : 'good';
      transcript.push({ type: 'message', tick, speakerId: bot.id, speaker: bot.name, kind: bot.kind, text, polarity: bot.infoPolarity });
    }

    // --- Generate: humans currently holding no info decide whether to originate something ---
    for (const a of agents) {
      if (a.hasInfo) continue;
      const weight = a.belief === 'bad' ? 0.3 : 0.15;
      if (!judge(rnd, weight)) continue;
      const persona = a.belief === 'bad' ? PERSONAS.badHuman : PERSONAS.goodHuman;
      const text = await speak(persona);
      if (!text) continue;
      a.hasInfo = true;
      a.infoText = text;
      a.infoPolarity = a.belief;
      transcript.push({ type: 'message', tick, speakerId: a.nodeId, speaker: a.name, kind: 'human-' + a.belief, text, polarity: a.infoPolarity });
    }

    // --- Consume + propagate: bots -> targeted humans ---
    for (const bot of bots) {
      if (!bot.hasInfo) continue;
      for (const targetId of bot.targets) {
        if (!judge(rnd, 0.75)) continue;
        const target = agents[targetId];
        applyExposure(target, bot.infoPolarity);
        transcript.push({ type: 'exposure', tick, fromId: bot.id, from: bot.name, toId: target.nodeId, to: target.name, text: bot.infoText, polarity: bot.infoPolarity });

        // Info-Correction Bot reacts specifically to a Bad message it observes landing
        // (only if at least one exists -- alpha2 may be 0).
        if (bot.infoPolarity === 'bad' && correctionBots.length && calls < CALL_BUDGET) {
          const correctionBot = correctionBots[Math.floor(rnd() * correctionBots.length)];
          const rebuttal = await speak(PERSONAS.correctionBot, bot.infoText);
          if (rebuttal) {
            transcript.push({ type: 'message', tick, speakerId: correctionBot.id, speaker: correctionBot.name, kind: 'correctionBot', text: rebuttal, polarity: 'good', inReplyTo: bot.infoText });
            applyExposure(target, 'good');
          }
        }
      }
    }

    // --- Consume + propagate: humans -> network neighbors ---
    for (const a of agents) {
      if (!a.hasInfo) continue;
      const willingness = a.belief === 'bad' && a.infoPolarity === 'good' ? 0.05
        : a.belief === 'good' && a.infoPolarity === 'bad' ? 0.2 : 0.6;
      if (judge(rnd, willingness)) {
        for (const j of adjacency[a.id]) {
          if (!judge(rnd, 0.65)) continue;
          applyExposure(agents[j], a.infoPolarity);
          transcript.push({ type: 'exposure', tick, fromId: a.nodeId, from: a.name, toId: agents[j].nodeId, to: agents[j].name, text: a.infoText, polarity: a.infoPolarity });
        }
      }
    }

    // --- Update ---
    for (const a of agents) {
      const beliefBefore = a.belief;
      if (a.exposureScore >= FLIP) a.belief = 'bad';
      else if (a.exposureScore <= -FLIP) a.belief = 'good';
      if (a.belief !== beliefBefore) transcript.push({ type: 'flip', tick, whoId: a.nodeId, who: a.name, from: beliefBefore, to: a.belief });
      a.hasInfo = false; a.infoText = null; a.infoPolarity = null;
    }
    for (const bot of bots) { bot.hasInfo = false; bot.infoText = null; }
  }

  const usage = getUsage();
  writeTranscript(transcript, agents, usage);
  writeDataFile({ agents, bots, adjacency, events: transcript, usage, params: { N, K, P, TICKS, FLIP, ALPHA1, ALPHA2, ALPHA3, nBadBots, nCorrectionBots, nGoodBots } });
  console.log(`Wrote transcript.md, transcript.json, transcript-data.js — ${usage.totalCalls} live GLM calls, ~$${usage.totalCost.toFixed(5)}, ${usage.totalTokens} tokens.`);
}

function writeTranscript(transcript, agents, usage) {
  const lines = [];
  lines.push('# jev_botsim — live Tier-1 (GLM) generation transcript');
  lines.push('');
  lines.push(`Real messages generated by \`${usage.model}\` on OpenRouter, gated by the same jev-mock Tier-2 (consume/propagate/persuade) mechanics as \`../botsim.js\`. See \`the two-tier design\` for the two-tier design this implements.`);
  lines.push('');
  lines.push(`**Usage:** ${usage.totalCalls} live calls · ${usage.totalTokens} tokens · $${usage.totalCost.toFixed(5)}`);
  lines.push('');

  let lastTick = null;
  for (const e of transcript) {
    if (e.type === 'tick-header') {
      lines.push(`## Tick ${e.tick}`);
      lines.push('');
      lastTick = e.tick;
      continue;
    }
    if (e.type === 'message') {
      const tag = e.polarity === 'bad' ? '🔴' : '🟢';
      const replyNote = e.inReplyTo ? ` _(rebutting: "${e.inReplyTo}")_` : '';
      lines.push(`- ${tag} **${e.speaker}** (${e.kind}): "${e.text}"${replyNote}`);
    } else if (e.type === 'exposure') {
      lines.push(`  - → reached **${e.to}**`);
    } else if (e.type === 'flip') {
      lines.push(`  - ⚡ **${e.who}** flipped ${e.from} → **${e.to}**`);
    }
  }

  lines.push('');
  lines.push('## Final beliefs');
  lines.push('');
  for (const a of agents) lines.push(`- ${a.name}: ${a.belief} (exposure score ${a.exposureScore})`);

  fs.writeFileSync(path.join(__dirname, 'transcript.md'), lines.join('\n') + '\n');
}

// Structured output for index_llm.html: network topology (with layout angles
// already computed, matching ../botsim.js's ring layout) + the full event
// stream + real usage numbers. Written as both plain JSON and a `const
// BOTSIM_LLM_RUN = {...}` script so index_llm.html can include it with a
// plain <script src>, no fetch/server required.
function writeDataFile({ agents, bots, adjacency, events, usage, params }) {
  const data = {
    meta: {
      model: usage.model,
      totalCalls: usage.totalCalls,
      totalCost: usage.totalCost,
      totalTokens: usage.totalTokens,
      replayedFromRealRun: REPLAY,
      generatedAt: new Date().toISOString(),
      params
    },
    network: {
      humans: agents.map(a => ({ id: a.nodeId, name: a.name, angle: a.angle, finalBelief: a.belief, exposureScore: a.exposureScore })),
      bots: bots.map(b => ({ id: b.id, name: b.name, kind: b.kind, angle: b.angle, targets: b.targets.map(i => agents[i].nodeId) })),
      adjacency: agents.map(a => adjacency[a.id].map(j => agents[j].nodeId))
    },
    events
  };

  fs.writeFileSync(path.join(__dirname, 'transcript.json'), JSON.stringify(data, null, 2));
  fs.writeFileSync(path.join(__dirname, 'transcript-data.js'), `const BOTSIM_LLM_RUN = ${JSON.stringify(data)};\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
