# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A YAML config file as the single source of options, shared by
  `report` and `compile`: `--config <path>` selects it, else
  `./config.yaml` is auto-loaded from the working directory when it
  exists. Top-level keys apply to both commands (`repos`, `users-map`,
  `verbose`), `report`-only keys sit next to them (`since`, `until`,
  `unit`, `output`, `cache-dir`, `refresh`, `llm`, `model`,
  `provider-url`, `api-key`, the `limit-*` keys, `llm-retries`,
  `parallel`), and `compile`-only keys live under a nested `compile`
  section (`report`, `output`, `include-users`, `exclude-users`,
  `exclude-repos`). Unknown keys are rejected.
- `${ENV_VAR}` references in the config are expanded from the
  environment — with a `.env` file in the working directory
  auto-loaded at startup — before YAML parsing, so the LLM provider
  configuration and API key stay out of version control. An unset or
  empty variable errors out at load.
- Identity merging at report time via the `users-map` key (an
  `email: name` mapping): emails mapping to the same display name
  merge into one identity during analysis — deterministic metrics are
  exact, the LLM runs one session per merged person, and the JSON
  report carries the full `emails` list of the identity.
- Per-repository analysis via a structured `repos` entry
  `{ repo, branch?, base-branch?, ignore? }`:
    - `branch` analyzes that repository's branch instead of its
      default; each branch is cached under its own cache entry, and
      the report entry records it.
    - `base-branch` scopes a non-default branch to the commits not yet
      on the base (per-release attribution); it defaults to the
      repository's own default branch (from `origin/HEAD`, then `main`
      before `master`), an explicit `base-branch` overrides it, and
      `''` restores full history. The report entry records the resolved
      `baseBranch`.
    - `ignore` excludes gitignore-style paths for that repository
      alone: commits whose files all fall under ignored paths are
      dropped, and a mixed commit keeps only its non-ignored files, in
      both the deterministic metrics and the LLM analysis. The report
      entry records `ignoredPaths`.
- Always-visible stderr start/end markers for every command
  (`starting report` / `finished report in <ms> ms`, and the same for
  `compile`), logged even when the run fails.
- The LLM result cache is now keyed by the clone's head and resolved
  base commit shas (plus branch and ignored paths), so an advancing
  branch or base re-runs the analysis instead of reusing a stale result.

### Changed

- The report's `parameters.repos` and the startup configuration dump
  record each analyzed repository as a full spec — the clone target
  plus the branch, base scoping, and ignored paths — instead of a bare
  URL string, so entries analyzing the same repository differently
  (e.g. at different branches) are distinguishable; `compile` still
  reads older reports whose entries were plain strings.
- The README is shortened: the full configuration reference moved to
  `docs/configuration.md` and the README shows a simple configuration
  instead.
- The CLI is reduced to the single `--config` option: `report` and
  `compile` are step selectors, and every functional setting lives in
  the config file. All `report` flags and the `[repo...]` positional,
  and all `compile` flags and its `<report>` positional, were removed.
- The `DEV_PERF_*` / `DEV_PERF_COMPILE_*` environment-variable option
  layer is removed; `.env` remains only as the source for `${ENV_VAR}`
  expansion. `--maps-file` becomes the `users-map` config key, and the
  `compile <report>` positional becomes `compile.report`.
- Validation errors name the config key the value came from
  (`compile.include-users`, `users-map`, `provider-url`, ...) instead
  of CLI flags.
- Scoped per-repository log labels carry the analyzed branch
  (`repo#branch`) instead of an order-based suffix.
- The default base branch prefers the repository's own default
  (resolved from `origin/HEAD`) before a stale leftover `master`; an
  unresolvable *default* base is logged at info instead of warning on
  every run, while an unresolvable *configured* base still warns.

### Fixed

- The committed `config.example.yaml` now sets `compile.report`, so a
  `compile` run against the copied example config no longer fails with
  `compile.report: the report file is required`.
- A `${ENV_VAR}` value containing `#` or a newline fails loudly
  instead of silently corrupting the parsed YAML.
- `users-map` display names may contain commas: mappings are parsed
  straight from the YAML instead of being re-split like
  comma-separated lists.
- `--config ""` counts as no config, so the `config.yaml` autoload
  still applies.
- Ignored-path matching matches git: a trailing `/` or `**` excludes a
  directory subtree only (never a file sharing the name), a middle
  `**` never matches a concatenated path, consecutive `**` segments
  behave as one, and pattern whitespace is trimmed.
- `git commit --allow-empty` commits are not dropped by ignore
  filtering.
- Two `repos` entries analyzing the same repository/branch with
  different ignore lists or base scoping are no longer treated as
  duplicates; concurrent clones of one cache entry are serialized so a
  parallel run never re-clones the same directory twice.
- A camelCase `base` key on a structured `repos` entry is rejected
  loudly — `base-branch` is the only valid spelling.
- A genuine git failure while resolving the base branch surfaces as an
  error instead of being mistaken for a missing base and silently
  analyzing full history.
- Branch names and ignored-path patterns are escaped and normalized
  before being rendered into the LLM prompts, so a repository-derived
  value cannot break out of quoting or code spans.
- When ignored paths exclude a repository's entire history, the run
  warns naming the repository instead of quietly producing an empty
  entry.

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
