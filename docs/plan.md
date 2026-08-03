# dev-perf — Implementation Plan

This is the step-by-step implementation plan for the analysis pipeline
described in [docs/design.md](./design.md). The work is split into
**9 steps**, each a self-contained, PR-sized chunk that leaves the
repository green (`pnpm check` passes). The steps are sequential —
each one builds on the outputs of the previous ones.

Three milestones mark user-visible progress:

| Milestone | Steps | Outcome |
| --- | --- | --- |
| M1 — Foundation | 1-2 | Report schema, CLI validation, clone/cache management |
| M2 — Deterministic report | 3-5 | First usable release: `--no-llm` produces the JSON report |
| M3 — LLM agentic layer | 7-9 | Full pipeline with opencode-based analysis |

## Conventions (apply to every step)

- **Green at all times**: every step must pass `pnpm check` (format,
  lint, typecheck, build, test) before it is considered done.
- **Testing**: unit tests are co-located with sources in `src/`
  (`*.test.ts`); shared fixtures live in `test/fixtures/`; e2e tests
  live in `test/e2e/`. This follows AGENTS.md (a slight path
  deviation from design §8, which shows `tests/`).
- **Fixtures**: `test/fixtures/repo-builder.ts` builds temp git repos
  with known content so metrics are asserted exactly (§9).
- **Code guidelines**: kebab-case file names, JSDoc on all exports,
  files ≤ 300 lines, functions ≤ 50 lines, pinned dependency versions,
  no changes to linter/formatter configs.
- **Docs**: each milestone updates README.md, DEVELOPMENT.md,
  CHANGELOG.md (Unreleased section) and the Project Structure section
  of AGENTS.md.

## Step 1 — Foundation: report schema and CLI validation

**Goal**: single source of truth for the report shape (design §7) and
zod validation of CLI arguments (design §3).

**Files**

- `src/report/schema.ts` (new) — zod schemas + inferred types for the
  whole report: parameters, repository entries, user entries,
  deterministic metrics, per-language contributions, LLM analysis,
  and contributions. `churn` stays optional (v2, §5.2);
  `llm.status` defaults to `"skipped"`. This schema is reused verbatim
  by the deterministic layer and the LLM tool schema, so nothing can
  drift (§3).
- `src/config.ts` (new) — zod schema for parsed CLI options with a
  cross-field rule: LLM analysis enabled ⇒ `model`, `providerUrl` and
  `apiKey` are required (the key may come from `DEV_PERF_API_KEY`);
  `limitContext` / `limitOutput` are positive integers with the
  design defaults (262144 / 65536).
- `src/cli.ts` (edit) — add the `--limit-context <n>` and
  `--limit-output <n>` options (they are missing from the current
  surface, §3); run parsed options through `config.ts` validation in
  the action; keep the not-implemented stub.

**Tests**

- `src/report/schema.test.ts` — a full sample report validates; each
  field mutation (wrong type, missing required field, out-of-enum
  value) fails with a clear path.
- `src/config.test.ts` — LLM flags required when LLM is enabled,
  limits validated, empty repo list rejected.
- `src/cli.test.ts` (update) — help documents the two new options.

**Verification**: `pnpm check`.

**Done when**: CLI help matches design §3 in full; validation errors
are clear; `schema.ts` compiles standalone and is importable by all
later steps.

## Step 2 — Repo management: git wrapper, cache, clone

**Goal**: clone/cache management per design §4.

**Dependencies**: `execa` (latest stable version, pinned exactly —
check the registry, do not guess).

**Files**

- `src/repo/git.ts` (new) — the small `execa`-based wrapper (§4):
  `runGit(repoDir, args)` with typed error handling plus helpers for
  clone, log, show, shortlog, and rev-parse.
- `src/repo/cache.ts` (new) — cache root resolution (default
  `.dev-perf/cache`), the `sha256(url).slice(0, 16)` entry hash, path
  builders (`repo/`, `clone.json`, `llm/`, `opencode/`), and
  zod-validated clone.json read/write (`url`, `clonedAt`, `branch`,
  `head`).
- `src/repo/clone.ts` (new) — `ensureClone(url, {cacheDir, refresh})`:
  reuse the clone when `repo/` exists and clone.json matches; remove
  the old dir and re-clone when `--refresh`; clone with
  `--filter=blob:none` and fall back to a full clone when the hosting
  does not support partial clones (§4); write clone.json.
- `src/util/json.ts` (new) — pretty-print, read/write, and safe parse
  helpers (used by the cache now and by the pipeline output later).
- `test/fixtures/repo-builder.ts` (new) — builds temp git repos with
  known files, authors, and commits; used by every later step (§9).

**Tests**

- `src/repo/cache.test.ts` — hashing, layout paths, clone.json
  roundtrip.
- `src/repo/git.test.ts` and `src/repo/clone.test.ts` — integration
  against fixture repos: clone succeeds, second run reuses the cache,
  `--refresh` re-clones, full-clone fallback works.
- Local-path note: plain `git clone <path>` ignores `--filter` with a
  warning; use the `file://` URL form for local paths so partial
  cloning applies, or accept the fallback.

**Verification**: `pnpm check`.

**Done when**: two runs with identical parameters clone once and
reuse the cache; `--refresh` re-clones; clone.json roundtrips.

## Step 3 — Deterministic: commit extraction and identity

**Goal**: parse git history per design §5.1 and group authors per
§5.3.

**Files**

- `src/deterministic/commits.ts` (new) — the single-pass `git log
  --numstat --no-renames` with the `%x1f` / `%x1e` record format
  (§5.1); parse each commit (sha, parents, author name/email, ISO
  author date, subject) and its numstat rows (`added\tdeleted\tpath`);
  binary files (numstat `-`) are recorded without line counts; merge
  commits are detected via parent count.
- Author-date filtering: `git log --since/--until` filters by *commit*
  date, so pass them only to bound the scan and apply the *author
  date* range in code on the parsed `%aI` field (§5.4).
- `src/deterministic/identity.ts` (new) — group commits by
  lowercased author email; display name is the most frequent author
  name for that email (§5.3); `isBot` is a heuristic *flag only* —
  no filtering, bots are counted like everyone else (§5.4).

Note: the author list is derived from the parsed log itself; the
separate `git shortlog` pass from §5.1 is redundant in v1 and skipped.

**Tests**

- `src/deterministic/commits.test.ts` — golden parsing from fixture
  repos: date ranges, merge commits, binary files, empty repos.
- `src/deterministic/identity.test.ts` — email grouping (case
  folding), name frequency selection, bot flag detection.

**Verification**: `pnpm check`.

**Done when**: commits parsed from a fixture repo match the fixture
exactly (shas, dates, numstat); author-date filtering honors §5.4.

## Step 4 — Deterministic: metrics and languages

**Goal**: per-user and repo-level metrics per design §5.2.

**Files**

- `src/deterministic/metrics.ts` (new) — aggregation over parsed
  commits: commits, nonMergeCommits, mergeCommits, linesAdded,
  linesRemoved, netLines, filesTouched (commit-file pairs),
  uniqueFilesTouched, activeDays (distinct author dates),
  firstCommitAt, lastCommitAt, avgCommitSize (per non-merge commit);
  repo stats: totalCommits, totalUsers, topLanguages by lines added.
- `src/deterministic/languages.ts` (new) — the built-in
  extension→language map; per-language linesAdded, linesRemoved and
  filesTouched counted from numstat paths (cloc-style counting applied
  to contributions, not the whole tree, §5.2).

**Tests**

- `src/deterministic/metrics.test.ts` — fixture repos with
  hand-computed expected values, asserted exactly (§9).
- `src/deterministic/languages.test.ts` — mapping correctness and
  per-language contribution counting.

**Verification**: `pnpm check`.

**Done when**: metrics for the fixture repos equal the hand-computed
values exactly.

## Step 5 — Assembly and deterministic pipeline end-to-end (M2)

**Goal**: first usable release — `dev-perf --no-llm` produces the JSON
report (design §7); this is the CI-safe e2e path (§9).

**Files**

- `src/report/assemble.ts` (new) — build the report document:
  parameters, repository entries (repo, clonePath, branch, head,
  range, stats), and users with deterministic metrics and
  `llm: { status: "skipped" }`.
- `src/pipeline.ts` (new) — orchestration: for each repo →
  cache/clone → deterministic analysis → assemble → write to stdout or
  the `--output` file (pretty JSON). Keeping orchestration here
  instead of in `cli.ts` deviates slightly from design §8; AGENTS.md
  structure is updated accordingly.
- `src/cli.ts` (edit) — call the pipeline instead of throwing the
  not-implemented error; update `src/cli.test.ts`.
- `test/e2e/deterministic.test.ts` (new) — build a fixture repo, run
  the compiled CLI with `--no-llm` as a child process, snapshot the
  JSON (§9).

**Docs**: README.md (deterministic usage), DEVELOPMENT.md (manual
testing), CHANGELOG.md (Added), AGENTS.md (Project Structure).

**Verification**: `pnpm check` plus a manual run against a fixture
repo.

**Done when**: `node build/index.js --no-llm <fixture>` prints a valid
report; the e2e snapshot test passes; release candidate v0.2.0.

## Step 6 — Logging and verbose output

**Goal**: a minimal stderr logger (`src/util/log.ts`, the `util/`
module design §8 reserves for logging) and a working `--verbose`
flag, so progress is visible on demand while stdout stays reserved
for the JSON report (design §2). Today `--verbose` is parsed and
validated but consumed by nothing; this step wires it through the
whole pipeline.

**Files**

- `src/util/log.ts` (new) — a level-based logger with no
  dependencies: quiet by default (warnings and errors only),
  verbose on `--verbose` (progress and debug). Every message goes
  to stderr — stdout carries nothing but the report JSON.
- `src/index.ts` (edit) — route the top-level fatal error handler
  through the logger instead of a bare `console.error`.
- `src/pipeline.ts` (edit) — consume `options.verbose` (already
  parsed and validated by `cli.ts` / `config.ts`, which need no
  surface changes): log cache reuse vs fresh clone (with duration),
  the resolved author-date range, and per-repo commit counts.
- Later LLM steps reuse the logger: server URL and model (Step 7),
  session progress and token usage (Step 8).

**Tests**

- `src/util/log.test.ts` — level gating (quiet vs verbose) and
  stderr targeting (stdout untouched).
- `src/pipeline.test.ts` (update) — a verbose run logs progress to
  stderr while the JSON report goes to stdout only.
- `test/e2e/deterministic.test.ts` (update) — run the compiled CLI
  with `--verbose --no-llm` against a fixture repo: stdout parses as
  the exact JSON snapshot, stderr carries progress lines.

**Docs**: README.md (`--verbose` behavior), DEVELOPMENT.md (manual
verbose run), CHANGELOG.md (Changed), AGENTS.md (Project Structure —
`src/util/log.ts`).

**Verification**: `pnpm check`.

**Done when**: `--verbose` reports clone/reuse, range, and commit
counts on stderr; a default run is silent apart from errors; the e2e
test asserts stdout purity.

## Step 7 — LLM layer: SDK, server lifecycle, generated config

**Goal**: opencode-as-a-library server lifecycle and the
report-capture tool per design §6.1-6.2 and §6.5.

**Dependencies**: `@opencode-ai/sdk` (check the registry for the
latest 1.x; the design was verified against v1.18.x) and
`@opencode-ai/plugin` (confirm at implementation time whether the
generated tool file resolves the plugin from the opencode runtime
rather than from dev-perf's own node_modules).

**Files**

- `src/llm/server.ts` (new) — `startServer(cloneDir, config)`:
  generate an isolated `opencode.json` inside the clone (provider
  base URL, model, read-only permissions that deny write tools,
  analysis rules, and the `limit` block from `--limit-context` /
  `--limit-output`, §6.2); launch `createOpencode()` with cwd = the
  clone; inject the API key programmatically via
  `client.auth.set()`; guarantee that no user config is merged (verify
  the `OPENCODE_CONFIG` mechanism, fall back to an empty inline
   config — §10); shut the server down in `finally`; the Step 6
   logger prints the server URL and model when `--verbose` is set.
- `src/llm/tools.ts` (new) — generate `.opencode/tools/
  devperf_report.ts` plugin source: `tool()` from `@opencode-ai/plugin`
  with a JSON-schema argument derived from `schema.ts` (all field
  descriptions included, §6.5); the tool validates the payload with
  zod, writes it to `<cache>/<hash>/llm/<user>.json`, and returns
  `ok`.

**Tests**

- `src/llm/server.test.ts` — golden-file checks for the generated
  `opencode.json` (provider, model, permissions, limit block).
- `src/llm/tools.test.ts` — generated tool source contains the full
  schema with descriptions; output path handling.
- A lifecycle smoke test (start/stop a server against a fixture
  clone) is marked manual and skipped in CI until the §9 manual LLM
  integration exists.

**Verification**: `pnpm check`.

**Done when**: generated files match the design; the server starts
and stops against a fixture clone; the API key is injected
programmatically, never stored in a file.

## Step 8 — LLM layer: prompts, sessions, orchestration, cache

**Goal**: sessions and orchestration per design §6.3-6.6.

**Files**

- `src/llm/prompts.ts` (new) — the orientation prompt (tech stack,
  main modules, conventions); the per-user prompt (identity, date
  range, repo context, commit list with sha/date/subject/numstat
  totals/files); both end with the instruction to call
  `devperf_report` with the final analysis before finishing (§6.3,
  §6.5); injected context uses `noReply: true`.
- `src/llm/session.ts` (new) — session create/prompt wrappers with
  `noReply` support, abort on error, tool-call detection (the report
  file exists and zod-validates), and token usage collected from the
  event stream.
- `src/llm/analyze.ts` (new) — orchestration: one orientation session
  per repo (cached and injected into every user prompt, §6.3);
  sequential per-user sessions (§6.2); the enforcement loop — up to 3
  follow-up prompts if the tool was not called, then exit with a
  non-zero status naming the user and session (§6.5); LLM result cache
  keyed by (repo, user, since, until, model, context/output limits),
   invalidated by `--refresh` (§6.6); tokenUsage and estimatedCostUsd
   accumulated for the report (§6.6); session progress and token
   usage are logged through the Step 6 logger when verbose.

**Tests**

- `src/llm/prompts.test.ts` — prompt contents and the required
  tool-call instruction.
- `src/llm/analyze.test.ts` with stub sessions — enforcement (a model
  that omits the tool call triggers retries and then a non-zero exit),
  cache idempotency (rerun with the same parameters makes no second
  call), `--refresh` invalidation, and session scoping to the clone
  directory (§10).

**Verification**: `pnpm check`.

**Done when**: enforcement and caching are proven with stubs; a
manual run with a real provider produces a validated, cached payload.

## Step 9 — Full pipeline integration and release polish (M3)

**Goal**: wire the LLM layer into the pipeline and ship the full
report (design §7).

**Files**

- `src/pipeline.ts` (edit) — run the LLM phase between deterministic
  analysis and assembly when enabled; map `llm.status` (completed /
  skipped / failed) and the error message into the report.
- `src/config.ts` / `src/cli.ts` (edit) — final validation and help
  text polish; fail fast with a clear message when the first prompt
  fails (§10).
- Docs: README.md (LLM usage, provider setup, cost visibility),
  DEVELOPMENT.md (manual LLM run on a small public repo),
  AGENTS.md (Project Structure — llm/, pipeline.ts, test/),
  CHANGELOG.md.
- Optional per §9: a cost-watch script that runs the LLM layer on
  fixture repos and reports token usage.

**Verification**: `pnpm check` plus a manual full run with a real
provider on a small public repo (documented in DEVELOPMENT.md).

**Done when**: the full pipeline produces a report with
`llm.completed` per user and tokenUsage/cost; the `--no-llm` path is
unchanged; release candidate v0.3.0.

## Risks from design §10 (where they are handled)

| Risk | Where | Mitigation |
| --- | --- | --- |
| SDK API stability | Step 7 | Pin the exact version; the server module is the only SDK touchpoint |
| Provider auth failure | Step 9 | Fail fast with a clear message when the first prompt fails |
| Global config isolation | Step 7 | Verify the `OPENCODE_CONFIG` mechanism; fall back to an empty inline config |
| Server startup cost | Step 7 | Verify startup time; keep the `createOpencodeClient` escape hatch |
| Session/directory scoping | Step 8 | Sessions scoped to the server cwd; explicit directory option if available |
| Large repos | Steps 3-4 | Partial clones; per-commit diffs fetched lazily |
| Identity / date semantics | Steps 3-4 | Email grouping and UTC author dates are the v1 contract; documented |

## Follow-ups (explicitly out of scope)

- `churn` metric (v2) — the schema field is already reserved.
- `.mailmap`-aware identity resolution.
- PR/review/issue enrichment via hosting APIs.
- Composite score, GitHub-API-only mode, web UI.

## Definition of done (whole plan)

- `pnpm check` is green after every step.
- The deterministic-only report (M2) and the full LLM report (M3) are
  verified end-to-end, including the e2e snapshot test and manual LLM
  runs.
- Docs are in sync: README.md, DEVELOPMENT.md, AGENTS.md Project
  Structure, CHANGELOG.md.
- Dependencies are pinned exactly; no linter or formatter configs
  changed.
