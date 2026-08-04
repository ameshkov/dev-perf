/**
 * Per-repository aggregation for the `compile` command: sums one
 * repository's commits, distinct users, and language lines across all
 * periods of the filtered report. The report's own stats describe the
 * pre-filter users, so the summaries are recomputed here.
 */
import type { TrendReport } from '../report/index.js';

/** One repository of the filtered report, aggregated across periods. */
export interface RepoSummary {
  /** The repository as given on the command line. */
  repo: string;
  /** Commits across all periods. */
  commits: number;
  /** Distinct user identities across all periods. */
  users: number;
  /** Top languages by lines added, best first (top 3). */
  topLanguages: Array<{ language: string; linesAdded: number }>;
  /** Commits per period, aligned with the periods of the report. */
  perPeriodCommits: number[];
}

/**
 * Aggregates one repository across all periods: commits are summed,
 * user identities are counted distinctly, and languages are summed
 * per language. The repository appears in every period of the report
 * (zeroed entries included), so a missing entry means the period has
 * no repositories at all.
 *
 * @param report - The filtered report.
 * @returns The repository summaries, sorted by commits descending.
 */
export function repoSummaries(report: TrendReport): RepoSummary[] {
  const names = report.periods.flatMap((period) =>
    period.repositories.map((repository) => repository.repo),
  );
  const byRepo = new Map<
    string,
    { commits: number; users: Set<string>; languages: Map<string, number> }
  >();
  for (const name of [...new Set(names)]) {
    byRepo.set(name, { commits: 0, users: new Set(), languages: new Map() });
  }
  for (const period of report.periods) {
    for (const repository of period.repositories) {
      const summary = byRepo.get(repository.repo);
      if (summary === undefined) {
        continue;
      }
      summary.commits += repository.stats.totalCommits;
      for (const user of repository.users) {
        summary.users.add(user.name);
        for (const [language, contribution] of Object.entries(user.deterministic.languages)) {
          summary.languages.set(
            language,
            (summary.languages.get(language) ?? 0) + contribution.linesAdded,
          );
        }
      }
    }
  }
  return [...byRepo.entries()]
    .map(([repo, summary]) => ({
      repo,
      commits: summary.commits,
      users: summary.users.size,
      topLanguages: [...summary.languages.entries()]
        .sort(([aName, aLines], [bName, bLines]) => bLines - aLines || aName.localeCompare(bName))
        .slice(0, 3)
        .map(([language, linesAdded]) => ({ language, linesAdded })),
      perPeriodCommits: report.periods.map(
        (period) =>
          period.repositories.find((repository) => repository.repo === repo)?.stats.totalCommits ??
          0,
      ),
    }))
    .sort((a, b) => b.commits - a.commits || a.repo.localeCompare(b.repo));
}
