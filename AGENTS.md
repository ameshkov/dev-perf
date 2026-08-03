# AGENTS.md

dev-perf — a CLI tool that measures developer contributions to git
repositories and produces a JSON report of per-user metrics. The
analysis is two-layered: deterministic metrics straight from git
history (commits, lines, files, churn, languages) plus an LLM-based
agentic layer that assesses what cannot be counted (work types,
complexity, impact areas, quality signals). The LLM layer uses
opencode as a library (`@opencode-ai/sdk`).

## Table of Contents

- [Project Overview](#project-overview)
- [Technical Context](#technical-context)
- [Project Structure](#project-structure)
- [Build and Test Commands](#build-and-test-commands)
- [Contribution Instructions](#contribution-instructions)
- [Code Guidelines](#code-guidelines)
    - [Architecture](#architecture)
    - [Code Quality](#code-quality)
    - [Testing](#testing)
    - [Dependency Management](#dependency-management)
    - [Configuration & Documentation](#configuration--documentation)
    - [Markdown Formatting](#markdown-formatting)

## Project Overview

`dev-perf` takes one or more repositories (any git URL or local path)
and a date range, and produces a JSON report of contributions **per
user**:

1. **Clone** — each repository is cloned into a gitignored cache
   directory (`.dev-perf/cache` by default, partial clone).
2. **Deterministic analysis** — commits, added/removed lines, files
   touched, churn, active days, and per-language contribution sizes,
   counted straight from git history.
3. **LLM analysis** (optional, `--no-llm` to skip) — an opencode agent
   with read access to the repository inspects the actual commits and
   diffs and assesses the dimensions that cannot be counted. Provider,
   model, and API key are always passed explicitly; the user's global
   opencode configuration is never read.
4. **Assembly** — the two layers are merged into a single JSON report,
   per repository and per user.

The full design and implementation plan lives in
[docs/design.md](./docs/design.md). The analysis pipeline is not
implemented yet — the CLI surface (argument parsing, `--help`,
`--version`) is in place, and running an analysis currently fails with
a not-implemented error.

## Technical Context

| Field | Value |
| --- | --- |
| Language | TypeScript 7, ES2022 target, strict mode |
| Runtime | Node.js 24+ |
| Package Manager | pnpm 10+ |
| CLI framework | commander |
| Validation | zod |
| Linting | oxlint (category-based config) + Knip |
| Formatting | Prettier 3.x, Markdownlint (markdownlint-cli2) |
| Testing | Vitest 4 |
| Project Type | CLI tool (npm bin: dev-perf) |

## Project Structure

```text
dev-perf/
├── src/                      # Application source code
│   ├── index.ts              # CLI entry point: .env loading, version, error handling
│   ├── cli.ts                # Commander program definition (arguments + options) + analysis stub
│   ├── cli.test.ts           # CLI surface tests
│   ├── config.ts             # zod validation of parsed CLI options (cross-field rules)
│   ├── config.test.ts        # CLI options validation tests
│   ├── repo/                 # Clone/cache management (design §4)
│   │   ├── git.ts            # execa-based git wrapper + helpers (clone, log, show, shortlog, rev-parse)
│   │   ├── git.test.ts       # Wrapper integration tests against fixture repos
│   │   ├── cache.ts          # Cache root, entry hash, layout paths, clone.json (zod)
│   │   ├── cache.test.ts     # Cache layout and clone.json tests
│   │   ├── clone.ts          # ensureClone: cache reuse, --refresh, partial-clone fallback
│   │   └── clone.test.ts     # Clone/cache reuse integration tests
│   ├── deterministic/        # Deterministic analysis (design §5)
│   │   ├── commits.ts        # Single-pass git log --numstat parsing + author-date filtering (§5.1, §5.4)
│   │   ├── commits.test.ts   # Parsing golden tests against fixture repos
│   │   ├── identity.ts       # Email grouping, display name, bot flag (§5.3)
│   │   ├── identity.test.ts  # Identity grouping tests
│   │   ├── metrics.ts        # Per-user and repo-level metrics aggregation (§5.2)
│   │   ├── metrics.test.ts   # Exact-value metrics tests against fixture repos
│   │   ├── languages.ts      # Built-in extension→language map + per-language counting (§5.2)
│   │   └── languages.test.ts # Language mapping and counting tests
│   ├── util/                 # Shared helpers, no business logic
│   │   └── json.ts           # Pretty-print, read/write, safe JSON parse
│   └── report/               # Report schema, the single source of truth (design §7)
│       ├── index.ts          # Barrel: public API of the report module
│       ├── schema.ts         # zod schemas + inferred types for the whole report
│       └── schema.test.ts    # Report schema validation tests
├── test/
│   └── fixtures/
│       └── repo-builder.ts   # Builds temp git repos with known files, authors, commits
├── docs/
│   ├── design.md             # Full design document
│   └── plan.md               # Step-by-step implementation plan
├── .github/                  # GitHub Actions workflows
│   └── workflows/
        └── ci.yml            # Quality gate + npm publish on version tags
├── AGENTS.md                 # This file
├── DEVELOPMENT.md            # Local setup & manual testing guide
├── CHANGELOG.md              # Project changelog (Keep a Changelog)
├── oxlint.config.ts          # oxlint category-based config
├── knip.config.ts            # Knip unused-export analysis config
├── tsconfig.json             # TypeScript solution config (references app + test)
├── tsconfig.app.json         # TypeScript configuration (production build)
├── tsconfig.test.json        # TypeScript configuration (tests, noEmit)
├── vitest.config.ts          # Vitest configuration
└── package.json              # Project dependencies and scripts
```

The target structure after the pipeline is implemented (repo clone
management, deterministic analysis, LLM layer, report assembly) is
described in [docs/design.md](./docs/design.md), section 8. When the
structure changes, update this section and keep it valid.

## Build and Test Commands

- `pnpm build` — compile TypeScript to `build/` and make `build/index.js` executable
- `pnpm typecheck` — check for TypeScript type errors in production and test code
- `pnpm lint` — lint source files with oxlint and check for unused exports with Knip
- `pnpm lint:fix` — lint and auto-fix issues
- `pnpm knip` — run Knip unused-export analysis separately
- `pnpm format:check` — check formatting with Prettier and Markdownlint
- `pnpm format:fix` — fix formatting issues
- `pnpm check` — run `format:check`, `lint`, `typecheck`, `build`, and `test` (full CI gate)
- `pnpm clean` — remove `node_modules` and `build/`

## Contribution Instructions

You MUST follow the following rules for EVERY task that you perform:

- You MUST verify it with linter, formatter, and TypeScript compiler.

  Use the following commands:
    - `pnpm typecheck` to check for TypeScript type errors
    - `pnpm lint` to run the linter (oxlint) and Knip unused-export analysis
    - `pnpm lint:fix` to fix linting issues that can be fixed automatically
    - `pnpm format:check` to check the formatting (Prettier and Markdownlint)
    - `pnpm format:fix` to fix the formatting issues

- When making changes to the project structure, ensure the Project
  Structure section in `AGENTS.md` is updated and remains valid.

- If the prompt essentially asks you to refactor or improve existing code,
  check if you can phrase it as a code guideline. If it's possible, add it
  to the relevant Code Guidelines section in `AGENTS.md`.

- You MUST update the unit tests for changed code.

- You MUST run tests with the `pnpm test` script to verify that your
  changes do not break existing functionality.

- After completing the task you MUST verify that the code you've written
  follows the Code Guidelines in this file.

- When the coding task is finished update `CHANGELOG.md` and explain
  changes in the Unreleased section. Add entries to the appropriate
  subsection (Added, Changed, or Fixed) if it already exists; do not
  create duplicate subsections.

## Code Guidelines

### Architecture

Universal design principles this codebase follows:

- **Separation of Concerns** — each module handles one aspect of the
  system (e.g. clone/cache management, deterministic analysis, LLM
  layer, report assembly).
- **Single Responsibility Principle** — every file, class, or function has
  one reason to change.
- **Dependency Direction** — dependencies point downward; never from lower
  layers to higher ones.
- **Explicit Boundaries** — module interfaces are intentional; barrel
  `index.ts` files define public API. External code MUST import from
  barrel files only. Each directory groups related functionality and
  imports only from layers below it.
- **Data Flow Clarity** — data moves through the system in a predictable,
  traceable path (entry point → CLI → services → utilities).
- **Minimize Coupling, Maximize Cohesion** — modules are self-contained
  and interact through narrow interfaces.
- **Make Invalid States Impossible** — use TypeScript strict mode and
  validation (zod) to prevent illegal combinations at compile time.
- **Keep It Boring** — prefer well-understood patterns over clever or
  novel solutions.

The easiest way to achieve these principles is **layered architecture**.
This project's layers, from top to bottom:

- **Entry point** (`src/index.ts`) — loads `.env`, wires the commander
  program, and handles fatal errors. No business logic.
- **CLI** (`src/cli.ts`) — commander program definition: arguments,
  options, and the action that drives the analysis pipeline.
- **Services** — own all business logic: clone/cache management,
  deterministic analysis, LLM orchestration, report assembly.
  Directories: `src/repo/` (implemented), `src/deterministic/`
  (implemented), `src/llm/` (planned), `src/report/`.
- **Utilities** — shared helpers, logging, and type definitions. No
  business logic.

```text
Entry point (src/index.ts)
     ↓
CLI (src/cli.ts)
     ↓
Services (repo/, deterministic/, llm/, report/)
     ↓
Utilities (util/)
```

The analysis pipeline receives everything it needs through explicit
parameters (repos, date range, cache dir, provider configuration) —
never through globals or the user's global opencode configuration.
The report schema (zod) is shared between the CLI, the deterministic
layer, and the LLM structured-output tool schema so nothing can drift.

### Code Quality

All code MUST meet documentation and style requirements before merge:

- **Public API documentation**: Exported functions, classes, interfaces,
  and their properties MUST have JSDoc comments describing purpose,
  arguments, return values, and thrown errors (use `@throws` only for
  specific errors).
- **Static analysis gates**: Every change MUST pass TypeScript compilation
  (`pnpm typecheck`), oxlint (`pnpm lint`), and Prettier/Markdownlint
  (`pnpm format:check`) before merge.
- **Do not modify linter or formatter configurations**: Never change
  oxlint, Prettier, Markdownlint, or TypeScript configuration files
  (`oxlint.config.ts`, `.prettierrc`, `.prettierignore`,
  `.markdownlint-cli2.yaml`, `tsconfig.json`) to work around lint or
  formatting errors. Fix the source code instead. If the issue cannot be
  resolved after a few attempts, ask the human for help.
- **oxlint category selection**: oxlint groups rules into categories
  rather than a single `recommended` preset. This project enables only the
  `correctness` category (error) plus explicit project rules
  (`no-unused-vars`, `max-lines`, `max-lines-per-function`,
  `preserve-caught-error`). The `suspicious`, `restriction`, `pedantic`,
  and `style` categories, and the `unicorn` plugin, are intentionally
  disabled: they forbid idiomatic TypeScript (async/await, optional
  chaining, object spread, `undefined`) and the project's `_`-prefixed
  private-field convention. Do not re-enable these without explicit
  justification.
- **Error handling strategy**: Prefer throwing errors over returning error
  values. Handle errors at top-level entry points where they can be logged.
- **Import style**: Use top-level static `import` statements exclusively.
  Do NOT scatter dynamic `await import()` calls inside function bodies
  ("inline imports"). Dynamic imports placed mid-function obscure
  dependencies, bypass static analysis, and fragment module initialization
  across call sites. When a dynamic import is genuinely necessary (e.g.
  breaking a circular dependency or deferring a heavy module load for
  startup performance), extract it into a named, cached helper function at
  module scope rather than invoking `await import()` inline within business
  logic.
- **File naming**: Use kebab-case for all file names. TypeScript source
  files MUST use lower-case kebab-case. Do NOT use PascalCase or camelCase
  file names.
- **Knip unused-export analysis**: The project uses Knip
  (`knip.config.ts`) to detect unused exports. All Knip findings MUST
  be resolved — either remove the unused export or, when the export is
  genuinely needed but not reachable through the public dependency
  graph, mark it with the JSDoc `@internal` tag. The `@internal` tag
  is allowed **only** when a symbol is exported solely for test files
  and is intentionally **not** re-exported from the module barrel.
  Every `@internal` tag MUST include a short explanation of why the
  export is excluded (e.g. "Exported for tests only; not part of the
  public module API"). Do NOT use `@internal` to silence legitimate
  unused-export warnings — remove the export instead.
- **No `@public` tag**: Do NOT use the `@public` JSDoc tag. This
  project is an application (not a library), so no symbol is part of a
  "public API" consumed by external consumers. Resolve Knip
  unused-export findings by removing the export or marking it
  `@internal` (for test-only symbols not re-exported from the barrel)
  instead.
- **File size limit**: Source files MUST stay within 300 lines of code.
  This is an enforced oxlint `max-lines` gate (`'error'` severity,
  `max: 300`; blank lines and comments are skipped) — a hard gate, not a
  soft target. When a file approaches or exceeds this limit, your FIRST
  and default response MUST be to **split the file into several smaller,
  cohesive files**, each with a single, clear responsibility (extract
  related functions, types, or constants into dedicated modules,
  utilities, or services, and re-export them through the barrel). Treat
  the limit as a signal that the file is doing too much, not as a quota
  to optimize against. You MUST attempt a split before any other tactic;
  only fall back if you can articulate a concrete reason a split would
  hurt clarity. For test files, the `max-lines` gate is raised to 500
  (and `max-lines-per-function` is disabled); split a large `*.test.ts`
  into multiple focused `*.test.ts` files grouped by the behavior they
  verify — multiple test files per source module are explicitly allowed.
  **Do NOT** satisfy the limit by making the existing code shorter: no
  condensing tests into table-driven blocks purely to save lines, no
  shortening of identifiers, string literals, or file paths, no merging
  statements onto one line, and no removing blank lines, comments, or
  JSDoc. Formatting is managed by Prettier and must stay uniform —
  readability and clarity always win over line count.
  Exceptions: auto-generated files and database migration files.
- **Function size limit**: Functions SHOULD stay within 50 lines of code.
  When approaching or exceeding this limit, break the function into
  smaller, named helper functions with single, clear responsibilities.
  **Do NOT** condense logic into dense one-liners, inline multiple
  statements on a single line, or strip whitespace to fit the limit —
  formatting is managed by Prettier and must not be sacrificed for
  brevity.
  Exceptions: auto-generated files and database migration files.

**Rationale**: Consistent documentation and tooling enforcement prevents
technical debt accumulation and ensures codebase navigability.

### Testing

Every module MUST have test coverage:

- **Test file placement**: Test files are co-located with their source
  files in `src/` and MUST use the `.test.ts` suffix (e.g.
  `src/cli.test.ts` next to `src/cli.ts`).
- **Shared test utilities**: Common test infrastructure lives in the
  `test/` directory (fixture repos, setup helpers). These files MUST
  NOT use the `.test.ts` suffix — they are test support code, not test
  cases.
- **End-to-end tests**: E2E tests live in `test/e2e/` and run the full
  compiled CLI as a child process. The deterministic-only path
  (`--no-llm` against a fixture repo, JSON snapshot) is the CI-safe E2E
  target; LLM runs are manual/slow.
- **Test verification mandatory**: All changes MUST pass `pnpm test`
  before merge. Tests MUST NOT be deleted or weakened without explicit
  justification.
- **Use real integrations where practical**: Fixture git repositories
  are built by a test helper (`tests/fixtures/repo-builder.ts` in the
  design) so line counts are exact and asserted exactly. Prefer
  integration-style tests that exercise real components (real `git`
  commands against fixture repos) over mock-heavy unit tests.

**Rationale**: Co-locating tests with source keeps related files close,
making it easier to find, update, and maintain tests. Testing against
real components catches bugs that mocks hide (git output parsing,
transport issues, serialization errors) and gives higher confidence in
the system's actual behavior.

### Dependency Management

- **Pin all dependency versions explicitly**: Do not use `^` or `~` in
  `package.json`.

External dependencies MUST be carefully evaluated before adoption:

- **Prefer vanilla solutions**: Use Node.js built-in APIs and standard
  language features when they adequately solve the problem. Only add a
  dependency when it provides significant value over a vanilla
  implementation.
- **Reputable sources only**: Dependencies MUST come from
  well-established, actively maintained projects. Evaluate by: weekly
  downloads (prefer >100k), GitHub stars, recent commit activity, and
  known maintainers.
- **Avoid unpopular libraries**: Do NOT add niche or obscure packages
  with limited community adoption. These pose security risks and may
  become unmaintained.
- **Minimize dependency count**: Each new dependency increases attack
  surface, bundle size, and maintenance burden. Justify every addition.
- **Use the latest stable version**: When adding a new dependency,
  explicitly check the package registry for the latest stable release and
  use it. Do not copy outdated version numbers from memory, training
  data, or existing lock files of other projects.

**Rationale**: Fewer, well-vetted dependencies reduce security
vulnerabilities, supply chain risks, and long-term maintenance costs.

### Configuration & Documentation

Configuration and documentation MUST stay synchronized with code:

- **Documentation updates required**: Changes to build process or
  configuration MUST update relevant documentation.
- **Structure tracking**: Changes to project structure MUST update the
  Project Structure section in `AGENTS.md`.
- **Environment variables**: A `.env` file in the current working
  directory is auto-loaded at startup (`dotenv`). The only documented
  variable today is `DEV_PERF_API_KEY` (see `.env.example`); it is an
  alternative to the `--api-key` flag. The user's global opencode
  configuration is NEVER read — provider, model, and API key are always
  passed explicitly via `--provider-url`, `--model`, and `--api-key`.

**Rationale**: Stale documentation causes onboarding friction and
operational incidents.

### Markdown Formatting

All Markdown files MUST follow these formatting rules:

- **Line length**: Keep lines at most 80 characters. This is not a hard
  lint gate, but SHOULD be followed for readability. Lines inside fenced
  code blocks are exempt from this limit.
- **Unordered lists**: Use dashes (`-`) for bullet points. Indent nested
  list items by 4 spaces.
- **Emphasis**: Use asterisks (`*`) for emphasis (`*italic*`,
  `**bold**`). Do NOT use underscores.
- **Headings**: Duplicate heading names are allowed only among sibling
  headings (same parent level). Avoid duplicates across different levels.
- **Inline HTML**: Avoid raw HTML in Markdown. The only allowed elements
  are `<a>`, `<p>`, `<details>`, `<summary>`, and `<img>`.
- **Trailing spaces**: Do NOT leave trailing whitespace on any line. Do
  NOT use two-space line breaks — use a blank line instead.
- **Bare URLs**: Bare URLs are permitted and do not need to be wrapped
  in angle brackets.
- **Table formatting**: Align table columns with padding when the table
  fits within 80 characters. If the table exceeds 80 characters or
  triggers an MD060 linter warning, switch to a compact format using
  single spaces only. This applies to the separator row as well — it
  should be written as `| --- |`, not `|--|`.

  Example of correct layout:

  ```markdown
  | Col1 | Col2 |
  | --- | --- |
  | Value1 | Value2 |
  ```

  Do NOT use extra padding or alignment characters beyond single spaces.

**Rationale**: Uniform Markdown formatting improves readability for both
humans and AI agents that consume project documentation.
