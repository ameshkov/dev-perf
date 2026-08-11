# dev-perf — Design

## 1. Goals and non-goals

### Goals

- A CLI tool that takes one or more repositories (any git URL or local path) and a
  date range, and produces a JSON report of contributions **per user**.
- Two complementary layers of analysis:
  1. **Deterministic** — everything that can be counted from git history:
     commits, added/removed lines, files touched, churn, active days,
     per-language contribution sizes (cloc-style counting applied to the
     contributions, not the whole tree).
  2. **LLM-based, agentic** — dimensions that cannot be counted, determined by an
     agent that is given tools to read the repository and the actual diffs.
- The agentic layer runs **fully in-process** via the
  `@earendil-works/pi-coding-agent` library (no spawned server), which
  gives us agents, built-in repo tools (read/grep/bash), custom tools,
  structured JSON output, and multi-provider support out of the box.
- All analysis happens on a fresh clone stored in a **cache directory**
  (`<tmpdir>/.dev-cache` by default — in the OS temp directory, so nothing needs
  to be gitignored).

### Non-goals (for now)

- PR/review/issue tracking (requires a hosting API — may be a later enrichment layer).
- A single composite "score" — the report is per-dimension; a composite would hide
  too much and is easy to add later if wanted.
- Real-time streaming or a web UI.
- Analyzing repos without a full clone (e.g. GitHub API-only mode).

## 2. High-level architecture

```text
┌─────────┐   ┌──────────────────┐   ┌─────────────────────┐   ┌───────────────┐
│  CLI    │──▶│ Repo manager     │──▶│ Deterministic       │──▶│ Report        │
│ (comm.) │   │ clone → cache    │   │ analyzer (git data) │   │ assembler     │──▶ JSON
└─────────┘   └──────────────────┘   └─────────────────────┘   └───────────────┘
                                             │                          ▲
                                             ▼                          │
                                     ┌─────────────────────┐            │
                                     │ LLM agentic layer   │────────────┘
                                     │ (pi-coding-agent)   │
                                     └─────────────────────┘
```

Pipeline phases, in order:

1. **Clone** — for each repo, clone into `<tmpdir>/.dev-cache/<hash>/repo`
   (in full, so every blob is local; see §4).
2. **Deterministic analysis** — enumerate commits in the range, compute per-user
   metrics (§5). This is fast and cheap; it also produces the inputs (commit list,
   stats) the LLM layer will need.
3. **LLM analysis** (optional — set `llm: false` to skip) — for each user, an in-process
   pi session with read access to the repo finishes by calling the report tool
   with its analysis (§6.5).
4. **Assemble** — merge layers into the report, write to stdout or the `output`
   config key (§7).

## 3. CLI

The CLI is **config-driven**: `report` and `compile` select the step to
run (exactly one per invocation), and every functional setting lives in
the YAML config file (§3.1). The only flag is `--config <path>`; else
`./config.yaml` auto-loads from the working directory when it exists.
`version` / `--version` print the application version.

```text
npx dev-perf report --config <path>   # or omit --config: ./config.yaml auto-loads
npx dev-perf compile --config <path>
npx dev-perf version | npx dev-perf --version
```

The LLM layer requires `model`, `provider-url` and `api-key` to be specified
explicitly in the config — dev-perf never falls back to the user's global
configuration (see §6.2). `limit-context` and `limit-output` are optional caps for the model
window (defaults: 256k context / 64k output tokens), registered as the model's
`contextWindow` / `maxTokens` (§6.2).

The config `users-map` key merges author emails that belong to the same person
into one identity during analysis (§5.3), mirroring the `compile` command's
mapping.

With `unit`, the analyzed range is split into UTC-aligned periods and the report
carries one full per-repository report per period (`src/trend/periods.ts`):
period bounds are instants (day = midnight, week = Monday, month = 1st,
quarter = Jan/Apr/Jul/Oct, year = Jan 1), first/last periods are trimmed to the
range, `until` is inclusive (next start − 1 ms), and empty periods are included
with zeroed metrics. The user list is resolved once over the whole range and
shown in every period; the LLM phase runs per period for the users active in it
(one in-process pi runtime per repo, shared across its periods; the LLM result
cache keys by period bounds). `since` is required with `unit` — an unbounded
range cannot be split.

### 3.1 Configuration file

The config file is the single source of options, shared by `report` and
`compile`: top-level keys apply to both, and `compile`-only keys live
under a nested `compile` section. Keys are kebab-case; booleans are
YAML booleans and numeric keys hold YAML numbers, so values flow into
the option schemas unchanged. `${ENV_VAR}` references are expanded from
the environment (a `.env` file provides them) before YAML parsing, so
the LLM provider configuration and API key stay out of version control;
an unset or empty variable errors naming the file and the variable.

| Key | Commands | Notes |
| --- | --- | --- |
| `repos` | report, compile | Repositories (URL or path) as a string or `{ repo, branch?, base-branch?, ignore?, ignore-commits? }`; a structured `branch` analyzes that branch as a delta vs the base (default: the repo's own default branch, then `main` → `master`); `ignore` excludes gitignore-style paths; `ignore-commits` excludes specific commits by hash and/or message pattern (§5.6); `compile` keep-filter |
| `since` / `until` | report | Analyzed author-date range (§5.1) |
| `unit` | report | Period split; requires `since` |
| `output` | report | JSON report file |
| `cache-dir` | report | Cache root (§4); default `<tmpdir>/.dev-cache` |
| `refresh` | report | Force re-clone and re-analysis (§4) |
| `llm` | report | LLM analysis enabled; default `true` |
| `model` / `provider-url` / `api-key` | report | LLM provider, explicit only (§6.2) |
| `limit-context` / `limit-output` / `llm-retries` | report | LLM caps and retries (§6.2) |
| `llm-max-time` / `llm-max-turns` | report | Per-session LLM limits; seconds / turns, unlimited by default (§6.2) |
| `users-map` | report, compile | Email-to-name mapping; identity merging (§5.3) |
| `parallel` | report | Repos analyzed in parallel; the shared cap on concurrent LLM sessions (§6.2) |
| `verbose` | report, compile | Verbose logging |
| `compile.report` / `compile.output` | compile | Input JSON report / markdown output directory (default `dev-perf-report`) |
| `compile.include-users` / `exclude-users` / `exclude-repos` | compile | User and repository selection (§8) |

Implementation: `commander` for command parsing and `--config`, `zod`
for validation of the config file and all data schemas. The report schema (zod) is shared between the CLI, the deterministic
layer, and the LLM structured-output schema so nothing can drift.

## 4. Cache and cloning

- Default cache root: `<tmpdir>/.dev-cache` — `.dev-cache` in the OS temp
  directory, so invoking the tool never pollutes the working directory and
  nothing needs to be gitignored. Set `cache-dir` anywhere to override,
  e.g. `~/.cache/dev-perf`.
- Layout:

```text
<tmpdir>/.dev-cache/
└── <sha256(repoUrl).slice(0,16)>/
    ├── repo/        # the git clone
    ├── clone.json   # { url, clonedAt, branch, head }
    └── llm/         # cached LLM analysis results (§6.6)
```

The LLM layer runs in-process and writes nothing beyond `llm/`: it
registers the provider and model in code, keeps credentials in memory,
and uses a logical `pi/home/` agent home that is never created on disk
(§6.2), so the `pi/` directory is left out of the layout entirely.

- Clone strategy: full clone — every blob is local right after the
  clone, so the deterministic numstat read, the branch-delta base
  resolution, and the LLM agent's file diffs never depend on the remote.
  A stale partial clone (`blob:none`, created before dev-perf switched
  to full clones) is detected by its promisor config and re-cloned as a
  full clone before reuse. A structured
  `repos` entry (`{ repo, branch?, base?, ignore?, ignoreCommits? }`, written as
  `base-branch` / `ignore-commits` in the config file) carries the branch to analyze,
  the base branch the analysis is scoped against, plus the gitignore-style
  paths and the specific commits excluded for that repository alone. A non-default branch is analyzed as a
  branch-delta: only the commits reachable from its head but not from the base
  (`git log HEAD --not <base>`, §5.1). The default base prefers the repository's
  own default branch (resolved from `refs/remotes/origin/HEAD`), then `main`
  before a stale leftover `master` (an explicit base resolves as `<base>` then
  `origin/<base>`). A base that is the
  analyzed branch head itself, or an unresolvable base, falls back to the full
  history (never an error); `base-branch: ''` opts out into the full history.
- Cache reuse: if `repo/` exists and `clone.json` matches the URL, skip cloning;
  the cache entry is keyed by the URL *and* the requested branch, so branch-specific
  clones and LLM results never collide. Concurrent clones of the same entry (the
  parallel analysis of specs that share a URL and branch but differ in base or
  ignored paths) are serialized per entry, so one entry is never cloned twice at
  once. `refresh` forces a re-clone. LLM results
  are cached under the same entry and reused when parameters match; the cache key
  includes the branch, its head sha, the base and base sha, and the ignored paths
  — so an advancing branch or base re-keys instead of reusing a stale analysis —
  and bumps a version whenever the
  analysis behavior changes, so switching either invalidates the corresponding
  results; `refresh` invalidates everything (§6.6). On re-clone the old dir is
  removed.
- All git operations go through a small `execa`-based wrapper (`src/repo/git.ts`).

## 5. Deterministic analysis

### 5.1 Data extraction (git commands)

- Commit list with metadata and per-file line counts in one pass:

  ```sh
  git log --since=<since> --until=<until> \
    --pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e \
    --numstat --no-renames
  ```

  For a branch-delta scope the same log adds the base exclusion:
  `git log HEAD --not <base> --since=... --until=...` (the positive side is named
  explicitly — `git log --not <base>` without a prior rev defaults to nothing).
  The caller drops the exclusion when the base sha equals the analyzed head, so a
  branch is never emptied by its own delta.

  Fields: `sha`, parent shas (`%P` — lets us detect merge commits), author name,
  author email, author date (ISO 8601), subject; followed by numstat rows
  `added\tdeleted\tpath`.
- Author identity list: `git shortlog -sne --since=... --until=...`.
- Per-commit diffs (only when the LLM layer or verbose output needs them, fetched
  lazily): `git show --format=fuller --stat --patch <sha>`.

All git invocations funnel through a single `runGit` wrapper
(`src/repo/git.ts`): every command runs under a per-command timeout (5 minutes by
default), so a hung git process — e.g. a `git log --numstat` over a huge history
— is killed and surfaces as a typed `GitError` (`timed out after N s`) instead
of blocking the run. Transient failures (refused/timed-out connections, a
dropped remote) are retried with a hard-coded backoff (1s, 5s, 30s with
jitter); a timed-out command is deliberately *not* retried. Because repositories
are cloned in full, the commit read is entirely local and never depends on the
remote, so transient-failure retries apply only to the clone itself.

### 5.2 Metrics (per user)

Core set (v1):

| Metric | Definition |
| --- | --- |
| `commits` | Commits authored in range |
| `nonMergeCommits` | Excluding commits with >1 parent |
| `mergeCommits` | Commits with >1 parent |
| `linesAdded` / `linesRemoved` | Sum of numstat over the range |
| `netLines` | added − removed |
| `filesTouched` | Commit-file pairs |
| `uniqueFilesTouched` | Distinct paths |
| `activeDays` | Distinct author-dates (UTC `YYYY-MM-DD`, sorted; count is `.length`) |
| `firstCommitAt` / `lastCommitAt` | Author dates |
| `avgCommitSize` | added/removed per non-merge commit |
| `languages` | Per extension: linesAdded, linesRemoved, filesTouched (cloc-style counting applied to contributions; extension → language via a built-in map; generated files excluded) |
| `generated` | linesAdded, linesRemoved, filesTouched of generated files — lockfile, test-snapshot, minified/build and compiler-output artifacts — kept separate from `languages` so auto-generated churn never inflates a language bucket (see §5.5) |
| `churn` | (v2) deletions by the author on files they added earlier in range — an approximation of rework |

Repo-level stats: total commits in range, distinct users, top languages by
contribution.

### 5.3 Author identity

- Commits are grouped by **lowercased author email**; the display name is the most
  frequent author name for that email.
- the config `users-map` key merges identities at the **grouping stage**: a commit whose
  email is in the mapping joins the mapped-name identity, otherwise its lowercased
  email. Identity keys are prefixed so mapped-name and email key spaces can never
  collide, and mapped identities take the user-supplied name (verbatim, so the
  merge is case-sensitive like the `compile` command's). Merging happens before
  any metrics are computed, so a merged person's deterministic metrics are exact,
  the LLM phase runs one session per merged identity, and the report's
  `emails` list carries every lowercased email of the identity (the first-seen
  email stays the stable primary key, reused everywhere downstream).
- An empty map is the v1 behavior: everything (and everyone, bots included) is
  counted as-is, no email merging.

### 5.4 Filtering

- **Ignored paths** — a repository's configured `ignore` patterns
  (gitignore-style, no `!` negation) drop the matching files right after
  the commits are read and before they are grouped by author
  (`src/deterministic/path-ignore.ts`): an ignored-only commit is dropped
  entirely, a mixed commit keeps only its non-ignored files, and merge
  commits (no numstat rows) are always kept. The single filtering point
  makes both the deterministic metrics and the LLM commit list
  exclusion-free.
- **No exclusions** — bots (`[bot]` suffix, `dependabot`, `renovate`, …) and every
  other author are counted like anyone else.
- **Merge commits** — counted, but reported separately so the line numbers are
  honest (merge diffs can be misleading).
- Date filtering uses **author date**, interpreted in UTC.

### 5.5 Generated files

Following GitHub's Linguist "generated" attribute, files that a tool
produced — not an author's code in whatever language their extension
suggests — are classified by a built-in path heuristic
(`src/deterministic/generated.ts`, `isGeneratedPath`):

- **Lock files** every package manager writes: `pnpm-lock.yaml`,
  `yarn.lock`, `package-lock.json` / `npm-shrinkwrap.json`,
  `bun.lock*`, `composer.lock`, `Cargo.lock`, `Gemfile.lock`,
  `Podfile.lock`, `Pipfile.lock` / `poetry.lock` / `pdm.lock` /
  `uv.lock`, `flake.lock`, `go.sum` / `go.work.sum`, `Package.resolved`,
  `.terraform.lock.hcl`, and friends.
- **Test snapshots** (`*.snap`) written by snapshot runners.
- **Minified and source-map artifacts** (`*.min.js` / `*.min.css`,
  `*.js.map`), named build-tool outputs (`lcov.info`, Yarn PnP
  files, `gradlew` / `mvnw` wrappers).
- **Vendored dependency subtrees** (`node_modules/`, Go `vendor/`
  import paths, `Godeps/`, `htmlcov/`, `Pods/`) and
  **compiler/designer codegen** suffixes (`.designer.cs`, `.g.cs`,
  `.feature.cs`, …).

Detection is path-only (numstat paths), like the language map; content
probes (Linguist's minified average-line-length, `DO NOT EDIT`
headers) are a documented future extension. Generated files are:

- **Excluded from `languages`** (per user) and **`topLanguages`** (per
  repository), so `pnpm-lock.yaml` never shows up as a mountain of
  `YAML` or `composer.lock` as `Unknown` — they are not authored code
  in those languages.
- **Still counted** in the aggregate `linesAdded` / `linesRemoved` /
  `filesTouched` / `commits` metrics, and reported **separately** as
  the per-user `generated` and repository `stats.generated` stats, so
  dependency-churn activity stays visible and attributable.
- The `compile` command surfaces the totals in the executive-summary
  table ("Generated files") and the per-user statistics table
  ("Generated lines"); the viewer adds a "Generated lines" chip to the
  author header and notes the exclusion in its language block. The
  language charts of both the compiled report and the viewer therefore
  show authored languages only.
- Unlike the per-repository `ignore` patterns (§5.4), generated-file
  classification is **default behavior with no opt-out** and is not a
  configurable list; a team that wants a snapshot counted as authored
  can keep the file out of the generated set only by not committing it
  under one of the matched paths.

### 5.6 Ignored commits

A structured repository entry can additionally exclude whole commits
from the analysis (`src/deterministic/commit-ignore.ts`,
`filterIgnoredCommits`), applied in the same single filtering point as
the ignored paths (§5.4) — right after the commits are read and before
they are grouped by author, so both the deterministic metrics and the
LLM commit list are exclusion-free:

- **By hash** — the configured `hashes` match as a case-insensitive
  prefix of the commit's full 40-char sha, so a pasted abbreviated hash
  works and casing never matters.
- **By message** — the configured `messages` are case-insensitive
  JavaScript regular expressions matched against the commit subject
  (the first line of the commit message). Each must compile; an invalid
  pattern is a config error naming the failing pattern, never a quiet
  "matches nothing".
- A matching commit is dropped **entirely** — merges included (an
  explicit exclusion by hash always wins, unlike the path filter which
  always keeps merges). The values are trimmed before matching, so an
  accidental config indent never becomes part of a hash or pattern.
- The exclusions ride on the `RepoSpec` (`ignoreCommits`), flow into
  the LLM prompts (orientation and per-user prompt render the excluded
  hashes and patterns so the agent never attributes them), the LLM
  result cache key (so a change in exclusions re-runs the analysis),
  the report entry (`ignoredCommits`), and the run-config dump.

## 6. LLM-based (agentic) analysis

### 6.1 Why pi as an in-process library

Building a custom tool-calling loop with a provider SDK would mean reimplementing
agent loops, tool schemas, retries, and multi-provider support.
`@earendil-works/pi-coding-agent` (verified against v0.84.0) provides all of it,
and runs **fully in-process** — no spawned server, no isolation environment, no
binary on `PATH`:

- `ModelRuntime.create({ modelsPath: null })` — a model/auth runtime with no
  generated `models.json`; the `devperf` provider and model are registered in
  code via `registerProvider('devperf', { baseUrl, api: 'openai-completions',
  models: [...] })`, and the API key is injected with
  `setRuntimeApiKey('devperf', key)` — an in-memory-only overlay, never written
  to disk.
- `createAgentSession(...)` — one in-process agent session per analysis with an
  explicit model, tool allowlist, custom tools, an in-memory session manager, a
  settings manager with **auto-compaction and auto-retry** enabled, and thinking
  disabled.
- **Custom tools**: `defineTool(...)` registers the report-capture tool in code,
  its parameter schema derived from the shared report schema (§6.5).
- Progress and tool calls: `session.subscribe(...)` — the `tool_execution_start`
  event carries the parsed tool arguments (early report detection, §6.5).
- Session-event debug logging: each session also feeds its event stream to the
  debug log (`src/llm/session-events.ts`) — agent/message lifecycle
  (`message_end` with truncated content), compaction, auto-retries, and every
  tool execution — so a `verbose` run can follow the analysis event by event.
- Per-session token usage: `session.getSessionStats()` (no cost tracking).
- System prompts: `DefaultResourceLoader.systemPrompt` injects the rendered
  per-session system prompt; sessions never read the user's global `~/.pi`.

### 6.2 Runtime lifecycle and configuration

- One runtime per cloned repo: `createLlmRuntime(cloneDir, config)` (`src/llm/runtime.ts`)
  creates the `ModelRuntime` in memory (no `models.json`, an in-memory
  credential store so no `auth.json` is ever written), registers the
  `devperf` provider (base URL from `provider-url`), the single model
  (`model`, with `contextWindow`/`maxTokens` from
  `limit-context`/`limit-output`), injects the API key from
  `api-key` in memory, and resolves the model. Nothing is written to
  disk.
- **No global pi config**: the agent home (`agentDir`) is a logical path
  under the cache entry's `pi/home/` that is **never created** — it only
  differs from the user's real `~/.pi` so no global configuration is
  ever read. No `~/.pi/agent`, `settings.json`, `auth.json`, or
  `models.json` is loaded or written.
- **Token limits** — the registered model carries the caps:
  `contextWindow: 262144`, `maxTokens: 65536` (overridable via
  `limit-context` / `limit-output`).
- Sessions are created per analysis by `createSessionService(runtime, entryDir,
  log)` (`src/llm/session.ts`); `close()` disposes every session and
  `runtime.dispose()` removes the in-memory API key.
- **Session limits** (`src/llm/session-limits.ts`): `llm-max-time`
  (seconds) and `llm-max-turns` optionally bound each session — wall-clock
  time and agent turns counted from the session event stream
  (`turn_start`). A limit-hit aborts the session and fails the prompt
  with a `SessionLimitError` (§6.5); the failure then goes through the
  normal `llm-retries` handling. When a limit caused the retry, the
  retried prompts (rendered from `limit-retry.md`) tell the model to be
  less thorough but faster, so the fresh session finishes within its new
  budget. Unlimited by default.
- LLM failures are retried (`llm-retries`) with a **fresh runtime** per
  attempt; completed per-user analyses are cached and reused across attempts
  (§6.6).
- Multiple repos are analyzed in parallel up to `parallel`; LLM user
  sessions instead share one run-level gate of the same capacity, so up
  to `parallel` of them run concurrently across all repositories — the
  slow part is parallelized, and total concurrency stays predictable
  (`src/util/pool.ts` `createLimit`, created once in the pipeline).

### 6.3 Sessions and prompts

- Prompt text lives in `src/llm/prompts/*.md` templates:
  `orientation-system.md` / `user-system.md` (the per-session **system
  prompts** that define the dev-perf analyst and its tool surface),
  `orientation.md` / `user.md` (the user prompts), and `reminder.md`;
  `prompts.ts` only renders them with the session values, so the prose stays
  maintainable outside the code.
- **Orientation session** (per repo, once): the agent explores the repo (README,
  manifests, top-level layout) and returns a compact "repo context": tech stack,
  main modules, conventions. Dev-perf reads the final assistant text
  (`getLastAssistantText()`) and injects it into every user prompt, so user
  sessions do not re-explore.
- **Per-user session**: the system prompt carries only who the agent is and the
  environment (the tool surface) — no per-run task details; the user
  prompt carries the analysis task — identity, date range, repo, the
  analyzed **branch**, and the repository's **excluded paths** — together
  with the repo context and the user's commit list (sha, date, subject, numstat
  totals, files). The branch and the excluded paths are also named in the
  orientation prompt (§5.4), so the agent scopes its exploration to the analyzed
  branch and does not attribute or weigh changes under ignored paths even when
  `git show`/`git log` surfaces them. A merged identity (§5.3) is introduced to
  the agent by all of its emails, so it treats commits authored under any of
  them as one contributor's work. The agent then decides what to look at (via
  tools) and finishes by calling the report tool with its analysis
  (§6.5). The context lives in the same turn — no separate no-reply injection.
- Auto-compaction and auto-retry are enabled explicitly via
  `SettingsManager.inMemory({ compaction: { enabled: true }, retry: {
  enabled: true } })`.

### 6.4 Agent tools

The analysis agent is defined by the system prompt templates
(`orientation-system.md`, `user-system.md`): a dev-perf analyst that never
creates, modifies, or deletes files and never stages, commits, or pushes. Each
session runs with the tool allowlist
`['read', 'bash', 'grep', 'find', 'ls', 'devperf_report']` — the built-in pi
tools plus the report-capture tool. read-only-ness of the agent is *not*
enforced in code: `bash` is pi's built-in, unshielded tool that can run
arbitrary shell commands in the clone (git inspection and file/text reading
like `git show`, `git log`, `git diff`, `cat`, `ls`, `tail`, `head` are the
intended use, but a hostile repository could prompt-inject destructive
commands, and git's hooks, aliases, and config-driven execution cannot be
reliably defended against). The only protection is the system-prompt text,
which keeps the agent to read-only inspection: the prompts explicitly forbid
checking out or switching branches and any change to the working tree, the
index, or HEAD — the clone is a shared cache entry, and with `parallel` LLM
sessions several agents inspect it at the same time, so it must stay
byte-identical. Because of this, LLM analysis
is expected to run in the published Docker container, which sandboxes the
analysis away from the host (see the README); a repository under analysis must
be treated as untrusted.

### 6.5 Structured output via the report tool

Not every model supports structured output, so the analysis result is captured
with a **custom tool** instead. `buildReportTool(reportId, llmDir)`
(`src/llm/tools.ts`) builds the `devperf_report` tool in-process with
`defineTool`:

- The tool's parameter schema mirrors `llmToolPayloadSchema`: the JSON Schema
  from `z.toJSONSchema` is mapped onto a TypeBox schema (hand-mapped — typebox
  1.x has no `Type.Create`), descriptions included, so the model-facing shape
  cannot drift from the report.
- The model calls `devperf_report` with the whole analysis object; `execute`
  zod-validates it against the report schema and writes it to
  `<cache-dir>/<hash>/llm/<reportId>.json` (the report id is the
  dev-perf-generated session id), returning `ok`. It never depends on the model
  supporting structured output.
- Every analysis prompt ends with the instruction: **call `devperf_report` with
  the final analysis before finishing** — no other output format is accepted.
- Enforcement: while the analysis prompt runs, the session's
  `tool_execution_start` event is observed; as soon as it fires for
  `devperf_report` with valid arguments, the report file is written from those
  arguments, the running session is aborted, and the analysis moves on — dev-perf
  never waits for an agent that keeps working after reporting. If the turn ends
  without a report, the report file is read as a fallback and a follow-up prompt
  asks the agent to call the tool — up to 3 attempts. If the tool was still not
  called, dev-perf **exits with a non-zero status** and an error message naming
  the user and session; the report is not written.

Default output shape (described in the `devperf_report` tool's schema; all fields
have descriptions to guide the model):

- `overview` (optional) — 1–2 sentences summarizing the user's work in the range.
- `contributions` — the user's changes split into a **list of distinct
  contributions** (one feature, one bug fix, one refactor, …), instead of trying
  to fit everything into a single summary. Each entry:
    - `title` — short name of the contribution;
    - `summary` — what was done and how;
    - `types` — `["feature" | "bugfix" | "refactor" | "test" | "docs" | "tooling" | "chore" | "security"]`;
    - `complexity` — `low | medium | high` plus `complexityReasoning`;
    - `size` — `xs | s | m | l | xl` (t-shirt sizing) plus `sizeReasoning`;
    - `areas` — repo areas/dirs touched by this contribution;
    - `commits` — shas grouped into this contribution;
    - `qualitySignals` — fixed enum of observable quality signals
      (tests-added, docs-updated, test-coverage-expanded, changelog-updated, …);
    - `riskFlags` — fixed enum of observable risk flags (no-tests, large-diff,
      breaking-change, …). Limited to what is observable in the repository:
      review status, for instance, cannot be determined from git history alone.

Changes of different complexity or size are reported as separate contributions
rather than averaged into one description.

### 6.6 Caching and token usage

- LLM analysis results are cached in the cache directory
  (`<cache-dir>/<hash>/llm/`), keyed by (repo, branch, head sha, base, base
  exclusion sha, ignored paths,
  identity, since, until, model, context and output limits) — the identity is
  the full lowercased email set, not just the primary email, so a newly merged
  identity (§5.3) can never reuse a stale result cached for one of its
  constituent emails; the branch, head sha, base, base sha, and ignored paths
  are part of the key so switching any of them never reuses the wrong analysis,
  and — because the head and base *shas* (not just the names) are keyed — an
  advancing branch or base re-keys the cache instead of reusing a stale
  analysis whose commit set no longer matches. The cache version is
  bumped whenever the analysis behavior changes, invalidating entries written by
  older versions. A rerun with the same parameters reuses them; `refresh`
  invalidates the cache and re-runs everything. The cached file stores all
  cache-key components (repo, branch, head, base, base sha, ignored paths,
  primary email, email
  set, range, model, limits) next to the payload, so each file is self-describing;
  the filename hash encodes the same components.
- `llm: false` produces the deterministic-only report (also the CI mode).
- The report includes `tokenUsage` (non-cached input, cached read, and output
  tokens, read from the pi session's `getSessionStats()`). There is no cost
  tracking: dev-perf deliberately does not report estimated USD.

## 7. Report format

Single JSON document (schema defined in `src/report/schema.ts` with zod),
schema v2: repository entries are always wrapped in a `periods` array. Without
`unit` there is exactly one period covering the whole range — the v1 report
content, nested one level deeper. With `unit`, each period is a full
per-repository report over its bounds (UTC instants, `until` inclusive).

Before the analysis, every run logs the application version
(`dev-perf <version>`) to stderr through the logger; a `report` run
follows it with the full resolved configuration as one indented line
per field (`src/run-config.ts`): repositories, dates, unit, output
file, the resolved cache directory, refresh, LLM settings (model,
provider, API key masked), limits, retries, parallelism, and verbose —
always printed, so the effective settings are visible even when the
run fails before the report is written. stdout carries the report JSON
only; with `output` the report goes to the file and stdout stays
empty.

```json
{
  schemaVersion: 3,
  generatedAt: ISO,
  parameters: {
    repos: [ { repo, branch?, base?, ignore?, ignoreCommits? }, ... ],
    since, until, unit?, model?, llmEnabled
  },
  periods: [
    {
      since: ISO (UTC instant, inclusive),
      until: ISO (UTC instant, inclusive),
      repositories: [
        {
          repo, clonePath, branch, baseBranch?, head, ignoredPaths?,
          ignoredCommits?,
          range: { since, until },
          stats: { totalCommits, totalUsers, topLanguages: [...] },
          users: [
            {
              name, emails: [...], isBot,
              deterministic: { commits, nonMergeCommits, mergeCommits, linesAdded,
                linesRemoved, netLines, filesTouched, uniqueFilesTouched, activeDays,
                firstCommitAt, lastCommitAt, avgCommitSize, languages, churn? },
              llm: {
                status: "completed" | "skipped" | "failed",
                overview?,
                contributions: [ { title, summary, types, complexity,
                  complexityReasoning, size, sizeReasoning, areas, commits,
                  qualitySignals, riskFlags } ],
                tokenUsage: { input, cacheRead, output }?, error?
              }
            }
          ]
        }
      ]
    }
  ]
}
```

The report carries no schema change for identity merging: a user's `emails` field
already lists every lowercased email of the identity (§5.3) — one email per
identity without a mapping, the full set when emails merge.

Period splitting (`src/trend/periods.ts`): bounds are UTC instants (day =
midnight, week = Monday, month = 1st, quarter = Jan/Apr/Jul/Oct, year = Jan 1);
the first and last periods are trimmed to the analyzed range; `until` is
inclusive (the next period start minus 1 ms); periods with no commits are
included. The user list is resolved once over the whole range and shown in
every period with zeroed metrics for inactive users; the LLM phase runs per
period for active users only (cache keyed by period bounds, §6.6).

## 8. Project layout

```text
dev-perf/
├── package.json / tsconfig.json        # TypeScript, ESM, Node ≥ 20
├── README.md
├── docs/design.md
├── .gitignore                          # .dev-perf/, node_modules/, dist/
├── src/
│   ├── cli.ts                          # commander entry, command registry
│   ├── commands/report.ts              # the `report` command (options + action)
│   ├── config.ts                       # zod schemas for args
│   ├── config-file.ts                  # YAML config: --config / config.yaml, ${VAR} expansion
│   ├── repo/{clone,cache,git}.ts       # clone/cache management, execa wrappers
│   ├── deterministic/
│   │   ├── commits.ts                  # git log --numstat parsing
│   │   ├── metrics.ts
│   │   ├── identity.ts                 # email normalization + grouping
│   │   ├── path-ignore.ts              # gitignore-style ignore filtering (§5.4)
│   │   ├── commit-ignore.ts            # commit exclusions by hash/message (§5.6)
│   │   └── languages.ts                # extension → language map
│   ├── llm/
│   │   ├── runtime.ts                   # in-process pi ModelRuntime + provider registration
│   │   ├── session.ts                   # create/prompt/tool-call capture/abort/usage
│   │   ├── tools.ts                     # builds the devperf_report tool (defineTool)
│   │   ├── prompts.ts                   # renders src/llm/prompts/*.md templates
│   │   ├── prompts/                     # system + user prompt templates (*.md)
│   │   └── analyze.ts                   # orientation + per-user orchestration
│   ├── trend/periods.ts                # `unit` period splitting + per-period commit filtering
│   ├── report/{schema,assemble}.ts
│   └── util/                           # logging, json
└── tests/
    ├── fixtures/repo-builder.ts        # creates temp git repos with known content
    ├── deterministic.test.ts
    ├── identity.test.ts
    ├── languages.test.ts
    └── e2e.test.ts                     # config-driven `llm: false` run against a fixture repo
```

## 9. Testing strategy

- **Unit**: numstat/`%x1f` log parsing, identity grouping, language
  mapping, churn approximation. Fixture repos are built by `tests/fixtures/repo-builder.ts`
  (init, configure author, commit known files) so line counts are exact and
  asserted exactly.
- **e2e (CI-safe)**: run the full CLI with `llm: false` against a fixture repo,
  snapshot the JSON.
- **LLM integration (manual/slow)**: real run on a small public repo with a known
  contributor; golden-file comparison of the `devperf_report` payload shape (not
  exact content); the retry enforcement is exercised with a stub model that omits
  the tool call; also exercises the LLM result cache idempotency (rerun with the
  same parameters makes no second LLM call).
- **Cost watch**: a script that runs the LLM layer on fixture repos and reports
  token usage, so regressions in prompt size are visible.

## 10. Risks and open questions

- **Library API stability** — `@earendil-works/pi-coding-agent` evolves fast
  (its version pin must be checked when upgrading); keep the runtime/session
  integration in one module so upgrades are localized.
- **Provider auth** — the API key is injected in-memory via
  `ModelRuntime.setRuntimeApiKey`; if the provider rejects it, fail fast with a
  clear message when the first prompt fails.
- **Global config isolation** — the in-process agent must not read the user's
  global `~/.pi`; the isolated `agentDir` and explicit provider/model/key handle
  this, but verify on upgrades that no env-driven config sneaks in.
- **Early-abort race** — when the `devperf_report` tool call starts, the
  session is aborted so the run never waits for the agent to finish; the report
  file write settles the prompt, and the abort-induced prompt rejection is
  recognized and swallowed (a real prompt failure still surfaces). The fallback
  `readSessionReport` covers the turn-ending case.
- **In-process provider calls** — the LLM layer runs inside the dev-perf
  process; a stuck provider call surfaces as an error that ends the run (the
  heartbeat keeps long waits visible in verbose logs).
- **Large repos** — full clones and local per-commit diffs keep the common path
  cheap and offline; a repo with huge binary blobs in history is documented as a
  worst case.
- **Session/directory scoping** — each session is created with the clone as
  `cwd` and the isolated `agentDir`, so tools and prompts are scoped to the
  analyzed repo.
- **Identity is hard** — plain email-based grouping is the v1 contract (bots
  included); the config `users-map` key merges identities at report time
  (§3, §5.3), and `.mailmap`-aware identity resolution remains a candidate for
  automatic merging.
- **Date semantics** — author date in UTC is the v1 contract; document that commit
  date filtering would produce different results.
