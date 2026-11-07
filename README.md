# Rumor Network Lab

A small, parameter-driven Node.js package for simulating information diffusion.
Edit a JSON file to set the population, network, actor composition, belief rules,
and number of runs. Run the simulator to generate your own outcomes and belief histories.

## Quick start

Install Node.js 20 or newer, then clone the repository:

```sh
git clone https://github.com/quarbby/rumor-network-lab.git
cd rumor-network-lab
npm run simulate
```

The default probability simulation needs no API key or dependency installation.
It reads `config/simulation.json` and writes a new JSON file into `outputs/`.
Edit the parameter file and repeat the command to run a different scenario.
To use another file:

```sh
npm run simulate -- path/to/parameters.json
```

## Parameters

| Parameter | Meaning |
| --- | --- |
| `mode` | `probability`, `llm`, or `jev` |
| `n` | Number of human agents |
| `k` | Initial human-network degree; even and smaller than `n` |
| `p` | Small-world rewiring probability, between zero and one |
| `maxTicks` | Maximum interaction steps |
| `flipThreshold` | Positive/negative exposure threshold for belief change |
| `alpha1` | Rumor-spreading actors divided by human agents |
| `alpha2` | Correction actors divided by rumor-spreading actors; probability mode only |
| `alpha3` | Proactive actors divided by rumor-spreading actors |
| `seed` | Initial random seed; successive replications use successive seeds |
| `runs` | Number of independent replications |
| `callBudget` | Maximum generation plus judgment requests per live run |
| `jevThreshold` | Jev probability needed for a positive action, default 0.5 |
| `jevModel` | Jev model identifier, default `typesafe/jev-1.14` |
| `generationTemperature` | Message-generation temperature, default 0.9 |
| `judgmentTemperature` | Generative-model judgment temperature, default 0.3 |
| `generationTokenLimit` | Message-generation completion limit, default 1,800 |
| `judgmentTokenLimit` | Generative-model judgment completion limit, default 4,000 |
| `outputDir` | Directory for generated output, default `outputs/` |

Omitted parameters use the defaults in `src/index.cjs`. Unknown parameters and invalid
settings produce an error before simulation. Actor counts are rounded to integers.
For example, `n=10`, `alpha1=0.2`, and `alpha3=2` gives two rumor-spreading and four proactive actors.

## Model mechanics

Humans start by rejecting the rumor with an exposure score of zero. They connect through
an undirected small-world network. Fixed-role actors each draw three to five human contacts
with replacement and keep those contacts throughout a run. Repeated draws allow repeated
exposures to the same human. In each step, actors decide whether to produce information,
share it along their communication links, and attend to incoming information. Persuasive
rumor exposures increase a human's score; supportive exposures decrease it. The positive
threshold changes belief to rumor acceptance; the negative threshold changes it to rejection.
Between thresholds, the previous belief persists. Scores have no decay or bound.

Humans share their own information from the current step. They do not forward received
messages directly. The contact graph stays fixed. The probability model represents information
by rumor/supportive labels and uses seeded random decisions. Correction and proactive roles
use the same supportive rules in that baseline. The live model implements rumor-spreading
and proactive actors; it does not implement reactive correction, and rejects nonzero `alpha2`.

## Live LLM and Jev runs

Copy `.env.example` to `.env` and configure your provider:

```sh
cp .env.example .env
npm run simulate -- examples/llm.json
# Or use Jev for decisions, keeping the configured LLM for messages:
npm run simulate -- examples/jev.json
```

`llm` uses an OpenAI-compatible local LM Studio server or OpenRouter for both message generation
and judgments. `jev` uses that same generation provider and OpenRouter's Decisions API for judgments;
it requires `OPENROUTER_API_KEY` even when message generation is local. Set `LLM_PROVIDER`, the model
identifier, and credentials in `.env` or process environment variables. Environment variables take precedence.
No credential is written into the outputs. Calls to paid providers incur their normal charges.

The fictional singing-contest prompts are in `src/personas.cjs`; edit them to change the scenario.
Requests run sequentially with a 45-second timeout and no automatic retries. Invalid responses stop
the run rather than silently replacing model decisions. If the call allowance is exhausted, the simulator
stops and retains the last completed step. Calls made during an incomplete step remain in the usage log,
but that step's state changes are discarded. An allowance does not force remaining actions to false.

## Outputs and reproducibility

Each output includes the complete configuration, per-run seeds, final rumor acceptance,
majority timing, and belief fractions over completed steps. Live outputs also contain
message prompts, generated messages, decision contexts and answers, model identifiers,
request durations, and provider usage. New files receive unique names; earlier outputs are preserved.
`outputs/` is ignored by Git. Archive your generated output to retain the response stream for a live run.
A seed reproduces the probability model; it does not make remote LLM responses deterministic.

This package preserves the original probability model's action and exposure rules. The live runner
adds configurable populations and a stop-at-budget policy; it does not reproduce the former behavior
of forcing negative decisions after exhausting an inference allowance.

## Use from code

```js
const { simulate } = require('./src/index.cjs');
const result = await simulate({ n: 30, runs: 5, seed: 42, alpha1: 0.2, alpha3: 1 });
console.log(result.runs.map(run => run.finalBadFraction));
```

Use this snippet inside an async function or a compatible REPL. A loop over configurations
can implement a parameter sweep. Call `npm test` for configuration, determinism, budget,
and command-line checks; tests make no model requests.

Related methods: Ng and Carley, *Modeling Social Dynamics with an LLM-Enabled Agent Based
Network-Dynamic (LAND) Model*, https://arxiv.org/abs/2608.00929.
