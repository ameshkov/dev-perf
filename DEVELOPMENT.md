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

The CLI surface is implemented: argument parsing, `--help`, `--version`,
and validation errors all work. The analysis pipeline itself is **not
implemented yet** — running an analysis currently fails with a
not-implemented error pointing at [docs/design.md](docs/design.md):

```bash
node build/index.js --no-llm https://github.com/org/repo.git
# dev-perf: The analysis pipeline is not implemented yet — see docs/design.md
```

Once the pipeline lands, the intended flow is:

```bash
node build/index.js --since 2026-01-01 --until 2026-06-30 \
  --output report.json \
  --model gpt-4.1 \
  --provider-url https://api.openai.com/v1 \
  --api-key "$DEV_PERF_API_KEY" \
  https://github.com/org/repo.git
```

`--model`, `--provider-url`, and `--api-key` are required for LLM
analysis; pass `--no-llm` for deterministic stats only. A `.env` file in
the current working directory is auto-loaded (`DEV_PERF_API_KEY` is the
only documented variable, see `.env.example`).

## Manual Testing

The analysis is not implemented yet, so manual testing is limited to the
CLI surface:

```bash
# Help and version
node build/index.js --help
node build/index.js --version

# Argument validation (should fail with a clear error)
node build/index.js

# Running an analysis (should fail with the not-implemented error)
node build/index.js --no-llm /path/to/some/git/repo
```

When the deterministic layer lands, the primary manual workflow will be
building a small fixture repository and running `--no-llm` against it:

```bash
mkdir -p /tmp/fixture && cd /tmp/fixture
git init -b main
git config user.name "Jane Doe" && git config user.email "jane@example.com"
printf 'console.log("hello");\n' > index.js
git add index.js && git commit -m "Initial commit"
cd - && node build/index.js --no-llm /tmp/fixture
```

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
- **`dev-perf: The analysis pipeline is not implemented yet`** — expected:
  only the CLI surface exists so far. See [docs/design.md](docs/design.md).
- **`pnpm` complains about the `packageManager` version** — the project
  pins `pnpm@10.14.0`; run `corepack enable` (or install that exact
  version) to satisfy it.
- **Husky hook does not run** — re-run `pnpm install`; the `prepare`
  script installs the hook.
