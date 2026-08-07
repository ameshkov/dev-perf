# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `compile.report` config key: the input JSON report file for the
  `compile` step (replaces the `compile <report>` positional argument).
- A YAML config file shared by `report` and `compile`: `--config <path>`
  selects it, else `./config.yaml` auto-loads from the working directory
  when it exists, and the config file is the single source of options.
  Top-level keys apply to both commands (repos, users-map, verbose);
  `compile`-only keys live under a nested `compile` section (`report`,
  `output`, `include-users`, `exclude-users`, `exclude-repos`).
  `${ENV_VAR}` references inside the file are expanded from the
  environment (a `.env` file provides them), so the LLM provider
  configuration and API key stay out of version control;
  `config.example.yaml` is the starting template.
- `report` now merges author identities at report time through the
  config `users-map` key (an `email: name` mapping): emails mapping to
  the same display name merge into one identity under that name during
  analysis, so deterministic metrics are exact, the LLM layer runs one
  session per merged person (naming every email of the identity, so a
  merged person's commits are analyzed as one contributor), and the
  JSON report carries the full `emails` list for each identity.
- Per-repository branch selection: append `#branch` to a `repos` config
  entry to analyze that repository's given branch instead of its
  default — every repository of a run can pick its own branch
  (`https://github.com/org/repo.git#dev` analyzes the `dev` branch
  alone). Each branch is cached under its own cache entry, so switching
  branches never reuses the wrong clone, and the report entry records
  the analyzed branch.

### Changed

- The CLI is reduced to the single `--config` option: `report` and
  `compile` are step selectors (exactly one step per run) and every
  functional setting lives in the config file. All `report` flags
  (`--since`, `--until`, `--unit`, `--output`, `--cache-dir`,
  `--refresh`, `--no-llm`, `--model`, `--provider-url`, `--api-key`,
  the `limit-*` keys, `--llm-retries`, `--map`, `--parallel`,
  `--verbose`) and the `[repo...]` positional were removed, as were the
  `compile` flags (`--output`, `--map`, `--include-user`,
  `--exclude-user`, `--repo`, `--exclude-repo`) and its `<report>`
  positional (see `compile.report` above).
- Every command run now logs start/end markers to stderr — `starting
  report` then `finished report in <ms> ms` (and the same for
  `compile`) — bracketing the command's execution so its beginning and
  end (with duration) are always visible in the log, even without
  verbose.
- Configuration moved from the `DEV_PERF_*` / `DEV_PERF_COMPILE_*`
  environment variables to the YAML config file. The `DEV_PERF_*`
  option layer is removed; `.env` remains only as the source for
  `${ENV_VAR}` expansion inside the config. `--maps-file` is replaced
  by the config `users-map` key, and the `compile` `<report>` argument
  is replaced by the `compile.report` config key.

### Fixed

- A `repos` entry with a `#branch` suffix (e.g.
  `https://github.com/org/repo.git#dev`) no longer silently drops every
  repository from the `compile` output: the `#branch` suffix is stripped
  before the repo selection is matched against the report entries, so
  the same branch-qualified `repos` config works for both `report` and
  `compile`.
- The `finished report in <ms> ms` / `finished compile in <ms> ms` end
  marker is now logged for failed runs too, so the start/end marker pair
  brackets every run even when it errors.
- A `${ENV_VAR}` reference whose value contains `#` or a newline now
  fails loudly at config load instead of silently corrupting the
  parsed config (a `#` would truncate the value as a YAML comment, a
  newline could inject extra keys).
- `users-map` display names may now contain commas: config mappings are
  parsed straight from the YAML instead of being re-split like
  comma-separated lists (which mangled names such as `Doe, John`).
- `--config ""` is treated as no config file, so the `config.yaml`
  autoload still applies.
- Validation errors always name the config key the value came from
  (`compile.include-users`, `compile.exclude-repos`, `users-map`,
  `provider-url`, ...) — there are no CLI flags to name anymore, and
  the missing-`api-key` error points to the `api-key` config key as the
  source.

## [v1.0.0] - 2026-08-06

### Added

- Initial release of `dev-perf`, a CLI tool that measures developer
  contributions to git repositories (any git URL or local path) over a
  date range and produces a JSON report of per-user metrics.
- Two-layered analysis per user: deterministic metrics counted straight
  from git history (commits, lines added/removed, files touched, churn,
  active days, per-language contribution sizes) merged with an LLM-based
  agentic layer that assesses what cannot be counted (work types,
  complexity, impact areas, quality signals).
- Fully in-process LLM analysis via the
  `@earendil-works/pi-coding-agent` library — no spawned server.
  Provider, model, and API key are always passed explicitly
  (`--model`, `--provider-url`, `--api-key` or the `DEV_PERF_*`
  environment variables); the user's global configuration is never
  read. Results are cached on disk and reused on reruns; `--refresh`
  forces a re-clone and invalidates the cache.
- Command-based CLI: the `report` command builds the JSON report, the
  `compile` command renders it into a markdown report with Vega-Lite
  SVG charts (team dynamics, per-repository and per-user charts, LLM
  summary pies, tables, appendix), and `version` prints the application
  version.
- Time-based period reports: `--unit day|week|month|quarter|year`
  splits the range into consecutive UTC-aligned periods, each with its
  own full per-repository report.
- Parallel analysis of multiple repositories with `--parallel <n>`, and
  automatic retry of failed LLM analyses with `--llm-retries <n>`.
- Environment-variable configuration: every `report` option has a
  `DEV_PERF_*` equivalent and every `compile` option a
  `DEV_PERF_COMPILE_*` one, and a `.env` file is auto-loaded at
  startup.
- A Docker image published to `ghcr.io/ameshkov/dev-perf` for both
  `linux/amd64` and `linux/arm64`, sandboxing the analysis away from
  the host.

[unreleased]: https://github.com/ameshkov/dev-perf/compare/v1.0.0...HEAD
[v1.0.0]: https://github.com/ameshkov/dev-perf/releases/tag/v1.0.0
