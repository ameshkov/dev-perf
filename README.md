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
   added/removed, files touched, churn, active days, and per-language contribution
   sizes (cloc-style counting applied to contributions).
3. **Analyzes with an LLM agent** — fully in-process via
   [`@earendil-works/pi-coding-agent`](https://github.com/earendil-works/pi)
   (no spawned server). For each contributor, an agent with read access to
   the repository inspects the actual commits and diffs and assesses the
   dimensions that cannot be counted: the type of work (feature, bug fix,
   refactoring, docs…), complexity, areas of impact, and quality signals.
4. **Merges** the deterministic and LLM results into a single JSON report, per
   repository and per user.

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
config file (see [Configuration](#configuration)). The `repos` key
takes each repository as a dash item; append `#branch` to a repository
to analyze that branch of it instead of its default
(`https://github.com/org/repo.git#dev` analyzes the `dev` branch alone,
while every other repository keeps its default or its own `#branch`).
Each branch is cached under its own cache entry, so switching branches
never reuses the wrong clone.

Date-only `since`/`until` values (e.g. `2026-01-01`) are interpreted as
UTC midnight: the range starts at the beginning of the `since` day and
ends at the beginning of the `until` day, so `since: 2026-01-01` and
`until: 2026-03-01` cover exactly two months. Bounds with an explicit
time keep that time.

`model`, `provider-url` and `api-key` are required for the LLM
analysis. `dev-perf` does not read your global configuration — provider,
model and API key are always specified explicitly in the config
(typically as `${ENV_VAR}` references). `limit-context` and
`limit-output` optionally cap the model window (defaults: 256k context /
64k output tokens). The LLM layer runs fully in-process via the
`@earendil-works/pi-coding-agent` library — no external LLM binary is
needed.

*Security*: the analysis agent gets a `bash` tool that can execute
commands in the cloned repository. It is *not* hardened against a
hostile repository — the prompt only instructs the agent to use it for
read-only inspection, and git's hooks, aliases, and config-driven
execution cannot be reliably defended against, so a repository under
analysis must be treated as untrusted. To sandbox the analysis away
from the host, run the LLM analysis in the published Docker container
instead of on your machine (see [Docker](#docker)); the container
starts fresh each run and isolates the cloned repositories from your
host filesystem.

LLM analysis results are cached in the cache directory
(`<tmpdir>/.dev-cache/<hash>/llm/`), keyed by repo, user, date range,
model and limits — a rerun with the same parameters reuses them and
makes no new calls. Setting `refresh: true` forces a re-clone and
invalidates the cached LLM results.

A failed LLM analysis is retried automatically instead of failing the
run: `llm-retries` (default 2) recreates the failed repository's
in-process LLM runtime and re-runs the analysis with the fresh runtime,
reusing the already-cached per-user results so only the failed sessions
run again. `llm-retries: 0` fails fast on the first failure.

Multiple repositories are analyzed sequentially by default.
`parallel` (default 1) analyzes up to that many repositories at once —
with LLM analysis enabled this runs that many in-process runtimes
concurrently (nothing is spawned, so no shared global configuration can
leak in). The analyzed range is resolved once from the first clone
before the parallel phase. Duplicate repository specs are analyzed
once, with a warning; the report lists each repository once.

Token usage: the report records, per user, the `tokenUsage` (input,
prompt-cache reads, and output tokens) reported by the provider.

stdout carries the report JSON only. Every command run prints its
start and end to stderr (`starting report` / `finished report in
1234 ms`). Every `report` run additionally starts by logging the
application version and the full resolved configuration to stderr as
one indented line per field: repositories, dates, unit, output file,
the config file, the resolved cache directory, refresh, LLM settings
(model, provider, masked API key), limits, retries, parallelism, and
verbose — so the effective settings are visible before the analysis,
and even when the run fails before the report is written. Every
`compile` run logs the version line as well. Each line carries a
millisecond timestamp and a `[LEVEL]` tag
(`[ERROR]`/`[WARN]`/`[INFO]`/`[DEBUG]`).

Setting `verbose: true` additionally prints progress to stderr — the
start of long-running operations so it stays clear what dev-perf is
doing right now (cloning a repository, reading the commit history,
creating the LLM runtime, rendering compile charts), cache reuse vs a
fresh clone (with duration), the resolved author-date range, and
per-repo commit counts. Per-repository lines are prefixed with the
repository's label (`[repo]`), so the progress of a parallel run stays
traceable. Clone lines name the cache entry directory
(`.dev-cache/<hash>`), so a repository can be matched to its cache
entry from the log. Redirect stderr to a `.log` file to get syntax
highlighting in editors that understand the standard log format (e.g.
VS Code's Log mode).

Time-based period reports: with `unit: day|week|month|quarter|year`,
the `since`/`until` range is split into consecutive UTC-aligned periods
(days at midnight, weeks at Monday, months at the 1st, quarters at
Jan/Apr/Jul/Oct, years at Jan 1) and the report carries one full
per-repository report per period. Periods with no commits are included
with zeroed metrics, the user list is the same in every period, and the
LLM analysis runs per period for the users active in it. `since` is
required with `unit` (an unbounded range cannot be split). Without
`unit`, a single period covers the whole range — the report is the same
content, nested one level deeper under `periods`.

Identity merging at report time: the config `users-map` key merges
author emails that belong to the same person into one identity
**during analysis**, so the person's deterministic metrics are exact
(commits, lines, files summed from every email) and the LLM runs one
session per merged identity. Emails mapping to the same display name
merge under that name. The JSON report then carries the full `emails`
list for that identity. Without a mapping, every distinct email is its
own identity.

```yaml
repos:
  - /path/to/repo
since: 2026-01-01
until: 2026-06-30
llm: false
users-map:
  'jane.doe@example.com': 'Jane Doe'
  'jane@work.com': 'Jane Doe'
```

```console
npx dev-perf report
```

Example — an LLM-enabled run writing the report to a file:

```yaml
repos:
  - https://github.com/org/repo.git
since: 2026-01-01
until: 2026-06-30
output: report.json
model: ${DEV_PERF_MODEL}
provider-url: ${DEV_PERF_PROVIDER_URL}
api-key: ${DEV_PERF_API_KEY}
limit-context: 1050000
limit-output: 65500
```

```console
npx dev-perf report
```

Deterministic stats only (no LLM analysis — no provider configuration
needed): set `llm: false`.

Example output (abridged):

```json
{
  "schemaVersion": 2,
  "parameters": {
    "repos": ["https://github.com/org/repo.git"],
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
                "activeDays": 15,
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

### Compiling a markdown report with charts

```text
npx dev-perf compile --config <path>

Compile a JSON report into a markdown report with charts.

Options:
  --config <path>   YAML config file (default: ./config.yaml when it exists)
  -V, --version     Show version
  --help            Show help
```

The `compile` step reads its settings from the config file: the input
JSON report (`compile.report`), the output directory
(`compile.output`), the user and repository selection
(`compile.include-users`, `compile.exclude-users`,
`compile.exclude-repos`, and the top-level `repos` as the keep-filter),
and identity merging (the `users-map` key). List keys take YAML lists;
empty list items are ignored. An empty `output` falls back to the
`dev-perf-report` default.

```yaml
compile:
  report: report.json
  output: ./team-report
  'exclude-users':
    - ci-bot@example.com
users-map:
  'alice+work@example.com': 'Alice'
```

```console
npx dev-perf compile
```

`compile` reads the JSON report produced by `report`, filters and
merges it, renders every chart as an SVG with Vega-Lite (pure Node,
no browser), and writes `report.md` plus the `assets/` directory into
the output directory. The report covers the team dynamics — points
per period, contributions stacked by size, complexity and work type,
contributions with a cumulative line, commits with a cumulative line,
lines added vs removed, active users, top languages — the
per-repository comparison (with multiple repositories), per-user
dynamics (per-period points and contributions, or commits and lines
without LLM analysis), and the LLM summary (work-type/size/complexity
pies, quality and risk tallies, per-user token usage). Tables carry the
totals, per-repository and per-contributor rankings, contributions, and
the appendix documents parameters, applied filters, email mappings, and
size weights (`xs=1, s=2, m=3, l=5, xl=8` for the weighted points).
Time-based dynamics require a report generated with `unit`; the
compiled report notes it when the input has a single period.

The `users-map` mapping merges author emails into one identity:
deterministic metrics are summed (active days take the max — the
report carries no per-day data), LLM contributions are concatenated,
and repository stats are recomputed after filtering.

Example — compile a monthly report for two repos, merging an email
alias and excluding one user:

```yaml
repos:
  - https://github.com/org/repo-a.git
since: 2026-01-01
until: 2026-06-30
llm: false
unit: month
output: report.json
compile:
  report: report.json
  output: ./team-report
  'exclude-users':
    - ci-bot@example.com
users-map:
  'alice+work@example.com': 'Alice'
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
back from the host (`$PWD/config.yaml` sets `compile.report` and
`compile.output`):

```console
docker run --rm \
  -v "$PWD":/work \
  ghcr.io/ameshkov/dev-perf compile
```

## Configuration

The config file is the single source of options. The CLI carries
exactly one flag beyond the command selectors — `--config <path>`
(else `./config.yaml` auto-loads from the working directory when it
exists) — and every functional setting lives in the config file. The
file is shared by `report` and `compile`: top-level keys apply to both,
and `compile`-only keys live under a nested `compile` section. Copy
[`config.example.yaml`](config.example.yaml) to `config.yaml`, edit the
values, and keep it out of version control (it is gitignored).

`${ENV_VAR}` references in the config are replaced by the environment,
so the LLM provider configuration (model, provider URL, API key) stays
out of the repository:

```yaml
model: ${DEV_PERF_MODEL}
provider-url: ${DEV_PERF_PROVIDER_URL}
api-key: ${DEV_PERF_API_KEY}
```

Each referenced variable must be set in the environment (or in a
[`.env`](.env.example) file, auto-loaded at startup); a run errors out
naming the file and the variable when it is unset or empty. Expansion
happens before YAML parsing, so `refresh: ${DEV_PERF_REFRESH}` with a
`"true"` value is read as a boolean. The `DEV_PERF_*` environment
variables are no longer option sources.

| Key | Commands | Type | Notes |
| --- | --- | --- | --- |
| `repos` | report, compile | list | Repositories; `repo#branch` analyzes that branch; `compile` keep-filter |
| `since` / `until` | report | string | Date range; any git date format |
| `unit` | report | string | day/week/month/quarter/year; requires `since` |
| `output` | report | string | JSON report file |
| `cache-dir` | report | string | Default: `<tmpdir>/.dev-cache` |
| `refresh` | report | boolean | Force re-clone and re-analysis |
| `llm` | report | boolean | LLM analysis enabled; default `true` |
| `model` / `provider-url` / `api-key` | report | string | Required for LLM analysis; never from your global config |
| `limit-context` / `limit-output` / `llm-retries` | report | number | Defaults 262144 / 65536 / 2 |
| `users-map` | report, compile | mapping | `email: name`; merging identities under the name |
| `parallel` | report | number | Default 1 |
| `compile.report` | compile | string | Input JSON report file (schema v2, as written by `report`) |
| `compile.output` | compile | string | Markdown report output directory; default `dev-perf-report` |
| `compile.include-users` / `exclude-users` / `exclude-repos` | compile | list | User and repository selection |
| `verbose` | report, compile | boolean | Verbose logging |

The keys carry YAML types: booleans are `true` / `false`, and the
numeric keys hold numbers, so the values flow into the option schemas
unchanged. List keys take YAML lists; empty entries are ignored.

Example — the whole run configured through `config.yaml` (no flags, no
positional arguments):

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

The config is the single source — nothing is overridable from the
command line beyond which command runs and which config file to read.
To change the settings of a run, edit the config file.

## Additional Resources

- [Design document](docs/design.md) — the full design of the
  deterministic analysis, the in-process LLM layer, the report schema,
  and the compile layer.
- [Development guide](DEVELOPMENT.md) — local setup, build, manual
  testing, and the release process.
- [Contributor guide](AGENTS.md) — coding conventions and contribution
  instructions.
- [Changelog](CHANGELOG.md) — the version history.
