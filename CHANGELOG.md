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

### Changed

- With `--verbose`, `report` and `compile` now log the start of
  long-running operations (cloning a repository, reading the commit
  history, starting the opencode server, rendering charts), so the CLI
  shows what it is doing instead of waiting silently.
- The verbose clone lines now name the cache entry directory (its
  hash), so a repository can be matched to its cache entry from the
  log.
- The opencode server now runs with its isolated home directory
  (`HOME`/`XDG_CONFIG_HOME`) under the cache entry's `opencode/home/`,
  kept after the run. opencode's state and log files persist in the
  cache, so a failed LLM analysis can be diagnosed from the server
  logs left behind.
- With `--verbose`, the opencode server now runs at DEBUG log level,
  so its log file in the cache (`opencode/home/.local/share/opencode/
  log/opencode.log`) records server-side detail for diagnosing a
  failed analysis; by default it stays at the server's INFO level.
