#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { simulate } = require('../src/index.cjs');
(async () => {
  if (process.argv.includes('--help')) {
    console.log('Usage: node bin/simulate.cjs [config.json]\nDefault: config/simulation.json. Outputs go to outputDir.');
    return;
  }
  const configPath = path.resolve(process.argv[2] || path.join(__dirname, '../config/simulation.json'));
  const input = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const startedAt = new Date().toISOString();
  const result = await simulate(input);
  const dir = path.resolve(result.config.outputDir);
  fs.mkdirSync(dir, { recursive: true });
  const id = `${startedAt.replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
  const output = path.join(dir, `simulation-${id}.json`);
  fs.writeFileSync(output, JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), nodeVersion: process.version, ...result }, null, 2) + '\n', { flag: 'wx' });
  console.log(`Saved ${result.runs.length} run(s) to ${output}`);
  for (const run of result.runs) console.log(`seed=${run.seed} finalRumorAcceptance=${run.finalBadFraction.toFixed(3)} completedSteps=${run.completedSteps} budgetStopped=${run.stoppedByBudget}`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
