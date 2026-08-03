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

### Changed

- The CLI is now command-based: the report run lives under the
  `report` subcommand (`dev-perf report [options] [repo...]`), and a
  bare `dev-perf` invocation prints the command list. **Breaking
  change** for existing invocations — the report options, positional
  repository arguments, and `DEV_PERF_*` environment variables are
  unchanged, only the `report` command word is added. Future commands
  (e.g. a `compile` that renders a JSON report into markdown with
  charts) will be registered alongside `report`.
- The report document is now schema v2: repository entries are always
  wrapped in a `periods` array (a single period covers the whole range
  without `--unit`). **Breaking change** for consumers of the previous
  flat `repositories` shape — the repository entries move one level
  deeper under `periods[0]`, and the `parameters` may carry a `unit`.

### Fixed

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
