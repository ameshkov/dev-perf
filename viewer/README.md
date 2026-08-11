# dev-perf viewer

An interactive, fully client-side web viewer for the JSON reports
written by `dev-perf report`. Drop a `reports.json` onto the page (or
load the bundled sample) and explore the team's contribution
statistics: a hero overview, team dynamics and per-user charts grouped
by what they read — activity, the nature of the work, and the LLM's
risk and quality signals — per-user detail views with the
LLM-assessed contribution cards, and repository comparisons. A `Navigation` button in the top bar opens a panel that
navigates between the sections and scopes the whole dashboard to a
subset of repositories (scoped by their short name) and/or
contributors — the overview KPIs, team dynamics, distributions, and
individual reports all recompute for the selection. The panel's
"Contributor statistics" group picks which contributor's individual
dynamics are shown and, for a multi-period report, one chip per
period — the chip of the currently viewed period stays selected, and
clicking another period jumps to that period's contribution group in
the individual section, where every period stays listed; a period
without contributions shows a placeholder. The panel is hidden by
default and closes on an outside click, on Escape, or when a section
link navigates; it also stays narrower than the viewport at every
width, so it never needs horizontal scrolling on mobile. The overview
meta bar shows one chip per analyzed repository spec — a repository
analyzed on several branches, or with a different base scoping or
ignore filters, shows one distinguishable chip per spec — and long
lists collapse behind a single "N repositories" chip that expands on
click.

Everything is parsed and rendered locally in the browser — reports
never leave your machine. Both the current report schema (v3 trend
reports) and the legacy v1 shape are accepted; a v1 report is wrapped
into a single period before rendering.

## Hosted site

The latest build of the viewer runs at
https://ameshkov.github.io/dev-perf/: a static site published to
GitHub Pages by the repository's `pages.yml` workflow on every push to
`master` and on every release tag. Open the page and drop a report onto
it — no CLI, server, or configuration needed.

## Development

The viewer is a standalone project with its own dependency set and
quality gates, mirroring the parent CLI's conventions ([AGENTS.md]
(../AGENTS.md) applies): React 19 + TypeScript 7 (strict), Vite,
ECharts, zod, Vitest + Testing Library, oxlint + Knip, Prettier +
Markdownlint. All dependency versions are pinned.

```console
cd viewer
pnpm install
pnpm dev        # dev server on http://localhost:5173
```

Quality gates (same commands as the parent project):

```console
pnpm typecheck      # tsc --noEmit
pnpm lint           # oxlint + Knip unused-export analysis
pnpm format:check   # Prettier + Markdownlint
pnpm test           # Vitest (jsdom)
pnpm build          # static site into build/
pnpm check          # all of the above in CI order
```

## Building

```console
pnpm build
```

emits a fully static site to `build/` (asset references are relative,
so the directory can be served from any path by any static file
server).

## The bundled sample report

`public/samples/sample-report.json` is a generated artifact: a
six-month trend report over two repositories with four human
contributors and one bot, built by the parent project's test
fixtures. Regenerate it from the repository root whenever the parent
fixtures change:

```console
pnpm tsx scripts/generate-viewer-sample.ts
```

The viewer's integration test (`src/data/sample-report.test.ts`)
parses this artifact on every run, so a stale or invalid sample fails
the test suite.

## Layout

- `src/report/` — read-only port of the report schema (v3 + legacy
  v1) and the upload parser.
- `src/data/` — report → chart data extraction: per-period team
  points, per-user series, repository summaries, bus factor, signal
  tallies, and the repository/contributor scope filtering applied
  before extraction.
- `src/charts/` — ECharts setup: theme, reusable option builders.
- `src/components/` — shared UI: the chart block and chart group with
  tag selection, badges, KPI grid.
- `src/team/` — the team dynamics section: the activity,
  nature-of-work, and risk-and-quality chart groups (deterministic,
  LLM, and distribution chart blocks).
- `src/individual/` — the per-user section: picker, detail view, and
  contribution cards.
- `src/app/` — the root component, hero, upload panel, dashboard, the
  report-loading state machine, the report scope state, the section
  navigation, and the scope filter chip groups.
- `src/styles/` — the dark theme stylesheets.
- `test/` — shared fixture builders for the report schema.
