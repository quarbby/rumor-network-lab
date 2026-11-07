# jev_botsim experiment results

A scoped-down reproduction of three of BotSim's five experiments (Ng & Carley,
*JASSS* 2025, "Mitigating the Formation of Conspiratorial Societies with
Useful Bots"), run against the jev-gated mechanics in `experiment.cjs` (a
headless port of `botsim.js`'s network + four-stage tick loop, with a seeded
RNG for reproducibility). Raw output: `results.json`, `results.csv`. Rerun with
`node experiment.cjs`.

**This is not the paper's scale.** Per instruction, only a light set of runs
was executed — see "Deviations from the paper" below before reading anything
here as a replication.

## What was run

| | This run | BotSim (paper) |
|---|---|---|
| Population | 300 humans | 1,000 humans |
| Network | Watts-Strogatz, k=6, p=0.05 | Watts-Strogatz, p=0.05 (k unspecified in the source) |
| Replications per condition | 8 | 15 |
| Grid resolution | 6 points per sweep | 10 points per sweep |
| Experiments run | 1, 2, 3 (single-parameter sweeps) | 1–5 (sweeps + two 10×10 grids) |
| Decision mechanism | jev-mock `Noul` gate per Generate/Consume/Propagate/Update step | fixed Pg/Pc/Pp + raw exposure counter |
| Flip threshold | 6 cumulative persuasive exposures | 72 cumulative Bad exposures |

Experiments 4 and 5 (the 10×10 parameter-interaction grids) were **not run**
— those are 100 conditions each in the paper and weren't part of this pass.

## Experiment 1 — Bad Bots alone (α₂ = α₃ = 0)

| α₁ (Bad Bots / humans) | Majority-reached rate | Mean ticks to majority | All-Bad reached rate | Mean ticks to all-Bad | Mean final Bad fraction |
|---|---|---|---|---|---|
| 0.10 | 0% | — | 0% | — | 0.302 |
| 0.28 | 100% | 32.6 (±2.2) | 0% | — | 0.830 |
| 0.46 | 100% | 16.5 (±0.9) | 0% | — | 0.984 |
| 0.64 | 100% | 10.6 (±0.7) | 87.5% | 78.7 (±11.9) | 0.999 |
| 0.82 | 100% | 8.1 (±0.3) | 100% | 54.4 (±5.9) | 1.000 |
| 1.00 | 100% | 6.4 (±0.5) | 100% | 39.3 (±7.2) | 1.000 |

**Finding:** clean, monotonic dose-response. More Bad Bots relative to the
human population both makes a Bad-Human majority *more certain* (0%→100%
majority-reached rate between α₁=0.10 and α₁=0.28) and *faster* (32.6→6.4
mean ticks as α₁ rises from 0.28→1.0). This qualitatively matches BotSim's
own baseline-threat finding (Experiment 1 in the paper): left unchecked, Bad
Bots reliably tip the population toward conspiracy, and more bots tip it
faster.

## Experiment 2 — Info-Correction Bots at fixed α₁ = 0.2

| α₂ (Correction Bots / Bad Bots) | Majority-reached rate | Mean ticks to majority | Mean final Bad fraction |
|---|---|---|---|
| 0.0 | 100% | 60.5 (±5.5) | 0.646 |
| 0.3 | 100% | 73.9 (±6.8) | 0.579 |
| 0.6 | 75% | 80.2 (±12.3) | 0.540 |
| 0.9 | 0% | — | 0.458 |
| 1.2 | 0% | — | 0.439 |
| 1.5 | 0% | — | 0.381 |

**Finding:** adding Info-Correction Bots monotonically reduces both how often
a Bad-Human majority forms (100%→0% across the swept range) and how bad
things get when it doesn't fully flip (final Bad fraction 0.646→0.381). This
is the same direction as BotSim's finding that Info-Correction Bots mitigate
Bad-Bot damage.

## Experiment 3 — Good Bots at fixed α₁ = 0.2

| α₃ (Good Bots / Bad Bots) | Majority-reached rate | Mean ticks to majority | Mean final Bad fraction |
|---|---|---|---|
| 0.0 | 100% | 59.8 (±4.8) | 0.643 |
| 0.4 | 100% | 77.9 (±6.5) | 0.560 |
| 0.8 | 50% | 88.5 (±5.8) | 0.497 |
| 1.2 | 0% | — | 0.427 |
| 1.6 | 0% | — | 0.360 |
| 2.0 | 0% | — | 0.329 |

**Finding:** Good Bots also monotonically suppress the conspiracy outcome,
and by inspection the final-Bad-fraction decline across the swept range looks
close to linear (0.643→0.329, roughly –0.16 per unit of α₃ per step).

## Where this reproduction agrees and disagrees with BotSim

**Agrees:** the direction of every effect matches the paper — more Bad Bots
is worse and faster; both useful-bot types monotonically reduce the
conspiracy outcome; nothing here contradicts BotSim's qualitative claims.

**Does not clearly reproduce:** the paper's headline comparative finding is
that Good Bots scale *nearly linearly* in effectiveness while Info-Correction
Bots show *diminishing returns*, making Good Bots the more resource-efficient
intervention. At this reduced scale (n=300, 8 reps, 6-point grids), the two
mitigation curves here look similar in shape and slope — Experiment 2's final
Bad fraction drops ~0.265 over its swept range, Experiment 3's drops ~0.314
over a larger range, giving comparable per-unit slopes (~0.17 vs ~0.16). The
paper's sharper Good-Bot-vs-Correction-Bot contrast is a 10×10 interaction
finding (Experiments 4–5) with fitted quadratic response surfaces over 100
conditions × 15 reps; a 6-point single-parameter sweep at 8 reps is very
unlikely to resolve a curvature difference that subtle, so this result should
be read as "not enough resolution to see it" rather than "the effect isn't
there."

## Caveats

- **Not the paper's decision mechanism.** Every Generate/Consume/Propagate/
  persuasion step here is a calibrated *mock* `judge()` (weighted
  pseudo-random draw), not a real call to jev's `Noul` primitive or to the
  paper's fixed-probability rules. Treat this as validating that a jev-gated
  version of BotSim's mechanics *can* reproduce the paper's qualitative
  shape, not as a live-model replication.
- **Flip threshold (6) is not a rescaled 72.** The paper's t=72 is a raw
  exposure count; this uses a jev-persuasion-weighted running score, so the
  two thresholds aren't on the same scale and the absolute tick counts above
  aren't comparable to the paper's reported tick counts — only the shapes of
  the curves are.
- **k=6** for the Watts-Strogatz network was chosen because the paper excerpt
  available didn't specify the initial ring degree, only p=0.05 and "high
  local clustering, small characteristic path length."
- Small n (8 reps) means the noisier transition points (e.g. Experiment 2's
  α₂=0.6 majority-reached rate of 75%, sitting between two more decisive
  neighbors) could shift with more replications.
