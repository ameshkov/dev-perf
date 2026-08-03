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

```text
dev-perf [options] <repo...>

Arguments:
  repo                   Git repository URL or local path (repeatable)

Options:
  --since <date>         Start date, e.g. 2026-01-01 (any git date format)
  --until <date>         End date (default: today)
  --output <file>        Write the JSON report to a file (default: stdout)
  --cache-dir <dir>      Cache directory for cloned repos and LLM results
                         (default: .dev-perf/cache)
  --no-llm               Deterministic stats only, skip LLM analysis
  --model <model>        Model id, e.g. gpt-4.1 (required for LLM analysis)
  --provider-url <url>   OpenAI-compatible provider base URL (required for LLM)
  --api-key <key>        Provider API key (required for LLM; or DEV_PERF_API_KEY)
  --limit-context <n>    Max context tokens for LLM analysis (default: 262144)
  --limit-output <n>     Max output tokens for LLM analysis (default: 65536)
  --verbose              Verbose logging
  --help                 Show help
```

`--model`, `--provider-url` and `--api-key` are required for the LLM analysis.
`dev-perf` does not read your global opencode configuration — provider, model and
API key are always specified explicitly. `--limit-context` and `--limit-output`
optionally cap the model window (defaults: 256k context / 64k output tokens).

Example:

```console
dev-perf --since 2026-01-01 --until 2026-06-30 \
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
dev-perf --no-llm --since 2026-01-01 --until 2026-06-30 /path/to/repo
```

Example output (abridged):

```json
{
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
            ]
          }
        }
      ]
    }
  ]
}
```

## Status

The deterministic analysis path (milestone M2) is implemented:
`dev-perf --no-llm <repo>` clones the repository (into the cache,
reusing it on later runs) and produces the JSON report — commits,
lines, files, active days, and per-language contributions, per user
and per repository. The LLM-based agentic layer (design §6, plan steps
6-8) is not implemented yet, so runs without `--no-llm` fail
validation until then. See [docs/design.md](docs/design.md) for the
full design and implementation plan.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for the local setup, build
commands, manual testing, and release process. The project uses the
same tooling as
[mcp-compress-router](https://github.com/ameshkov/mcp-compress-router):
pnpm, TypeScript, Vitest, oxlint, Knip, Prettier, Markdownlint, and
Husky pre-commit checks.
