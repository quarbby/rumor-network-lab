// A real replacement for botsim.js/experiment.cjs's judge() mock: instead
// of perturbing a role-conditioned base probability with random noise and
// flipping a weighted coin, this asks the live model to make the yes/no
// call itself, given the actual situation. This is the Tier-2 half of the
// two-tier design in ../../jev/BOTSIM_LLM_PLAN.md that was never actually
// built with a live model -- every run in this project before now used the
// calibrated mock for this layer, real generation or not.

const { chatComplete, getUsage } = require('./generate.js');

function buildPrompt(instructions, context) {
  return `You are a fast binary-decision classifier embedded inside a social-simulation agent-based model. You are not the agent; you are deciding, from the outside, what a realistic agent in this situation would do.

Decision to make: ${instructions}

Situation context (JSON): ${JSON.stringify(context)}

Base rate for context: absent any other signal, this type of decision in this population is calibrated to happen roughly ${Math.round((context.baseRate ?? 0.5) * 100)}% of the time -- treat this only as a weak prior, and let the specific context above (message content, belief state, relationship, etc., whichever are present) move you away from it when it's informative.

Respond with ONLY one line of strict JSON, no other text, no explanation: {"answer": true or false, "confidence": <number between 0 and 1>}`;
}

async function judgeReal(instructions, context) {
  const prompt = buildPrompt(instructions, context);
  const raw = await chatComplete(prompt, { maxTokens: 4000, temperature: 0.3 });
  const match = raw.match(/\{[\s\S]*?\}/);
  try {
    const parsed = JSON.parse(match ? match[0] : raw);
    if (typeof parsed.answer !== 'boolean') throw new Error('no boolean answer field');
    return {
      answer: parsed.answer,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5
    };
  } catch (e) {
    // A real call that came back malformed is still a real call -- fall
    // back to the context's base rate rather than crash the run, but flag
    // it so parse failures are visible in the record, not silently eaten.
    return { answer: Math.random() < (context.baseRate ?? 0.5), confidence: 0.5, parseError: true, raw };
  }
}

module.exports = { judgeReal, getUsage };
