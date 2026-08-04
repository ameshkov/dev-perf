# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The LLM analysis agent can now use more read-only bash commands
  when inspecting a repository: git history and ref inspection
  (`git branch`, `git tag`, `git rev-parse`, `git rev-list`,
  `git shortlog`, `git ls-tree`, `git ls-files`, `git grep`,
  `git describe`, `git merge-base`, `git cat-file`), file inspection
  (`ls`, `cat`, `tail`, `head`, `wc`, `file`, `grep`, `rg`), and text
  processing (`sort`, `uniq`, `cut`, `diff`, `echo`), in addition to
  the git history commands already allowed.
- A failed LLM analysis is now retried automatically instead of
  failing the run: the repository's opencode server is fully stopped
  (and force-killed when it does not exit) and a fresh one is started
  for each retry, reusing the already-cached per-user results. The
  number of retries is configurable with `--llm-retries <n>` /
  `DEV_PERF_LLM_RETRIES` (default 2; `--llm-retries 0` restores the
  fail-fast behavior).
- The `compile` command now writes one full per-person report per user
  under `people/<slug>.md`: title and summary line, statistics table,
  the complete chart set (contribution sizes and complexity
  distributions, per-period contributions stacked by size, commits
  with the cumulative line, lines, and per-period top languages), the
  LLM overview, the contributions table, risk flags, and the
  per-repository commit counts, with a back-link to `report.md`. The
  individual sections of the main report link to these reports.
- The `compile` team dynamics now include per-period complexity,
  risk-flag and quality-signal charts (top 9 flags plus `other`, as
  grouped bars), and the LLM analysis summary gains risk and quality
  distribution pies. The risk and quality series are normalized to
  the share of contributions carrying each flag, so periods with more
  work are not shown with more flags.
- The `compile` executive summary now lists the analysis period and
  the analyzed repositories, and the totals table gains a one-line
  description column per metric.
- The `compile` contributors table now shows each user's repository
  count and the repository with their most commits; per-user
  contributions per period are stacked by size, per-user commits
  per period show the cumulative line, and a per-user top-languages
  chart was added.
- Initial release of `dev-perf`, a CLI tool that measures developer
  contributions to git repositories (any git URL or local path) over a
  date range and produces a JSON report of per-user metrics.
- Deterministic analysis counted straight from git history: commits,
  lines added/removed, files touched, churn, active days, and
  per-language contribution sizes, per user (grouped by email with bot
  detection) and per repository.
- LLM agentic analysis (skippable with `--no-llm`): an opencode agent
  with read-only access to the cloned repository inspects the actual
  commits and diffs and assesses what cannot be counted — work types,
  complexity, size, impact areas, quality signals, and risk flags.
  Provider, model, and API key are always passed explicitly; the user's
  global opencode configuration is never read.
- A single JSON report merging both layers, per repository and per
  user, including per-user token usage and estimated cost for the LLM
  analysis; the report goes to stdout or `--output <file>`.
- Clone and LLM-result caching under `--cache-dir` (default
  `.dev-perf/cache`) with partial-clone fallback and `--refresh` to
  force re-cloning and re-analysis.
- Every CLI option has a `DEV_PERF_*` environment-variable equivalent;
  a `.env` file in the working directory is loaded automatically (the
  flag wins when both are set).
- Verbose (`--verbose`) progress logging for the LLM phase: each
  waiting stage logs its start (orientation prompt, context injection,
  analysis prompt) and long-running operations log a periodic "still
  waiting" line with elapsed time, so a slow or stuck model call is
  visible instead of an endless silent wait.
- Time-based period reports with `--unit day|week|month|quarter|year`:
  the analyzed range is split into UTC-aligned periods and the report
  carries one full per-repository report per period, including empty
  periods with zeroed metrics; the user list is the same in every
  period, and the LLM analysis runs per period for the users active in
  it. `--since` is required when `--unit` is set.
- The `compile` command: turns a JSON report into a markdown report
  with charts (`dev-perf compile <report> --output <dir>` writes
  `report.md` plus SVG chart assets into the output directory).
  Charts are rendered server-side with Vega-Lite and cover the team
  dynamics (contributions by size and weighted points, commits with a
  cumulative line, lines, active users, top languages) and the
  individual dynamics (per-user contribution sizes and per-period
  contributions or commits/lines), plus LLM distribution pies (work
  types, sizes, complexity) when the report has LLM analysis.
- Compile-time report shaping: `--repo`/`--exclude-repo` narrow the
  repositories, `--include-user`/`--exclude-user` narrow the users
  (by display name or any email), and `--map <email=name>` /
  `--maps-file <path>` merge author emails into a single identity.
  Merged identities sum deterministic metrics (active days take the
  max), concatenate LLM contributions, and repository stats are
  recomputed after filtering; every compile option has a
  `DEV_PERF_COMPILE_*` environment-variable equivalent.
- Language detection now recognizes more file types: .NET project
  and resource files (`.csproj`, `.vcxproj`, `.resx`, `.wxs`,
  `.config`), Objective-C (`.m`/`.mm`), TypeScript module formats
  (`.mts`/`.cts`), C++ variants (`.c++`, `.h++`, `.ipp`, `.inl`),
  Xcode project files (`.pbxproj`), binary blobs (`.bin`), and Go
  module files (`go.mod`, `go.sum`, `go.work`), so fewer files fall
  under `Unknown` in per-language statistics.

### Changed

- The LLM cost reporting now tracks token usage with the cached-read
  split: the JSON report's per-user `tokenUsage` gains `cacheRead`
  (opencode reports `input` and cached reads as non-overlapping
  counts), and the compiled report shows the LLM cost with the full
  token breakdown in the executive summary and the per-user cost
  table, e.g. `1.2k in / 5M cached in / 1M out / $0.0123`.
- The `compile` individual dynamics of the main report are leaner:
  each user section now shows the summary line, a statistics table,
  the two most informative charts and a link to the full per-person
  report; the per-user LLM overviews, contributions tables and risk
  callouts moved into the per-person reports.
- The `compile` team dynamics no longer render the contributions-vs-
  weighted-points chart.
- All `compile` charts are now rendered at a shared width of 1024
  pixels instead of 420, with the height scaled to keep the 3:2
  aspect ratio, so the SVGs are readable at report size.
- The CLI is now command-based: the report run lives under the
  `report` subcommand (`dev-perf report [options] [repo...]`), and a
  bare `dev-perf` invocation prints the command list. **Breaking
  change** for existing invocations — the report options, positional
  repository arguments, and `DEV_PERF_*` environment variables are
  unchanged, only the `report` command word is added. The `compile`
  command (renders a JSON report into markdown with charts) is
  registered alongside `report`.
- The report document is now schema v2: repository entries are always
  wrapped in a `periods` array (a single period covers the whole range
  without `--unit`). **Breaking change** for consumers of the previous
  flat `repositories` shape — the repository entries move one level
  deeper under `periods[0]`, and the `parameters` may carry a `unit`.
- The VS Code launch configurations now write every dev-perf run's
  result into a gitignored `output/` directory: the report runs write
  `output/deterministic-report.json` and `output/llm-report.json`, and
  the compile run writes `report.md` plus its chart assets under
  `output/`.

### Fixed

- The `compile` command now honors the list-option environment
  variables `DEV_PERF_COMPILE_MAP`, `DEV_PERF_COMPILE_INCLUDE_USER`,
  `DEV_PERF_COMPILE_EXCLUDE_USER`, `DEV_PERF_COMPILE_REPO` and
  `DEV_PERF_COMPILE_EXCLUDE_REPO` when the corresponding flags are not
  passed (previously the commander empty-array defaults shadowed them,
  so the variables were silently ignored).
- The CLI now exits after writing the report even when the opencode
  server does not shut down: the entry point forces a clean exit once
  stdout has flushed, and a server that ignores SIGTERM is force-killed
  after a short grace period (previously the process hung forever with
  the server's pipes keeping it alive). The force-kill also cleans up
  the server's whole process tree — including child processes a stuck
  server is waiting on — so a hung server leaks nothing either.
- Date-only `--since`/`--until` values (e.g. `2026-01-01`) are now
  resolved to UTC midnight instead of the run's time of day, so the
  analyzed range — and the LLM result cache keyed on it — stays stable
  across reruns. The `until` bound ends at the start of its day, so
  `--since 2026-01-01 --until 2026-03-01` covers exactly two months
  rather than two months plus the boundary day; with `--unit`, a range
  ending on a period boundary no longer emits a zero-length boundary
  period.
