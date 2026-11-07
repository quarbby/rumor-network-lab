const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { loadConfig, parseEnv } = require('./config.cjs');

function createBackend(config, { fetchImpl = global.fetch } = {}) {
  const settings = loadConfig();
  const envPath = path.resolve(__dirname, '..', '.env');
  const file = fs.existsSync(envPath) ? parseEnv(fs.readFileSync(envPath, 'utf8')) : {};
  const jevKey = process.env.OPENROUTER_API_KEY || process.env.open_router || file.OPENROUTER_API_KEY || file.open_router;
  if (config.mode === 'jev' && !jevKey) throw new Error('Jev requires OPENROUTER_API_KEY');
  const calls = [];
  async function request(task, url, body, apiKey) {
    const start = performance.now();
    const response = await fetchImpl(url, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error(`${task} request failed (HTTP ${response.status}); check your provider configuration`);
    const data = await response.json();
    calls.push({ task, seconds: (performance.now() - start) / 1000,
      model: data.model || body.model, usage: data.usage || {} });
    return data;
  }
  async function generateMessage(prompt) {
    const data = await request('generation', settings.baseUrl, { model: settings.model,
      messages: [{ role: 'user', content: prompt }], temperature: config.generationTemperature,
      max_tokens: config.generationTokenLimit }, settings.apiKey);
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('The generation model returned no message');
    calls.at(-1).prompt = prompt; calls.at(-1).message = text;
    return text;
  }
  async function judgeReal(instructions, context) {
    if (config.mode === 'jev') {
      const data = await request('judgment', 'https://openrouter.ai/api/alpha/decisions', {
        model: config.jevModel, state: { instructions, context },
        questions: { action: { type: 'noul', instructions: 'The actor performs the action described in instructions, given context.' } }
      }, jevKey);
      const probability = data.answers?.action?.noul;
      if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error('Invalid Jev probability');
      const answer = probability >= config.jevThreshold;
      calls.at(-1).decision = { instructions, context, probability, answer };
      return { answer };
    }
    const prompt = `You judge an actor's next action in a social simulation. Decision: ${instructions}\nContext: ${JSON.stringify(context)}\nThe baseRate is a weak prior. Return strict JSON only: {"answer": true or false, "confidence": 0.0}`;
    const data = await request('judgment', settings.baseUrl, { model: settings.model,
      messages: [{ role: 'user', content: prompt }], temperature: config.judgmentTemperature,
      max_tokens: config.judgmentTokenLimit }, settings.apiKey);
    const raw = data.choices?.[0]?.message?.content || '';
    let parsed;
    try { parsed = JSON.parse(raw.match(/\{[\s\S]*?\}/)?.[0] || raw); } catch { throw new Error('The judgment model returned invalid JSON'); }
    if (typeof parsed.answer !== 'boolean') throw new Error('The judgment model did not return a Boolean answer');
    calls.at(-1).decision = { instructions, context, answer: parsed.answer };
    return parsed;
  }
  return { generateMessage, judgeReal, calls };
}
module.exports = { createBackend };
