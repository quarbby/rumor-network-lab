# Rumor Network Lab

Build and compare four ways of simulating rumor diffusion on the same small-world network.
The default experiment has **30 humans, six rumor bots, six counter-rumor bots, and 20 steps**.
The question is: **how many humans accept the rumor after step 20?**

## Four approaches

| Approach | `mode` | Sending decision | Message |
| --- | --- | --- | --- |
| 1 | `probability` | Seeded probability rule | Rumor or counter-rumor label |
| 2 | `probability-llm` | The same probability rule | LLM-generated sentence |
| 3 | `llm` | LLM returns a Boolean answer | LLM-generated sentence |
| 4 | `jev` | Jev probability compared with a cutoff | LLM-generated sentence |

GLM is an example LLM, not a separate approach. Approaches 2–4 can use another
OpenAI-compatible local model or an OpenRouter model. Jev supplies decisions only.

## Quick start

Install Node.js 20 or newer. No dependency installation is needed.

```sh
git clone https://github.com/quarbby/rumor-network-lab.git
cd rumor-network-lab
npm run approach:1
```

The default run reproduces the teaching example: **7 of 30 humans accept at step 20,
301 messages are sent, and 1,193 deliveries occur**. Output is written to a uniquely
named JSON file in `outputs/`; existing outputs are preserved.

Choose another approach:

```sh
npm run approach:2
npm run approach:3
npm run approach:4
```

For a different configuration:

```sh
npm run simulate -- examples/probability-llm.json
npm run simulate -- path/to/config.json --approach 4
```

The numbered flag overrides only `mode`. All other settings come from the file.
`npm run simulate` reads `config/simulation.json` by default. `--help` lists the approaches.

## Model credentials

Approach 1 uses no model and reads no credentials. For Approaches 2–4:

```sh
cp .env.example .env
```

Set `LLM_PROVIDER=openrouter`, `OPENROUTER_MODEL=z-ai/glm-5.3-flashx` (or your chosen
model), and your own `OPENROUTER_API_KEY` in `.env`. Alternatively, set
`LLM_PROVIDER=local`, `LOCAL_LLM_MODEL`, and `LOCAL_LLM_BASE_URL` for an
OpenAI-compatible local server. Approach 4 requires `OPENROUTER_API_KEY` for Jev
even when message generation is local. Environment settings override `.env`.

**Never put keys in configuration JSON, HTML, prompts, or committed files.**
The package reads only its own ignored `.env` or the environment. It does not read
credentials from a sibling project. The browser never receives provider credentials.
Model calls incur the provider's normal charges. The default 2,000-request allowance
covers the maximum 1,680 tasks in a 42-agent, 20-step run without retries.
Requests are sequential, have a 45-second timeout, and are not automatically retried.

## HTML page

Open `index.html` directly, or start the static preview:

```sh
npm run preview
```

Visit `http://127.0.0.1:8765`. The page:

- Runs Approach 1 locally with the same engine as the command-line package.
- Downloads configurations for any of the four approaches.
- Imports version 3 output JSON from all four approaches, including incomplete runs.
- Shows the same network before and after communication, the accepting count at each
  completed step, generated messages, request durations, and available charges.
- Exports browser runs for further analysis.

For Approaches 2–4, run Node.js with your credentials, then load its saved JSON into
the page. The page does not substitute mock decisions for live models. It uses no CDN
or external JavaScript dependency. The preview serves only the page and its three assets;
`.env`, Git data, and output files cannot be downloaded from the preview server.

## Simulation rules

1. Initialize humans on a ring, connect each to `k/2` neighbors on each side, and rewire
   each original edge with probability `p`. Self-links and duplicate human edges are excluded.
2. All humans reject the rumor and start at score zero. Each fixed-role bot draws three
   to five human contacts **with replacement**, keeping the same contacts throughout the run.
3. In every step, process rumor bots, counter-rumor bots, then humans. Decide whether
   each sends once. A human who accepts sends rumor information; a rejecting human sends
   counter-rumor information. Bots keep their assigned category.
4. Send each message to all of the sender's contacts. A repeated bot contact causes a
   repeated delivery. Every rumor delivery adds one to the recipient's pending score;
   every counter-rumor delivery subtracts one. There are no extra attention, sharing,
   or persuasion decisions.
5. Apply all score changes together at the end of the step. At score `>= flipThreshold`,
   the human accepts; at score `<= -flipThreshold`, the human rejects. Between thresholds,
   keep the previous belief. Scores persist without decay. Three is an illustrative
   threshold, not an empirical estimate.
6. Save messages, sending decisions, scores, and beliefs. Model-based decisions in the
   next step receive the human's new state and messages from the previous completed step.
7. Complete the full horizon even after unanimous acceptance. Report the human count
   after step 20 as `acceptingCountAt20`; bots never enter that count.

Changing wording alone does not change the score update. The controller assigns the
category. Inspect generated text for consistency with that category. With identical
probability settings and successful generation requests, Approaches 1 and 2 have
identical beliefs and deliveries; Approach 2 adds sentences.

## Parameters

| Parameter | Default | Meaning |
| --- | --- | --- |
| `mode` | `probability` | One of the four values above |
| `n` | 30 | Human population |
| `k` | 4 | Initial human-network degree; even and smaller than `n` |
| `p` | 0.15 | Rewiring probability |
| `maxTicks` | 20 | Steps to complete |
| `flipThreshold` | 3 | Positive acceptance and negative rejection limits |
| `rumorBots` | 6 | Fixed bots promoting the rumor |
| `counterRumorBots` | 6 | Fixed bots opposing the rumor |
| `seed` | 42 | Network, bot contacts, and action randomness |
| `runs` | 1 | Replications; successive runs use successive seeds |
| `sendingProbabilities` | See below | Role-specific probabilities in Approaches 1 and 2 |
| `claim` | The community event result was manipulated. | Claim supplied to models |
| `callBudget` | 2000 | Maximum total action and generation attempts per live run |
| `jevThreshold` | 0.5 | Jev probability required to send |
| `jevModel` | `typesafe/jev-1.14` | Jev model identifier |
| `generationTemperature` | 0.9 | LLM message sampling |
| `judgmentTemperature` | 0.3 | LLM action sampling |
| `generationTokenLimit` | 1800 | Message completion limit |
| `judgmentTokenLimit` | 4000 | Action completion limit |
| `outputDir` | `outputs` | Destination for new result files |

Default sending probabilities:

```json
{
  "sendingProbabilities": {
    "rumorBot": 0.70,
    "counterRumorBot": 0.45,
    "acceptingHuman": 0.35,
    "rejectingHuman": 0.30
  }
}
```

Partial overrides are allowed. The same initialized contacts are used across all modes
for a given seed and population. Model decisions can differ between repeated requests;
a seed does not make model responses deterministic.

## Outputs and incomplete runs

Version 3 outputs identify `specification: "signed-exposure-v1"` and the selected
approach. Each run includes the network, initial state, state after every completed step,
messages and recipient lists, sending decisions, request logs, and final counts.

- `acceptingCountAt20` is `null` unless step 20 was completed.
- `acceptingCountAtHorizon` is `null` unless the configured horizon was completed.
- `finalAcceptingCount` describes the last completed step, even in an incomplete run.
- `summary` calculates means and sample SDs using completed runs only.

If the request allowance is exhausted during a step, no state change from that partial
step is committed. `incompleteStep` retains its messages and decisions, and request logs
mark those requests `committed: false`; their durations and charges still count.
An exhausted allowance never forces the rest of the decisions to false.
Malformed model responses and provider errors stop the run with an error instead of
silently fabricating decisions. Outputs omit credentials and raw provider error bodies.

## Programmatic use and tests

```js
const { simulate } = require('./src/index.cjs');
// Inside an async function or a compatible REPL:
const result = await simulate({ mode: 'probability', n: 30, runs: 5 });
console.log(result.runs.map(run => run.acceptingCountAt20));
```

Run `npm test` for regression, shared-rule, synchronous-update, allowance, configuration,
CLI, and provider checks. Tests use fake providers and make no model requests.

## Changes from version 2

Version 3 replaces the older receipt, forwarding, and persuasion decisions with the
single sending decision described above. `probability-llm` is the new second approach.
Direct bot counts replace ratio-based configuration; legacy `alpha1` and `alpha3` inputs
are converted to counts, but nonzero `alpha2` is rejected because reactive correction is
not part of this model. Legacy model names `probability`, `llm`, and `jev` remain valid
but now execute the version 3 rules. Previous output files are left untouched. Their
belief counts must not be pooled with version 3 results, and the HTML viewer identifies
them as unsupported rather than displaying them under the new rules.
