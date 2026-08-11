# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A per-repository `ignore-commits` option on structured `repos`
  entries that drops specific commits from that repository's analysis:
  `hashes` excludes commits by full or abbreviated hash (matched as a
  case-insensitive prefix of the commit's sha), `messages` excludes
  commits whose subject matches a case-insensitive regular expression.
  Excluded commits are dropped before both the deterministic metrics
  and the LLM analysis (the LLM is told which commits are excluded),
  and each report entry records the `ignoredCommits` when any were
  configured.

### Changed

- Auto-generated files — dependency lock files (`pnpm-lock.yaml`,
  `yarn.lock`, `package-lock.json`, `composer.lock`, `Cargo.lock`,
  `Gemfile.lock`, `poetry.lock`, `go.sum`, `Package.resolved`, …),
  test snapshots (`*.snap`), minified/source-map and named build
  artifacts, vendored dependency subtrees (`node_modules/`, Go
  `vendor/`), and compiler/designer codegen output — are no longer
  counted in the per-language stats. A `composer.lock` or
  `pnpm-lock.yaml` no longer inflates `Unknown` or `YAML` (and the
  other language buckets) with hundreds of thousands of generated
  lines. Their lines and file touches are still counted in the
  aggregate totals and reported separately as the per-user and
  per-repository `generated` stat, and the `compile` command and the
  viewer surface them (executive-summary "Generated files" row,
  per-user "Generated lines", viewer author chip) so dependency-churn
  activity stays visible. See the design doc §5.5.
- Repositories are now cloned in full (`git clone`, no partial-clone
  filter), so every blob is local right after the clone and the whole
  analysis — reading commits (`git log --numstat`), resolving the
  branch-delta base, and the LLM reads — runs fully offline and never
  touches the remote. The previous partial clone fetched missing blobs
  lazily, one network connection per blob, which made the commit read
  depend on remote connectivity and fail with `Connection refused` when
  the host throttled or the network dropped; a full clone removes that
  failure mode entirely at the cost of the blobs transferring up front.
  A cached partial clone from an older version is detected and re-cloned
  as a full clone once.
- The `Commits per period, one line per repository` chart (and the
  viewer's `Commits per repository` chart) now shows the full commit
  count of a repository that is analyzed on several branches: when the
  same repository URL appears with different branches, each period's
  point sums the branches instead of showing only the first branch's
  commits, so the timeline matches the repository's total.
- Git operations now run under a per-command timeout (5 minutes by
  default): a git command that hangs instead of completing — e.g. a
  `git log --numstat` over a huge history — is killed and fails the
  analysis with a `git ... timed out after N s` error, just like any
  other git failure, instead of blocking the run forever.
- The viewer's `Commits per repository` chart now spans the full
  chart width, and its filter shows the short repository name (the
  last path segment, as in the chart legend) instead of the full
  clone URL; hovering a chip still shows the full URL.
- The viewer's `Top languages per period` and `Languages per
  period` charts (team and individual dynamics) now span the full
  chart width, like the `Commits per repository` and per-period
  signal charts, so the stacked language comparison and its tag list
  get more room.
- The viewer's individual dynamics `Contribution sizes` and
  `Complexity distribution` charts are now donut pies with a legend
  and per-slice labels, like the team distributions and the work-type
  share, instead of single bars per category.
- The viewer's intro now links the `dev-perf` name to the project's
  GitHub repository.
- The viewer's meta bar now collapses long repository lists behind a
  single "N repositories" chip that expands on click, and shows one
  chip per analyzed repository spec: when the same repository was
  analyzed with different branches, base branches, or ignore filters,
  each spec gets its own chip with those fields visible next to the
  repository name.
- Contribution points now take complexity into account: the compile
  command's `Weighted points` and the viewer's `Points` charts scale
  each contribution's size weight (xs=1, s=2, m=3, l=5, xl=8) by its
  LLM-assessed complexity multiplier (low=1, medium=1.5, high=2), so
  complex work counts more than large-but-simple work. The appendix
  documents the point weights and multipliers.
- The retry warning for a transient git failure — e.g.
  `git "log" failed ... : Connection refused` — now names the
  repository directory the command ran in
  (`git "log" failed in "..." ...`), so it is clear which repository
  is being retried instead of only that a git command failed.

### Removed

- The `git-parallel-per-host` option is removed: it capped how many
  parallel git operations ran against one remote host, which existed to
  pace the per-blob lazy fetches of a partial clone. Repositories are
  now cloned in full with a single transfer each, so the per-host cap
  is no longer needed (repositories still analyze in parallel up to
  `parallel`).

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
