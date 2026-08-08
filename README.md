# dev-perf

[![CI](https://github.com/ameshkov/dev-perf/actions/workflows/ci.yml/badge.svg)](https://github.com/ameshkov/dev-perf/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dev-perf)](https://www.npmjs.com/package/dev-perf)
[![GitHub release](https://img.shields.io/github/v/release/ameshkov/dev-perf)](https://github.com/ameshkov/dev-perf/releases)

<p align="center">
    CLI tool that measures developer contributions to git repositories and
    produces a report of the team metrics.
</p>

<p align="center">
    <img src="docs/assets/dev-perf.png"
         alt="Dev Perf" width="600"/>
</p>

## Table of Contents

- [What it does](#what-it-does)
- [Usage](#usage)
    - [Building a report](#building-a-report)
    - [Compiling a markdown report with charts](#compiling-a-markdown-report-with-charts)
    - [Docker](#docker)
- [Configuration](#configuration)
- [Additional Resources](#additional-resources)

## What it does

Given one or more repositories (any git URL) and a date range, `dev-perf`:

1. **Clones** each repository into a local cache directory in the OS temp
   directory (`<tmpdir>/.dev-cache` by default).
2. **Counts deterministically** — straight from git history — commits, lines
   added/removed, files touched, churn, active days, and per-language
   contribution sizes (cloc-style counting applied to contributions).
3. **Analyzes with an LLM agent** — fully in-process via
   [`@earendil-works/pi-coding-agent`](https://github.com/earendil-works/pi)
   (no spawned server). For each contributor, an agent with read access to
   the repository inspects the actual commits and diffs and assesses the
   dimensions that cannot be counted: the type of work (feature, bug fix,
   refactoring, docs…), complexity, areas of impact, and quality signals.
4. **Merges** the deterministic and LLM results into a single JSON report,
   per repository and per user.

## Usage

Run `dev-perf` with `npx` — no global install needed. The CLI is
config-driven: every functional setting lives in the YAML config file,
`report` and `compile` select which step to run (exactly one per
invocation), and `version` prints the application version (same as
`--version` / `-V`). Running `npx dev-perf` without a command prints
the command list.

```text
dev-perf report --config <path>   # or omit --config: ./config.yaml auto-loads
dev-perf compile --config <path>
dev-perf version | --version | -V
```

### Building a report

```text
npx dev-perf report --config <path>

Build a JSON report of per-user contribution metrics.

Options:
  --config <path>   YAML config file (default: ./config.yaml when it exists)
  -V, --version     Show version
  --help            Show help
```

Every setting of the analysis — the repositories, the date range, the
period unit, the output file, the cache directory, the LLM provider and
its limits, identity merging, parallelism, verbosity — comes from the
config file (see [Configuration](#configuration)).

Deterministic stats only (no LLM analysis — no provider configuration
needed): set `llm: false`.

```yaml
repos:
  - https://github.com/org/repo.git
since: 2026-01-01
until: 2026-06-30
llm: false
output: report.json
```

```console
npx dev-perf report
```

Example — an LLM-enabled run (the default) writing the report to a file.
`dev-perf` never reads your global configuration — the provider, model
and API key are always specified explicitly in the config (typically as
`${ENV_VAR}` references):

```yaml
repos:
  - https://github.com/org/repo.git
since: 2026-01-01
until: 2026-06-30
output: report.json
model: ${DEV_PERF_MODEL}
provider-url: ${DEV_PERF_PROVIDER_URL}
api-key: ${DEV_PERF_API_KEY}
```

```console
npx dev-perf report
```

Example output (abridged):

```json
{
  "schemaVersion": 3,
  "parameters": {
    "repos": [{ "repo": "https://github.com/org/repo.git", "branch": "main" }],
    "since": "2026-01-01T00:00:00.000Z",
    "until": "2026-06-30T00:00:00.000Z",
    "llmEnabled": true
  },
  "periods": [
    {
      "since": "2026-01-01T00:00:00.000Z",
      "until": "2026-01-31T23:59:59.999Z",
      "repositories": [
        {
          "repo": "https://github.com/org/repo.git",
          "users": [
            {
              "name": "Jane Doe",
              "deterministic": {
                "commits": 42,
                "linesAdded": 1234,
                "linesRemoved": 567,
                "filesTouched": 89,
                "activeDays": ["2026-01-03", "2026-01-14", "2026-02-02", "2026-03-17"],
                "languages": {
                  "TypeScript": { "linesAdded": 900, "linesRemoved": 400 }
                }
              },
              "llm": {
                "status": "completed",
                "overview": "Jane shipped the reporting module and cleaned up the CLI…",
                "contributions": [
                  {
                    "title": "Reporting module",
                    "types": ["feature"],
                    "complexity": "high",
                    "areas": ["src/reporting"]
                  },
                  {
                    "title": "CLI cleanup",
                    "types": ["refactor"],
                    "complexity": "medium",
                    "areas": ["src/cli"]
                  }
                ],
                "tokenUsage": { "input": 102400, "output": 5120 }
              }
            }
          ]
        }
      ]
    }
  ]
}
```

Stdout carries the report JSON only; progress and errors go to stderr as
timestamped `[LEVEL]` lines. Every `report` and `compile` run starts by
logging the application version; every `report` run then logs the full
resolved configuration (the API key masked), so the effective settings
are visible before the analysis. The coarse analysis stages (clone,
commit reading, per-repository boundaries, the LLM phase) are shown on
every `report` run; the `verbose` config key adds per-user detail.

### Compiling a markdown report with charts

```text
npx dev-perf compile --config <path>

Compile a JSON report into a markdown report with charts.

Options:
  --config <path>   YAML config file (default: ./config.yaml when it exists)
  -V, --version     Show version
  --help            Show help
```

`compile` reads a JSON report produced by `report`, filters and merges
it, renders every chart as an SVG with Vega-Lite (pure Node, no
browser), and writes `report.md` plus the `assets/` directory into the
output directory: team dynamics, per-repository comparison, per-user
dynamics, and the LLM summary. Its settings — the input report, the
output directory, the user/repository selection, and the `users-map`
identity mapping — come from the config file's `compile` section:

```yaml
compile:
  report: report.json
  output: ./team-report
```

```console
npx dev-perf compile
```

The markdown report references the charts by relative path
(`![...](assets/team-commits-per-period.svg)`), so the output directory
is portable as a unit — open `report.md` in GitHub, VS Code, or any
markdown viewer that renders local images.

### Docker

A Docker image is published to the
[GitHub Container Registry](https://ghcr.io/ameshkov/dev-perf) on every
release tag (`latest` plus version tags) and on every push to `master`
(the `master` tag). The image runs the same `dev-perf` CLI, ships
Node.js, git and the shell utilities, and supports `linux/amd64` and
`linux/arm64`. Use it to run dev-perf in a sandbox without installing
Node.js:

```console
docker run --rm ghcr.io/ameshkov/dev-perf --help
```

`dev-perf report` runs the LLM analysis by default; the provider, model
and API key come from the mounted config. Every `docker run` starts
with a fresh container, so anything written inside it is lost on exit:
mount a host directory at `/tmp/.dev-cache` to reuse cloned
repositories and cached LLM results across runs, and mount the working
directory at `/work` (the image's working directory) — a `config.yaml`
in it is auto-loaded and the `output` report file lands on the host:

```console
docker run --rm \
  -v "$PWD":/work \
  -v "$HOME/.dev-perf-cache":/tmp/.dev-cache \
  ghcr.io/ameshkov/dev-perf report
```

with `$PWD/config.yaml` holding the run:

```yaml
repos:
  - https://github.com/org/repo-a.git
since: 2026-01-01
until: 2026-06-30
output: report.json
model: ${DEV_PERF_MODEL}
provider-url: ${DEV_PERF_PROVIDER_URL}
api-key: ${DEV_PERF_API_KEY}
```

The example above needs network access from the container to the
repository (fine for a public repo). Set `llm: false` for
deterministic stats only — no provider configuration needed.

To analyze a *local* repository, mount it into the container read-only
and reference the mount path from the config (the path is cloned into
the container's cache, so the working tree is never modified):

```console
docker run --rm \
  -v /path/to/repo:/repo:ro \
  -v "$PWD":/work \
  ghcr.io/ameshkov/dev-perf report
```

with `$PWD/config.yaml` holding `repos: [/repo]`, the range and
`llm: false`.

The `compile` command works the same way — mount the directory with the
JSON report and the config into `/work`, then read the markdown report
back from the host:

```console
docker run --rm \
  -v "$PWD":/work \
  ghcr.io/ameshkov/dev-perf compile
```

*Security*: the LLM analysis agent gets a `bash` tool that can execute
commands in the cloned repository. It is *not* hardened against a
hostile repository — use the Docker container to sandbox the analysis
away from your host.

## Configuration

The config file is the single source of options. The CLI carries no
functional flags beyond the command selectors and `--config <path>`
(else `./config.yaml` auto-loads when it exists) — every setting of a
run comes from the config file. Copy
[`config.example.yaml`](config.example.yaml) to `config.yaml`, edit the
values, and keep it out of version control (it is gitignored).

See [docs/configuration.md](docs/configuration.md) for the full
reference: every key, `${ENV_VAR}` expansion, repositories with branches
and `base-branch` deltas, ignored paths, the date range and period
unit, LLM limits, retries and caching, identity merging, parallelism,
compile settings, and verbose logging.

Simple example — the whole run configured through `config.yaml` (no
flags, no positional arguments):

```yaml
repos:
  - https://github.com/org/repo.git
since: 2026-01-01
until: 2026-06-30
llm: true
model: ${DEV_PERF_MODEL}
provider-url: ${DEV_PERF_PROVIDER_URL}
api-key: ${DEV_PERF_API_KEY}
users-map:
  'alice@example.com': 'Alice Smith'
```

```console
npx dev-perf report
```

## Additional Resources

- [Configuration reference](docs/configuration.md) — every config key,
  with examples.
- [Design document](docs/design.md) — the full design of the
  deterministic analysis, the in-process LLM layer, the report schema,
  and the compile layer.
- [Development guide](DEVELOPMENT.md) — local setup, build, manual
  testing, and the release process.
- [Contributor guide](AGENTS.md) — coding conventions and contribution
  instructions.
- [Changelog](CHANGELOG.md) — the version history.
