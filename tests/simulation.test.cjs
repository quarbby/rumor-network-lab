const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { simulate, validateConfig } = require('../src/index.cjs');

test('seeded probability runs repeat exactly without calling a provider', async () => {
  const input = { n: 30, maxTicks: 10, runs: 2, seed: 42, alpha1: 0.5 };
  const options = { backendFactory: () => { throw new Error('A probability run must not load a model'); } };
  const first = await simulate(input, options);
  assert.deepEqual(first, await simulate(input, options));
  assert.deepEqual(first.runs.map(x => x.seed), [42, 43]);
  assert.ok(first.runs.every(x => x.history.length > 0));
});

test('no rumor sources leaves all humans rejecting the rumor', async () => {
  const result = await simulate({ alpha1: 0, runs: 1, maxTicks: 10 });
  assert.equal(result.runs[0].finalBadFraction, 0);
});

test('invalid or unsupported configurations fail before inference', () => {
  assert.throws(() => validateConfig({ k: 3 }), /even k/);
  assert.throws(() => validateConfig({ p: 2 }), /between 0 and 1/);
  assert.throws(() => validateConfig({ mode: 'llm', alpha2: 1 }), /probability mode only/);
  assert.throws(() => validateConfig({ typoParameter: 1 }), /Unknown parameter/);
});

test('a call limit stops observation instead of imposing negative decisions', async () => {
  const result = await simulate({ mode: 'llm', n: 3, k: 2, alpha1: 0.34,
    alpha3: 0, maxTicks: 1, runs: 1, callBudget: 3 }, {
    backendFactory: () => {
      const calls = [];
      return { calls, generateMessage: async () => 'unused',
        judgeReal: async () => { calls.push({ task: 'judgment' }); return { answer: false }; } };
    }
  });
  assert.equal(result.runs[0].calls.length, 3);
  assert.equal(result.runs[0].completedSteps, 0);
  assert.equal(result.runs[0].stoppedByBudget, true);
  assert.equal(result.runs[0].finalBadFraction, 0);
});

test('a complete live step is retained when its exact call allowance suffices', async () => {
  const result = await simulate({ mode: 'llm', n: 3, k: 2, alpha1: 0.34,
    alpha3: 0, maxTicks: 1, runs: 1, callBudget: 4 }, {
    backendFactory: () => ({ calls: [], generateMessage: async () => 'unused', judgeReal: async () => ({ answer: false }) })
  });
  assert.equal(result.runs[0].completedSteps, 1);
  assert.equal(result.runs[0].stoppedByBudget, false);
});

test('CLI reads a parameter file and writes configuration and outcomes to a new file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rumor-package-test-'));
  try {
    const configPath = path.join(dir, 'parameters.json');
    fs.writeFileSync(configPath, JSON.stringify({ n: 10, k: 4, runs: 1, seed: 7, outputDir: dir }));
    const result = spawnSync(process.execPath, ['bin/simulate.cjs', configPath], {
      cwd: path.resolve(__dirname, '..'), encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    const file = fs.readdirSync(dir).find(x => x.startsWith('simulation-'));
    const output = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    assert.equal(output.config.n, 10);
    assert.equal(output.runs[0].seed, 7);
  } finally { fs.rmSync(dir, { recursive: true }); }
});
