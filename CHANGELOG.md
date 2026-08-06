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
- A Docker image is published to the GitHub Container Registry
  (`ghcr.io/ameshkov/dev-perf`), so dev-perf can be run in a sandbox
  without installing Node.js. The image is built for `linux/amd64` and
  `linux/arm64`, is published on every `master` push (`master` tag) and
  on every `v*` release tag (version tags plus `latest`), and is
  documented in the README and DEVELOPMENT guide.

### Changed

- With `--verbose`, `report` and `compile` now log the start of
  long-running operations (cloning a repository, reading the commit
  history, creating the LLM runtime, rendering charts), so the CLI
  shows what it is doing instead of waiting silently.
- The verbose clone lines now name the cache entry directory (its
  hash), so a repository can be matched to its cache entry from the
  log.
- With `--verbose`, every LLM session log line now also names the
  session id — creation, prompt send, enforcement reminders, report
  receipt, token usage, and the periodic "still waiting" progress
  lines — so a run can be traced session by session.
- LLM analysis now runs fully in-process via the
  `@earendil-works/pi-coding-agent` library instead of spawning an
  opencode server per repository: no separate `opencode` binary is
  needed, the provider and model are registered in code, and the API
  key is injected in memory and never written to disk.
- Continuing the in-process LLM move, the LLM runtime now writes
  nothing to the cache entry: credentials stay in a purely in-memory
  store, so no `pi/` home directory or `auth.json` is left behind
  after a run.
- The per-user `llm` report entries no longer include the estimated
  cost (`estimatedCostUsd`); only token usage is recorded. The
  compiled report's "cost" tables became token-only usage tables, and
  the "LLM analysis cost" summary line was removed.

### Fixed

- A prompt that failed for a real reason (rate limit, transport, model
  error) no longer masquerades as "did not call `devperf_report`":
  the underlying error surfaces and the run fails fast, instead of
  burning the reminder retries on a broken session.
- A report received right as the session aborted is no longer
  misread as "tool not called": the report-file write now settles the
  analysis even under an in-flight abort, avoiding spurious reminders
  for a valid analysis.
- The LLM analysis agent's `bash` tool is pi's regular, **unshielded**
  tool: it can run arbitrary shell commands in the cloned repository and
  is kept to read-only inspection only through the system prompt. A
  repository under analysis must be treated as untrusted, and it is
  recommended to run the LLM analysis in the Docker container, which
  sandboxes the analysis away from the host.
- Cached LLM results written by an older version are no longer
  silently reused after an upgrade: the cache key now carries a
  version that invalidates stale entries when prompts or the report
  schema change.
