/**
 * Data extraction for the `compile` command: pulls every data frame
 * the charts and tables need out of a filtered report — period labels,
 * team series per period, per-user series, per-repository summaries,
 * LLM pies and tallies, usage rows, totals, and the bus factor. Pure
 * computation; rendering and markdown assembly live in `vega.ts`,
 * `charts.ts` and `markdown.ts`.
 */
import type { ContributionSize, PeriodUnit, User } from '../report/index.js';
import type { RepoSpec } from '../repo/repo-spec.js';
import type { FilteredReport } from './filter.js';
import { combinePeriodUsers } from './filter.js';
import { periodLabel } from './period-label.js';
import {
  allContributions,
  computeBusFactor,
  countByKey,
  countContributionsByKey,
  teamPoint,
} from './aggregate.js';
import { repoSummaries } from './repos.js';
import type { RepoSummary } from './repos.js';

/** Contribution size weights used for the weighted-points series. */
export const SIZE_WEIGHTS: Record<ContributionSize, number> = {
  xs: 1,
  s: 2,
  m: 3,
  l: 5,
  xl: 8,
};

/** All contribution sizes in chart order. */
export const SIZE_ORDER: ContributionSize[] = ['xs', 's', 'm', 'l', 'xl'];

/** All complexity levels in chart order. */
export const COMPLEXITY_ORDER: string[] = ['low', 'medium', 'high'];

/** One period's identity: bounds and a short label for chart axes. */
interface PeriodInfo {
  /** Period start (UTC instant, inclusive). */
  since: string;
  /** Period end (UTC instant, inclusive). */
  until: string;
  /** Short axis label, e.g. `2026-01` for a month unit. */
  label: string;
}

/** Team-level series of one period. */
export interface TeamPoint {
  /** Commits in the period. */
  commits: number;
  /** Cumulative commits up to and including the period. */
  cumulativeCommits: number;
  /** Lines added in the period. */
  linesAdded: number;
  /** Lines removed in the period. */
  linesRemoved: number;
  /** Users with at least one commit in the period. */
  activeUsers: number;
  /** LLM-assessed contributions in the period. */
  contributions: number;
  /** Cumulative contributions up to and including the period. */
  cumulativeContributions: number;
  /** Size-weighted contribution points in the period. */
  weightedPoints: number;
  /** Contributions per size in the period. */
  sizes: Record<ContributionSize, number>;
  /** Contributions per complexity level in the period. */
  complexity: Record<string, number>;
  /** Contributions per work type in the period (multi-type
   * contributions count in each of their types). */
  workTypes: Record<string, number>;
  /** Lines added per language in the period. */
  languages: Record<string, number>;
}

/** One repository's commit count of a user. */
interface UserRepoCount {
  /** The repository as given on the command line. */
  repo: string;
  /** The user's commits in the repository across all periods. */
  commits: number;
}

/** Per-user series: totals plus one point per period. */
export interface UserSeries {
  /** The master user entry (totals across the whole report). */
  user: User;
  /** Per-period points, aligned with the periods of the report. */
  points: TeamPoint[];
  /** Per-period LLM quality-signal and risk-flag tallies, aligned with
   * `points`; each entry counts the contributions carrying each value
   * (once per contribution). */
  signals: {
    /** Quality signals per period, most frequent first. */
    quality: CountRow[][];
    /** Risk flags per period, most frequent first. */
    risk: CountRow[][];
  };
  /** Commit counts per analyzed repository, most commits first. */
  repos: UserRepoCount[];
}

/** One counted categorical value, e.g. a pie slice. */
export interface CountRow {
  /** The category name. */
  key: string;
  /** How often the category occurs. */
  value: number;
}

/** Token usage of one user across the report. */
interface UsageRow {
  /** The user's display name. */
  name: string;
  /** Non-cached input tokens across all analyses of the user. */
  inputTokens: number;
  /** Input tokens read from the prompt cache. */
  cacheReadTokens: number;
  /** Output tokens across all analyses of the user. */
  outputTokens: number;
}

/** Team totals of the whole report. */
interface TeamTotals {
  /** Commits across all users and periods. */
  commits: number;
  /** LLM-assessed contributions across all users. */
  contributions: number;
  /** Size-weighted contribution points across all users. */
  weightedPoints: number;
  /** Lines added across all users. */
  linesAdded: number;
  /** Lines removed across all users. */
  linesRemoved: number;
  /** Net lines (added minus removed). */
  netLines: number;
  /** Files touched across all users. */
  filesTouched: number;
  /** Users with at least one commit. */
  activeUsers: number;
  /** Non-cached input tokens across all LLM analyses. */
  inputTokens: number;
  /** Input tokens read from the prompt cache. */
  cacheReadTokens: number;
  /** Output tokens across all LLM analyses. */
  outputTokens: number;
}

/** The fewest users covering half of the commits. */
interface BusFactor {
  /** Users covering at least half of the commits, fewest first. */
  users: string[];
  /** Their combined share of commits, 0..1. */
  commitShare: number;
}

/** Everything the markdown assembly and the chart inventory need. */
export interface ChartData {
  /** Report parameters plus the generation timestamp. */
  parameters: {
    /** Repositories analyzed, as full specs, in input order. */
    repos: RepoSpec[];
    /** Start of the analyzed range (UTC instant). */
    since: string;
    /** End of the analyzed range (UTC instant). */
    until: string;
    /** Period unit, absent without `--unit`. */
    unit?: PeriodUnit;
    /** Whether LLM analysis was enabled. */
    llmEnabled: boolean;
    /** Model used for LLM analysis. */
    model?: string;
    /** When the report was generated (ISO 8601, UTC). */
    generatedAt: string;
  };
  /** Period identities, oldest first. */
  periods: PeriodInfo[];
  /** Team-level points, one per period. */
  team: TeamPoint[];
  /** Per-repository summaries, sorted by contributions descending. */
  repos: RepoSummary[];
  /** Per-user series, one per master user. */
  users: UserSeries[];
  /** Top languages by total lines added, best first (chart order). */
  topLanguages: string[];
  /** LLM pies: work types, sizes, complexity. */
  pies: {
    /** Contributions per work type (multi-type contributions count in each). */
    workTypes: CountRow[];
    /** Contributions per size. */
    sizes: CountRow[];
    /** Contributions per complexity level. */
    complexity: CountRow[];
  };
  /** Aggregate LLM quality-signal and risk-flag tallies: how many
   * contributions carry each value (counted once per contribution). */
  tallies: {
    /** Quality signals, most frequent first. */
    quality: CountRow[];
    /** Risk flags, most frequent first. */
    risk: CountRow[];
  };
  /** Per-period LLM quality-signal and risk-flag tallies, aligned
   * with `periods`; each entry counts the contributions carrying
   * each value (once per contribution). */
  signals: {
    /** Quality signals per period, most frequent first. */
    quality: CountRow[][];
    /** Risk flags per period, most frequent first. */
    risk: CountRow[][];
  };
  /** LLM token usage per user. */
  usage: UsageRow[];
  /** Team totals. */
  totals: TeamTotals;
  /** Bus factor, or `undefined` when there are no commits. */
  busFactor?: BusFactor;
}

/**
 * The merged per-period view of the report: for each period, the
 * master users merged across the period's repositories (zeroed when
 * inactive), in master order.
 *
 * @param filtered - The filtered report.
 * @returns One user entry per master user per period.
 */
function periodUserViews(filtered: FilteredReport): User[][] {
  return filtered.report.periods.map((period) => combinePeriodUsers(period, filtered.users));
}

/**
 * The team points of all periods, with the cumulative commit and
 * contribution lines.
 *
 * @param views - The per-period user views.
 * @returns One team point per period.
 */
function teamPoints(views: User[][]): TeamPoint[] {
  const team: TeamPoint[] = [];
  let cumulativeCommits = 0;
  let cumulativeContributions = 0;
  for (const users of views) {
    const point = teamPoint(users, {
      commits: cumulativeCommits,
      contributions: cumulativeContributions,
    });
    cumulativeCommits = point.cumulativeCommits;
    cumulativeContributions = point.cumulativeContributions;
    team.push(point);
  }
  return team;
}

/**
 * The per-repository commit counts of one master user: commits across
 * all periods, grouped by repository, most commits first (ties broken
 * by repository name).
 *
 * @param filtered - The filtered report.
 * @param user - The master user.
 * @returns The repository counts, one entry per repository.
 */
function userRepoCommits(
  filtered: FilteredReport,
  user: User,
): Array<{ repo: string; commits: number }> {
  const totals = new Map<string, number>();
  for (const period of filtered.report.periods) {
    for (const repository of period.repositories) {
      for (const entry of repository.users) {
        if (entry.name === user.name) {
          totals.set(
            repository.repo,
            (totals.get(repository.repo) ?? 0) + entry.deterministic.commits,
          );
        }
      }
    }
  }
  return [...totals.entries()]
    .map(([repo, commits]) => ({ repo, commits }))
    .sort((a, b) => b.commits - a.commits || a.repo.localeCompare(b.repo));
}

/**
 * The per-user series, one per master user, aligned with the periods.
 * Each point's cumulative commit and contribution counts run across
 * the periods, each series carries the user's per-period signal
 * tallies and per-repository commit counts.
 *
 * @param views - The per-period user views.
 * @param masterUsers - The master user list.
 * @param filtered - The filtered report, for the per-repository counts.
 * @returns The series.
 */
function userSeries(views: User[][], masterUsers: User[], filtered: FilteredReport): UserSeries[] {
  return masterUsers.map((user) => {
    const points: TeamPoint[] = [];
    const signals: UserSeries['signals'] = { quality: [], risk: [] };
    let cumulativeCommits = 0;
    let cumulativeContributions = 0;
    for (const periodUsers of views) {
      const entry = periodUsers.find((candidate) => candidate.name === user.name) ?? user;
      const point = teamPoint([entry], {
        commits: cumulativeCommits,
        contributions: cumulativeContributions,
      });
      cumulativeCommits = point.cumulativeCommits;
      cumulativeContributions = point.cumulativeContributions;
      points.push(point);
      signals.quality.push(
        countContributionsByKey(
          (contribution) => contribution.qualitySignals,
          entry.llm.contributions,
        ),
      );
      signals.risk.push(
        countContributionsByKey((contribution) => contribution.riskFlags, entry.llm.contributions),
      );
    }
    return { user, points, signals, repos: userRepoCommits(filtered, user) };
  });
}

/**
 * The per-period quality-signal and risk-flag tallies, aligned with
 * the periods: each entry counts the contributions of one period's
 * merged users that carry each value.
 *
 * @param views - The per-period user views.
 * @returns The tallies, one entry per period.
 */
function periodSignals(views: User[][]): { quality: CountRow[][]; risk: CountRow[][] } {
  return {
    quality: views.map((users) =>
      countContributionsByKey(
        (contribution) => contribution.qualitySignals,
        allContributions(users),
      ),
    ),
    risk: views.map((users) =>
      countContributionsByKey((contribution) => contribution.riskFlags, allContributions(users)),
    ),
  };
}

/**
 * The top languages by total lines added across all periods.
 *
 * @param team - The team points.
 * @returns The language names, best first.
 */
function topLanguagesOf(team: TeamPoint[]): string[] {
  const totals: Record<string, number> = {};
  for (const point of team) {
    for (const [language, linesAdded] of Object.entries(point.languages)) {
      totals[language] = (totals[language] ?? 0) + linesAdded;
    }
  }
  return Object.entries(totals)
    .sort(([aName, aLines], [bName, bLines]) => bLines - aLines || aName.localeCompare(bName))
    .slice(0, 5)
    .map(([language]) => language);
}

/**
 * Total tokens (input + prompt-cache reads + output) of a usage
 * row, used both to order the usage rows and to accumulate team
 * totals.
 *
 * @param row - The usage row.
 * @returns The row's total token count.
 */
function totalTokens(row: UsageRow): number {
  return row.inputTokens + row.cacheReadTokens + row.outputTokens;
}

/**
 * The per-user usage rows, ordered by total tokens descending (ties
 * broken by name).
 *
 * @param users - The master users.
 * @returns The usage rows.
 */
function usageRows(users: User[]): UsageRow[] {
  return users
    .filter((user) => user.llm.tokenUsage !== undefined)
    .map((user) => ({
      name: user.name,
      inputTokens: user.llm.tokenUsage?.input ?? 0,
      cacheReadTokens: user.llm.tokenUsage?.cacheRead ?? 0,
      outputTokens: user.llm.tokenUsage?.output ?? 0,
    }))
    .sort((a, b) => totalTokens(b) - totalTokens(a) || a.name.localeCompare(b.name));
}

/**
 * The team totals of the whole report.
 *
 * @param team - The team points.
 * @param users - The master users.
 * @param usage - The usage rows.
 * @returns The totals.
 */
function teamTotalsOf(team: TeamPoint[], users: User[], usage: UsageRow[]): TeamTotals {
  return {
    commits: team.reduce((sum, point) => sum + point.commits, 0),
    contributions: team.reduce((sum, point) => sum + point.contributions, 0),
    weightedPoints: team.reduce((sum, point) => sum + point.weightedPoints, 0),
    linesAdded: team.reduce((sum, point) => sum + point.linesAdded, 0),
    linesRemoved: team.reduce((sum, point) => sum + point.linesRemoved, 0),
    netLines: team.reduce((sum, point) => sum + point.linesAdded - point.linesRemoved, 0),
    filesTouched: users.reduce((sum, user) => sum + user.deterministic.filesTouched, 0),
    activeUsers: users.filter((user) => user.deterministic.commits > 0).length,
    inputTokens: usage.reduce((sum, row) => sum + row.inputTokens, 0),
    cacheReadTokens: usage.reduce((sum, row) => sum + row.cacheReadTokens, 0),
    outputTokens: usage.reduce((sum, row) => sum + row.outputTokens, 0),
  };
}

/**
 * Extracts every data frame of the filtered report: period labels,
 * team and per-user series, LLM pies and tallies, usage rows, totals
 * and the bus factor.
 *
 * @param filtered - The filtered report.
 * @returns The chart data.
 */
export function buildChartData(filtered: FilteredReport): ChartData {
  const { report } = filtered;
  const views = periodUserViews(filtered);
  const periods = report.periods.map((period) => ({
    since: period.since,
    until: period.until,
    label: periodLabel(period.since, report.parameters.unit),
  }));
  const team = teamPoints(views);
  const users = userSeries(views, filtered.users, filtered);
  const contributions = allContributions(filtered.users);
  const usage = usageRows(filtered.users);
  return {
    parameters: {
      repos: report.parameters.repos,
      since: report.parameters.since,
      until: report.parameters.until,
      unit: report.parameters.unit,
      llmEnabled: report.parameters.llmEnabled,
      model: report.parameters.model,
      generatedAt: report.generatedAt,
    },
    periods,
    team,
    repos: repoSummaries(report),
    users,
    topLanguages: topLanguagesOf(team),
    pies: {
      workTypes: countByKey((contribution) => contribution.types, contributions),
      sizes: countByKey((contribution) => [contribution.size], contributions),
      complexity: countByKey((contribution) => [contribution.complexity], contributions),
    },
    tallies: {
      quality: countContributionsByKey(
        (contribution) => contribution.qualitySignals,
        contributions,
      ),
      risk: countContributionsByKey((contribution) => contribution.riskFlags, contributions),
    },
    signals: periodSignals(views),
    usage,
    totals: teamTotalsOf(team, filtered.users, usage),
    busFactor: computeBusFactor(filtered.users),
  };
}
