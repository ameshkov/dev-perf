/**
 * Regenerates the sample report bundled with the viewer web app
 * (`viewer/public/samples/sample-report.json`). Run from the
 * repository root after the parent fixtures change:
 *
 *     pnpm tsx scripts/generate-viewer-sample.ts
 *
 * The sample is a six-month trend report (schema v3) over two
 * repositories with four human contributors and one bot: monthly
 * periods, LLM analysis enabled, varied work types, sizes,
 * complexities, quality signals, and risk flags. Test support code —
 * not shipped with the viewer build.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Contribution, PeriodUnit } from '../src/report/index.js';
import type { FixturePeriod, FixtureUser } from '../test/fixtures/trend-report-builder.js';
import { buildTrendReport, fixtureContribution } from '../test/fixtures/trend-report-builder.js';

/** The output file inside the viewer project. */
const OUTPUT = path.resolve(import.meta.dirname, '../viewer/public/samples/sample-report.json');

/** The six analyzed months of the sample. */
const MONTHS: Array<{ since: string; until: string }> = [
  { since: '2026-01-01T00:00:00.000Z', until: '2026-01-31T23:59:59.999Z' },
  { since: '2026-02-01T00:00:00.000Z', until: '2026-02-28T23:59:59.999Z' },
  { since: '2026-03-01T00:00:00.000Z', until: '2026-03-31T23:59:59.999Z' },
  { since: '2026-04-01T00:00:00.000Z', until: '2026-04-30T23:59:59.999Z' },
  { since: '2026-05-01T00:00:00.000Z', until: '2026-05-31T23:59:59.999Z' },
  { since: '2026-06-01T00:00:00.000Z', until: '2026-06-30T23:59:59.999Z' },
];

/**
 * A contribution of the sample: the fixture defaults filled with the
 * given overrides.
 *
 * @param overrides - The contribution overrides.
 * @returns The contribution.
 */
function contrib(overrides: Partial<Contribution>): Contribution {
  return fixtureContribution(overrides);
}

/** Fake commit sha of a contribution, stable by title. */
function sha(title: string): string[] {
  let hash = 0x811c9dc5;
  for (const char of title) {
    hash = (hash ^ char.codePointAt(0)!) >>> 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return [hash.toString(16).padStart(8, '0'), (hash * 7).toString(16).padStart(8, '0')];
}

/** The active days of a deterministic profile inside one month. */
function days(month: string, count: number): string[] {
  return Array.from(
    { length: count },
    (_unused, index) => `${month}-${String(1 + ((index * 2) % 27)).padStart(2, '0')}`,
  );
}

/** One language map entry, synced to the deterministic overrides. */
function langs(
  entries: Array<[string, number, number, number]>,
): Record<string, { linesAdded: number; linesRemoved: number; filesTouched: number }> {
  return Object.fromEntries(
    entries.map(([language, linesAdded, linesRemoved, filesTouched]) => [
      language,
      { linesAdded, linesRemoved, filesTouched },
    ]),
  );
}

/** Alice's month: senior backend work in the API repo. */
function aliceOfMonth(monthIndex: number, month: string): FixtureUser {
  const scale = 1 + monthIndex * 0.15;
  const overview = [
    'Alice built the rate limiting layer and hardened request validation in the API.',
    'Alice shipped the usage metering pipeline with a focus on correctness and tests.',
    'Alice led the API v2 routing refactor while keeping the old routes alive.',
    'Alice delivered the webhook delivery queue and its retry semantics.',
    'Alice drove the auth session rework and closed the token rotation gap.',
    'Alice wrapped the half with performance work: caching, pooling, and query tuning.',
  ][monthIndex];
  return {
    name: 'Alice Nguyen',
    emails: ['alice.nguyen@acme.dev'],
    deterministic: {
      commits: 34 + monthIndex * 3,
      linesAdded: Math.round(4200 * scale),
      linesRemoved: Math.round(1300 * scale),
      filesTouched: 96 + monthIndex * 4,
      activeDays: days(month, 14),
      languages: langs([
        ['Go', Math.round(3100 * scale), Math.round(900 * scale), 58],
        ['TypeScript', Math.round(900 * scale), Math.round(300 * scale), 26],
        ['SQL', Math.round(200 * scale), Math.round(100 * scale), 12],
      ]),
    },
    llm: {
      overview,
      contributions: [
        contrib({
          title: 'Request rate limiting and quota enforcement',
          summary:
            'Added per-key rate limiting with sliding windows and quota enforcement, backed by the shared cache; rejection responses carry retry hints.',
          types: monthIndex < 3 ? ['feature', 'security'] : ['feature'],
          complexity: 'high',
          complexityReasoning:
            'New middleware across the request path with cache-backed state and backwards compatibility.',
          size: 'l',
          sizeReasoning: 'Touches gateway, middleware, config, and tests across many files.',
          areas: ['api/gateway', 'api/middleware'],
          commits: sha('rate-limiting'),
          qualitySignals: ['tests-added', 'validation-added', 'error-handling-added'],
          riskFlags: ['touches-critical-path'],
        }),
        contrib({
          title: 'Usage metering pipeline',
          summary:
            'Introduced metering events for billable calls with an idempotent ingest path and reconciliation checks.',
          types: ['feature', 'tooling'],
          complexity: 'medium',
          complexityReasoning: 'Mostly additive pipeline work with one tricky idempotency edge.',
          size: 'm',
          sizeReasoning: 'A focused pipeline plus tests, contained in one area.',
          areas: ['api/metering'],
          commits: sha('metering'),
          qualitySignals: ['tests-added', 'logging-added'],
          riskFlags: monthIndex % 2 === 0 ? ['no-tests'] : [],
        }),
        contrib({
          title: 'Query and connection tuning',
          summary:
            'Tuned the hot read paths with connection pooling and two covering indexes; p95 latency dropped notably.',
          types: ['refactor'],
          complexity: monthIndex > 2 ? 'medium' : 'low',
          complexityReasoning: 'Contained changes with measurable, verified outcomes.',
          size: 's',
          sizeReasoning: 'A handful of files in the data layer.',
          areas: ['api/db'],
          commits: sha('query-tuning'),
          qualitySignals: ['performance-improved', 'benchmarks-added'],
          riskFlags: [],
        }),
      ],
    },
  };
}

/** Bob's month: full-stack fixes across both repos. */
function bobOfMonth(monthIndex: number, month: string): FixtureUser {
  const overview = [
    'Bob chased regressions in the checkout flow and stabilized the session handling.',
    'Bob fixed the sync bugs reported by support and cleaned the shared form components.',
    'Bob split the monolith web bundle and removed dead feature flags.',
    'Bob repaired the CI cache busting and the flaky end-to-end setup.',
    'Bob shipped the settings revamp and the missing validation paths.',
    'Bob closed out the half with a wave of small fixes and dependency cleanups.',
  ][monthIndex];
  return {
    name: 'Bob Fisher',
    emails: ['bob.fisher@acme.dev', 'bfisher@acme.dev'],
    deterministic: {
      commits: 41 + ((monthIndex * 5) % 9),
      linesAdded: 2600 + monthIndex * 160,
      linesRemoved: 2100 + monthIndex * 90,
      filesTouched: 88,
      activeDays: days(month, 16),
      languages: langs([
        ['TypeScript', 1900 + monthIndex * 120, 1500 + monthIndex * 60, 62],
        ['CSS', 300, 260, 12],
        ['Go', 400, 340, 14],
      ]),
    },
    llm: {
      overview,
      contributions: [
        contrib({
          title: 'Checkout state regressions',
          summary:
            'Fixed the race where the cart state lagged behind the payment intent, plus the duplicate-submit guard.',
          types: ['bugfix'],
          complexity: 'medium',
          complexityReasoning: 'Cross-component state bug with a subtle async ordering cause.',
          size: 'm',
          sizeReasoning: 'Several components plus regression tests.',
          areas: ['web/checkout'],
          commits: sha('checkout-fix'),
          qualitySignals: ['tests-added', 'error-messages-improved'],
          riskFlags: ['test-assertions-weak'],
        }),
        contrib({
          title: 'Shared form cleanup',
          summary:
            'Consolidated the three form wrappers into one, removed the dead validation props, and documented the schema helpers.',
          types: ['refactor', 'docs'],
          complexity: 'low',
          complexityReasoning: 'Mechanical consolidation with existing test coverage.',
          size: 's',
          sizeReasoning: 'A narrow set of components.',
          areas: ['web/forms'],
          commits: sha('form-cleanup'),
          qualitySignals: ['docs-updated', 'dead-code-removed', 'code-reuse-improved'],
          riskFlags: [],
        }),
        contrib({
          title: 'Session handling hardening',
          summary:
            'Reworked the session refresh to survive clock skew, and added the missing invalidation on logout.',
          types: ['bugfix', 'security'],
          complexity: 'high',
          complexityReasoning: 'Auth-adjacent logic with several interacting lifetimes.',
          size: 'm',
          sizeReasoning: 'One module but broad blast radius and careful tests.',
          areas: ['api/auth', 'web/session'],
          commits: sha('session-fix'),
          qualitySignals: ['security-hardened', 'tests-added'],
          riskFlags: ['touches-critical-path'],
        }),
      ],
    },
  };
}

/** Carol's month: QA, docs, tooling; absent in the third month. */
function carolOfMonth(monthIndex: number, month: string): FixtureUser | undefined {
  if (monthIndex === 2) {
    return undefined;
  }
  return {
    name: 'Carol Diaz',
    emails: ['carol.diaz@acme.dev'],
    deterministic: {
      commits: 18 + monthIndex,
      linesAdded: 1500 + monthIndex * 80,
      linesRemoved: 400,
      filesTouched: 44,
      activeDays: days(month, 9),
      languages: langs([
        ['Markdown', 500, 90, 18],
        ['TypeScript', 1000 + monthIndex * 80, 310, 26],
      ]),
    },
    llm: {
      overview:
        monthIndex === 5
          ? 'Carol closed the half with the migration guides and the release checklist automation.'
          : 'Carol expanded test coverage, refreshed the docs, and smoothed the contributor tooling.',
      contributions: [
        contrib({
          title: 'Test coverage expansion',
          summary:
            'Filled the gaps in gateway and metering tests flagged by the coverage report, focusing on error paths.',
          types: ['test'],
          complexity: 'low',
          complexityReasoning: 'Additive tests against stable behavior.',
          size: 'm',
          sizeReasoning: 'Many small test files across two areas.',
          areas: ['api/tests'],
          commits: sha('coverage'),
          qualitySignals: ['test-coverage-expanded', 'tests-added'],
          riskFlags: [],
        }),
        contrib({
          title: 'Docs and changelog refresh',
          summary:
            'Updated the configuration reference and changelog for the new limits, and added the upgrade guide.',
          types: ['docs'],
          complexity: 'low',
          complexityReasoning: 'Documentation work following shipped changes.',
          size: 's',
          sizeReasoning: 'A few markdown files.',
          areas: ['docs'],
          commits: sha('docs-refresh'),
          qualitySignals: ['docs-updated', 'changelog-updated', 'migration-guide-added'],
          riskFlags: [],
        }),
        contrib({
          title: 'CI cache and tooling fixes',
          summary:
            'Repaired the flaky cache keys in CI and added the local setup script with sensible defaults.',
          types: ['tooling'],
          complexity: 'medium',
          complexityReasoning: 'Build-system behavior with environment-specific edges.',
          size: 's',
          sizeReasoning: 'A couple of workflow files and one script.',
          areas: ['.github', 'scripts'],
          commits: sha('ci-tooling'),
          qualitySignals: ['logging-added'],
          riskFlags: ['config-changed-without-docs'],
        }),
      ],
    },
  };
}

/** Dave's month: junior frontend work in the web repo. */
function daveOfMonth(monthIndex: number, month: string): FixtureUser {
  return {
    name: 'Dave Malik',
    emails: ['dave.malik@acme.dev'],
    deterministic: {
      commits: 12 + (monthIndex % 4),
      linesAdded: 900 + monthIndex * 40,
      linesRemoved: 300,
      filesTouched: 30,
      activeDays: days(month, 7),
      languages: langs([
        ['TypeScript', 700 + monthIndex * 40, 220, 22],
        ['CSS', 200, 80, 8],
      ]),
    },
    llm: {
      overview:
        'Dave picked up the UI polish items: empty states, the settings forms, and small fixes.',
      contributions: [
        contrib({
          title: 'Settings form revamp',
          summary:
            'Reworked the settings page with the new field components, inline validation, and proper focus order.',
          types: ['feature'],
          complexity: 'medium',
          complexityReasoning: 'New UI across several states with accessibility requirements.',
          size: 'm',
          sizeReasoning: 'One page but many components and styles.',
          areas: ['web/settings'],
          commits: sha('settings-form'),
          qualitySignals: ['accessibility-improved', 'validation-added'],
          riskFlags: monthIndex % 2 === 0 ? ['large-diff'] : [],
        }),
        contrib({
          title: 'Empty states and polish',
          summary:
            'Added empty states and loading skeletons to the lists, and fixed the overflow bugs on narrow screens.',
          types: ['bugfix', 'feature'],
          complexity: 'low',
          complexityReasoning: 'Self-contained UI work.',
          size: 's',
          sizeReasoning: 'A few list components.',
          areas: ['web/lists'],
          commits: sha('empty-states'),
          qualitySignals: ['docs-added'],
          riskFlags: ['snapshot-only-tests'],
        }),
      ],
    },
  };
}

/** The bot's month: dependency bumps in both repos. */
function botOfMonth(month: string): FixtureUser {
  return {
    name: 'renovate[bot]',
    emails: ['renovate[bot]@users.noreply.github.com'],
    isBot: true,
    deterministic: {
      commits: 8,
      linesAdded: 420,
      linesRemoved: 400,
      filesTouched: 16,
      activeDays: days(month, 4),
      // The lock files the bot regenerates are auto-generated: their
      // lines land in `generated`, not in a language. Only the authored
      // manifests (package.json, workflow YAML) count as JSON/YAML.
      languages: langs([
        ['JSON', 20, 18, 2],
        ['YAML', 40, 36, 2],
      ]),
      generated: { linesAdded: 360, linesRemoved: 346, filesTouched: 12 },
    },
    llm: {
      overview: 'Automated dependency updates across the lock files and CI action versions.',
      contributions: [
        contrib({
          title: 'Dependency updates',
          summary:
            'Grouped monthly dependency bumps: runtime, dev, and CI action versions, with lock file regeneration.',
          types: ['chore'],
          complexity: 'low',
          complexityReasoning: 'Automated version bumps.',
          size: 'xs',
          sizeReasoning: 'Lock files and a couple of manifests.',
          areas: ['package.json', '.github'],
          commits: sha('dependency-updates'),
          qualitySignals: [],
          riskFlags: ['dependency-added', 'dependency-removed'],
        }),
      ],
    },
  };
}

/** Builds all six periods of the sample report. */
function samplePeriods(): FixturePeriod[] {
  return MONTHS.map((range, monthIndex) => {
    const month = range.since.slice(0, 7);
    const carol = carolOfMonth(monthIndex, month);
    return {
      since: range.since,
      until: range.until,
      repositories: [
        {
          repo: 'git@github.com:acme/api.git',
          users: [
            aliceOfMonth(monthIndex, month),
            bobOfMonth(monthIndex, month),
            ...(carol === undefined ? [] : [carol]),
            botOfMonth(month),
          ],
        },
        {
          repo: 'https://github.com/acme/web.git',
          users: [bobOfMonth(monthIndex, month), daveOfMonth(monthIndex, month), botOfMonth(month)],
        },
      ],
    };
  });
}

/** Entry point: builds the report and writes the sample JSON. */
async function main(): Promise<void> {
  const report = buildTrendReport({
    llmEnabled: true,
    unit: 'month' as PeriodUnit,
    since: MONTHS[0].since,
    until: MONTHS[MONTHS.length - 1].until,
    periods: samplePeriods(),
  });
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`wrote "${OUTPUT}"`);
}

await main();
