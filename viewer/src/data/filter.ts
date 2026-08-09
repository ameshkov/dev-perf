/**
 * Report-level scoping for the viewer: narrows a loaded trend report
 * to a subset of repositories and/or users so the extraction layer
 * (`chart-data.ts`) recomputes every frame of the dashboard for the
 * chosen scope. Pure computation; the selection state itself lives in
 * the app layer. Mirrors the filtering half of `src/compile/filter.ts`
 * of the parent CLI.
 */
import type { PeriodReport, Repository, TrendReport } from '../report/index.js';
import type { CountRow } from './types.js';

/**
 * The scope selection applied to a loaded report; a missing side means
 * that side is unfiltered (all repositories / all users).
 */
export interface ReportSelection {
  /** Repositories to keep, by repository name; all when `undefined`. */
  repos?: ReadonlySet<string>;
  /** Users to keep, by display name; all when `undefined`. */
  users?: ReadonlySet<string>;
}

/**
 * Narrows one repository entry to the selected users: user entries are
 * filtered by display name, and the repository statistics are
 * recomputed from the kept users so the scope stays self-consistent.
 * Unchanged entries are returned as-is.
 *
 * @param repository - The repository entry.
 * @param users - The selected user names.
 * @returns The narrowed repository entry.
 */
function filterRepositoryUsers(repository: Repository, users: ReadonlySet<string>): Repository {
  const kept = repository.users.filter((user) => users.has(user.name));
  if (kept.length === repository.users.length) {
    return repository;
  }
  return {
    ...repository,
    users: kept,
    stats: {
      ...repository.stats,
      totalCommits: kept.reduce((sum, user) => sum + user.deterministic.commits, 0),
      totalUsers: kept.length,
    },
  };
}

/**
 * Narrows one period of the report: repositories are filtered by name,
 * then the kept repositories are narrowed to the selected users.
 * Unchanged periods are returned as-is.
 *
 * @param period - The period.
 * @param selection - The scope selection.
 * @returns The narrowed period.
 */
function filterPeriod(period: PeriodReport, selection: ReportSelection): PeriodReport {
  const repos = selection.repos;
  const users = selection.users;
  let repositories = period.repositories;
  if (repos !== undefined) {
    repositories = repositories.filter((repository) => repos.has(repository.repo));
  }
  if (users !== undefined) {
    repositories = repositories.map((repository) => filterRepositoryUsers(repository, users));
  }
  if (repositories.length === period.repositories.length) {
    const unchanged = repositories.every(
      (repository, index) => repository === period.repositories[index],
    );
    if (unchanged) {
      return period;
    }
  }
  return { ...period, repositories };
}

/**
 * Narrows a loaded report to the selected repositories and users. The
 * parameter list is narrowed alongside the periods, and repository
 * statistics are recomputed when users are filtered out. The original
 * document is returned unchanged when nothing is selected away, so
 * memoized downstream extraction keeps its input reference.
 *
 * @param report - The loaded trend report.
 * @param selection - The scope selection.
 * @returns The narrowed report, or `report` itself without a selection.
 */
export function filterReport(report: TrendReport, selection: ReportSelection): TrendReport {
  const repos = selection.repos;
  const users = selection.users;
  if (repos === undefined && users === undefined) {
    return report;
  }
  const periods = report.periods.map((period) => filterPeriod(period, selection));
  let parameters = report.parameters;
  if (repos !== undefined) {
    const keptSpecs = report.parameters.repos.filter((spec) => repos.has(spec.repo));
    if (keptSpecs.length !== report.parameters.repos.length) {
      parameters = { ...report.parameters, repos: keptSpecs };
    }
  }
  const unchanged = periods.every((period, index) => period === report.periods[index]);
  if (unchanged && parameters === report.parameters) {
    return report;
  }
  return { ...report, parameters, periods };
}

/**
 * Sorts counted option rows by value descending, then key ascending.
 *
 * @param totals - The totals by option key.
 * @returns The sorted rows.
 */
function sortOptions(totals: Map<string, number>): CountRow[] {
  return [...totals.entries()]
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
}

/**
 * The repository options of the scope filter: one row per repository
 * with its commits summed across all periods.
 *
 * @param report - The report to collect from.
 * @returns The rows, most commits first.
 */
export function collectRepoOptions(report: TrendReport): CountRow[] {
  const totals = new Map<string, number>();
  for (const period of report.periods) {
    for (const repository of period.repositories) {
      totals.set(
        repository.repo,
        (totals.get(repository.repo) ?? 0) + repository.stats.totalCommits,
      );
    }
  }
  return sortOptions(totals);
}

/**
 * The user options of the scope filter: one row per user identity with
 * its commits summed across all periods and repositories.
 *
 * @param report - The report to collect from.
 * @returns The rows, most commits first.
 */
export function collectUserOptions(report: TrendReport): CountRow[] {
  const totals = new Map<string, number>();
  for (const period of report.periods) {
    for (const repository of period.repositories) {
      for (const user of repository.users) {
        totals.set(user.name, (totals.get(user.name) ?? 0) + user.deterministic.commits);
      }
    }
  }
  return sortOptions(totals);
}

/**
 * Toggles one key in or out of a scope selection: toggling against the
 * effective selection (all options when the selection is unset), and
 * normalizing a full selection back to `undefined` so "everything
 * selected" and "no filter" stay the same state.
 *
 * @param options - All selectable options of the group.
 * @param selected - The current selection; `undefined` means all.
 * @param key - The key to toggle.
 * @returns The next selection; `undefined` when every option is in.
 */
export function toggleScopedValue(
  options: readonly CountRow[],
  selected: ReadonlySet<string> | undefined,
  key: string,
): ReadonlySet<string> | undefined {
  const next = new Set(selected ?? options.map((option) => option.key));
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next.size === options.length ? undefined : next;
}
