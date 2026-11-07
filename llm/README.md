# LLM experiments

Run all commands from the repository root; see the root README for configuration and results.

- `personas.js`: fictional scenario and message prompts.
- `config.js`: repository `.env` and process-environment configuration.
- `generate.js`: local LM Studio/OpenRouter request transport and usage tracking.
- `judge-real.js`: Boolean judgment prompts, parsing, and fallback.
- `run-demo.cjs`: conversation demonstration, including reactive corrections.
- `experiment3-llm.cjs`: GLM-generation sweep with probability-based decisions.
- `experiment3-full-real.cjs`: two-tier sweep using the configured LLM for both tasks.
- `transcript.json`, `transcript-data.js`, `transcript.md`: saved conversation outputs.
- `replay-texts.js`: saved message queue for API-free demonstration replay.
- `experiment3-*-results*.json`: original experimental checkpoints.

Live scripts write into this directory. Preserve the supplied checkpoints before rerunning
experiments. The default two-tier checkpoint contains Qwen results; move it aside before
running a different configuration. Aggregate checkpoint usage can include calls beyond
completed runs; `analysis/audit_manuscript_results.cjs` reports both counts.

Configuration also accepts the legacy variable names `llm_provider`, `local_llm_model`,
`local_llm_base_url`, `openrouter_text_model`, and `open_router`. No external sibling project
or private configuration file is required.
