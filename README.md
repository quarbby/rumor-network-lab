# Rumor Network Lab

Code and data for *Using AI to Simulate Information Diffusion* by Lynnette Hui Xian Ng.
The model connects individual beliefs, network exposure, and messages from rumor-spreading,
correction, and proactive actors. The examples use a fictional singing contest.

## Try the browser demonstrations

Open `rumor_network_lab.html` for the interactive lab, `index.html` for the probability-based
network demonstration, or `index_llm.html` to replay the included LLM conversation. No build
or API key is needed. The lab optionally loads fonts from Google Fonts.

Alternatively, serve the directory with `python3 -m http.server 8000` and visit
`http://localhost:8000/rumor_network_lab.html`.
The replay page displays saved messages; it does not issue model requests from the browser.
Browser illustrations and batch experiments use different population settings.

## Reproduce the manuscript checks

Use Node.js 20 or newer. The Node scripts have no third-party dependencies.

```sh
npm test
npm run audit
```

The audit replays all 144 seeded probability-baseline runs and checks the stored summaries.
It also compares 48 pairs with correction versus proactive roles and verifies completed-run
counts and usage totals in the LLM checkpoints. It makes no model requests and writes
`analysis/results_audit.json`. All 144 summaries reproduce exactly, and all 48 role pairs
are identical because the baseline assigns both supportive roles the same rules.

To regenerate the figures, install Python plotting dependencies and run:

```sh
python3 -m pip install -r requirements.txt
python3 analysis/figures/generate_paper_figures.py
```

The generator reads the supplied data and audit, checks baseline source/data hashes,
and writes vector PDF figures to `analysis/figures/`. To rerun the original probability
sweeps, use `npm run experiment:baseline`; this overwrites `results.json`, `results.csv`,
and `results.md`.

## LLM configuration and execution

Copy `.env.example` to `.env` and select a provider. Process environment variables override
file settings. Local LM Studio requires its OpenAI-compatible server and a loaded model.
OpenRouter requires your own `OPENROUTER_API_KEY`. Never commit `.env`.

```sh
cp .env.example .env
npm run demo:live
# Other live experiments:
npm run experiment:generation
npm run experiment:two-tier
```

These commands invoke the configured model. OpenRouter calls incur provider charges.
Live scripts overwrite their transcript or checkpoint files; use a separate checkout to
preserve the supplied data. The two-tier runner resumes an existing checkpoint, so move
`llm/experiment3-full-real-results.json` aside before starting a different model or setup.
A provider name does not select its model automatically: set the model identifier too.

`npm run demo:replay` reconstructs the default demonstration from saved message text without
model requests. It writes the transcript files. Live demonstration ratios can be set with
`ALPHA1`, `ALPHA2`, and `ALPHA3`; replay uses its fixed original roster.

## Included results and interpretation

| Configuration | Data file | Completed runs |
| --- | --- | ---: |
| Probability baseline | `results.json` | 144 |
| GLM message generation with probability decisions | `llm/experiment3-llm-results.json` | 16 |
| GLM generation and judgments | `llm/experiment3-full-real-results.GLM53FLASHX.json` | 3 |
| Qwen generation and judgments | `llm/experiment3-full-real-results.json` | 8 |

GLM-5.3-FlashX ran through OpenRouter; Qwen2.5-7B-Instruct-1M ran through local LM Studio.
Generation used temperature 0.9 and a 1,800-token completion limit. Judgment used temperature
0.3 and a 4,000-token limit. The completed Qwen runs issued no generation calls because
speaking decisions remained false. All three completed GLM two-tier runs exhausted their
60-call allowance; the controller subsequently returns false at remaining decision gates.
These mechanisms matter when interpreting zero rumor acceptance.

The baseline represents messages as polarity labels. Its correction and proactive roles
have identical rules. The live demonstration implements a separate rumor-triggered reply.
GLM generation also changes speaking and exposure-update rules relative to the baseline;
the configurations do not isolate wording effects.

## Measured Jev benchmark

An additional live benchmark uses GLM for message generation and Jev 1.14 through
OpenRouter's Decisions API for judgments. It runs ten humans, two rumor-spreading actors,
one proactive actor, three steps, and seed 42. A Jev `noul` probability of at least 0.5
produces a positive action. The run generates one message and makes 45 decisions.

We then replay the same 45 contexts through GLM sequentially. The measured request totals
are 3.30 seconds for message generation, 19.17 seconds for Jev decisions, and 153.40 seconds
for GLM decisions. Adding the shared generation time gives 22.47 seconds with Jev and
156.70 seconds with GLM judgments: a 6.97-fold speedup. These are matched-workload inference
totals, not two independent trajectory runtimes. Jev and GLM agree on 19 of 45 decisions;
speed does not establish equivalent behavior. There were no malformed GLM replies.

The benchmark supersedes the earlier figure based on assumed latency. Historical baseline,
GLM, and Qwen checkpoints remain unchanged. The live timing evidence, including request
contexts, responses, and timings, is in `analysis/results_jev_benchmark.json`.
The frozen simulation source used for this benchmark is in `analysis/benchmark_inputs/`.

To repeat it with your own OpenRouter credentials, set `OPENROUTER_API_KEY` or configure
it in the repository `.env`, then run `node analysis/benchmark_jev.cjs`. This makes live,
billed requests and overwrites the benchmark JSON. Generation uses temperature 0.9 and
1,800 output tokens; GLM judgments use 0.3 and 4,000 tokens. Calls are sequential with a
45-second deadline and no retries. The original probability baseline still uses weighted
random rules; it does not call Jev.

## Files

- `experiment.cjs`: original seeded baseline runner, preserved for reproducibility.
- `botsim.js`: browser probability simulation.
- `llm/`: prompts, model transport, judgment adapter, live experiments, saved outputs, replay.
- `analysis/`: manuscript audit and figure generator.
- `tests/`: isolated configuration checks; no external inference.
- `requirements.txt`: optional Python figure dependencies.

The source retains historical identifiers such as `badBot` and `goodBot` so the original
simulation and result hashes remain reproducible. The guide describes their roles as
rumor-spreading and proactive actors.

The implementation draws on agent-based diffusion modeling and the LAND architecture.
Related work: Lynnette Hui Xian Ng and Kathleen M. Carley, *Modeling Social Dynamics with
an LLM-Enabled Agent Based Network-Dynamic (LAND) Model* (2026),
https://arxiv.org/abs/2608.00929; and *Bots, Bias, and Influence: The Hidden Architects of
Social Media* (Cambridge Scholars Publishing, 2026), ISBN 9781036473112.
