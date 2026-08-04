/**
 * Data extraction for the `compile` command: pulls every data frame
 * the charts and tables need out of a filtered report — period labels,
 * team series per period, per-user series, per-repository summaries,
 * LLM pies and tallies, cost rows, totals, and the bus factor. Pure
 * computation; rendering and markdown assembly live in `vega.ts`,
 * `charts.ts` and `markdown.ts`.
 */
import type { ContributionSize, PeriodUnit, User } from '../report/index.js';
import type { FilteredReport } from './filter.js';
import { combinePeriodUsers } from './filter.js';
import { allContributions, computeBusFactor, countByKey, teamPoint } from './aggregate.js';
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
  /** Size-weighted contribution points in the period. */
  weightedPoints: number;
  /** Contributions per size in the period. */
  sizes: Record<ContributionSize, number>;
  /** Lines added per language in the period. */
  languages: Record<string, number>;
}

/** Per-user series: totals plus one point per period. */
export interface UserSeries {
  /** The master user entry (totals across the whole report). */
  user: User;
  /** Per-period points, aligned with the periods of the report. */
  points: TeamPoint[];
}

/** One counted categorical value, e.g. a pie slice. */
export interface CountRow {
  /** The category name. */
  key: string;
  /** How often the category occurs. */
  value: number;
}

/** LLM cost of one user. */
interface CostRow {
  /** The user's display name. */
  name: string;
  /** Input tokens across all analyses of the user. */
  inputTokens: number;
  /** Output tokens across all analyses of the user. */
  outputTokens: number;
  /** Estimated cost in USD. */
  costUsd: number;
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
  /** Estimated LLM cost in USD. */
  costUsd: number;
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
    /** Repositories analyzed, as given on the command line. */
    repos: string[];
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
  /** Per-repository summaries, sorted by commits descending. */
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
  /** Aggregate LLM quality-signal and risk-flag tallies. */
  tallies: {
    /** Quality signals, most frequent first. */
    quality: CountRow[];
    /** Risk flags, most frequent first. */
    risk: CountRow[];
  };
  /** LLM cost per user. */
  cost: CostRow[];
  /** Team totals. */
  totals: TeamTotals;
  /** Bus factor, or `undefined` when there are no commits. */
  busFactor?: BusFactor;
}

/** Short month names for axis labels. */
const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Formats a period start as a short axis label for the unit: day and
 * week become `Jan 5`, month `2026-01`, quarter `Q1 2026`, year `2026`.
 *
 * @param since - Period start (ISO 8601, UTC).
 * @param unit - The period unit.
 * @returns The label.
 */
function periodLabel(since: string, unit: PeriodUnit | undefined): string {
  const date = new Date(since);
  const year = date.getUTCFullYear();
  const month = MONTH_NAMES[date.getUTCMonth()];
  const day = date.getUTCDate();
  if (unit === 'month') {
    return `${year}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  if (unit === 'quarter') {
    return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${year}`;
  }
  if (unit === 'year') {
    return String(year);
  }
  return `${month} ${day}`;
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
 * The team points of all periods, with the cumulative commit line.
 *
 * @param views - The per-period user views.
 * @returns One team point per period.
 */
function teamPoints(views: User[][]): TeamPoint[] {
  const team: TeamPoint[] = [];
  let cumulative = 0;
  for (const users of views) {
    const point = teamPoint(users, cumulative);
    cumulative = point.cumulativeCommits;
    team.push(point);
  }
  return team;
}

/**
 * The per-user series, one per master user, aligned with the periods.
 *
 * @param views - The per-period user views.
 * @param masterUsers - The master user list.
 * @returns The series.
 */
function userSeries(views: User[][], masterUsers: User[]): UserSeries[] {
  return masterUsers.map((user) => {
    const points = views.map((periodUsers) => {
      const entry = periodUsers.find((candidate) => candidate.name === user.name) ?? user;
      return teamPoint([entry], 0);
    });
    return { user, points };
  });
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
 * The LLM cost rows of the master users, most expensive first.
 *
 * @param users - The master users.
 * @returns The cost rows.
 */
function costRows(users: User[]): CostRow[] {
  return users
    .filter((user) => user.llm.tokenUsage !== undefined || user.llm.estimatedCostUsd !== undefined)
    .map((user) => ({
      name: user.name,
      inputTokens: user.llm.tokenUsage?.input ?? 0,
      outputTokens: user.llm.tokenUsage?.output ?? 0,
      costUsd: user.llm.estimatedCostUsd ?? 0,
    }))
    .sort((a, b) => b.costUsd - a.costUsd || a.name.localeCompare(b.name));
}

/**
 * The team totals of the whole report.
 *
 * @param team - The team points.
 * @param users - The master users.
 * @param cost - The cost rows.
 * @returns The totals.
 */
function teamTotalsOf(team: TeamPoint[], users: User[], cost: CostRow[]): TeamTotals {
  return {
    commits: team.reduce((sum, point) => sum + point.commits, 0),
    contributions: team.reduce((sum, point) => sum + point.contributions, 0),
    weightedPoints: team.reduce((sum, point) => sum + point.weightedPoints, 0),
    linesAdded: team.reduce((sum, point) => sum + point.linesAdded, 0),
    linesRemoved: team.reduce((sum, point) => sum + point.linesRemoved, 0),
    netLines: team.reduce((sum, point) => sum + point.linesAdded - point.linesRemoved, 0),
    filesTouched: users.reduce((sum, user) => sum + user.deterministic.filesTouched, 0),
    activeUsers: users.filter((user) => user.deterministic.commits > 0).length,
    costUsd: cost.reduce((sum, row) => sum + row.costUsd, 0),
  };
}

/**
 * Extracts every data frame of the filtered report: period labels,
 * team and per-user series, LLM pies and tallies, cost rows, totals
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
  const users = userSeries(views, filtered.users);
  const contributions = allContributions(filtered.users);
  const cost = costRows(filtered.users);
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
      quality: countByKey((contribution) => contribution.qualitySignals, contributions),
      risk: countByKey((contribution) => contribution.riskFlags, contributions),
    },
    cost,
    totals: teamTotalsOf(team, filtered.users, cost),
    busFactor: computeBusFactor(filtered.users),
  };
}
