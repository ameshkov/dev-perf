# Configuration

The config file is the single source of options. The CLI carries
exactly one flag beyond the command selectors — `--config <path>`
(else `./config.yaml` auto-loads from the working directory when it
exists) — and every functional setting lives in the config file. The
file is shared by `report` and `compile`: top-level keys apply to both,
and `compile`-only keys live under a nested `compile` section. Copy
[`config.example.yaml`](../config.example.yaml) to `config.yaml`, edit
the values, and keep it out of version control (it is gitignored).

## Environment variable expansion

`${ENV_VAR}` references in the config are replaced by the environment,
so the LLM provider configuration (model, provider URL, API key) stays
out of the repository:

```yaml
model: ${DEV_PERF_MODEL}
provider-url: ${DEV_PERF_PROVIDER_URL}
api-key: ${DEV_PERF_API_KEY}
```

Each referenced variable must be set in the environment (or in a
[`.env`](../.env.example) file, auto-loaded at startup); a run errors
out naming the file and the variable when it is unset or empty.
Expansion happens before YAML parsing, so `refresh: ${DEV_PERF_REFRESH}`
with a `"true"` value is read as a boolean. The `DEV_PERF_*`
environment variables are no longer option sources.

## Key reference

| Key | Commands | Type | Notes |
| --- | --- | --- | --- |
| `repos` | report, compile | list | Repositories: `string` or `{ repo, branch?, base-branch?, ignore? }`; a structured `branch` selects that branch as a delta vs the base (default: the default branch, `base-branch` overrides, `''` = full history); ignored paths are excluded; `compile` keep-filter |
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

## Repositories (`repos`)

Each repository is a dash item. A plain string is a bare repository
analyzed on its default branch; use the structured form below to
analyze a specific branch instead. Each branch is cached under its own
cache entry, so switching branches never reuses the wrong clone.

Analyzing the default branch covers its full history; a non-default
branch is scoped to its *branch-delta* — only the commits not yet on
the base branch are analyzed (per-release attribution). The base
defaults to the repository's own default branch (resolved from
`origin/HEAD`), then `main` before a stale leftover `master`;
`base-branch` overrides it, and an empty `base-branch` (`''`) restores
the branch's full history. A release branch merged back into the base
collapses its delta, so delta analysis suits live release branches, not
post-merge retrospectives.

```yaml
repos:
  - https://github.com/org/repo.git
  - repo: https://github.com/org/other.git
    branch: release/v5
    base-branch: main        # omit for the default (repo default, then main)
    ignore:
      - docs/
      - vendor/
```

Ignored paths are gitignore-style (no `!` negation): a trailing `/`
excludes a directory subtree, a pattern without a `/` matches a
basename at any depth, and a slash-carrying pattern is root-anchored,
with `*`/`?` within a segment and `**` across segments. Commits whose
files all fall under ignored paths are dropped entirely; a mixed commit
keeps only its non-ignored files. Both the deterministic metrics and
the LLM layer are exclusion-free, the LLM is told which branch and
paths are excluded, and each report entry records the analyzed branch,
the `ignoredPaths` when any were configured, and the resolved
`baseBranch` when the analysis was scoped to a branch-delta (the LLM
then receives a scope note naming the base, and the base is part of its
result cache key).

## Date range (`since` / `until`)

Date-only `since`/`until` values (e.g. `2026-01-01`) are interpreted as
UTC midnight: the range starts at the beginning of the `since` day and
ends at the beginning of the `until` day, so `since: 2026-01-01` and
`until: 2026-03-01` cover exactly two months. Bounds with an explicit
time keep that time.

## Period unit (`unit`)

With `unit: day|week|month|quarter|year`, the `since`/`until` range is
split into consecutive UTC-aligned periods (days at midnight, weeks at
Monday, months at the 1st, quarters at Jan/Apr/Jul/Oct, years at
Jan 1) and the report carries one full per-repository report per
period. Periods with no commits are included with zeroed metrics, the
user list is the same in every period, and the LLM analysis runs per
period for the users active in it. `since` is required with `unit` (an
unbounded range cannot be split). Without `unit`, a single period
covers the whole range — the report is the same content, nested one
level deeper under `periods`.

## LLM analysis (`llm`, `model`, limits, retries, caching)

`model`, `provider-url` and `api-key` are required for the LLM
analysis. `dev-perf` does not read your global configuration — provider,
model and API key are always specified explicitly in the config
(typically as `${ENV_VAR}` references). `limit-context` and
`limit-output` optionally cap the model window (defaults: 256k context /
64k output tokens). The LLM layer runs fully in-process via the
`@earendil-works/pi-coding-agent` library — no external LLM binary is
needed. Set `llm: false` for deterministic stats only, with no provider
configuration.

LLM analysis results are cached in the cache directory
(`<tmpdir>/.dev-cache/<hash>/llm/`), keyed by repo, branch, its head
sha, the base and base sha, ignored paths, user, date range, model and
limits — a rerun with the same parameters reuses them and makes no new
calls, while an advancing branch or base (whose names stay the same)
re-keys the cache instead of reusing a stale analysis. Setting
`refresh: true` forces a re-clone and invalidates the cached LLM
results.

A failed LLM analysis is retried automatically instead of failing the
run: `llm-retries` (default 2) recreates the failed repository's
in-process LLM runtime and re-runs the analysis with the fresh runtime,
reusing the already-cached per-user results so only the failed sessions
run again. `llm-retries: 0` fails fast on the first failure.

Token usage: the report records, per user, the `tokenUsage` (input,
prompt-cache reads, and output tokens) reported by the provider.

*Security*: the analysis agent gets a `bash` tool that can execute
commands in the cloned repository. It is *not* hardened against a
hostile repository — the prompt only instructs the agent to use it for
read-only inspection, and git's hooks, aliases, and config-driven
execution cannot be reliably defended against, so a repository under
analysis must be treated as untrusted. To sandbox the analysis away
from the host, run the LLM analysis in the published Docker container
instead of on your machine (see the README); the container starts fresh
each run and isolates the cloned repositories from your host
filesystem.

## Identity merging (`users-map`)

The `users-map` key merges author emails that belong to the same person
into one identity **during analysis**, so the person's deterministic
metrics are exact (commits, lines, files summed from every email) and
the LLM runs one session per merged identity. Emails mapping to the
same display name merge under that name. The JSON report then carries
the full `emails` list for that identity. Without a mapping, every
distinct email is its own identity.

```yaml
users-map:
  'jane.doe@example.com': 'Jane Doe'
  'jane@work.com': 'Jane Doe'
```

## Parallelism (`parallel`)

Multiple repositories are analyzed sequentially by default. `parallel`
(default 1) analyzes up to that many repositories at once — with LLM
analysis enabled this runs that many in-process runtimes concurrently
(nothing is spawned, so no shared global configuration can leak in).
The analyzed range is resolved once from the first clone before the
parallel phase. Duplicate repository specs are analyzed once, with a
warning; the report lists each repository once.

## Compile settings (`compile`)

The `compile` step reads its settings from the config file: the input
JSON report (`compile.report`), the output directory
(`compile.output`), the user and repository selection
(`compile.include-users`, `compile.exclude-users`,
`compile.exclude-repos`, and the top-level `repos` as the keep-filter),
and identity merging (the `users-map` key). List keys take YAML lists;
empty list items are ignored. An empty `output` falls back to the
`dev-perf-report` default.

The `users-map` mapping merges author emails into one identity:
deterministic metrics are summed (active days are the union of the
merged entries' `YYYY-MM-DD` dates), LLM contributions are
concatenated, and repository stats are recomputed after filtering.

```yaml
compile:
  report: report.json
  output: ./team-report
  'exclude-users':
    - ci-bot@example.com
users-map:
  'alice+work@example.com': 'Alice'
```

## Verbose logging (`verbose`)

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

## Example

The whole run configured through `config.yaml` (no flags, no positional
arguments):

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
