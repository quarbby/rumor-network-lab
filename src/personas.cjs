// Neutral teaching claim. Belief effects follow metadata, not text classification.
function messagePrompt(agent, category, claim) {
  const role = {human:'human participant',rumorBot:'rumor bot',counterRumorBot:'counter-rumor bot'}[agent.role];
  return `Write one short message (under 30 words) for a fictional social-network simulation.\nClaim: ${claim}\nSender role: ${role}.\nRequired position: ${category==='rumor'?'support the claim':'oppose the claim'}.\nExpress only that position. Return one sentence without explanation or JSON.`;
}
module.exports = { messagePrompt };
