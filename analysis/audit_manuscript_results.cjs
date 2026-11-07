// Offline manuscript audit. Replays the existing probability baseline without
// executing the experiment runner's file-writing entry point or any LLM code.
// Run: node analysis/audit_manuscript_results.cjs
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'experiment.cjs');
const resultPath = path.join(root, 'results.json');
const source = fs.readFileSync(sourcePath, 'utf8');
const stored = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
const marker = "console.log('Running jev_botsim experiments";
if (!source.includes(marker)) throw new Error('Experiment entry-point boundary changed');
const definitions = source.slice(0, source.indexOf(marker))
  .replace(/^const (?:fs|path) = require\([^\n]+\);\n/gm, '');
const sandbox = { module: { exports: {} } };
vm.runInNewContext(definitions + '\nmodule.exports = {runOnce, summarize, hashSeed};', sandbox);
const { runOnce, summarize, hashSeed } = sandbox.module.exports;
const keys = {
  exp1_badBotOnly: ['alpha1', { alpha2: 0, alpha3: 0 }],
  exp2_correctionBots: ['alpha2', { alpha1: .2, alpha3: 0 }],
  exp3_goodBots: ['alpha3', { alpha1: .2, alpha2: 0 }],
};
const experiments = {};
let reproducedRuns = 0;
let maximumNumericDifference = 0;
for (const [name, points] of Object.entries(stored.experiments)) {
  const [parameter, fixed] = keys[name];
  experiments[name] = points.map(point => {
    const runs = Array.from({ length: stored.nReps }, (_, replication) => {
      const seed = hashSeed(parameter, point[parameter], replication);
      const parameters = { ...stored.base, ...fixed, [parameter]: point[parameter], seed };
      reproducedRuns++;
      return { replication: replication + 1, seed, ...runOnce(parameters) };
    });
    const summary = summarize(runs);
    for (const [key, observed] of Object.entries(summary)) {
      const expected = point[key];
      if (expected === null || observed === null) {
        if (expected !== observed) throw new Error(`${name}/${point[parameter]}/${key}: null mismatch`);
      } else {
        const delta = Math.abs(observed - expected);
        maximumNumericDifference = Math.max(maximumNumericDifference, delta);
        if (delta > 1e-12) throw new Error(`${name}/${point[parameter]}/${key}: stored result differs`);
      }
    }
    const m = summary.meanFinalBadFraction;
    const sampleSD = Math.sqrt(runs.reduce((sum, r) => sum + (r.finalBadFraction - m) ** 2, 0) / (runs.length - 1));
    return { [parameter]: point[parameter], ...summary, sdFinalBadFraction: sampleSD, runs };
  });
}

const roleSwapPairs = [];
for (const ratio of [0, .4, .8, 1.2, 1.6, 2]) {
  for (let rep = 0; rep < 8; rep++) {
    const seed = hashSeed('role-swap-audit', ratio, rep);
    const common = { ...stored.base, alpha1: .2, seed };
    const correction = runOnce({ ...common, alpha2: ratio, alpha3: 0 });
    const proactive = runOnce({ ...common, alpha2: 0, alpha3: ratio });
    const identical = JSON.stringify(correction) === JSON.stringify(proactive);
    if (!identical) throw new Error(`Role equivalence changed: ratio=${ratio}, seed=${seed}`);
    roleSwapPairs.push({ ratio, replication: rep + 1, seed, identical, correction, proactive });
  }
}

const usageChecks = {};
for (const file of ['experiment3-llm-results.json', 'experiment3-full-real-results.GLM53FLASHX.json', 'experiment3-full-real-results.json']) {
  const record = JSON.parse(fs.readFileSync(path.join(root, 'llm', file), 'utf8'));
  const runs = record.results.flatMap(p => p.runs);
  for (const point of record.results) {
    if (point.nRuns !== point.runs.length) throw new Error(`${file}: replication count mismatch`);
    if (point.meanFinalBadFraction != null) {
      const mean = point.runs.reduce((s, r) => s + r.finalBadFraction, 0) / point.runs.length;
      if (Math.abs(mean - point.meanFinalBadFraction) > 1e-12) throw new Error(`${file}: mean mismatch`);
    }
  }
  const assignedCalls = runs.reduce((s, r) => s + (r.callsUsed ?? (r.genCalls + r.judgeCalls)), 0);
  usageChecks[file] = {
    model: record.model, completedRuns: runs.length,
    callsAttributedToCompletedRuns: assignedCalls,
    checkpointCalls: record.usage.totalCalls,
    checkpointCallsBeyondCompletedRuns: record.usage.totalCalls - assignedCalls,
  };
}
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const report = {
  provenance: {
    purpose: 'Offline reproduction and mechanism audit for paper_codex.tex',
    baselineSource: 'experiment.cjs', sourceSHA256: hash(source),
    baselineResults: 'results.json', resultsSHA256: hash(fs.readFileSync(resultPath)),
    externalInferenceCalls: 0,
  },
  base: stored.base, nReps: stored.nReps,
  reproducedRuns, maximumNumericDifference,
  experiments,
  roleSwapAudit: { pairs: roleSwapPairs.length, identicalPairs: roleSwapPairs.filter(p => p.identical).length, runs: roleSwapPairs },
  usageChecks,
};
fs.writeFileSync(path.join(__dirname, 'results_audit.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ reproducedRuns, maximumNumericDifference, roleSwapPairs: roleSwapPairs.length,
  identicalRoleSwapPairs: report.roleSwapAudit.identicalPairs, usageChecks }, null, 2));
