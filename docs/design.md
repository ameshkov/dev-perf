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
- The agentic layer uses **opencode as a library** (`@opencode-ai/sdk`), which gives
  us agents, built-in repo tools (read/grep/bash), custom tools, structured JSON
  output, and multi-provider support (Anthropic, OpenAI, Google, …) out of the box.
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
                                    │ (opencode SDK)      │
                                    └─────────────────────┘
```

Pipeline phases, in order:

1. **Clone** — for each repo, clone into `<tmpdir>/.dev-cache/<hash>/repo`
   (partial clone, see §4).
2. **Deterministic analysis** — enumerate commits in the range, compute per-user
   metrics (§5). This is fast and cheap; it also produces the inputs (commit list,
   stats) the LLM layer will need.
3. **LLM analysis** (optional, `--no-llm` to skip) — for each user, an opencode
   session with read access to the repo finishes by calling the report tool with
   its analysis (§6.5).
4. **Assemble** — merge layers into the report, write to stdout or `--output`
   (§7).

## 3. CLI

```text
dev-perf [options] <repo...>

Arguments:
  repo                   Git repository URL or local path (repeatable)

Options:
  --since <date>         Start date (author-date, UTC). Any git date format.
  --until <date>         End date (default: today)
  --unit <unit>          Split the range into periods: day, week, month,
                         quarter, year (requires --since)
  --output <file>        Write JSON report to file (default: stdout; pretty-printed)
  --cache-dir <dir>      Cache directory (default: <tmpdir>/.dev-cache) — cloned repos
                         and LLM analysis results (§4, §6.6)
  --refresh              Force re-clone and re-analysis even if cache is present
  --no-llm               Deterministic stats only
  --model <model>        Model id, e.g. gpt-4.1 (required for LLM analysis)
  --provider-url <url>   OpenAI-compatible provider base URL (required for LLM)
  --api-key <key>        Provider API key (required for LLM; DEV_PERF_API_KEY env
                         var allowed)
  --limit-context <n>    Max context tokens for LLM analysis (default: 262144)
  --limit-output <n>     Max output tokens for LLM analysis (default: 65536)
  --verbose
```

The LLM layer requires `--model`, `--provider-url` and `--api-key` to be specified
explicitly — dev-perf never falls back to the user's global opencode configuration
(see §6.2). `--limit-context` and `--limit-output` are optional caps for the model
window (defaults: 256k context / 64k output tokens), passed through as opencode's
`limit` config (§6.2).

With `--unit`, the analyzed range is split into UTC-aligned periods and the report
carries one full per-repository report per period (`src/trend/periods.ts`):
period bounds are instants (day = midnight, week = Monday, month = 1st,
quarter = Jan/Apr/Jul/Oct, year = Jan 1), first/last periods are trimmed to the
range, `until` is inclusive (next start − 1 ms), and empty periods are included
with zeroed metrics. The user list is resolved once over the whole range and
shown in every period; the LLM phase runs per period for the users active in it
(one opencode server per repo, shared across its periods; the LLM result cache
keys by period bounds). `--since` is required with `--unit` — an unbounded range
cannot be split.

Implementation: `commander` for arg parsing, `zod` for validation of args and all
data schemas. The report schema (zod) is shared between the CLI, the deterministic
layer, and the LLM structured-output schema so nothing can drift.

## 4. Cache and cloning

- Default cache root: `<tmpdir>/.dev-cache` — `.dev-cache` in the OS temp
  directory, so invoking the tool never pollutes the working directory and
  nothing needs to be gitignored. Point `--cache-dir` anywhere to override,
  e.g. `~/.cache/dev-perf`.
- Layout:

```text
<tmpdir>/.dev-cache/
└── <sha256(repoUrl).slice(0,16)>/
    ├── repo/        # the git clone
    ├── clone.json   # { url, clonedAt, branch, head }
    ├── llm/         # cached LLM analysis results (§6.6)
    └── opencode/    # generated .opencode/tools/devperf_report.ts + opencode.json (§6.2, §6.5)
        └── home/    # opencode's isolated HOME — server state and logs, kept (§6.2)
```

- Clone strategy: `git clone --filter=blob:none` (partial clone). Full history is
  needed for the date range, but blobs are fetched on demand when the deterministic
  layer reads numstat data or the LLM agent requests a diff. Falls back to a full
  clone when the hosting does not support partial clones.
- Cache reuse: if `repo/` exists and `clone.json` matches the URL, skip cloning;
  `--refresh` forces a re-clone. LLM results are cached under the same entry and
  reused when parameters match; `--refresh` invalidates both (§6.6). On re-clone
  the old dir is removed.
- All git operations go through a small `execa`-based wrapper (`src/repo/git.ts`).

## 5. Deterministic analysis

### 5.1 Data extraction (git commands)

- Commit list with metadata and per-file line counts in one pass:

  ```sh
  git log --since=<since> --until=<until> \
    --pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e \
    --numstat --no-renames
  ```

  Fields: `sha`, parent shas (`%P` — lets us detect merge commits), author name,
  author email, author date (ISO 8601), subject; followed by numstat rows
  `added\tdeleted\tpath`.
- Author identity list: `git shortlog -sne --since=... --until=...`.
- Per-commit diffs (only when the LLM layer or verbose output needs them, fetched
  lazily): `git show --format=fuller --stat --patch <sha>`.

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
| `activeDays` | Distinct author-dates |
| `firstCommitAt` / `lastCommitAt` | Author dates |
| `avgCommitSize` | added/removed per non-merge commit |
| `languages` | Per extension: linesAdded, linesRemoved, filesTouched (cloc-style counting applied to contributions; extension → language via a built-in map) |
| `churn` | (v2) deletions by the author on files they added earlier in range — an approximation of rework |

Repo-level stats: total commits in range, distinct users, top languages by
contribution.

### 5.3 Author identity

- Commits are grouped by **lowercased author email**; the display name is the most
  frequent author name for that email.
- v1 keeps this simple: everything (and everyone, bots included) is counted as-is,
  no email merging. `.mailmap`-aware identity resolution is a candidate v2 feature.

### 5.4 Filtering

- **No exclusions** — bots (`[bot]` suffix, `dependabot`, `renovate`, …) and every
  other author are counted like anyone else.
- **Merge commits** — counted, but reported separately so the line numbers are
  honest (merge diffs can be misleading).
- Date filtering uses **author date**, interpreted in UTC.

## 6. LLM-based (agentic) analysis

### 6.1 Why opencode as a library

Building a custom tool-calling loop with a provider SDK would mean reimplementing
agent loops, tool schemas, retries, and multi-provider support. `@opencode-ai/sdk`
(verified against v1.18.x) provides all of it:

- `createOpencode({ hostname, port, config })` — starts a server **in-process**
  (with a type-safe client), scoped to the working directory it runs in.
  Configuration is passed explicitly: we generate the config ourselves rather than
  relying on the user's global opencode setup (§6.2).
- `createOpencodeClient({ baseUrl })` — connects to an already running
  `opencode serve` (useful for debugging).
- Sessions: `session.create`, `session.prompt` (with tool use), `session.abort`,
  `session.messages`.
- **Custom tools**: files in `<clone>/.opencode/tools/*.ts` using `tool()` from
  `@opencode-ai/plugin` are loaded by the server at startup — we register a
  report-capture tool there, so the agent returns its analysis as validated JSON
  from any model, not only models with structured-output support (§6.5).
- Progress: `event.subscribe()` SSE stream for logs/updates.

### 6.2 Server lifecycle and configuration

- One server per cloned repo: `createOpencode()` launched with cwd = the clone
  directory, so the project, file tools, and LSP are scoped to the analyzed repo.
- **No global opencode config**: dev-perf must not pick up the user's
  `~/.config/opencode/` or project `opencode.json`. Instead we generate an
  isolated `opencode.json` inside the clone that declares the provider and model
  from the required `--provider-url` / `--model` flags, and ensure the server does
  not merge any user config (e.g. by pointing `OPENCODE_CONFIG` at the generated
  file — exact mechanism to be confirmed during implementation).
- The API key from `--api-key` is set programmatically on the spawned server via
  `client.auth.set({ path: { id: <provider> }, body: { type: "api", key } })`
  rather than stored in any file.
- The server runs with an **isolated HOME**: `HOME`/`XDG_CONFIG_HOME` point at the
  cache entry's `opencode/home/` directory (a dev-perf-owned directory, created
  per entry — the user's real home is never read). Unlike the generated files
  beside it, this home is **kept** after the run, so opencode's state and log
  files persist there (e.g. `opencode/home/.local/share/opencode/log/`) and can
  be inspected to diagnose a failed analysis.
- With `--verbose` the server is started at **DEBUG log level** (the SDK forwards
  the generated config's `logLevel` as `--log-level=DEBUG` to `opencode serve`),
  so the cache's `opencode.log` records server-side detail — per-part updates,
  tool calls, provider round-trips — for diagnosing a stuck or failed attempt.
  Without `--verbose` the server stays at its default INFO level.
- Before starting the server, the tool writes into the clone:
    - `opencode.json` — provider (base URL) + model, permissions (read-only for
      the repo, deny writes), and a `limit` block;
    - `.opencode/tools/devperf_report.ts` — the report-capture tool, registered
      via a plugin (§6.5);
    - `.opencode/agents/devperf-analyst.md` — the analysis agent, following
      opencode's markdown agent spec: YAML frontmatter (description, mode,
      permissions) and the prompt as the body (§6.4).
- **Token limits** — the generated `opencode.json` caps the model window so a
  single analysis cannot blow the context:

  ```json
  { "limit": { "context": 262144, "output": 65536 } }
  ```

  `--limit-context` and `--limit-output` override the defaults (256k context /
  64k output tokens); both are optional.
- Server shutdown in `finally`; `--verbose` prints the server URL and model.
- Multiple repos are analyzed sequentially (one server at a time) in v1; user
  sessions within a repo run one at a time to keep resource usage predictable.

### 6.3 Sessions and prompts

- Prompt text lives in `src/llm/prompts/*.md` templates (`orientation.md`,
  `user.md`, `reminder.md`); `prompts.ts` only renders them with the session
  values, so the prose stays maintainable outside the code.
- **Orientation session** (per repo, once): the agent explores the repo (README,
  manifests, top-level layout) and returns a compact "repo context": tech stack,
  main modules, conventions. Output is cached and injected into every user prompt,
  so user sessions do not re-explore.
- **Per-user session**: prompt contains user identity, date range, the repo
  context, and the user's commit list (sha, date, subject, numstat totals, files).
  The agent then decides what to look at (via tools) and finishes by calling the
  report tool with its analysis (§6.5).
- Context injection without triggering a reply: `session.prompt` with
  `noReply: true` for the fixed instructions, then the analysis request.

### 6.4 Agent tools

Analysis runs through a dedicated `devperf-analyst` agent defined by an
opencode **markdown agent file** (`src/llm/agents/devperf-analyst.md`, copied
into the clone's `.opencode/agents/` where the server discovers it — the file
name is the agent name). The file follows opencode's agent spec: YAML
frontmatter with the description, `mode: primary`, and the permission
surface; the body is the prompt. Permissions are deny-all with a short
allow-list: a leading `"*": deny` (opencode matches permission rules
last-wins) followed by the read tools (`read`, `glob`, `grep`, `list`),
`bash` restricted to read-only commands — git history and ref
inspection (`git show`, `git log`, `git diff`, `git blame`,
`git status`, `git branch`, `git tag`, `git rev-parse`,
`git rev-list`, `git shortlog`, `git ls-tree`, `git ls-files`,
`git grep`, `git describe`, `git merge-base`, `git cat-file`; git is a
prerequisite of dev-perf, so all history inspection goes through
bash), file inspection (`ls`, `cat`, `tail`, `head`, `wc`, `file`,
`grep`, `rg`), and text processing (`sort`, `uniq`, `cut`, `diff`,
`echo`) — and the `devperf_report` capture tool. Everything
else — edits, task delegation, todos, questions, web access, skills,
LSP, doom-loop recovery, external directories — is denied by the
wildcard. Sessions pass `agent: devperf-analyst` on every prompt,
context injection included.

### 6.5 Structured output via the report tool

Not every model supports structured output (the SDK's `json_schema` prompt
format), so the analysis result is captured with a **custom tool** instead. The
tool is registered via a plugin: dev-perf writes `.opencode/tools/devperf_report.ts`
into the clone before the server starts (using `tool()` from `@opencode-ai/plugin`):

- The tool takes the whole analysis object as its JSON argument, validates it
  against the report schema (zod), writes it to
  `<cache-dir>/<hash>/llm/<user-key>.json` and returns `ok`. It never depends on
  the model supporting structured output.
- Every analysis prompt ends with the instruction: **call `devperf_report` with
  the final analysis before finishing** — no other output format is accepted.
- Enforcement: the session's report file is polled while the analysis prompt
  runs; as soon as the tool output exists, the session is aborted and the
  analysis moves on — dev-perf never waits for an agent that keeps working
  after reporting. If the prompt ends without a report, dev-perf sends a
  follow-up prompt asking the agent to call the tool — up to 3 attempts. If
  the tool was still not called, dev-perf **exits with a non-zero status** and
  an error message naming the user and session; the report is not written.

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

### 6.6 Caching and cost visibility

- LLM analysis results are cached in the cache directory
  (`<cache-dir>/<hash>/llm/`), keyed by (repo, user, since, until, model, context
  and output limits). A rerun with the same parameters reuses them; `--refresh`
  invalidates the cache and re-runs everything. The cached file stores all
  cache-key components (repo, email, range, model, limits) next to the payload,
  so each file is self-describing; the filename hash encodes the same
  components.
- `--no-llm` produces the deterministic-only report (also the CI mode).
- The report includes `tokenUsage` (non-cached input, cached read, and output
  tokens — opencode reports non-overlapping counts, so `input` excludes the
  cached reads) and an estimated cost per user from the SDK event stream, so
  runaway costs are visible.

## 7. Report format

Single JSON document (schema defined in `src/report/schema.ts` with zod),
schema v2: repository entries are always wrapped in a `periods` array. Without
`--unit` there is exactly one period covering the whole range — the v1 report
content, nested one level deeper. With `--unit`, each period is a full
per-repository report over its bounds (UTC instants, `until` inclusive).

Before the analysis, every run logs the application version
(`dev-perf <version>`) to stderr through the logger; a `report` run
follows it with the full resolved configuration as one indented line
per field (`src/run-config.ts`): repositories, dates, unit, output
file, the resolved cache directory, refresh, LLM settings (model,
provider, API key masked), limits, retries, parallelism, and verbose —
always printed, so the effective settings are visible even when the
run fails before the report is written. stdout carries the report JSON
only; with `--output` the report goes to the file and stdout stays
empty.

```json
{
  schemaVersion: 2,
  generatedAt: ISO,
  parameters: { repos: [...], since, until, unit?, model?, llmEnabled },
  periods: [
    {
      since: ISO (UTC instant, inclusive),
      until: ISO (UTC instant, inclusive),
      repositories: [
        {
          repo, clonePath, branch, head,
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
                tokenUsage: { input, cacheRead, output }?, estimatedCostUsd?, error?
              }
            }
          ]
        }
      ]
    }
  ]
}
```

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
│   ├── repo/{clone,cache,git}.ts       # clone/cache management, execa wrappers
│   ├── deterministic/
│   │   ├── commits.ts                  # git log --numstat parsing
│   │   ├── metrics.ts
│   │   ├── identity.ts                 # email normalization + grouping
│   │   └── languages.ts                # extension → language map
│   ├── llm/
│   │   ├── server.ts                   # createOpencode lifecycle
│   │   ├── session.ts                  # create/prompt/tool-call capture/abort
│   │   ├── tools.ts                    # generates .opencode/tools/*.ts
│   │   ├── prompts.ts                  # renders src/llm/prompts/*.md templates
│   │   ├── prompts/                    # LLM prompt templates (*.md)
│   │   ├── agents/                     # the devperf-analyst agent definition (*.md)
│   │   └── analyze.ts                  # orientation + per-user orchestration
│   ├── trend/periods.ts                # --unit period splitting + per-period commit filtering
│   ├── report/{schema,assemble}.ts
│   └── util/                           # logging, json
└── tests/
    ├── fixtures/repo-builder.ts        # creates temp git repos with known content
    ├── deterministic.test.ts
    ├── identity.test.ts
    ├── languages.test.ts
    └── e2e.test.ts                     # --no-llm run against a fixture repo
```

## 9. Testing strategy

- **Unit**: numstat/`%x1f` log parsing, identity grouping, language
  mapping, churn approximation. Fixture repos are built by `tests/fixtures/repo-builder.ts`
  (init, configure author, commit known files) so line counts are exact and
  asserted exactly.
- **e2e (CI-safe)**: run the full CLI with `--no-llm` against a fixture repo,
  snapshot the JSON.
- **LLM integration (manual/slow)**: real run on a small public repo with a known
  contributor; golden-file comparison of the `devperf_report` payload shape (not
  exact content); the retry enforcement is exercised with a stub model that omits
  the tool call; also exercises the LLM result cache idempotency (rerun with the
  same parameters makes no second LLM call).
- **Cost watch**: a script that runs the LLM layer on fixture repos and reports
  token usage, so regressions in prompt size are visible.

## 10. Risks and open questions

- **SDK API stability** — opencode 1.x evolves fast; pin the SDK version, keep the
  server/client integration in one module so upgrades are localized.
- **Provider auth** — the API key is passed via `--api-key` and injected with
  `client.auth.set()`; if the provider rejects it, fail fast with a clear message
  when the first prompt fails.
- **Global config isolation** — the spawned server must not merge the user's
  `opencode.json`/global config. Verify the isolation mechanism (e.g.
  `OPENCODE_CONFIG`) during implementation; if it is not fully supported, fall
  back to an empty inline `config` passed to `createOpencode` and document any
  residual behavior.
- **Server startup cost** — each repo spawns a server; verify startup time with
  `createOpencode` on CI-sized machines and keep the external-server
  (`createOpencodeClient`) path as an escape hatch.
- **Large repos** — partial clones and lazy per-commit diffs keep the common path
  cheap; a repo with huge binary blobs in history is documented as a worst case.
- **Session/directory scoping** — verify that sessions created via the SDK are
  scoped to the server's cwd (they should be, given the server is started inside
  the clone); if a session-level `directory` option exists, use it explicitly.
- **Identity is hard** — plain email-based grouping is the v1 contract (no
  merging, bots included); `.mailmap`-aware identity resolution is a candidate v2
  feature.
- **Date semantics** — author date in UTC is the v1 contract; document that commit
  date filtering would produce different results.
