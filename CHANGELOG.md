# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [v1.1.0] - 2026-08-10

### Added

- A YAML config file as the single source of options, shared by
  `report` and `compile`: `--config <path>` selects it, else
  `./config.yaml` is auto-loaded from the working directory when it
  exists. Top-level keys apply to both commands, `report`-only keys
  sit next to them, and `compile`-only keys live under a nested
  `compile` section; unknown keys are rejected.
- `${ENV_VAR}` references in the config are expanded from the
  environment — with a `.env` file auto-loaded at startup — before
  YAML parsing, so the LLM provider configuration and API key stay out
  of version control.
- Identity merging at report time via the `users-map` key (an
  `email: name` mapping): emails mapping to the same display name merge
  into one identity during analysis.
- Per-repository analysis via a structured `repos` entry
  `{ repo, branch?, base-branch?, ignore? }`: `branch` analyzes that
  branch instead of the default, `base-branch` scopes a non-default
  branch to the commits not yet on it, and `ignore` excludes
  gitignore-style paths for that repository alone.
- Configurable per-session LLM limits — `llm-max-time` (seconds) and
  `llm-max-turns` — that bound every LLM session and end a runaway
  analysis with a descriptive error instead of running forever. Both
  are unlimited by default.
- An interactive browser viewer of JSON reports (`viewer/`) and its
  publication to GitHub Pages: open the hosted page, drop a
  `report.json` written by `dev-perf report` onto it, and explore the
  report in the browser.

### Changed

- The CLI is reduced to the single `--config` option: `report` and
  `compile` are step selectors, and every functional setting lives in
  the config file. The `DEV_PERF_*` / `DEV_PERF_COMPILE_*`
  environment-variable option layer is removed; `.env` remains only as
  the source for `${ENV_VAR}` expansion.
- `activeDays` in the deterministic per-user metrics is now a sorted
  array of the distinct author dates instead of a count (the count is
  `activeDays.length`). The trend report schema bumps to version 3, so
  reports written by earlier versions must be regenerated.

### Fixed

- Transient git failures — refused or timed-out connections, a
  dropped remote, or a partial clone whose on-demand blob fetch
  fails — are retried with backoff before the analysis fails, so a
  short network hiccup no longer discards the whole run's
  deterministic analysis.
- When a partial clone's on-demand blob fetch fails mid-analysis, the
  repository is re-cloned once as a full clone instead of aborting
  the whole report.

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

[unreleased]: https://github.com/ameshkov/dev-perf/compare/v1.1.0...HEAD
[v1.1.0]: https://github.com/ameshkov/dev-perf/compare/v1.0.0...v1.1.0
[v1.0.0]: https://github.com/ameshkov/dev-perf/releases/tag/v1.0.0
