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
         alt="MCP Compress Router" width="600"/>
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

`dev-perf` is command-based: `report` builds the JSON report,
`compile` renders it into a markdown report with charts, and `version`
prints the application version (same as `--version`/`-V`). Running
`dev-perf` without a command prints the command list.

### Building a report

```text
dev-perf report [options] [repo...]

Build a JSON report of per-user contribution metrics.

Arguments:
  repo                   Git repository URL or local path (repeatable;
                         default: DEV_PERF_REPOS)

Options:
  --since <date>         Start date, e.g. 2026-01-01 (any git date format)
  --until <date>         End date (default: today)
  --unit <unit>          Split the range into periods: day, week, month,
                         quarter, year (requires --since)
  --output <file>        Write the JSON report to a file (default: stdout)
  --cache-dir <dir>      Cache directory for cloned repos and LLM results
                         (default: <tmpdir>/.dev-cache)
  --refresh              Force re-clone and re-analysis, invalidating the
                         LLM result cache
  --no-llm               Deterministic stats only, skip LLM analysis
  --model <model>        Model id, e.g. gpt-4.1 (required for LLM analysis)
  --provider-url <url>   OpenAI-compatible provider base URL (required for LLM)
  --api-key <key>        Provider API key (required for LLM; or DEV_PERF_API_KEY)
  --limit-context <n>    Max context tokens for LLM analysis (default: 262144)
  --limit-output <n>     Max output tokens for LLM analysis (default: 65536)
  --llm-retries <n>      Retry a failed LLM analysis up to <n> more times,
                         recreating the LLM runtime between attempts
                         (default: 2)
  --parallel <n>         Analyze up to <n> repositories in parallel
                         (default: 1)
  --verbose              Verbose logging
  -V, --version          Show version
  --help                 Show help
```

Date-only `--since`/`--until` values (e.g. `2026-01-01`) are interpreted as
UTC midnight: the range starts at the beginning of the `since` day and ends at
the beginning of the `until` day, so `--since 2026-01-01 --until 2026-03-01`
covers exactly two months. Bounds with an explicit time keep that time.

`--model`, `--provider-url` and `--api-key` are required for the LLM analysis.
`dev-perf` does not read your global configuration — provider, model and
API key are always specified explicitly. `--limit-context` and `--limit-output`
optionally cap the model window (defaults: 256k context / 64k output tokens).
The LLM layer runs fully in-process via the
`@earendil-works/pi-coding-agent` library — no external LLM binary is needed.

*Security*: the analysis agent gets a `bash` tool that can execute commands
in the cloned repository. It is *not* hardened against a hostile repository
— the prompt only instructs the agent to use it for read-only inspection, and
git's hooks, aliases, and config-driven execution cannot be reliably
defended against, so a repository under analysis must be treated as
untrusted. To sandbox the analysis away from the host, run the LLM analysis
in the published Docker container instead of on your machine
(see [Docker](#docker)); the container starts fresh each run and isolates
the cloned repositories from your host filesystem.

LLM analysis results are cached in the cache directory
(`<tmpdir>/.dev-cache/<hash>/llm/`), keyed by repo, user, date range, model and
limits — a rerun with the same parameters reuses them and makes no new calls.
`--refresh` forces a re-clone and invalidates the cached LLM results.

A failed LLM analysis is retried automatically instead of failing the run:
`--llm-retries <n>` (default 2) recreates the failed repository's in-process
LLM runtime and re-runs the analysis with the fresh runtime, reusing the
already-cached per-user results so only the failed sessions run again.
`--llm-retries 0` fails fast on the first failure.

Multiple repositories are analyzed sequentially by default.
`--parallel <n>` analyzes up to `n` repositories at once — with LLM
analysis enabled this runs up to `n` in-process runtimes concurrently
(bounded by `--parallel`; nothing is spawned, so no shared global
configuration can leak in). The analyzed range is resolved once from the first
clone before the parallel phase. Duplicate repository specs are
analyzed once, with a warning; the report lists each repository once.

Token usage: the report records, per user, the `tokenUsage` (input,
prompt-cache reads, and output tokens) reported by the provider.

stdout carries the report JSON only. Every `report` run starts by
logging the application version and the full resolved configuration to
stderr as one indented line per field: repositories, dates, unit,
output file, the resolved cache directory, refresh, LLM settings
(model, provider, masked API key), limits, retries, parallelism, and
verbose — so the effective settings are visible before the analysis,
and even when the run fails before the report is written. Every
`compile` run logs the version line as well.

`--verbose` additionally prints progress to stderr — the start of
long-running operations so it stays clear what dev-perf is doing right
now (cloning a repository, reading the commit history, creating the
LLM runtime, rendering compile charts), cache reuse vs a fresh
clone (with duration), the resolved author-date range, and per-repo
commit counts. Clone lines name the cache entry directory
(`.dev-cache/<hash>`), so a repository can be matched to its cache
entry from the log. Each line carries a millisecond timestamp and a
`[LEVEL]` tag (`[ERROR]`/`[WARN]`/`[INFO]`/`[DEBUG]`), and
per-repository lines are prefixed with the repository's label
(`[repo]`), so the progress of a parallel run stays traceable.
Redirect stderr to a `.log` file to get syntax highlighting in editors
that understand the standard log format (e.g. VS Code's Log mode).

Time-based period reports: with `--unit day|week|month|quarter|year`, the
`--since`/`--until` range is split into consecutive UTC-aligned periods (days
at midnight, weeks at Monday, months at the 1st, quarters at Jan/Apr/Jul/Oct,
years at Jan 1) and the report carries one full per-repository report per
period. Periods with no commits are included with zeroed metrics, the user
list is the same in every period, and the LLM analysis runs per period for
the users active in it. `--since` is required with `--unit` (an unbounded
range cannot be split). Without `--unit`, a single period covers the whole
range — the report is the same content, nested one level deeper under
`periods`.

Example:

```console
dev-perf report --since 2026-01-01 --until 2026-06-30 \
  --output report.json \
  --model gpt-4.1 \
  --provider-url https://api.openai.com/v1 \
  --api-key "$DEV_PERF_API_KEY" \
  --limit-context 1050000 \
  --limit-output 65500 \
  https://github.com/org/repo.git
```

Deterministic stats only (no LLM analysis — no provider configuration
needed):

```console
dev-perf report --no-llm --since 2026-01-01 --until 2026-06-30 \
  --output report.json /path/to/repo
```

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
dev-perf compile [options] <report>

Compile a JSON report into a markdown report with charts.

Arguments:
  report                 JSON report file (schema v2, as written by `report`;
                         default: DEV_PERF_COMPILE_REPORT)

Options:
  --output <dir>         Output directory for report.md and the assets/
                         charts (default: dev-perf-report)
  --map <email=name>     Map an author email to a display name, merging
                         identities (repeatable)
  --maps-file <path>     JSON file with email-to-name mappings
                         ({ "email": "Name" })
  --include-user <n|e>   Keep only matching users (repeatable; matches
                         display name or any email)
  --exclude-user <n|e>   Drop matching users (repeatable; cannot be
                         combined with --include-user)
  --repo <repo>          Keep only these repositories (repeatable; as
                         given on the command line)
  --exclude-repo <repo>  Drop these repositories (repeatable; cannot be
                         combined with --repo)
  --verbose              Verbose logging
  --help                 Show help
```

List options (`--map`, `--include-user`, `--exclude-user`, `--repo`,
`--exclude-repo`) accept comma-separated values and ignore empty
entries, so `--exclude-user "Alice, Bob"` excludes both users and
`--exclude-user ""` excludes no one. An empty `--output` falls back to
the `dev-perf-report` default.

`compile` reads the JSON report produced by `report`, filters and
merges it, renders every chart as an SVG with Vega-Lite (pure Node,
no browser), and writes `report.md` plus the `assets/` directory into
the output directory. The report covers the team dynamics — points
per period, contributions stacked by size, complexity and work type,
contributions with a cumulative line, commits with a cumulative
line, lines added vs removed, active users, top languages — the
per-repository comparison (with multiple repositories), per-user
dynamics (per-period points and contributions, or commits and lines
without LLM analysis), and the LLM summary (work-type/size/complexity
pies, quality and risk tallies, per-user token usage). Tables carry the
totals, per-repository and
per-contributor rankings, contributions, and the appendix documents
parameters, applied filters, email mappings, and size weights
(`xs=1, s=2, m=3, l=5, xl=8` for the weighted points). Time-based
dynamics require a report generated with `--unit`; the compiled
report notes it when the input has a single period.

`--map`/`--maps-file` merge author emails into one identity:
deterministic metrics are summed (active days take the max — the
report carries no per-day data), LLM contributions are concatenated,
and repository stats are recomputed after filtering.

Example — compile a monthly report for two repos, merging an email
alias and excluding one user:

```console
dev-perf report --no-llm --since 2026-01-01 --until 2026-06-30 \
  --unit month --output report.json https://github.com/org/repo-a.git
dev-perf compile report.json --output ./team-report \
  --map "alice+work@example.com=Alice" \
  --exclude-user "ci-bot@example.com"
```

The markdown report references the charts by relative path
(`![...](assets/team-commits-per-period.svg)`), so the output
directory is portable as a unit — open `report.md` in GitHub, VS
Code, or any markdown viewer that renders local images.

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

`dev-perf report` runs the LLM analysis by default. The full command
passes the model provider explicitly — `--model`, `--provider-url`
and `--api-key` (or the `DEV_PERF_*` environment variables). Every
`docker run` starts with a fresh container, so anything written inside
it is lost on exit: mount a host directory at `/tmp/.dev-cache` to
reuse cloned repositories and cached LLM results across runs, and
mount a directory at `/work` (the image's working directory) so the
`--output` report file lands on the host:

```console
docker run --rm \
  -v "$PWD":/work \
  -v "$HOME/.dev-perf-cache":/tmp/.dev-cache \
  ghcr.io/ameshkov/dev-perf report \
  --since 2026-01-01 --until 2026-06-30 \
  --output report.json \
  --model gpt-4.1 \
  --provider-url https://api.openai.com/v1 \
  --api-key "$DEV_PERF_API_KEY" \
  https://github.com/org/repo.git
```

The example above needs network access from the container to the
repository (fine for a public repo). Pass `--no-llm` for deterministic
stats only — no provider configuration needed:

```console
docker run --rm \
  -v "$PWD":/work \
  -v "$HOME/.dev-perf-cache":/tmp/.dev-cache \
  ghcr.io/ameshkov/dev-perf report --no-llm \
  --since 2026-01-01 --until 2026-06-30 \
  --output report.json https://github.com/org/repo.git
```

To analyze a *local* repository, mount it into the container
read-only and pass the mount path (the path is cloned into the
container's cache, so the working tree is never modified):

```console
docker run --rm \
  -v /path/to/repo:/repo:ro \
  -v "$PWD":/work \
  ghcr.io/ameshkov/dev-perf report --no-llm \
  --output report.json /repo
```

The `compile` command works the same way — mount the directory with the
JSON report and the output directory into `/work`, then read the
markdown report back from the host:

```console
docker run --rm \
  -v "$PWD":/work \
  ghcr.io/ameshkov/dev-perf compile report.json --output dev-perf-report
```

## Configuration

Every `report` command-line option has a `DEV_PERF_*` environment
variable equivalent; when both are given, the flag wins. A `.env` file
in the current working directory is loaded automatically at startup —
copy [`.env.example`](.env.example), fill in the values you need, and
keep it out of version control (it is gitignored). Values already
exported in the shell are never overridden by `.env`.

| CLI option | Environment variable | Notes |
| --- | --- | --- |
| `<repo...>` | `DEV_PERF_REPOS` | Comma-separated list |
| `--since <date>` | `DEV_PERF_SINCE` | Any git date format |
| `--until <date>` | `DEV_PERF_UNTIL` | Default: today |
| `--unit <unit>` | `DEV_PERF_UNIT` | day/week/month/quarter/year; requires `--since` |
| `--output <file>` | `DEV_PERF_OUTPUT` | Default: stdout |
| `--cache-dir <dir>` | `DEV_PERF_CACHE_DIR` | Default: `<tmpdir>/.dev-cache` |
| `--refresh` | `DEV_PERF_REFRESH` | Boolean |
| `--no-llm` | `DEV_PERF_NO_LLM` | Boolean; `true` skips LLM analysis |
| `--model <model>` | `DEV_PERF_MODEL` | Required for LLM analysis |
| `--provider-url <url>` | `DEV_PERF_PROVIDER_URL` | Required for LLM analysis |
| `--api-key <key>` | `DEV_PERF_API_KEY` | Required for LLM analysis |
| `--limit-context <n>` | `DEV_PERF_LIMIT_CONTEXT` | Default: 262144 |
| `--limit-output <n>` | `DEV_PERF_LIMIT_OUTPUT` | Default: 65536 |
| `--llm-retries <n>` | `DEV_PERF_LLM_RETRIES` | Retries for a failed LLM analysis; default 2 |
| `--parallel <n>` | `DEV_PERF_PARALLEL` | Repositories analyzed concurrently; default 1 |
| `--verbose` | `DEV_PERF_VERBOSE` | Boolean |

Every `compile` option has a `DEV_PERF_COMPILE_*` variable:

| CLI option | Environment variable | Notes |
| --- | --- | --- |
| `<report>` | `DEV_PERF_COMPILE_REPORT` | JSON report file (schema v2) |
| `--output <dir>` | `DEV_PERF_COMPILE_OUTPUT` | Default: dev-perf-report |
| `--map <email=name>` | `DEV_PERF_COMPILE_MAP` | Comma-separated list |
| `--maps-file <path>` | `DEV_PERF_COMPILE_MAPS_FILE` | JSON `{ "email": "Name" }` |
| `--include-user <n\|e>` | `DEV_PERF_COMPILE_INCLUDE_USER` | Comma-separated list |
| `--exclude-user <n\|e>` | `DEV_PERF_COMPILE_EXCLUDE_USER` | Comma-separated list |
| `--repo <repo>` | `DEV_PERF_COMPILE_REPO` | Comma-separated list |
| `--exclude-repo <repo>` | `DEV_PERF_COMPILE_EXCLUDE_REPO` | Comma-separated list |
| `--verbose` | `DEV_PERF_VERBOSE` | Boolean |

Boolean environment variables accept `1`/`true`/`yes`/`on` and
`0`/`false`/`no`/`off`.

Example — the whole run configured through the environment (no flags,
no positional arguments):

```console
DEV_PERF_REPOS=https://github.com/org/repo.git \
DEV_PERF_NO_LLM=true \
DEV_PERF_OUTPUT=report.json \
dev-perf report
```

## Additional Resources

- [Design document](docs/design.md) — the full design of the
  deterministic analysis, the in-process LLM layer, the report schema,
  and the compile layer.
- [Development guide](DEVELOPMENT.md) — local setup, build, manual
  testing, and the release process.
- [Contributor guide](AGENTS.md) — coding conventions and contribution
  instructions.
- [Changelog](CHANGELOG.md) — the version history.
