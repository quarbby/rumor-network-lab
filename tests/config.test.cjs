const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseEnv, loadConfig } = require('../llm/config.js');

test('environment settings work without a private sibling project', () => {
  const config = loadConfig({ envPath: '/nonexistent/rumor-lab.env', env: {
    LLM_PROVIDER: 'local', LOCAL_LLM_MODEL: 'test-model', LOCAL_LLM_BASE_URL: 'http://localhost:1234/v1/'
  }});
  assert.equal(config.baseUrl, 'http://localhost:1234/v1/chat/completions');
  assert.equal(config.apiKey, '');
});

test('process settings override file settings and legacy aliases', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rumor-lab-config-'));
  try {
    const envPath = path.join(dir, '.env');
    fs.writeFileSync(envPath, 'LLM_PROVIDER=local\nLOCAL_LLM_MODEL=file-model\n');
    const config = loadConfig({ envPath, env: { llm_provider: 'openrouter', openrouter_text_model: 'test-model', open_router: 'test-placeholder' }});
    assert.equal(config.provider, 'openrouter');
    assert.equal(config.model, 'test-model');
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('missing credentials fail before a request without exposing supplied values', () => {
  assert.throws(() => loadConfig({ envPath: '/nonexistent/rumor-lab.env', env: {
    LLM_PROVIDER: 'openrouter', OPENROUTER_MODEL: 'test-model'
  }}), /Set OPENROUTER_MODEL and OPENROUTER_API_KEY/);
});

test('dotenv parser supports quoted values, comments, and export syntax', () => {
  assert.deepEqual(parseEnv('# comment\nexport MODEL="with spaces"\nPORT=1234 # local\n'), { MODEL: 'with spaces', PORT: '1234' });
});

test('configured local transport sends the selected model and tracks usage', async () => {
  const { spawnSync } = require('node:child_process');
  const script = `
    const assert = require('node:assert/strict');
    global.fetch = async (url, request) => {
      assert.equal(url, 'http://localhost:1234/v1/chat/completions');
      assert.equal(request.headers.Authorization, undefined);
      const body = JSON.parse(request.body);
      assert.equal(body.model, 'transport-test');
      assert.equal(body.temperature, 0.3);
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'true' } }], usage: { total_tokens: 12 } }) };
    };
    const { chatComplete, getUsage } = require('./llm/generate.js');
    chatComplete('test decision', { temperature: 0.3 }).then(text => {
      assert.equal(text, 'true');
      assert.equal(getUsage().totalTokens, 12);
      assert.equal(getUsage().totalCalls, 1);
    }).catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'), encoding: 'utf8',
    env: { ...process.env, LLM_PROVIDER: 'local', LOCAL_LLM_MODEL: 'transport-test', LOCAL_LLM_BASE_URL: 'http://localhost:1234/v1' }
  });
  assert.equal(result.status, 0, result.stderr);
});
