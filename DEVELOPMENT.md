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

The CLI surface is implemented: the `report` command with
`--config`, `--help`, `--version`, and validation errors all work, and
the deterministic analysis path runs end to end. Every setting — the
repositories, the date range, the output file, the cache directory,
verbosity — comes from the config file (the CLI carries no flags
beyond `--config`):

```bash
node build/index.js report --config config.yaml
```

This clones the repository into the cache (`<tmpdir>/.dev-cache` by
default), analyzes git history, and prints the JSON report to stdout.
LLM analysis is wired in: a run without `llm: false`
requires the `model`, `provider-url`, and `api-key` config keys; the
language model runs fully in-process.

Full LLM run (see the config file example below):

### Configuration file (config.yaml)

Every setting is read from a YAML config file — the config file is the
single source of options. The config file is shared by `report` and
`compile` — top-level keys apply to both, and `compile`-only keys live
under a nested `compile` section. Two files are needed:

- `config.yaml` — the options themselves (repositories, date range, LLM
  provider configuration). Copy it from `config.example.yaml`.
- `.env` — the values for `${ENV_VAR}` references inside `config.yaml`
  (API keys, model id, provider URL). Copy it from `.env.example`.

Copy both on first use:

```bash
cp config.example.yaml config.yaml
cp .env.example .env
```

Edit the values: `--config <path>` selects a file explicitly, otherwise
`./config.yaml` is auto-loaded from the working directory when it
exists. `config.yaml` is gitignored. Use `${ENV_VAR}` references for
the LLM provider configuration so it stays out of version control:

```yaml
model: ${DEV_PERF_MODEL}
provider-url: ${DEV_PERF_PROVIDER_URL}
api-key: ${DEV_PERF_API_KEY}
```

Each referenced variable must be set in the environment (or in `.env`,
which dev-perf auto-loads at startup); a run errors out when it is
unset or empty. `.env` (from `.env.example`) holds only the variables
`${ENV_VAR}` references use — it is no longer an option source.

### Running from VS Code

The repository ships `.vscode/launch.json` with three launch
configurations that load `.env` via `envFile` and pass `--config
config.yaml`:

- *dev-perf: report* — `report --config config.yaml` against the repositories
  in the config file.
- *dev-perf: compile* — `compile --config config.yaml` with everything —
  the input report (`compile.report`), the output directory,
  user/repository selection, and email mapping — set in the config
  file.

Create `config.yaml` (from `config.example.yaml`) and `.env` (from
`.env.example`) before launching, then press F5 in the Run and Debug
view. The configurations run the TypeScript sources through `tsx`, so
no `pnpm build` is needed.

## Manual Testing

The deterministic analysis path is the primary manual workflow: build
a small fixture repository and run with `llm: false` in the config
file.

```bash
# Help and version
node build/index.js --help
node build/index.js --version

# Deterministic analysis of a local repository (stdout)
node build/index.js report --config config.yaml
```

Create `config.yaml` first (./config.yaml auto-loads from the cwd
when `--config` is omitted):

```bash
cp config.example.yaml config.yaml
```

```yaml
# config.yaml — deterministic analysis of a local fixture repository
repos:
  - /tmp/fixture
since: 2026-01-01
until: 2026-12-31
llm: false
output: report.json
```

```bash
# Run from the config file
node build/index.js report

# Argument validation (should fail with a clear error): a config file
# without repos
node build/index.js report --config /tmp/empty-config.yaml

# Verbose run: progress (operation starts + outcomes, range, commit
# counts) goes to stderr; stdout carries the report JSON only
node build/index.js report --config config.yaml
```

Building a fixture repository:

```bash
mkdir -p /tmp/fixture && cd /tmp/fixture
git init -b main
git config user.name "Jane Doe" && git config user.email "jane@example.com"
printf 'console.log("hello");\n' > index.js
git add index.js && git commit -m "Initial commit"
cd -
```

A second run with the same repository reuses the cached clone; set
`refresh: true` in the config to force a re-clone.

`verbose: true` in the config shows what the pipeline is doing on
stderr — clone vs cache reuse (with duration), the resolved author-date
range, and per-repo commit counts. Every run starts by logging the
application version (`dev-perf <version>`) to stderr; a `report` run
follows it with the full resolved configuration as one indented line
per field (repositories, dates, unit, output file, the config file,
resolved cache directory, refresh, LLM settings with the API key
masked, limits, retries, parallelism, verbose), and stdout carries the
report JSON only.
`node build/index.js --version` (or `version`) prints the application
version.

### Manual LLM run

With a provider API key, run the full pipeline against a small public
repository (keep the range narrow so the run is quick):

```yaml
# config.yaml
repos:
  - https://github.com/org/small-public-repo.git
since: 2026-01-01
until: 2026-06-30
model: ${DEV_PERF_MODEL}
provider-url: ${DEV_PERF_PROVIDER_URL}
api-key: ${DEV_PERF_API_KEY}
verbose: true
```

```bash
node build/index.js report
```

Expectations:

- Verbose stderr shows the pi runtime creation with the model, the
  orientation session, and per-user sessions with token usage.
- The report's per-user `llm` entries have `status: "completed"` with
  `overview`, `contributions`, and `tokenUsage`.
- A rerun with identical parameters makes no new LLM calls (results
  are cached in `<tmpdir>/.dev-cache/<hash>/llm/`); `refresh: true`
  re-runs everything.
- A provider that rejects the key fails fast: the run exits non-zero
  with a message naming the failing prompt, and no report is written.
- A model that never calls `devperf_report` fails after 3 reminders
  with an error naming the user and session.

### Docker

Build the image locally and exercise the CLI inside a container. The
image exposes `dev-perf` as its entrypoint, so it is used exactly like
the installed CLI — every setting comes from a config file mounted
into the container's working directory `/work`:

```bash
# Build the image (multi-stage; Node.js 24 runtime with git, bash,
# file and ripgrep — the read-only tool set the LLM agent uses).
docker build -t dev-perf:local .

# Version and help.
docker run --rm dev-perf:local --version
docker run --rm dev-perf:local --help

# Deterministic analysis of a local repository: mount it read-only
# (the path is cloned into the container's cache; the working tree is
# never modified) and reference the mount path from the config.
docker run --rm \
  -v /path/to/repo:/repo:ro \
  -v "$PWD":/work \
  dev-perf:local report

# Write the report onto the host: mount the working directory at /work
# (its config.yaml is auto-loaded) and set output there.
docker run --rm \
  -v /path/to/repo:/repo:ro \
  -v "$PWD":/work \
  dev-perf:local report
```

with `$PWD/config.yaml` holding the run (`repos: [/repo]`, the range,
`llm: false`, and `output: report.json`).

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
  resolved; check the provider URL and the model id in the config.
  Deterministic runs (`llm: false`) never need it.
- **LLM run fails with an auth error on the first prompt** — the
  provider rejected the API key; check the config `api-key` (or its
  `${DEV_PERF_API_KEY}` reference) and the provider base URL.
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
