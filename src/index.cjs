const { runOnce: probabilityRun } = require('./baseline.cjs');
const { runOnce: liveRun } = require('./live.cjs');
const { createBackend } = require('./providers.cjs');

const defaults = { mode: 'probability', n: 30, k: 4, p: 0.15, maxTicks: 20,
  flipThreshold: 3, alpha1: 0.2, alpha2: 0, alpha3: 1, seed: 42, runs: 3,
  callBudget: 120, jevThreshold: 0.5, jevModel: 'typesafe/jev-1.14',
  generationTemperature: 0.9, judgmentTemperature: 0.3,
  generationTokenLimit: 1800, judgmentTokenLimit: 4000, outputDir: 'outputs' };
function validateConfig(input) {
  for (const key of Object.keys(input)) if (!(key in defaults)) throw new Error(`Unknown parameter: ${key}`);
  const c = { ...defaults, ...input };
  if (!['probability', 'llm', 'jev'].includes(c.mode)) throw new Error('mode must be probability, llm, or jev');
  for (const key of ['n', 'k', 'maxTicks', 'flipThreshold', 'runs', 'callBudget', 'generationTokenLimit', 'judgmentTokenLimit']) {
    if (!Number.isSafeInteger(c[key]) || c[key] < 1) throw new Error(`${key} must be a positive integer`);
  }
  if (c.n < 3 || c.k % 2 || c.k >= c.n) throw new Error('Use n >= 3 and an even k smaller than n');
  for (const key of ['p', 'jevThreshold']) if (!Number.isFinite(c[key]) || c[key] < 0 || c[key] > 1) throw new Error(`${key} must be between 0 and 1`);
  for (const key of ['alpha1', 'alpha2', 'alpha3', 'generationTemperature', 'judgmentTemperature']) {
    if (!Number.isFinite(c[key]) || c[key] < 0) throw new Error(`${key} must be a nonnegative number`);
  }
  if (!Number.isInteger(c.seed) || c.seed < 0 || c.seed > 0xffffffff) throw new Error('seed must be a 32-bit unsigned integer');
  if (c.mode !== 'probability' && c.alpha2 !== 0) throw new Error('Correction actors (alpha2) are supported in probability mode only; the live model implements rumor-spreading and proactive roles');
  if (typeof c.outputDir !== 'string' || !c.outputDir.trim()) throw new Error('outputDir must be a nonempty path');
  if (typeof c.jevModel !== 'string' || !c.jevModel.trim()) throw new Error('jevModel must be a nonempty model identifier');
  return c;
}
async function simulate(input, { backendFactory = createBackend } = {}) {
  const config = validateConfig(input);
  const runs = [];
  for (let replication = 0; replication < config.runs; replication++) {
    const seed = (config.seed + replication) >>> 0;
    if (config.mode === 'probability') {
      const result = probabilityRun({ ...config, seed });
      runs.push({ seed, ...result, completedSteps: result.history.length, stoppedByBudget: false, calls: [] });
    } else {
      const backend = backendFactory(config);
      const result = await liveRun(config.alpha3, seed, config, backend);
      runs.push({ seed, ...result, calls: backend.calls });
    }
  }
  return { config, runs };
}
module.exports = { simulate, validateConfig, defaults };
