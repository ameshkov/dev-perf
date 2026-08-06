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
- A terminal running from the **repository root** for all commands below.

The LLM layer runs fully in-process via the
`@earendil-works/pi-coding-agent` library — no external LLM binary is
needed.

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
deterministic analysis path runs end to end:

```bash
node build/index.js report --no-llm /path/to/some/git/repo
```

This clones the repository into the cache (`<tmpdir>/.dev-cache` by
default), analyzes git history, and prints the JSON report to stdout.
LLM analysis is wired in: a run without `--no-llm`
requires `--model`, `--provider-url`, and `--api-key`; the language
model runs fully in-process. Provider settings can come from the
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

The repository ships `.vscode/launch.json` with three launch
configurations that load `.env` via `envFile`:

- *dev-perf: run (deterministic)* — `report --no-llm` against the
  repository root, no provider configuration needed.
- *dev-perf: run (with LLM)* — full pipeline; set `DEV_PERF_MODEL`,
  `DEV_PERF_PROVIDER_URL`, and `DEV_PERF_API_KEY` in `.env` first.
- *dev-perf: compile* — prompts for the JSON report file, then runs
  `compile <report> --output dev-perf-report` in the workspace root.

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

# Verbose run: progress (operation starts + outcomes, range, commit
# counts) goes to stderr; stdout carries the report JSON only
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
commit counts. Every run starts by logging the application version
(`dev-perf <version>`) to stderr; a `report` run follows it with the
full resolved configuration as one indented line per field
(repositories, dates, unit, output, resolved cache directory, refresh,
LLM settings with the API key masked, limits, retries, parallelism,
verbose), and stdout carries the report JSON only.
`node build/index.js --version` (or `version`) prints the application
version.

### Manual LLM run

With a provider API key, run the full pipeline against a small public
repository (keep the range narrow so the run is quick):

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

- Verbose stderr shows the pi runtime creation with the model, the
  orientation session, and per-user sessions with token usage.
- The report's per-user `llm` entries have `status: "completed"` with
  `overview`, `contributions`, and `tokenUsage`.
- A rerun with identical parameters makes no new LLM calls (results
  are cached in `<tmpdir>/.dev-cache/<hash>/llm/`); `--refresh` re-runs
  everything.
- A provider that rejects the key fails fast: the run exits non-zero
  with a message naming the failing prompt, and no report is written.
- A model that never calls `devperf_report` fails after 3 reminders
  with an error naming the user and session.

### Docker

Build the image locally and exercise the CLI inside a container. The
image exposes `dev-perf` as its entrypoint, so it is used exactly like
the installed CLI (it runs inside the container, but every flag and
argument is identical):

```bash
# Build the image (multi-stage; Node.js 24 runtime with git, bash,
# file and ripgrep — the read-only tool set the LLM agent uses).
docker build -t dev-perf:local .

# Version and help.
docker run --rm dev-perf:local --version
docker run --rm dev-perf:local --help

# Deterministic analysis of a local repository: mount it read-only
# (the path is cloned into the container's cache; the working tree is
# never modified) and pass the mount path.
docker run --rm -v /path/to/repo:/repo:ro \
  dev-perf:local report --no-llm /repo

# Write the report onto the host by mounting a directory at the
# container's working directory /work.
docker run --rm -v /path/to/repo:/repo:ro -v "$PWD":/work \
  dev-perf:local report --no-llm --output report.json /repo
```

The runtime dependency set is pure JavaScript (the one native-looking
dependency, `@silvia-odwyer/photon-node`, is a WASM module), so the
same `Dockerfile` builds unchanged for every architecture buildx
targets; the publish workflow builds `linux/amd64` and `linux/arm64`.
Each `docker run` starts fresh, so the clone cache inside the container
(`/tmp/.dev-cache`) is ephemeral; mount a host directory there to reuse
clones and cached LLM results across runs.

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
pushed, and the [Docker workflow](.github/workflows/docker.yml) builds
and pushes the Docker image to the GitHub Container Registry
(`ghcr.io/ameshkov/dev-perf`) on the same tags (and on every push to
`master`).

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
attached. The Docker workflow pushes a multi-architecture image
(`linux/amd64`, `linux/arm64`) tagged with the version and `latest` —
it does not depend on the npm publish, so both run in parallel.

### Notes

- The tag version **must** match `package.json` exactly, or the job
  fails fast.
- npm
  [provenance](https://docs.npmjs.com/generating-provenance-statements)
  is enabled, so each published version links back to its source
  commit and build.
- The Docker workflow needs no extra secret: it authenticates to the
  GitHub Container Registry with the automatic `GITHUB_TOKEN` (granted
  `packages: write`), so GHCR access works out of the box for
  repositories in GitHub. To make the image visible to everyone, ensure
  the package's visibility is *public* on the package settings page.

## Troubleshooting

- **`Error: Cannot find module 'build/index.js'`** — run `pnpm build`
  first.
- **LLM run fails with "Failed to create the pi LLM runtime"** — the
  in-process pi runtime could not be created or the model could not be
  resolved; check the provider URL and the model id. Deterministic
  runs (`--no-llm`) never need it.
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
- **Knip crashes with "JavaScript heap out of memory"** — knip's file
  walker can traverse the `.dev-perf` clone cache before it applies
  the repo's own `.gitignore` (the root `.gitignore` is discovered
  only during the walk). The `knip` script automatically appends
  `.dev-perf/` to `.git/info/exclude`, which knip preloads before the
  walk, so the cache is pruned from the first step. If the crash
  still happens, verify `.git/info/exclude` contains `.dev-perf/`.
