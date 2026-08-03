# Development Guide

How to set up, run, and manually test dev-perf on your own machine.
This guide assumes you are working inside a clone of the repository.
For usage as an end user, see the [README](./README.md) instead.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Initial Setup](#initial-setup)
- [Building](#building)
- [Running the CLI](#running-the-cli)
- [Manual Testing](#manual-testing)
- [Code Quality Gates](#code-quality-gates)
- [Releasing](#releasing)
    - [One-time setup](#one-time-setup)
    - [Cutting a release](#cutting-a-release)
    - [Notes](#notes)
- [Troubleshooting](#troubleshooting)

## Prerequisites

- **Node.js 24 or later** (check with `node --version`).
- **pnpm 10 or later** (install with `corepack enable && corepack prepare
  pnpm@latest --activate`, then verify with `pnpm --version`).
- **git** on `PATH` — the analysis pipeline shells out to git, and the
  LLM agent runs git commands through its `bash` tool.
- **opencode** on `PATH` (only for LLM analysis) — the LLM layer starts
  an opencode server as a library per repository; without it, LLM runs
  fail fast with a hint. `dev-perf report --no-llm` never needs it.
- A terminal running from the **repository root** for all commands below.

## Initial Setup

Install dependencies (this also installs the Husky pre-commit hook):

```bash
pnpm install
```

## Building

Compile the TypeScript to `build/`:

```bash
pnpm build
```

The compiled entry point is `build/index.js`. Run it with Node directly:

```bash
node build/index.js --help
node build/index.js --version
```

There is no shebang in the source, so always invoke it through `node`
during development (the published `dev-perf` command wraps it with Node
automatically).

To rebuild after editing source:

```bash
pnpm build
```

## Running the CLI

The CLI surface is implemented: the `report` command with argument
parsing, `--help`, `--version`, and validation errors all work, and the
deterministic analysis path (milestone M2) runs end to end:

```bash
node build/index.js report --no-llm /path/to/some/git/repo
```

This clones the repository into the cache (`.dev-perf/cache` by
default), analyzes git history, and prints the JSON report to stdout.
LLM analysis (milestone M3) is wired in: a run without `--no-llm`
requires `--model`, `--provider-url`, and `--api-key`, and the
`opencode` CLI on `PATH`. Provider settings can come from the
environment instead of flags (see below).

Full LLM run:

```bash
node build/index.js report --since 2026-01-01 --until 2026-06-30 \
  --output report.json \
  --model gpt-4.1 \
  --provider-url https://api.openai.com/v1 \
  --api-key "$DEV_PERF_API_KEY" \
  https://github.com/org/repo.git
```

### Environment variables (.env)

Every command-line option has a `DEV_PERF_*` environment variable
equivalent; the flag wins when both are set. The template documents
all of them:

```bash
cp .env.example .env
```

A `.env` file in the current working directory is auto-loaded at
startup (`dotenv`), and `.env` is gitignored — the right place for API
keys and machine-specific settings. Values already exported in the
shell are never overridden by `.env` entries.

For example, with a `.env` containing:

```text
DEV_PERF_NO_LLM=true
DEV_PERF_OUTPUT=report.json
```

`node build/index.js report /path/to/repo` behaves exactly like
`--no-llm --output report.json /path/to/repo`. Boolean variables accept
`1`/`true`/`yes`/`on` and `0`/`false`/`no`/`off`.

### Running from VS Code

The repository ships `.vscode/launch.json` with two launch
configurations that load `.env` via `envFile`:

- *dev-perf: run (deterministic)* — `report --no-llm` against the
  repository root, no provider configuration needed.
- *dev-perf: run (with LLM)* — full pipeline; set `DEV_PERF_MODEL`,
  `DEV_PERF_PROVIDER_URL`, and `DEV_PERF_API_KEY` in `.env` first.

Create `.env` (from `.env.example`) before launching, then press F5 in
the Run and Debug view. The configurations run the TypeScript sources
through `tsx`, so no `pnpm build` is needed.

## Manual Testing

The deterministic analysis path is the primary manual workflow: build
a small fixture repository and run `--no-llm` against it.

```bash
# Help and version
node build/index.js --help
node build/index.js --version

# Deterministic analysis of a local repository (stdout)
node build/index.js report --no-llm /tmp/fixture

# With an explicit author-date range and an output file
node build/index.js report --no-llm --since 2026-01-01 --until 2026-12-31 \
  --output report.json /tmp/fixture

# Argument validation (should fail with a clear error)
node build/index.js report

# Verbose run: progress (clone vs cache reuse, range, commit counts)
# goes to stderr, the report JSON stays on stdout
node build/index.js report --no-llm --verbose /tmp/fixture
```

Building a fixture repository:

```bash
mkdir -p /tmp/fixture && cd /tmp/fixture
git init -b main
git config user.name "Jane Doe" && git config user.email "jane@example.com"
printf 'console.log("hello");\n' > index.js
git add index.js && git commit -m "Initial commit"
cd - && node build/index.js report --no-llm /tmp/fixture
```

A second run with the same repository reuses the cached clone; pass
`--refresh` to force a re-clone.

`--verbose` shows what the pipeline is doing on stderr — clone vs cache
reuse (with duration), the resolved author-date range, and per-repo
commit counts — while stdout stays reserved for the report JSON.

### Manual LLM run

With the `opencode` CLI installed and a provider key, run the full
pipeline against a small public repository (keep the range narrow so
the run is quick):

```bash
node build/index.js report \
  --since 2026-01-01 --until 2026-06-30 \
  --model gpt-4.1 \
  --provider-url https://api.openai.com/v1 \
  --api-key "$DEV_PERF_API_KEY" \
  --verbose \
  https://github.com/org/small-public-repo.git
```

Expectations:

- Verbose stderr shows the server URL and model, the orientation
  session, and per-user sessions with token usage and cost.
- The report's per-user `llm` entries have `status: "completed"` with
  `overview`, `contributions`, `tokenUsage` and `estimatedCostUsd`.
- A rerun with identical parameters makes no new LLM calls (results
  are cached in `.dev-perf/cache/<hash>/llm/`); `--refresh` re-runs
  everything.
- A provider that rejects the key fails fast: the run exits non-zero
  with a message naming the failing prompt, and no report is written.
- A model that never calls `devperf_report` fails after 3 reminders
  with an error naming the user and session.

## Code Quality Gates

Before proposing changes, run the full gate locally (this mirrors CI):

```bash
pnpm format:check   # Prettier + Markdownlint
pnpm lint           # oxlint + Knip unused-export analysis
pnpm typecheck      # TypeScript (production + test configs)
pnpm test           # Vitest unit + E2E suite
```

Convenience shortcuts:

- `pnpm format:fix` — auto-fix Prettier and Markdownlint issues.
- `pnpm lint:fix` — auto-fix oxlint issues.
- `pnpm check` — runs `format:check`, `lint`, `typecheck`, `build`, and
  `test` in sequence (the complete CI gate).
- `pnpm clean` — remove `node_modules` and `build/`.

A Husky pre-commit hook is installed by `pnpm install` (see the `prepare`
script in `package.json`); it runs the full `pnpm check` automatically
when you commit.

## Releasing

Releases are published to the npm registry automatically by the
[CI workflow](.github/workflows/ci.yml) whenever a version tag is
pushed.

### One-time setup

1. The package is published as **public** (see `publishConfig` in
   `package.json`).
2. Publishing uses npm **Trusted Publishers** (OIDC) — no token secret
   is needed. Grant the `ameshkov/dev-perf` repository permission to
   publish the `dev-perf` package in the npm package's access settings.

### Cutting a release

1. Make sure `CHANGELOG.md` is up to date under the `[Unreleased]`
   section.
2. Bump the `version` field in `package.json` following
   [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
3. Commit the version bump and tag it with a `v` prefix:

   ```bash
   git add package.json CHANGELOG.md
   git commit -m "Release v0.2.0"
   git tag v0.2.0
   git push origin master v0.2.0
   ```

The workflow verifies that the tag version matches `package.json`, runs
the full quality gate, builds, publishes to npm with provenance, and
creates a GitHub release linking to `CHANGELOG.md` with the npm tarball
attached.

### Notes

- The tag version **must** match `package.json` exactly, or the job
  fails fast.
- npm
  [provenance](https://docs.npmjs.com/generating-provenance-statements)
  is enabled, so each published version links back to its source
  commit and build.

## Troubleshooting

- **`Error: Cannot find module 'build/index.js'`** — run `pnpm build`
  first.
- **LLM run fails with "Is the opencode CLI installed and on PATH?"** —
  the LLM layer spawns an opencode server via the SDK; install the
  `opencode` CLI and make sure it is on `PATH`. Deterministic runs
  (`--no-llm`) never need it.
- **LLM run fails with an auth error on the first prompt** — the
  provider rejected the API key; check `--api-key` /
  `DEV_PERF_API_KEY` and the provider base URL.
- **E2E tests are skipped** — the e2e suite
  (`test/e2e/deterministic.test.ts`) runs the compiled CLI and needs
  `pnpm build` first; `pnpm test` skips it when `build/index.js` is
  missing. Use `pnpm check`, which always builds before testing.
- **`pnpm` complains about the `packageManager` version** — the project
  pins `pnpm@10.14.0`; run `corepack enable` (or install that exact
  version) to satisfy it.
- **Husky hook does not run** — re-run `pnpm install`; the `prepare`
  script installs the hook.
