const fs = require('node:fs');
const path = require('node:path');

function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '').trim();
    values[match[1]] = value;
  }
  return values;
}

function loadConfig({ env = process.env, envPath = path.resolve(__dirname, '..', '.env') } = {}) {
  const file = fs.existsSync(envPath) ? parseEnv(fs.readFileSync(envPath, 'utf8')) : {};
  // Environment variables override file settings, including legacy aliases.
  const setting = (names, fallback = '') => {
    for (const source of [env, file]) {
      for (const name of names) if (source[name] !== undefined) return source[name].trim();
    }
    return fallback;
  };
  const provider = setting(['LLM_PROVIDER', 'llm_provider'], 'openrouter');
  if (!['local', 'openrouter'].includes(provider)) throw new Error('LLM_PROVIDER must be local or openrouter');
  const local = provider === 'local';
  const model = local
    ? setting(['LOCAL_LLM_MODEL', 'local_llm_model'])
    : setting(['OPENROUTER_MODEL', 'openrouter_text_model']);
  const apiKey = local ? '' : setting(['OPENROUTER_API_KEY', 'open_router']);
  if (!model || (!local && !apiKey)) {
    throw new Error(local ? 'Set LOCAL_LLM_MODEL in .env or the environment' :
      'Set OPENROUTER_MODEL and OPENROUTER_API_KEY in .env or the environment');
  }
  const baseUrl = local
    ? setting(['LOCAL_LLM_BASE_URL', 'local_llm_base_url'], 'http://localhost:1234/v1').replace(/\/$/, '') + '/chat/completions'
    : 'https://openrouter.ai/api/v1/chat/completions';
  return { provider, model, apiKey, baseUrl,
    decisionApiKey: setting(['OPENROUTER_API_KEY', 'open_router']) };
}

module.exports = { parseEnv, loadConfig };
