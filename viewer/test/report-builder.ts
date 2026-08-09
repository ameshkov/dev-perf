/**
 * Shared test fixture builders for the dev-perf viewer: minimal valid
 * report documents that pass the zod schemas in `src/report/schema.ts`
 * and `src/report/schema-report.ts`, plus a predictable two-period,
 * two-repo, two-user report whose numbers are worked out in
 * `docs` of `chart-data.test.ts`. Callers override any field; the
 * defaults keep every fixture schema-valid.
 */
import type {
  Complexity,
  Contribution,
  ContributionSize,
  ContributionType,
  DeterministicMetrics,
  LanguageContribution,
  LlmAnalysis,
  PeriodUnit,
  Repository,
  RepoSpec,
  TokenUsage,
  TrendReport,
  User,
} from '../src/report/index.js';

/** TypeScript line counts fixture, reused by the default metrics. */
const TYPESCRIPT: LanguageContribution = { linesAdded: 100, linesRemoved: 20, filesTouched: 3 };

/** Overridable fields of {@link buildContribution}. */
export interface BuildContributionOptions extends Partial<Omit<Contribution, 'types'>> {
  /** Kinds of change this contribution mixes. */
  types?: ContributionType[];
}

/**
 * Builds one valid LLM contribution with sane defaults.
 *
 * @param overrides - Fields to override.
 * @returns A schema-valid contribution.
 */
export function buildContribution(overrides: BuildContributionOptions = {}): Contribution {
  return {
    title: 'Ship the feature',
    summary: 'Implemented the feature end to end.',
    types: ['feature'],
    complexity: 'medium',
    complexityReasoning: 'Touches several modules.',
    size: 'm',
    sizeReasoning: 'A few hundred lines.',
    areas: ['src'],
    commits: ['a1b2c3d4e5f6a7b8'],
    qualitySignals: [],
    riskFlags: [],
    ...overrides,
  };
}

/** Overridable fields of {@link buildDeterministic}. */
export type BuildDeterministicOptions = Partial<DeterministicMetrics>;

/**
 * Builds valid deterministic metrics with plausible defaults.
 *
 * @param overrides - Fields to override.
 * @returns Schema-valid deterministic metrics.
 */
export function buildDeterministic(
  overrides: BuildDeterministicOptions = {},
): DeterministicMetrics {
  return {
    commits: 2,
    nonMergeCommits: 2,
    mergeCommits: 0,
    linesAdded: 100,
    linesRemoved: 20,
    netLines: 80,
    filesTouched: 3,
    uniqueFilesTouched: 2,
    activeDays: ['2026-01-05'],
    firstCommitAt: '2026-01-05T09:00:00.000Z',
    lastCommitAt: '2026-01-06T15:00:00.000Z',
    avgCommitSize: 60,
    languages: { TypeScript: { ...TYPESCRIPT } },
    ...overrides,
  };
}

/** Overridable fields of {@link buildTokenUsage}. */
export type BuildTokenUsageOptions = Partial<TokenUsage>;

/**
 * Builds a valid token-usage record.
 *
 * @param overrides - Fields to override.
 * @returns A schema-valid token usage.
 */
export function buildTokenUsage(overrides: BuildTokenUsageOptions = {}): TokenUsage {
  return { input: 10, cacheRead: 5, output: 2, ...overrides };
}

/** Overridable fields of {@link buildLlm}. */
export type BuildLlmOptions = Partial<LlmAnalysis>;

/**
 * Builds a valid LLM analysis; skipped without contributions by
 * default, so deterministic-only fixtures stay valid.
 *
 * @param overrides - Fields to override.
 * @returns A schema-valid LLM analysis.
 */
export function buildLlm(overrides: BuildLlmOptions = {}): LlmAnalysis {
  return { status: 'skipped', contributions: [], ...overrides };
}

/** Overridable fields of {@link buildUser}. */
export interface BuildUserOptions {
  /** Display name of the user. */
  name?: string;
  /** Author emails grouped into this identity. */
  emails?: string[];
  /** Heuristic bot flag. */
  isBot?: boolean;
  /** Deterministic metrics. */
  deterministic?: DeterministicMetrics;
  /** The LLM analysis. */
  llm?: LlmAnalysis;
}

/**
 * Builds one valid user entry.
 *
 * @param overrides - Fields to override.
 * @returns A schema-valid user.
 */
export function buildUser(overrides: BuildUserOptions = {}): User {
  return {
    name: 'Alice Nguyen',
    emails: ['alice@example.com'],
    isBot: false,
    deterministic: buildDeterministic(),
    llm: buildLlm(),
    ...overrides,
  };
}

/** One repository entry of one period, as built by the caller. */
export type BuildRepository = Omit<Repository, 'stats'> & {
  /** Repository-level statistics; totals default to the users. */
  stats?: Repository['stats'];
};

/**
 * Builds one valid repository entry; `stats` totals default to the
 * users it carries (commit sum, distinct users, first language).
 *
 * @param overrides - Fields to override.
 * @returns A schema-valid repository entry.
 */
export function buildRepository(overrides: Partial<BuildRepository> = {}): Repository {
  const users = overrides.users ?? [buildUser()];
  return {
    repo: 'https://github.com/acme/app.git',
    clonePath: '/tmp/.dev-cache/abc123',
    branch: 'master',
    head: 'f7e6d5c4b3a29876543210fedcba9876543210ab',
    range: { since: '2026-01-01T00:00:00.000Z', until: '2026-01-31T23:59:59.999Z' },
    users,
    ...overrides,
    stats: overrides.stats ?? {
      totalCommits: users.reduce((sum, user) => sum + user.deterministic.commits, 0),
      totalUsers: users.length,
      topLanguages: [{ language: 'TypeScript', linesAdded: 100 }],
    },
  };
}

/** One period of a trend report. */
export interface BuildPeriod {
  /** Period start (UTC instant, inclusive). */
  since: string;
  /** Period end (UTC instant, inclusive). */
  until: string;
  /** One entry per analyzed repository in this period. */
  repositories: Repository[];
}

/** Overridable fields of {@link buildTrendReport}. */
export interface BuildTrendReportOptions {
  /** One period per entry, oldest first. */
  periods?: BuildPeriod[];
  /** Repository specs, defaulting to the first period's repos. */
  repos?: RepoSpec[];
  /** Start of the analyzed range (defaults to the first period). */
  since?: string;
  /** End of the analyzed range (defaults to the last period). */
  until?: string;
  /** Period unit; omit for a single-period report. */
  unit?: PeriodUnit;
  /** Whether LLM analysis was enabled. */
  llmEnabled?: boolean;
  /** Model used for LLM analysis. */
  model?: string;
  /** When the report was generated. */
  generatedAt?: string;
}

/**
 * Builds a full schema-valid v3 trend report.
 *
 * @param options - Report fields; sane single-period defaults apply.
 * @returns The trend report document.
 */
export function buildTrendReport(options: BuildTrendReportOptions = {}): TrendReport {
  const periods: BuildPeriod[] = options.periods ?? [
    {
      since: '2026-01-01T00:00:00.000Z',
      until: '2026-01-31T23:59:59.999Z',
      repositories: [buildRepository()],
    },
  ];
  const repos =
    options.repos ?? periods[0].repositories.map((repository) => ({ repo: repository.repo }));
  const since = options.since ?? periods[0].since;
  const until = options.until ?? periods[periods.length - 1].until;
  const model = options.model;
  return {
    schemaVersion: 3,
    generatedAt: options.generatedAt ?? '2026-03-01T00:00:00.000Z',
    parameters: {
      repos,
      since,
      until,
      llmEnabled: options.llmEnabled ?? true,
      ...(model === undefined ? {} : { model }),
      ...(options.unit === undefined ? {} : { unit: options.unit }),
    },
    periods,
  };
}

/** Overridable fields of {@link buildLegacyV1Report}. */
export interface BuildLegacyV1ReportOptions {
  /** When the report was generated. */
  generatedAt?: string;
  /** Clone targets as plain strings (the legacy spec form). */
  repos?: string[];
  /** Start of the analyzed range. */
  since?: string;
  /** End of the analyzed range. */
  until?: string;
  /** Whether LLM analysis was enabled. */
  llmEnabled?: boolean;
  /** Model used for LLM analysis. */
  model?: string;
  /** Repository entries. */
  repositories?: Repository[];
}

/**
 * Builds a schema-valid legacy v1 report document (schemaVersion 1,
 * parameters and repositories, no periods). The document shape only
 * matches `legacyReportSchema`; it is typed loosely as a trend report
 * for fixture convenience.
 *
 * @param options - Document fields; sane defaults apply.
 * @returns The v1 report document.
 */
export function buildLegacyV1Report(options: BuildLegacyV1ReportOptions = {}): TrendReport {
  const {
    generatedAt = '2026-03-01T00:00:00.000Z',
    repos = ['git@github.com:acme/legacy.git'],
    since = '2026-01-01T00:00:00.000Z',
    until = '2026-03-31T23:59:59.999Z',
    llmEnabled = false,
    model,
    repositories,
  } = options;
  const document = {
    schemaVersion: 1,
    generatedAt,
    parameters: {
      repos,
      since,
      until,
      llmEnabled,
      ...(model === undefined ? {} : { model }),
    },
    repositories: repositories ?? [buildRepository({ repo: repos[0], range: { since, until } })],
  };
  return document as unknown as TrendReport;
}

/**
 * Strips the LLM analysis off every user of the periods, mirroring a
 * deterministic-only report as written by the CLI (skipped status, no
 * contributions).
 *
 * @param periods - The periods whose users to strip.
 * @returns The periods with contribution-free analyses.
 */
function stripLlm(periods: BuildPeriod[]): BuildPeriod[] {
  return periods.map((period) => ({
    ...period,
    repositories: period.repositories.map((repository) => ({
      ...repository,
      users: repository.users.map((user) => ({
        ...user,
        llm: { status: 'skipped' as const, contributions: [] },
      })),
    })),
  }));
}

/** January 2026 period bounds, as used by the demo report. */
const JANUARY = { since: '2026-01-01T00:00:00.000Z', until: '2026-01-31T23:59:59.999Z' };

/** February 2026 period bounds, as used by the demo report. */
const FEBRUARY = { since: '2026-02-01T00:00:00.000Z', until: '2026-02-28T23:59:59.999Z' };

/** Repository specs of the demo report: one ssh and one https URL. */
const DEMO_REPOS = ['git@github.com:acme/api.git', 'https://github.com/acme/web.git'];

/**
 * Builds the shared demo report: two monthly periods (January and
 * February 2026), two repositories (`api`, `web`) and two users —
 * Alice with two contributions in January, Bob with one contribution
 * in February and none in January. Every number is controlled so the
 * data-layer tests can assert exact aggregations.
 *
 * @param overrides - Trend report fields to override (`llmEnabled`,
 * `model` and `generatedAt` are the useful ones).
 * @returns The demo trend report document.
 */
export function buildDemoReport(overrides: BuildTrendReportOptions = {}): TrendReport {
  const aliceJanuaryApi = buildContribution({
    title: 'Ship the payments API',
    summary: 'Built the payments endpoint.',
    types: ['feature'],
    complexity: 'medium',
    size: 'm',
    areas: ['api', 'payments'],
    commits: ['a1b2c3d4e5f60718'],
    qualitySignals: ['tests-added'],
    riskFlags: ['no-tests'],
  });
  const aliceJanuaryWeb = buildContribution({
    title: 'Fix the checkout flow',
    summary: 'Fixed the checkout bugs and added tests.',
    types: ['bugfix', 'test'],
    complexity: 'low',
    size: 's',
    areas: ['web', 'checkout'],
    commits: ['b2c3d4e5f6071829'],
    qualitySignals: ['tests-added', 'docs-added'],
    riskFlags: [],
  });
  const bobFebruaryApi = buildContribution({
    title: 'Harden the auth layer',
    summary: 'Hardened authentication.',
    types: ['feature', 'security'],
    complexity: 'high',
    size: 'xl',
    areas: ['api', 'auth'],
    commits: ['c3d4e5f607182930'],
    qualitySignals: ['security-hardened'],
    riskFlags: ['large-diff', 'no-tests'],
  });
  const alice = (repository: string, period: 'january' | 'february'): User => {
    if (repository === 'api' && period === 'january') {
      return buildUser({
        name: 'Alice Nguyen',
        deterministic: buildDeterministic({
          commits: 6,
          nonMergeCommits: 6,
          linesAdded: 100,
          linesRemoved: 20,
          netLines: 80,
          filesTouched: 3,
          avgCommitSize: 20,
        }),
        llm: buildLlm({
          status: 'completed',
          overview: 'Shipped the payments API.',
          contributions: [aliceJanuaryApi],
          tokenUsage: buildTokenUsage(),
        }),
      });
    }
    if (repository === 'web' && period === 'january') {
      return buildUser({
        name: 'Alice Nguyen',
        deterministic: buildDeterministic({
          commits: 3,
          nonMergeCommits: 3,
          linesAdded: 30,
          linesRemoved: 5,
          netLines: 25,
          filesTouched: 2,
          activeDays: ['2026-01-06'],
          firstCommitAt: '2026-01-06T09:00:00.000Z',
          lastCommitAt: '2026-01-07T15:00:00.000Z',
          avgCommitSize: 11.666666666666666,
          languages: { CSS: { linesAdded: 30, linesRemoved: 5, filesTouched: 2 } },
        }),
        llm: buildLlm({ status: 'completed', contributions: [aliceJanuaryWeb] }),
      });
    }
    if (repository === 'api' && period === 'february') {
      return buildUser({
        name: 'Alice Nguyen',
        deterministic: buildDeterministic({
          commits: 2,
          nonMergeCommits: 2,
          linesAdded: 40,
          linesRemoved: 40,
          netLines: 0,
          filesTouched: 1,
          uniqueFilesTouched: 1,
          activeDays: ['2026-02-02'],
          firstCommitAt: '2026-02-02T09:00:00.000Z',
          lastCommitAt: '2026-02-03T15:00:00.000Z',
          avgCommitSize: 40,
          languages: { TypeScript: { linesAdded: 40, linesRemoved: 40, filesTouched: 1 } },
        }),
      });
    }
    return buildUser({
      name: 'Alice Nguyen',
      deterministic: buildDeterministic({
        commits: 1,
        nonMergeCommits: 1,
        linesAdded: 10,
        linesRemoved: 2,
        netLines: 8,
        filesTouched: 1,
        uniqueFilesTouched: 1,
        activeDays: ['2026-02-04'],
        firstCommitAt: '2026-02-04T09:00:00.000Z',
        lastCommitAt: '2026-02-04T15:00:00.000Z',
        avgCommitSize: 12,
        languages: { CSS: { linesAdded: 10, linesRemoved: 2, filesTouched: 1 } },
      }),
    });
  };
  const bob = (repository: string, period: 'january' | 'february'): User => {
    if (repository === 'api' && period === 'january') {
      return buildUser({
        name: 'Bob Fisher',
        emails: ['bob@example.com'],
        deterministic: buildDeterministic({
          commits: 4,
          nonMergeCommits: 4,
          linesAdded: 50,
          linesRemoved: 10,
          netLines: 40,
          filesTouched: 1,
          uniqueFilesTouched: 1,
          activeDays: ['2026-01-07'],
          firstCommitAt: '2026-01-07T09:00:00.000Z',
          lastCommitAt: '2026-01-08T15:00:00.000Z',
          avgCommitSize: 15,
          languages: { Python: { linesAdded: 50, linesRemoved: 10, filesTouched: 1 } },
        }),
      });
    }
    if (repository === 'api' && period === 'february') {
      return buildUser({
        name: 'Bob Fisher',
        emails: ['bob@example.com'],
        deterministic: buildDeterministic({
          commits: 5,
          nonMergeCommits: 5,
          linesAdded: 70,
          linesRemoved: 30,
          netLines: 40,
          filesTouched: 2,
          uniqueFilesTouched: 2,
          activeDays: ['2026-02-05'],
          firstCommitAt: '2026-02-05T09:00:00.000Z',
          lastCommitAt: '2026-02-06T15:00:00.000Z',
          avgCommitSize: 20,
          languages: { Python: { linesAdded: 70, linesRemoved: 30, filesTouched: 2 } },
        }),
        llm: buildLlm({
          status: 'completed',
          overview: 'Hardened the auth layer.',
          contributions: [bobFebruaryApi],
          tokenUsage: buildTokenUsage({ input: 20, cacheRead: 0, output: 4 }),
        }),
      });
    }
    return buildUser({
      name: 'Bob Fisher',
      emails: ['bob@example.com'],
      deterministic: buildDeterministic({
        commits: 2,
        nonMergeCommits: 2,
        linesAdded: 25,
        linesRemoved: 5,
        netLines: 20,
        filesTouched: 1,
        uniqueFilesTouched: 1,
        activeDays: ['2026-02-06'],
        firstCommitAt: '2026-02-06T09:00:00.000Z',
        lastCommitAt: '2026-02-07T15:00:00.000Z',
        avgCommitSize: 15,
        languages: { Go: { linesAdded: 25, linesRemoved: 5, filesTouched: 1 } },
      }),
    });
  };
  const llmEnabled = overrides.llmEnabled ?? true;
  const demoPeriods: BuildPeriod[] = [
    {
      ...JANUARY,
      repositories: [
        buildRepository({
          repo: DEMO_REPOS[0],
          range: JANUARY,
          users: [alice('api', 'january'), bob('api', 'january')],
        }),
        buildRepository({ repo: DEMO_REPOS[1], range: JANUARY, users: [alice('web', 'january')] }),
      ],
    },
    {
      ...FEBRUARY,
      repositories: [
        buildRepository({
          repo: DEMO_REPOS[0],
          range: FEBRUARY,
          users: [alice('api', 'february'), bob('api', 'february')],
        }),
        buildRepository({
          repo: DEMO_REPOS[1],
          range: FEBRUARY,
          users: [alice('web', 'february'), bob('web', 'february')],
        }),
      ],
    },
  ];
  return buildTrendReport({
    repos: DEMO_REPOS.map((repo) => ({ repo })),
    since: JANUARY.since,
    until: FEBRUARY.until,
    unit: 'month',
    llmEnabled: true,
    model: llmEnabled ? 'test-model' : undefined,
    generatedAt: '2026-03-01T00:00:00.000Z',
    periods: llmEnabled ? demoPeriods : stripLlm(demoPeriods),
    ...overrides,
  });
}
