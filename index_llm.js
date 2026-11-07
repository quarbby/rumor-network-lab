// Replays a recorded jev_botsim LLM run (llm/transcript-data.js) — real
// messages from a live GLM call, real network topology, real usage numbers.
// Rendering reuses the same visual language as botsim.js (ring layout, glow,
// bot icon shapes) but drives it from a fixed event log instead of live
// simulation, since the underlying run is real, billed, and already happened.

(function () {
  if (typeof BOTSIM_LLM_RUN === 'undefined') {
    document.getElementById('feed').innerHTML =
      '<div class="feed-empty">No recorded run found. Run <code>node llm/run-demo.cjs</code> first to generate <code>llm/transcript-data.js</code>.</div>';
    return;
  }

  const RUN = BOTSIM_LLM_RUN;
  const canvas = document.getElementById('net');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const CX = W / 2, CY = H / 2, R = Math.min(W, H) * 0.36, BOT_R = R * 1.32;

  const COLORS = {
    goodHuman: '#4caf6a', badHuman: '#5b5f73',
    badBot: '#ef5e52', correctionBot: '#5b9bf0', goodBot: '#f0c33f'
  };

  document.getElementById('model-name').textContent = RUN.meta.model;
  document.getElementById('stat-max-tick').textContent = RUN.meta.params.TICKS;
  document.getElementById('stat-calls').textContent = RUN.meta.totalCalls;
  document.getElementById('stat-tokens').textContent = RUN.meta.totalTokens.toLocaleString();
  document.getElementById('stat-cost').textContent = '$' + RUN.meta.totalCost.toFixed(5);

  // --- node registry ---
  const nodes = new Map();
  for (const h of RUN.network.humans) {
    nodes.set(h.id, { id: h.id, name: h.name, isHuman: true, belief: 'good', angle: h.angle, pulse: 0, ringR: R });
  }
  for (const b of RUN.network.bots) {
    nodes.set(b.id, { id: b.id, name: b.name, isHuman: false, kind: b.kind, angle: b.angle, pulse: 0, ringR: BOT_R });
  }

  function nodePos(node) {
    return { x: CX + Math.cos(node.angle) * node.ringR, y: CY + Math.sin(node.angle) * node.ringR };
  }

  const bg = ctx.createRadialGradient(CX, CY, 30, CX, CY, Math.max(W, H) * 0.75);
  bg.addColorStop(0, '#20243a'); bg.addColorStop(0.55, '#181a29'); bg.addColorStop(1, '#0b0c12');

  function glow(color, blur) { ctx.shadowColor = color; ctx.shadowBlur = blur; }
  function noGlow() { ctx.shadowBlur = 0; }
  function curvedLine(pa, pb, bow, alpha) {
    const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
    const cx = mx + (CX - mx) * bow, cy = my + (CY - my) * bow;
    ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.quadraticCurveTo(cx, cy, pb.x, pb.y); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  function drawStar(x, y, r, points, color) {
    ctx.save(); glow(color, 10); ctx.fillStyle = color; ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const rad = i % 2 === 0 ? r : r * 0.45;
      const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
  function drawDiamond(x, y, r, color) {
    ctx.save(); glow(color, 9); ctx.fillStyle = color; ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.75, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.75, y);
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
  function drawBurst(x, y, r, color) {
    ctx.save(); glow(color, 12); ctx.fillStyle = color; ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? r : r * 0.4;
      const a = (i / 10) * Math.PI * 2;
      const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
  function colorFor(node) {
    if (node.isHuman) return node.belief === 'bad' ? COLORS.badHuman : COLORS.goodHuman;
    if (node.kind === 'badBot') return COLORS.badBot;
    if (node.kind === 'correctionBot') return COLORS.correctionBot;
    return COLORS.goodBot;
  }

  // active traveling flashes: { from, to, life }
  let flashes = [];

  function draw() {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2); ctx.stroke();

    // static contact network (faint)
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    RUN.network.humans.forEach((h, i) => {
      for (const neighborId of RUN.network.adjacency[i]) {
        const a = nodes.get(h.id), b = nodes.get(neighborId);
        if (!a || !b) continue;
        curvedLine(nodePos(a), nodePos(b), 0.12, 1);
      }
    });
    for (const b of RUN.network.bots) {
      const bot = nodes.get(b.id);
      ctx.strokeStyle = b.kind === 'badBot' ? 'rgba(239,94,82,0.16)'
        : b.kind === 'correctionBot' ? 'rgba(91,155,240,0.16)' : 'rgba(240,195,63,0.16)';
      for (const targetId of b.targets) {
        const t = nodes.get(targetId);
        if (t) curvedLine(nodePos(bot), nodePos(t), -0.08, 1);
      }
    }

    // active traveling flashes
    for (const f of flashes) {
      const a = nodes.get(f.from), b = nodes.get(f.to);
      if (!a || !b) continue;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 2.5;
      curvedLine(nodePos(a), nodePos(b), a.isHuman && b.isHuman ? 0.12 : -0.08, Math.max(0, f.life));
    }

    // human nodes
    for (const h of RUN.network.humans) {
      const node = nodes.get(h.id);
      const p = nodePos(node);
      const color = colorFor(node);
      ctx.save(); glow(color, node.pulse > 0 ? 16 : 6); ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(p.x, p.y, node.pulse > 0 ? 9 : 6.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      if (node.pulse > 0) {
        ctx.strokeStyle = `rgba(255,255,255,${0.5 * node.pulse})`; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, 9 + (1 - node.pulse) * 7, 0, Math.PI * 2); ctx.stroke();
      }
    }
    noGlow();

    // bot nodes
    for (const b of RUN.network.bots) {
      const node = nodes.get(b.id);
      const p = nodePos(node);
      if (b.kind === 'badBot') drawBurst(p.x, p.y, 9, COLORS.badBot);
      else if (b.kind === 'correctionBot') drawDiamond(p.x, p.y, 9, COLORS.correctionBot);
      else drawStar(p.x, p.y, 9.5, 5, COLORS.goodBot);
    }
    noGlow();
  }

  // --- playback ---
  const els = {
    tick: document.getElementById('stat-tick'),
    messages: document.getElementById('stat-messages'),
    flips: document.getElementById('stat-flips'),
    feed: document.getElementById('feed'),
    playBtn: document.getElementById('play-btn'),
    restartBtn: document.getElementById('restart-btn'),
    speed: document.getElementById('speed')
  };

  let idx = 0, playing = false, messageCount = 0, flipCount = 0, feedCleared = false;

  function baseIntervalMs() { return 900 / Number(els.speed.value); }

  function pushFeed(html) {
    if (!feedCleared) { els.feed.innerHTML = ''; feedCleared = true; }
    const div = document.createElement('div');
    div.innerHTML = html;
    els.feed.appendChild(div.firstElementChild);
    els.feed.scrollTop = els.feed.scrollHeight;
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function applyEvent(e) {
    if (e.type === 'tick-header') {
      els.tick.textContent = e.tick;
      return;
    }
    if (e.type === 'message') {
      const node = nodes.get(e.speakerId);
      if (node) node.pulse = 1;
      messageCount++; els.messages.textContent = messageCount;
      const cls = e.polarity === 'bad' ? 'bad' : 'good';
      const tag = e.polarity === 'bad' ? '🔴' : '🟢';
      const reply = e.inReplyTo ? `<div class="reply">rebutting: "${escapeHtml(e.inReplyTo)}"</div>` : '';
      pushFeed(`<div class="msg ${cls}">
        <span class="who">${tag} ${escapeHtml(e.speaker)}</span><span class="kind">${escapeHtml(e.kind)}</span>
        <div class="text">"${escapeHtml(e.text)}"</div>
        ${reply}
      </div>`);
      return;
    }
    if (e.type === 'exposure') {
      const target = nodes.get(e.toId);
      if (target) target.pulse = Math.max(target.pulse, 0.6);
      flashes.push({ from: e.fromId, to: e.toId, color: e.polarity === 'bad' ? 'rgba(239,94,82,0.8)' : 'rgba(76,175,106,0.8)', life: 1 });
      return;
    }
    if (e.type === 'flip') {
      const node = nodes.get(e.whoId);
      if (node) { node.belief = e.to; node.pulse = 1; }
      flipCount++; els.flips.textContent = flipCount;
      pushFeed(`<div class="flip-note">⚡ ${escapeHtml(e.who)} flipped ${e.from} → ${e.to}</div>`);
    }
  }

  // Event advancement runs on setInterval, not requestAnimationFrame: rAF can
  // be fully suspended (not just throttled) for an occluded/background tab,
  // which would silently freeze playback. setInterval keeps firing (Chrome
  // clamps background intervals to >=1s but doesn't stop them), so playback
  // still advances even if the tab isn't the focused/visible one.
  let stepTimer = null;

  function stepOnce() {
    if (!playing) return;
    if (idx < RUN.events.length) {
      applyEvent(RUN.events[idx]);
      idx++;
    } else {
      playing = false;
      els.playBtn.textContent = 'Play';
      pushFeed(`<div class="flip-note">— run complete —</div>`);
      clearStepTimer();
    }
  }

  function clearStepTimer() { if (stepTimer) { clearInterval(stepTimer); stepTimer = null; } }
  function restartStepTimer() {
    clearStepTimer();
    stepTimer = setInterval(stepOnce, baseIntervalMs());
  }

  function renderLoop() {
    for (const n of nodes.values()) if (n.pulse > 0) n.pulse -= 0.03;
    flashes = flashes.filter(f => (f.life -= 0.08) > 0);
    draw();
    requestAnimationFrame(renderLoop);
  }

  function restart() {
    playing = false;
    clearStepTimer();
    idx = 0; messageCount = 0; flipCount = 0; feedCleared = false;
    flashes = [];
    for (const n of nodes.values()) { n.pulse = 0; if (n.isHuman) n.belief = 'good'; }
    els.tick.textContent = '0';
    els.messages.textContent = '0';
    els.flips.textContent = '0';
    els.feed.innerHTML = '<div class="feed-empty">Press Play to replay the recorded run…</div>';
    els.playBtn.textContent = 'Play';
    draw();
  }

  els.playBtn.addEventListener('click', () => {
    playing = !playing;
    els.playBtn.textContent = playing ? 'Pause' : 'Play';
    if (playing) restartStepTimer(); else clearStepTimer();
  });
  els.restartBtn.addEventListener('click', restart);
  els.speed.addEventListener('input', () => { if (playing) restartStepTimer(); });

  // --- compose-panel: builds the ALPHA1/ALPHA2/ALPHA3 command for the next
  // real run-demo.cjs run. Purely a command generator -- no API key touches
  // this page, and nothing here calls OpenRouter.
  const compose = {
    a1: document.getElementById('alpha1'),
    a2: document.getElementById('alpha2'),
    a3: document.getElementById('alpha3'),
    a1v: document.getElementById('alpha1-val'),
    a2v: document.getElementById('alpha2-val'),
    a3v: document.getElementById('alpha3-val'),
    counts: document.getElementById('compose-counts'),
    cmd: document.getElementById('compose-cmd'),
    copyBtn: document.getElementById('copy-cmd-btn')
  };
  const N = RUN.network.humans.length;
  const p = RUN.meta.params || {};
  if (typeof p.ALPHA1 === 'number') compose.a1.value = Math.round(p.ALPHA1 * 100);
  if (typeof p.ALPHA2 === 'number') compose.a2.value = Math.round(p.ALPHA2 * 100);
  if (typeof p.ALPHA3 === 'number') compose.a3.value = Math.round(p.ALPHA3 * 100);

  function updateCompose() {
    const a1 = compose.a1.value / 100, a2 = compose.a2.value / 100, a3 = compose.a3.value / 100;
    compose.a1v.textContent = a1.toFixed(2);
    compose.a2v.textContent = a2.toFixed(2);
    compose.a3v.textContent = a3.toFixed(2);
    const nBad = Math.round(a1 * N);
    const nCorrection = Math.round(a2 * nBad);
    const nGood = Math.round(a3 * nBad);
    const plural = (n, s) => `${n} ${s}${n === 1 ? '' : 's'}`;
    compose.counts.textContent = `${plural(nBad, 'Bad Bot')} · ${plural(nCorrection, 'Correction Bot')} · ${plural(nGood, 'Good Bot')}, out of ${N} humans`;
    compose.cmd.textContent = `ALPHA1=${a1.toFixed(2)} ALPHA2=${a2.toFixed(2)} ALPHA3=${a3.toFixed(2)} node llm/run-demo.cjs`;
  }
  [compose.a1, compose.a2, compose.a3].forEach(el => el.addEventListener('input', updateCompose));
  compose.copyBtn.addEventListener('click', () => {
    navigator.clipboard?.writeText(compose.cmd.textContent).then(() => {
      compose.copyBtn.textContent = 'Copied!';
      setTimeout(() => { compose.copyBtn.textContent = 'Copy'; }, 1200);
    });
  });
  updateCompose();

  draw();
  requestAnimationFrame(renderLoop);
})();
