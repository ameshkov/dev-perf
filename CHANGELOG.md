# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Environment-variable configuration for every CLI option: each flag
  has a `DEV_PERF_*` equivalent (`DEV_PERF_SINCE`, `DEV_PERF_UNTIL`,
  `DEV_PERF_OUTPUT`, `DEV_PERF_CACHE_DIR`, `DEV_PERF_REFRESH`,
  `DEV_PERF_NO_LLM`, `DEV_PERF_MODEL`, `DEV_PERF_PROVIDER_URL`,
  `DEV_PERF_API_KEY`, `DEV_PERF_LIMIT_CONTEXT`,
  `DEV_PERF_LIMIT_OUTPUT`, `DEV_PERF_VERBOSE`, and `DEV_PERF_REPOS`
  for the positional repositories), resolved by `resolveRawOptions`
  in `src/config.ts` before validation — the flag wins when both are
  set, boolean variables accept `1`/`true`/`yes`/`on` and
  `0`/`false`/`no`/`off`, and `.env` (gitignored, loaded via dotenv)
  now drives any option, not just the API key.
- `.env.example` documents every `DEV_PERF_*` variable; the README
  gains a Configuration section with the full flag-to-variable
  mapping, and DEVELOPMENT.md explains `.env` setup and usage.
- VS Code launch configuration (`.vscode/launch.json`, committed):
  two configurations — deterministic (`--no-llm`) and full LLM — that
  run the TypeScript sources through `tsx` and load `.env` via
  `envFile`, so an F5 debug session picks up the same variables as a
  shell run.
- Full pipeline integration of the LLM layer (plan step 9, milestone
  M3): `src/pipeline.ts` now runs the LLM phase between deterministic
  analysis and assembly when enabled — one opencode server per
  repository (started and shut down around the analysis), the real
  session service bound to it, and `analyzeRepositoryLLM` producing
  one analysis per user (cached results reused unless `--refresh`).
  The completed per-user analyses are merged into the report
  (`llm.status: "completed"` with overview, contributions, token usage
  and cost); users without a result keep `status: "skipped"`. LLM
  failures fail fast with a clear message naming the repository (the
  server is shut down first) and no report is written (§6.5, §10);
  repositories without authors in the range skip the LLM phase
  entirely.
- The report assembler (`src/report/assemble.ts`) now maps per-user
  LLM results into the report: `assembleRepository` accepts an
  optional `llmResults` map keyed by lowercased email, so completed,
  failed (with the error message), and skipped statuses all flow into
  the document.
- Pipeline LLM-phase integration tests (`src/pipeline-llm.test.ts`):
  with `startServer` stubbed at the module boundary, the real session
  service and orchestration run against a stub client that simulates
  the `devperf_report` tool — the completed analyses land in the
  report, enforcement failures and server-start failures fail fast
  (server closed, no stdout output), and `--no-llm` / author-less
  repositories never start a server.
- Report-assembler tests for LLM result mapping: completed analyses
  onto the matching users, failed analyses with their error message,
  and skipped status when no results are given.
- LLM orchestration (`src/llm/analyze.ts`, design §6.3-6.6, plan step
  8): per repository — one orientation session establishes the repo
  context (tech stack, main modules, conventions), which is injected
  into every user session with `noReply: true`; per-user sessions run
  sequentially and are scoped to the clone directory. The
  `devperf_report` output is enforced (§6.5): up to 3 follow-up
  reminders, then an error naming the user and session that the
  top-level handler turns into a non-zero exit without writing the
  report. Results are cached in the cache entry's `llm/` directory
  keyed by (repo, user, since, until, model, context/output limits)
  and reused on reruns; `--refresh` skips the reads and re-runs
  everything (§6.6). Per-session token usage and cost are accumulated
  and logged with the session progress when `--verbose` is set.
- Session layer (`src/llm/session.ts`, plan step 8): the
  `SessionService` interface (session creation, prompting with
  `noReply` context injection, and abort-on-error) plus tool-call
  detection — the session's report file exists and zod-validates
  against `llmToolPayloadSchema` — and per-session token usage and
  cost collected from the server's event stream
  (`message.part.updated` events with `step-finish` parts, §6.6). The
  real implementation binds to the opencode SDK client
  (`createSessionService`); tests stub the interface.
- LLM prompts (`src/llm/prompts.ts`, design §6.3, §6.5): the
  orientation prompt, the per-user prompt (identity, date range, repo
  context, and the commit list with sha/date/subject/numstat
  totals/files, truncated at 20 paths per commit), and the enforcement
  reminder. Both analysis prompts end with the instruction to call
  `devperf_report` with the final analysis before finishing.
- The report barrel (`src/report/index.ts`) now also exports
  `tokenUsageSchema` and the `LlmAnalysis` / `LlmToolPayload` /
  `TokenUsage` types for the LLM layer (plan step 8).
- Tests for the LLM layer (plan step 8): prompt contents and the
  required tool-call instruction; session wrappers (creation, prompt,
  abort-on-error, report-file detection, usage collection) against a
  stubbed client; and orchestration with stub sessions — enforcement
  (3 reminders then a non-zero exit naming user and session), cache
  idempotency (a rerun with the same parameters makes no second
  call), `--refresh` invalidation, orientation reuse, and session
  scoping to the clone directory.
- LLM server lifecycle (`src/llm/server.ts`, plan step 7): starts an
  opencode server as a library (`createOpencode` from
  `@opencode-ai/sdk`, 1.18.11, pinned exactly) scoped to the analyzed
  clone. The generated `opencode.json` declares the provider
  (`@ai-sdk/openai-compatible` with the `--provider-url` base URL),
  the model with the `limit` block from `--limit-context` /
  `--limit-output`, read-only permissions that deny the write tools
  (`write`/`edit`/`patch` disabled, `webfetch`/`external_directory`
  denied), the analysis rules in the `build` agent prompt, and an
  `enabled_providers` pin. The API key is injected programmatically
  via `client.auth.set()` — never stored in a file.
- Global opencode config isolation (plan step 7, verified against
  opencode 1.18.11): the SDK's `OPENCODE_CONFIG_CONTENT` is *merged*
  with the user's global config rather than replacing it, so the
  spawned server runs with `HOME`/`XDG_CONFIG_HOME` pointed at an
  empty temp directory and with `OPENCODE_CONFIG*` and server-auth
  env vars cleared — no global config, plugins, or stored auth can
  reach the analysis. The process cwd is switched to the clone for
  the spawn (the server's project directory is fixed at spawn time)
  and both are restored immediately; `--verbose` logs the server URL
  and model.
- `devperf_report` tool generation (`src/llm/tools.ts`, design §6.5):
  the plugin source written to the clone's `.opencode/tools/` (and
  mirrored in the cache entry's `opencode/` directory, design §4).
  The tool's argument schema is derived from the report schema
  (`llmToolPayloadSchema`, now with model-facing field descriptions)
  via `z.toJSONSchema`, rendered back into `tool.schema.*` zod code,
  so the model-facing shape cannot drift from the report. The
  self-contained file imports only `@opencode-ai/plugin` (resolved by
  the opencode runtime) and `node:` builtins, validates the payload
  with zod, and writes it to `<cache>/<hash>/llm/<sessionID>.json`
  — session-scoped naming instead of the design's `<user>.json`,
  because the tool cannot know the user key; the orchestrator maps
  sessions to users (plan step 8).
- Tests for the LLM layer: golden checks for the generated
  `opencode.json` (provider, model, permissions, limit block), the
  generated-files layout (cache `opencode/` + clone copies), the
  generated tool's schema/descriptions and its real execution
  (valid payload written, invalid payload rejected), and a manual
  server lifecycle smoke test gated behind `DEV_PERF_SMOKE=1`
  (skipped in CI; needs the `opencode` binary).
- `@opencode-ai/sdk` dependency (1.18.11, pinned exactly);
  `@opencode-ai/plugin` (1.18.11, pinned exactly) is a devDependency
  — the opencode runtime resolves it for the generated tool file.
- `llmToolPayloadSchema` (`src/report/schema.ts`): the model-facing
  analysis payload (overview + contributions) with `describe()`d
  fields, exported through the report barrel.
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

- Code comments no longer reference `docs/design.md` / `docs/plan.md`
  sections — module JSDoc is self-contained, with the README as the
  single pointer to the design document.
- The CLI repository argument is now optional (`[repo...]`):
  repositories may come from `DEV_PERF_REPOS` instead of positional
  arguments, and an empty list fails validation with `repos: at least
  one repository is required`.
- The API-key fallback moved into option resolution: `--api-key` and
  `DEV_PERF_API_KEY` are merged by `resolveRawOptions` before
  validation, so `src/pipeline.ts` no longer reads `process.env`
  itself.
- The e2e suite sanitizes `DEV_PERF_*` variables from the child
  environment (a developer shell exporting them cannot skew expected
  outputs) and adds an env-only run case asserting the flag-equivalent
  report.
- `knip.config.ts`: removed the `src/llm/**` `ignoreFiles` entry and
  the `@opencode-ai/sdk` / `@opencode-ai/plugin` `ignoreDependencies`
  entries — the pipeline (plan step 9) wires the LLM layer in, so
  every module now has a production importer. The transitional
  `@internal` tags this enabled were removed accordingly
  (`llmToolPayloadSchema`, `tokenUsageSchema`, `TokenUsage`,
  `LlmAnalysis`, `LlmToolPayload`, `llmDir`, `opencodeDir`,
  `logDebug`, `CommitFile`); remaining test-only exports keep their
  tags with updated wording.
- `@opencode-ai/plugin` moved to `devDependencies`: the generated
  `devperf_report.ts` tool is loaded by the opencode runtime itself,
  which resolves the package from its own embedded modules — only the
  tool-execution test imports it from dev-perf's `node_modules`. The
  runtime dependency is `@opencode-ai/sdk` alone.
- `--refresh` help text now mentions that the cached LLM results are
  invalidated too: "Force re-clone and re-analysis, invalidating the
  LLM result cache".
- `--verbose` is now wired through the pipeline (plan step 6): progress
  messages — cache reuse vs a fresh clone (with duration), the
  resolved author-date range, and per-repo commit counts — go to
  stderr, while stdout stays reserved for the report JSON. A default
  run is silent apart from errors and warnings.
- `src/util/log.ts` (new): a dependency-free, level-based stderr
  logger — quiet by default (`error` and `warn` always printed;
  `--verbose` enables `info` and `debug`). The top-level fatal error
  handler in `src/index.ts` routes through `logError` instead of a
  bare `console.error`, and `ensureClone` warns on stderr when a host
  rejects the partial-clone filter and the full-clone fallback kicks
  in.
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
