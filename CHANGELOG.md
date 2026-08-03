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
