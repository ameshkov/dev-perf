/**
 * Per-repository aggregation for the `compile` command: sums one
 * repository's commits, distinct users, LLM contributions, and
 * language lines across all periods of the filtered report. The
 * report's own stats describe the pre-filter users, so the summaries
 * are recomputed here.
 */
import type { Repository, TrendReport } from '../report/index.js';
import { weightedPointsOf } from './aggregate.js';

/** One repository of the filtered report, aggregated across periods. */
export interface RepoSummary {
  /** The repository as given on the command line. */
  repo: string;
  /** Commits across all periods. */
  commits: number;
  /** Distinct user identities across all periods. */
  users: number;
  /** LLM-assessed contributions across all periods. */
  contributions: number;
  /** Size- and complexity-weighted points of the contributions across all periods. */
  points: number;
  /** Top languages by lines added, best first (top 3). */
  topLanguages: Array<{ language: string; linesAdded: number }>;
  /** Commits per period, aligned with the periods of the report. */
  perPeriodCommits: number[];
}

/** The aggregation state of one repository across all periods. */
interface RepoAccumulator {
  /** Commits across all periods. */
  commits: number;
  /** Distinct user identities across all periods. */
  users: Set<string>;
  /** LLM-assessed contributions across all periods. */
  contributions: number;
  /** Size- and complexity-weighted points of the contributions across all periods. */
  points: number;
  /** Lines added per language across all periods. */
  languages: Map<string, number>;
}

/**
 * Adds one repository entry of one period to the accumulator: commits,
 * LLM contributions and their weighted points are summed, user
 * identities are added, and languages are summed per language.
 *
 * @param summary - The accumulator to update.
 * @param repository - The repository entry of one period.
 */
function accumulateRepository(summary: RepoAccumulator, repository: Repository): void {
  summary.commits += repository.stats.totalCommits;
  for (const user of repository.users) {
    summary.users.add(user.name);
    summary.contributions += user.llm.contributions.length;
    summary.points += weightedPointsOf(user.llm.contributions);
    for (const [language, contribution] of Object.entries(user.deterministic.languages)) {
      summary.languages.set(
        language,
        (summary.languages.get(language) ?? 0) + contribution.linesAdded,
      );
    }
  }
}

/**
 * The repository summary of one accumulator: the aggregated totals,
 * the top 3 languages, and the per-period commit counts aligned with
 * the report's periods.
 *
 * @param repo - The repository as given on the command line.
 * @param summary - The accumulator.
 * @param periods - The report's periods.
 * @returns The summary.
 */
function toRepoSummary(
  repo: string,
  summary: RepoAccumulator,
  periods: TrendReport['periods'],
): RepoSummary {
  return {
    repo,
    commits: summary.commits,
    users: summary.users.size,
    contributions: summary.contributions,
    points: summary.points,
    topLanguages: [...summary.languages.entries()]
      .sort(([aName, aLines], [bName, bLines]) => bLines - aLines || aName.localeCompare(bName))
      .slice(0, 3)
      .map(([language, linesAdded]) => ({ language, linesAdded })),
    perPeriodCommits: periods.map(
      (period) =>
        period.repositories.find((repository) => repository.repo === repo)?.stats.totalCommits ?? 0,
    ),
  };
}

/**
 * Aggregates every repository across all periods: commits, LLM
 * contributions and languages are summed, user identities are counted
 * distinctly. The repository appears in every period of the report
 * (zeroed entries included), so a missing entry means the period has
 * no repositories at all.
 *
 * @param report - The filtered report.
 * @returns The repository summaries, sorted by LLM contributions
 * descending, then commits, then name.
 */
export function repoSummaries(report: TrendReport): RepoSummary[] {
  const names = report.periods.flatMap((period) =>
    period.repositories.map((repository) => repository.repo),
  );
  const byRepo = new Map<string, RepoAccumulator>();
  for (const name of [...new Set(names)]) {
    byRepo.set(name, {
      commits: 0,
      users: new Set(),
      contributions: 0,
      points: 0,
      languages: new Map(),
    });
  }
  for (const period of report.periods) {
    for (const repository of period.repositories) {
      const summary = byRepo.get(repository.repo);
      if (summary !== undefined) {
        accumulateRepository(summary, repository);
      }
    }
  }
  return [...byRepo.entries()]
    .map(([repo, summary]) => toRepoSummary(repo, summary, report.periods))
    .sort(
      (a, b) =>
        b.contributions - a.contributions || b.commits - a.commits || a.repo.localeCompare(b.repo),
    );
}
