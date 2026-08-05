# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial release of `dev-perf`, a CLI tool that measures developer
  contributions to git repositories (any git URL or local path) over a
  date range and produces a JSON report of per-user metrics.
- Command-based CLI: `dev-perf report [options] [repo...]` runs the
  analysis and `dev-perf compile <report>` turns the JSON report into a
  markdown report with charts; a bare `dev-perf` invocation prints the
  command list.
- Deterministic analysis counted straight from git history: commits,
  lines added/removed, files touched, churn, active days, and
  per-language contribution sizes, per user (grouped by email with bot
  detection) and per repository.
- LLM agentic analysis (skippable with `--no-llm`): an opencode agent
  with read-only access to the cloned repository inspects the actual
  commits and diffs and assesses what cannot be counted — work types,
  complexity, size, impact areas, quality signals, and risk flags.
  Provider, model, and API key are always passed explicitly; the user's
  global opencode configuration is never read. Failed runs are retried
  automatically with a fresh opencode server, reusing cached per-user
  results; the number of retries is configurable with `--llm-retries
  <n>` / `DEV_PERF_LLM_RETRIES` (default 2; `--llm-retries 0` fails
  fast).
- A single JSON report merging both layers, per repository and per
  user: repository entries are wrapped in a `periods` array (a single
  period covers the whole range without `--unit`), and the report
  includes per-user token usage (with the cached-read split) and
  estimated LLM cost. The report goes to stdout or `--output <file>`.
- Clone and LLM-result caching under `--cache-dir` (default
  `.dev-perf/cache`) with partial-clone fallback and `--refresh` to
  force re-cloning and re-analysis.
- Every CLI option has a `DEV_PERF_*` environment-variable equivalent,
  and every compile option has a `DEV_PERF_COMPILE_*` one, including
  the list options; a `.env` file in the working directory is loaded
  automatically (the flag wins when both are set).
- Verbose (`--verbose`) progress logging for the LLM phase: each
  waiting stage logs its start and long-running operations log a
  periodic "still waiting" line with elapsed time, so a slow or stuck
  model call is visible instead of an endless silent wait.
- Time-based period reports with `--unit day|week|month|quarter|year`:
  the analyzed range is split into UTC-aligned periods and the report
  carries one full per-repository report per period, including empty
  periods with zeroed metrics; the user list is the same in every
  period, and the LLM analysis runs per period for the users active in
  it. `--since` is required when `--unit` is set. Date-only
  `--since`/`--until` values are resolved to UTC midnight so the
  analyzed range — and the LLM result cache keyed on it — stays stable
  across reruns.
- The `compile` command (`dev-perf compile <report> --output <dir>`)
  renders the JSON report into `report.md` plus server-side Vega-Lite
  SVG chart assets: team dynamics (contribution sizes, commits with a
  cumulative line, lines, active users, top languages), per-period
  complexity, risk-flag and quality-signal charts (top 5 flags plus
  `other`, normalized to the share of contributions carrying each
  flag), individual dynamics, LLM distribution pies (work types,
  sizes, complexity) when the report has LLM analysis, tables, and an
  appendix.
- The `compile` command writes one full per-person report per user
  under `people/<slug>.md`: title and summary line, statistics table,
  the complete chart set, the LLM overview, the contributions table,
  risk flags, and per-repository commit counts, with a back-link to
  `report.md`; the individual sections of the main report link to
  these reports.
- The `compile` team dynamics now include per-period bar charts of
  the average number of risk flags and quality signals per
  contribution, so the flag density of the work is visible over time.
- The `compile` individual dynamics sections of the main report now
  show, per person, the contributions per period stacked by complexity
  next to the existing stacked-by-size chart.
- The `compile` per-person reports now duplicate the full team
  dynamics chart set per user: contributions per period stacked by
  size and complexity, commits, lines, top languages, and the
  per-period risk-flag and quality-signal charts (shares of
  contributions and averages per contribution); only the team-level
  active-users chart has no per-user counterpart.
- Compile-time report shaping: `--repo`/`--exclude-repo` narrow the
  repositories, `--include-user`/`--exclude-user` narrow the users (by
  display name or any email), and `--map <email=name>` /
  `--maps-file <path>` merge author emails into a single identity.
  Merged identities sum deterministic metrics (active days take the
  max), concatenate LLM contributions, and repository stats are
  recomputed after filtering.
- The `compile` executive summary lists the analysis period, the
  analyzed repositories (short `host/org/repo` labels) and the included
  people; the totals table has a one-line description column per
  metric, and the LLM cost is shown with the full token breakdown.
- The `compile` per-repository comparison chart ("Commits per period,
  one line per repository") shows just the repository name in its
  legend, since the full `host/org/repo` label does not fit.
- The `compile` team dynamics now include a "Contributions per period
  (bars) and cumulative contributions (line)" chart, placed before the
  commits chart, and the per-person reports and individual dynamics
  sections embed the per-user counterpart — so the LLM contribution
  velocity is visible next to the commit velocity.
- The `compile` team dynamics and individual dynamics now lead with a
  "Points per period (size-weighted)" chart, placed before the stacked
  contributions charts.
- The `compile` team dynamics now include a stacked "Contributions per
  period by work type" chart (multi-type contributions count in each
  of their types), and the per-person reports embed it per user plus a
  per-user "Share of contributions by work type" pie.
- Language detection recognizes a wide range of file types — .NET
  project and resource files, Objective-C, TypeScript module formats,
  C++ variants, Xcode project files, binary blobs, and Go module files
  — so fewer files fall under `Unknown` in per-language statistics.
- Guaranteed CLI exit: once the report is written the CLI flushes
  stdout and shuts the opencode server down, force-killing it with its
  whole process tree when it ignores SIGTERM, so a stuck server can
  neither hang the run nor leak a process.

### Changed

- The `compile` executive summary now reports three separate top
  contributors and three separate busiest periods — by commits, by LLM
  contributions, and by weighted points (the LLM pair only when the
  report has LLM analysis) — instead of a single commit-based "Top
  contributor" and "Busiest period" fact.
- The `compile` individual dynamics sections of the main report no
  longer embed the whole-range contribution-sizes chart; it stays in
  the per-person reports under `people/`.
- `compile` list options (`--map`, `--include-user`, `--exclude-user`,
  `--repo`, `--exclude-repo`) accept comma-separated values and ignore
  empty entries, and an empty `--output` falls back to the
  `dev-perf-report` default — so an optional value like
  `--exclude-user ""` excludes no user instead of failing.
