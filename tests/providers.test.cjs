const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackend } = require('../src/providers.cjs');
const { defaults } = require('../src/index.cjs');

test('Jev mode generates through the configured LLM and thresholds typed decisions', async () => {
  const keys = ['LLM_PROVIDER','LOCAL_LLM_MODEL','LOCAL_LLM_BASE_URL','OPENROUTER_API_KEY'];
  const previous = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  Object.assign(process.env, { LLM_PROVIDER: 'local', LOCAL_LLM_MODEL: 'test-model',
    LOCAL_LLM_BASE_URL: 'http://localhost:1234/v1', OPENROUTER_API_KEY: 'test-placeholder' });
  try {
    const requests = [];
    const backend = createBackend({ ...defaults, mode: 'jev', jevThreshold: 0.6 }, {
      fetchImpl: async (url, options) => {
        const body = JSON.parse(options.body);requests.push({url,body});
        return { ok:true, json:async () => url.endsWith('/decisions')
          ? { model:'test-jev', answers:{action:{noul:0.55}}, usage:{} }
          : { model:'test-model', choices:[{message:{content:'A fictional message.'}}],usage:{} } };
      }
    });
    assert.equal(await backend.generateMessage('test prompt'), 'A fictional message.');
    assert.equal((await backend.judgeReal('Attend?', {baseRate:0.5})).answer, false);
    assert.equal(requests[0].body.temperature, 0.9);
    assert.equal(requests[0].body.model, 'test-model');
    assert.equal(requests[1].url, 'https://openrouter.ai/api/alpha/decisions');
    assert.equal(backend.calls.length, 2);
    assert.equal(backend.calls[1].decision.probability, 0.55);
    assert.ok(!JSON.stringify(backend.calls).includes('test-placeholder'));
  } finally {
    for (const k of keys) if (previous[k] === undefined) delete process.env[k]; else process.env[k] = previous[k];
  }
});
