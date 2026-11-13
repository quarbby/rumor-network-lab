// Compatibility entry point; all four approaches share src/model.js.
const { runProbability } = require('./model.js');
module.exports = { runOnce: runProbability };
