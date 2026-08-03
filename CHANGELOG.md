# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Report assembler (`src/report/assemble.ts`, design §7): builds the
  report document — parameters, per-repository entries (repo,
  clonePath, branch, head, analyzed range, stats), and per-user
  entries with deterministic metrics and `llm: { status: "skipped" }`
  — validated against the shared report schema.
- Pipeline orchestration (`src/pipeline.ts`, plan step 5): for each
  repository — clone/cache reuse (`ensureClone`), commit extraction,
  author grouping, and report assembly — then writes the pretty JSON
  report to stdout or the `--output` file. The analyzed author-date
  range is resolved with git's own date parser (UTC) into
  `parameters` and each repository's `range`; an unbounded side is
  the empty string, and a missing `--until` defaults to "today".
- The CLI action now runs the analysis pipeline instead of throwing
  the not-implemented error: `dev-perf --no-llm <repo>` produces the
  JSON report (milestone M2, first usable release path).
- `resolveBoundDate` (`src/deterministic/commits.ts`): resolves a
  git-format date to the instant git uses for scan bounds (design
  §5.4), shared by `readCommits` and the pipeline's range reporting.
- `ensureClone` now clones empty repositories (no commits yet): the
  head is recorded as the empty string, and the branch comes from
  `git branch --show-current`, which works without a HEAD.
- End-to-end test (`test/e2e/deterministic.test.ts`, design §9): runs
  the compiled CLI with `--no-llm` against a fixture repo as a child
  process and checks the emitted JSON exactly (skipped when `build/`
  is missing).
- Pipeline and assembler unit tests (`src/pipeline.test.ts`,
  `src/report/assemble.test.ts`), and a CLI surface test that runs
  the pipeline against a fixture repo.
- Deterministic metrics (`src/deterministic/metrics.ts`, design §5.2):
  per-user aggregation over parsed commits — commits, non-merge and
  merge counts, lines added/removed, net lines, files touched
  (commit-file pairs) and unique files, active days (distinct UTC
  author dates), first/last author dates (UTC), average non-merge
  commit size, and per-language contributions — plus repo-level
  statistics (total commits, total users, top languages by lines
  added).
- Language identification (`src/deterministic/languages.ts`, design
  §5.2): a built-in extension→language map (with well-known
  extensionless filenames like `Dockerfile` / `Makefile` and an
  `Unknown` fallback), and per-language `linesAdded`, `linesRemoved`,
  and `filesTouched` counted from numstat paths cloc-style — applied
  to contributions, not the whole tree; binary files count as touched
  with zero lines.
- `src/report/index.ts` now exports the deterministic metrics,
  language-contribution, and repository-stats types through the
  barrel, and `src/deterministic/metrics.ts` / `languages.ts` import
  them from there. The types stay tagged as internal JSDoc until the
  pipeline (plan step 5) wires the layer and the `knip.config.ts`
  `ignoreFiles` entries are removed; `Commit` and `AuthorGroup`
  gained production importers.
- Commit extraction (`src/deterministic/commits.ts`, design §5.1): a
  single-pass `git log --numstat --no-renames` with the `%x1f`/`%x1e`
  record format. Each commit's sha, parents, author name/email, ISO
  author date, subject, and numstat rows are parsed; binary files
  (numstat `-`) are recorded without line counts; merge commits are
  detected via parent count and carry no numstat rows. `--since` /
  `--until` bound the scan by commit date while the author-date range
  is applied in code (§5.4) with git's own date parsing under
  `TZ=UTC`; an empty repository yields an empty list.
- Author identity resolution (`src/deterministic/identity.ts`,
  design §5.3): commits are grouped by lowercased author email with
  the most frequent author name as the display name, and a heuristic
  bot flag (`[bot]`, `dependabot`, `renovate`) marks bots — a flag
  only, bots are counted like everyone else (§5.4).
- `runGit` accepts extra environment variables (`env` option) for
  pinned commit dates and UTC date interpretation.
- Fixture repos now set committer dates equal to author dates, so
  commit-date bounding in fixture-based tests behaves like real
  repositories.
- Repo management (`src/repo/`, design §4): an `execa`-based git
  wrapper (`git.ts`) with typed `GitError` and helpers for clone, log,
  show, shortlog, and rev-parse; the cache layout (`cache.ts`) with the
  default `.dev-perf/cache` root, the `sha256(url).slice(0, 16)` entry
  hash, `repo/`/`clone.json`/`llm/`/`opencode/` path builders, and
  zod-validated `clone.json` read/write; and `ensureClone`
  (`clone.ts`) that reuses the cached clone when `repo/` exists and
  `clone.json` matches, re-clones on `--refresh` (removing the old
  `repo/`), clones with `--filter=blob:none` (partial clone, `file://`
  form for local paths), and falls back to a full clone when the
  hosting rejects partial clones.
- JSON helpers (`src/util/json.ts`) — pretty-print, safe parse, and
  read/write of JSON files, used by the cache now and the pipeline
  output later.
- Test fixture helper (`test/fixtures/repo-builder.ts`, design §9) that
  builds temporary git repos with known files, authors, and exact
  author dates, so metrics can be asserted exactly.
- `execa` dependency (10.0.1, pinned exactly).
- Report schema (`src/report/schema.ts`) — the single source of truth
  for the report shape (design §7): parameters, repository and user
  entries, deterministic metrics, per-language contributions, and the
  LLM analysis. `churn` stays optional (reserved for v2), and
  `llm.status` defaults to `"skipped"`.
- CLI option validation (`src/config.ts`) — zod schema for the parsed
  options: LLM analysis requires `--model`, `--provider-url` and
  `--api-key` (the key may come from `DEV_PERF_API_KEY`);
  `--limit-context` / `--limit-output` are positive integers (defaults
  262144 / 65536); empty repo lists are rejected. Errors name each
  failing option.
- `--limit-context <n>` and `--limit-output <n>` CLI options (design
  §3), and validation of all parsed options in the CLI action.
- Project scaffolding modeled on mcp-compress-router: TypeScript CLI
  skeleton (commander entry with the documented argument/option
  surface), Vitest + oxlint + Knip + Prettier + Markdownlint + Husky
  tooling, and a CI workflow running the full quality gate with npm
  publishing on version tags.
- `AGENTS.md` with contribution and code guidelines,
  `DEVELOPMENT.md` development guide, and `.env.example` documenting
  `DEV_PERF_API_KEY`.
- `docs/plan.md` with the step-by-step implementation plan for the
  analysis pipeline described in `docs/design.md`.

### Changed

- The CLI action runs the pipeline (see Added), so invoking an
  analysis no longer fails with the not-implemented error.
- `knip.config.ts`: removed the `ignoreFiles` entries for `src/repo/**`,
  `src/util/**`, `src/deterministic/**` and the `ignoreDependencies`
  entry for `execa` — every module now has a production importer
  (the pipeline). The `@internal` tags on exports that gained
  production importers were removed accordingly; the remaining
  test-only exports (e.g. the git helpers, cache path builders) are
  tagged `@internal`.
- `src/util/json.ts`: `JsonError` and `parseJson` are no longer
  exported — they are module-internal (the application has no
  consumers for them; `readJsonFile`/`writeJsonFile` remain the
  public surface).
