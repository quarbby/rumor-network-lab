// Message generation and structured-judgment transport for the LLM trials.
// Configuration comes from the repository's .env and process environment.
const { loadConfig } = require('./config.js');
const { provider: PROVIDER, model: MODEL, apiKey: API_KEY, baseUrl: BASE_URL } = loadConfig();
const IS_LOCAL = PROVIDER === 'local';

let totalCalls = 0;
let totalCost = 0;
let totalTokens = 0;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Upstream (Z.AI via OpenRouter's shared pool) intermittently returns 429
// "temporarily rate-limited upstream" under back-to-back calls -- not a hard
// quota, just shared-pool contention. Retry with backoff rather than fail
// the whole run on a transient 429. Local mode has no 429s to retry (no
// shared pool), so it uses far fewer retries and a much longer per-call
// timeout instead, since a slow local model is legitimately slow, not stuck.
// Shared low-level call: any real inference against the model, whether it's
// authoring a persona's message (generateMessage) or answering a structured
// yes/no judgment (judgeReal, in judge-real.js). Retry/timeout/usage
// tracking lives here once so both callers get the same reliability.
async function chatComplete(prompt, opts = {}) {
  const maxTokens = opts.maxTokens ?? 1800;
  const temperature = opts.temperature ?? 0.9;
  const maxRetries = opts.maxRetries ?? (IS_LOCAL ? 2 : 8);
  const timeoutMs = opts.timeoutMs ?? (IS_LOCAL ? 180000 : 25000);

  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(Math.min(30000, 2000 * 2 ** (attempt - 1)));
    let res;
    try {
      res = await fetch(BASE_URL, {
        method: 'POST',
        headers: {
          ...(IS_LOCAL ? {} : { Authorization: `Bearer ${API_KEY}` }),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: maxTokens,
          temperature
        }),
        // Without an explicit deadline, a congested upstream can leave the
        // request neither resolved nor rejected for the life of the process
        // (observed: a run hung for 10+ minutes on one call). Abort and let
        // the retry loop above handle it like any other transient failure.
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (networkErr) {
      // Transient DNS/connect/timeout failures (laptop sleep/wake, wifi
      // drop, upstream hang) -- retry with backoff same as a 429, rather
      // than fail the whole run.
      lastErr = networkErr;
      continue;
    }
    if (res.ok) return finishCall(await res.json());
    const body = await res.text();
    lastErr = new Error(`${IS_LOCAL ? 'LM Studio' : 'OpenRouter'} ${res.status}: ${body}`);
    if (!IS_LOCAL && res.status === 429) continue; // only OpenRouter's shared-pool 429 is worth retrying blindly
    if (IS_LOCAL && res.status >= 500) continue; // local server still loading/busy
    throw lastErr;
  }
  throw lastErr;
}

function finishCall(data) {
  totalCalls++;
  totalCost += data.usage?.cost || 0;
  totalTokens += data.usage?.total_tokens || 0;
  const text = data.choices?.[0]?.message?.content?.trim() || '';
  // Strip surrounding quotes some models like to add.
  return text.replace(/^["“]|["”]$/g, '');
}

async function generateMessage(prompt, opts) {
  return chatComplete(prompt, opts);
}

function getUsage() {
  return { totalCalls, totalCost, totalTokens, model: MODEL };
}

module.exports = { generateMessage, chatComplete, getUsage };
