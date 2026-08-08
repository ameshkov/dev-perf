/**
 * Builds trend report documents (schema v3) for compile tests: the
 * periods, repositories and users of the fixture are given as plain
 * objects, and the builder fills every schema-required field with
 * consistent defaults (recomputed stats, LLM status, metric defaults)
 * so tests can assert exact values without typing out the full shape.
 * Test support code — not a test file.
 */
import type {
  Contribution,
  DeterministicMetrics,
  LanguageContribution,
  LlmAnalysis,
  PeriodUnit,
  TrendReport,
  User,
} from '../../src/report/index.js';

/** Default analyzed range of the fixture report. */
const DEFAULT_SINCE = '2026-01-01T00:00:00.000Z';

/** Default end of the analyzed range of the fixture report. */
const DEFAULT_UNTIL = '2026-02-28T23:59:59.999Z';

/** Fixed generation timestamp so fixture reports are deterministic. */
const GENERATED_AT = '2026-03-01T00:00:00.000Z';

/** One fixture user of a period. */
export interface FixtureUser {
  /** Display name. */
  name: string;
  /** Author emails; defaults to `<name>@example.com`. */
  emails?: string[];
  /** Bot flag; defaults to false. */
  isBot?: boolean;
  /** Deterministic metrics overrides; sensible defaults fill the rest. */
  deterministic?: Partial<DeterministicMetrics>;
  /** LLM analysis overrides; merged into a completed entry. */
  llm?: Partial<LlmAnalysis>;
}

/** One fixture repository entry of a period. */
export interface FixtureRepository {
  /** Repository as given on the command line. */
  repo: string;
  /** Users of the repository in this period. */
  users: FixtureUser[];
}

/** One fixture period of the report. */
export interface FixturePeriod {
  /** Period start (UTC instant). */
  since: string;
  /** Period end (UTC instant). */
  until: string;
  /** Repository entries of the period. */
  repositories: FixtureRepository[];
}

/** Options of the fixture report builder. */
export interface BuildTrendReportOptions {
  /** Whether LLM analysis was enabled; true by default. */
  llmEnabled?: boolean;
  /** The period unit; month by default. */
  unit?: PeriodUnit;
  /** Analyzed range start; defaults to January 2026. */
  since?: string;
  /** Analyzed range end; defaults to February 2026. */
  until?: string;
  /** The period entries. */
  periods: FixturePeriod[];
}

/**
 * A complete fixture contribution.
 *
 * @param overrides - Field overrides.
 * @returns The contribution.
 */
export function fixtureContribution(overrides: Partial<Contribution> = {}): Contribution {
  return {
    title: 'Fixture work',
    summary: 'What was done and how.',
    types: ['feature'],
    complexity: 'medium',
    complexityReasoning: 'Why the level was chosen.',
    size: 'm',
    sizeReasoning: 'Why the size was chosen.',
    areas: ['src'],
    commits: ['abc1234'],
    qualitySignals: [],
    riskFlags: [],
    ...overrides,
  };
}

/**
 * Deterministic metrics of a fixture user: defaults filled, overrides
 * applied. Without an explicit language map, a single TypeScript entry
 * syncs with the line counts, so totals stay consistent.
 *
 * @param periodSince - The period start, for the commit timestamps.
 * @param periodUntil - The period end, for the commit timestamps.
 * @param overrides - Metric overrides.
 * @returns The metrics.
 */
function deterministicMetrics(
  periodSince: string,
  periodUntil: string,
  overrides: Partial<DeterministicMetrics> = {},
): DeterministicMetrics {
  const base = {
    commits: 1,
    nonMergeCommits: 1,
    mergeCommits: 0,
    linesAdded: 10,
    linesRemoved: 2,
    netLines: 8,
    filesTouched: 3,
    uniqueFilesTouched: 3,
    activeDays: [periodSince.slice(0, 10)],
    firstCommitAt: periodSince,
    lastCommitAt: periodUntil,
    avgCommitSize: 12,
    languages: { TypeScript: { linesAdded: 10, linesRemoved: 2, filesTouched: 3 } },
  };
  const merged = { ...base, ...overrides };
  const languages: Record<string, LanguageContribution> =
    overrides.languages === undefined
      ? {
          TypeScript: {
            linesAdded: merged.linesAdded,
            linesRemoved: merged.linesRemoved,
            filesTouched: 3,
          },
        }
      : Object.fromEntries(
          Object.entries(merged.languages).map(([language, contribution]) => [
            language,
            { ...contribution },
          ]),
        );
  return {
    ...merged,
    languages,
    netLines: merged.linesAdded - merged.linesRemoved,
    avgCommitSize:
      merged.nonMergeCommits === 0
        ? 0
        : (merged.linesAdded + merged.linesRemoved) / merged.nonMergeCommits,
  };
}

/**
 * The LLM analysis of a fixture user: a completed entry with the given
 * contributions and token usage by default; a skipped entry carries no
 * usage — like a real report, where the analysis never ran.
 *
 * @param llmEnabled - Whether the report has LLM analysis.
 * @param llm - LLM overrides.
 * @returns The analysis.
 */
function fixtureLlm(llmEnabled: boolean, llm: Partial<LlmAnalysis> = {}): LlmAnalysis {
  if (!llmEnabled) {
    return { status: 'skipped', contributions: [], ...llm };
  }
  const merged: LlmAnalysis = {
    status: 'completed',
    overview: `Overview of the work in the period.`,
    contributions: [fixtureContribution()],
    tokenUsage: { input: 100, cacheRead: 50, output: 20 },
    ...llm,
  };
  if (merged.status !== 'completed') {
    delete merged.tokenUsage;
  }
  return merged;
}

/**
 * Builds one user entry of the fixture report.
 *
 * @param fixture - The fixture user.
 * @param periodSince - The period start.
 * @param periodUntil - The period end.
 * @param llmEnabled - Whether the report has LLM analysis.
 * @returns The user entry.
 */
function buildUser(
  fixture: FixtureUser,
  periodSince: string,
  periodUntil: string,
  llmEnabled: boolean,
): User {
  const deterministic = deterministicMetrics(periodSince, periodUntil, fixture.deterministic);
  return {
    name: fixture.name,
    emails: fixture.emails ?? [`${fixture.name.toLowerCase().replace(/\s+/g, '.')}@example.com`],
    isBot: fixture.isBot ?? false,
    deterministic,
    llm: fixtureLlm(llmEnabled, fixture.llm),
  };
}

/**
 * Recomputes the repository stats of a fixture repository from its
 * users, mirroring the compile layer's recomputation.
 *
 * @param users - The users of the repository.
 * @returns The stats.
 */
function fixtureStats(users: User[]) {
  const languages: Record<string, number> = {};
  let commits = 0;
  for (const user of users) {
    commits += user.deterministic.commits;
    for (const [language, contribution] of Object.entries(user.deterministic.languages)) {
      languages[language] = (languages[language] ?? 0) + contribution.linesAdded;
    }
  }
  return {
    totalCommits: commits,
    totalUsers: users.length,
    topLanguages: Object.entries(languages)
      .sort(([aName, aLines], [bName, bLines]) => bLines - aLines || aName.localeCompare(bName))
      .slice(0, 10)
      .map(([language, linesAdded]) => ({ language, linesAdded })),
  };
}

/**
 * Builds a valid trend report document from fixture periods. Every
 * repository of the report appears in every period; the fixture's
 * per-period repository list drives the users of that period.
 *
 * @param options - The fixture periods and report parameters.
 * @returns The report document.
 */
export function buildTrendReport(options: BuildTrendReportOptions): TrendReport {
  const llmEnabled = options.llmEnabled ?? true;
  const unit = options.unit ?? 'month';
  const periods = options.periods.map((period) => ({
    since: period.since,
    until: period.until,
    repositories: period.repositories.map((repository) => {
      const users = repository.users.map((user) =>
        buildUser(user, period.since, period.until, llmEnabled),
      );
      return {
        repo: repository.repo,
        clonePath: `/cache/fixture/${repository.repo}`,
        branch: 'main',
        head: '0123456789abcdef0123456789abcdef01234567',
        range: { since: period.since, until: period.until },
        stats: fixtureStats(users),
        users,
      };
    }),
  }));
  const repos = [
    ...new Set(options.periods.flatMap((period) => period.repositories.map((repo) => repo.repo))),
  ].map((repo) => ({ repo }));
  return {
    schemaVersion: 3,
    generatedAt: GENERATED_AT,
    parameters: {
      repos,
      since: options.since ?? DEFAULT_SINCE,
      until: options.until ?? DEFAULT_UNTIL,
      unit,
      model: llmEnabled ? 'gpt-4.1' : undefined,
      llmEnabled,
    },
    periods,
  };
}

/**
 * Writes a fixture report as JSON text.
 *
 * @param options - The fixture report options.
 * @returns The pretty JSON text.
 */
export function trendReportJson(options: BuildTrendReportOptions): string {
  return `${JSON.stringify(buildTrendReport(options), null, 2)}\n`;
}
