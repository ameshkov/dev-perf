# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Report schema (`src/report/schema.ts`) — the single source of truth
  for the report shape (design §7): parameters, repository and user
  entries, deterministic metrics, per-language contributions, and the
  LLM analysis. `churn` stays optional (reserved for v2), and
  `llm.status` defaults to `"skipped"`.
- CLI option validation (`src/config.ts`) — zod schema for the parsed
  options: LLM analysis requires `--model`, `--provider-url` and
  `--api-key` (the key may come from `DEV_PERF_API_KEY`);
  `--limit-context` / `--limit-output` are positive integers (defaults
  262144 / 65536); empty repo lists are rejected. Errors name each
  failing option.
- `--limit-context <n>` and `--limit-output <n>` CLI options (design
  §3), and validation of all parsed options in the CLI action.
- Project scaffolding modeled on mcp-compress-router: TypeScript CLI
  skeleton (commander entry with the documented argument/option
  surface), Vitest + oxlint + Knip + Prettier + Markdownlint + Husky
  tooling, and a CI workflow running the full quality gate with npm
  publishing on version tags.
- `AGENTS.md` with contribution and code guidelines,
  `DEVELOPMENT.md` development guide, and `.env.example` documenting
  `DEV_PERF_API_KEY`.
- `docs/plan.md` with the step-by-step implementation plan for the
  analysis pipeline described in `docs/design.md`.
