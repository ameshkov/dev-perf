# dev-perf

`dev-perf` is a CLI tool that measures developer contributions to git repositories
and produces a JSON report of per-user metrics.

## What it does

Given one or more repositories (any git URL) and a date range, `dev-perf`:

1. **Clones** each repository into a local, gitignored cache directory
   (`.dev-perf/cache` by default).
2. **Counts deterministically** — straight from git history — commits, lines
   added/removed, files touched, churn, active days, and per-language contribution
   sizes (cloc-style counting applied to contributions).
3. **Analyzes with an LLM agent** — using [opencode](https://opencode.ai) as a
   library (`@opencode-ai/sdk`). For each contributor, an agent with read access to
   the repository inspects the actual commits and diffs and assesses the dimensions
   that cannot be counted: the type of work (feature, bug fix, refactoring, docs…),
   complexity, areas of impact, and quality signals.
4. **Merges** the deterministic and LLM results into a single JSON report, per
   repository and per user.

## Usage

`dev-perf` is command-based: `report` builds the JSON report, and
further commands (e.g. a `compile` that renders a report into a
markdown document with charts) will be added alongside it. Running
`dev-perf` without a command prints the command list.

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
                         (default: .dev-perf/cache)
  --refresh              Force re-clone and re-analysis, invalidating the
                         LLM result cache
  --no-llm               Deterministic stats only, skip LLM analysis
  --model <model>        Model id, e.g. gpt-4.1 (required for LLM analysis)
  --provider-url <url>   OpenAI-compatible provider base URL (required for LLM)
  --api-key <key>        Provider API key (required for LLM; or DEV_PERF_API_KEY)
  --limit-context <n>    Max context tokens for LLM analysis (default: 262144)
  --limit-output <n>     Max output tokens for LLM analysis (default: 65536)
  --verbose              Verbose logging
  --help                 Show help
```

Date-only `--since`/`--until` values (e.g. `2026-01-01`) are interpreted as
UTC midnight: the range starts at the beginning of the `since` day and ends at
the beginning of the `until` day, so `--since 2026-01-01 --until 2026-03-01`
covers exactly two months. Bounds with an explicit time keep that time.

`--model`, `--provider-url` and `--api-key` are required for the LLM analysis.
`dev-perf` does not read your global opencode configuration — provider, model and
API key are always specified explicitly. `--limit-context` and `--limit-output`
optionally cap the model window (defaults: 256k context / 64k output tokens).
The `opencode` CLI must be installed and on `PATH` (the analysis runs opencode
as a library, scoped to each cloned repository).

LLM analysis results are cached in the cache directory
(`.dev-perf/cache/<hash>/llm/`), keyed by repo, user, date range, model and
limits — a rerun with the same parameters reuses them and makes no new calls.
`--refresh` forces a re-clone and invalidates the cached LLM results.

Cost visibility: the report records, per user, the `tokenUsage` (input/output
tokens) and the `estimatedCostUsd` from the provider's event stream, so runaway
costs are visible in the report itself.

`--verbose` prints progress to stderr — cache reuse vs a fresh clone (with
duration), the resolved author-date range, and per-repo commit counts. stdout
carries nothing but the report JSON, and a default run is silent apart from
errors and warnings (e.g. when a host rejects partial clones and the full-clone
fallback kicks in).

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
dev-perf report --no-llm --since 2026-01-01 --until 2026-06-30 /path/to/repo
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
                "tokenUsage": { "input": 102400, "output": 5120 },
                "estimatedCostUsd": 0.0031
              }
            }
          ]
        }
      ]
    }
  ]
}
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
| `--cache-dir <dir>` | `DEV_PERF_CACHE_DIR` | Default: .dev-perf/cache |
| `--refresh` | `DEV_PERF_REFRESH` | Boolean |
| `--no-llm` | `DEV_PERF_NO_LLM` | Boolean; `true` skips LLM analysis |
| `--model <model>` | `DEV_PERF_MODEL` | Required for LLM analysis |
| `--provider-url <url>` | `DEV_PERF_PROVIDER_URL` | Required for LLM analysis |
| `--api-key <key>` | `DEV_PERF_API_KEY` | Required for LLM analysis |
| `--limit-context <n>` | `DEV_PERF_LIMIT_CONTEXT` | Default: 262144 |
| `--limit-output <n>` | `DEV_PERF_LIMIT_OUTPUT` | Default: 65536 |
| `--verbose` | `DEV_PERF_VERBOSE` | Boolean |

Boolean environment variables accept `1`/`true`/`yes`/`on` and
`0`/`false`/`no`/`off`.

Example — the whole run configured through the environment (no flags,
no positional arguments):

```console
DEV_PERF_REPOS=https://github.com/org/repo.git \
DEV_PERF_NO_LLM=true \
dev-perf report
```

## Status

Both analysis layers are implemented: the deterministic path (milestone
M2) and the LLM agentic layer (milestone M3). `dev-perf report --no-llm
<repo>` clones the repository (into the cache, reusing it on later
runs) and produces the JSON report — commits, lines, files, active
days, and per-language contributions, per user and per repository. A
run without `--no-llm` additionally starts an opencode server per
repository and produces per-user `llm` entries: `status: "completed"`
with the assessed work types, complexity, areas, quality signals and
risk flags, plus token usage and estimated cost. LLM failures (e.g. a
provider rejecting the key, or a session that never calls the report
tool) fail the run fast with a clear message and no report is written.
See [docs/design.md](docs/design.md) for the full design and
implementation plan.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for the local setup, build
commands, manual testing, and release process. The project uses the
same tooling as
[mcp-compress-router](https://github.com/ameshkov/mcp-compress-router):
pnpm, TypeScript, Vitest, oxlint, Knip, Prettier, Markdownlint, and
Husky pre-commit checks.
