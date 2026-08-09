/**
 * Data extraction of the viewer: pulls every data frame the sections
 * need out of a loaded report — period labels, team series per period,
 * per-user series, per-repository summaries, LLM pies and tallies,
 * totals, and the bus factor. Pure computation. Mirrors
 * `src/compile/chart-data.ts` of the parent CLI, minus the config
 * driven filtering the viewer does not have.
 */
import type { LlmAnalysis, TrendReport, User } from '../report/index.js';
import type { ChartData, CountRow, TeamPoint, UserSeries } from './types.js';
import {
  allContributions,
  computeBusFactor,
  countByKey,
  countContributionsByKey,
  teamPoint,
} from './aggregate.js';
import { combinePeriodUsers, buildMasterUsers } from './merge.js';
import { periodLabel } from './period-label.js';
import { repoSummaries } from './repos.js';

/**
 * The merged per-period view of the report: for each period, the
 * master users merged across the period's repositories (zeroed when
 * inactive), in master order.
 *
 * @param report - The loaded report.
 * @param masterUsers - The master user list.
 * @returns One user entry per master user per period.
 */
function periodUserViews(report: TrendReport, masterUsers: User[]): User[][] {
  return report.periods.map((period) => combinePeriodUsers(period, masterUsers));
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
 * @param report - The loaded report.
 * @param user - The master user.
 * @returns The repository counts, one entry per repository with work.
 */
function userRepoCommits(
  report: TrendReport,
  user: User,
): Array<{ repo: string; commits: number }> {
  const totals = new Map<string, number>();
  for (const period of report.periods) {
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
 * the periods, and each series carries the user's per-period signal
 * tallies and per-repository commit counts.
 *
 * @param views - The per-period user views.
 * @param masterUsers - The master user list.
 * @param report - The loaded report, for the per-repository counts.
 * @returns The series.
 */
function userSeries(views: User[][], masterUsers: User[], report: TrendReport): UserSeries[] {
  return masterUsers.map((user) => {
    const points: TeamPoint[] = [];
    const signals: UserSeries['signals'] = { quality: [], risk: [] };
    const periodLlm: LlmAnalysis[] = [];
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
      periodLlm.push(entry.llm);
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
    return { user, points, signals, periodLlm, repos: userRepoCommits(report, user) };
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
 * @returns The language names, best first (top 5).
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
 * The team totals of the whole report.
 *
 * @param team - The team points.
 * @param users - The master users.
 * @returns The totals.
 */
function teamTotalsOf(team: TeamPoint[], users: User[]): ChartData['totals'] {
  return {
    commits: team.reduce((sum, point) => sum + point.commits, 0),
    contributions: team.reduce((sum, point) => sum + point.contributions, 0),
    weightedPoints: team.reduce((sum, point) => sum + point.weightedPoints, 0),
    linesAdded: team.reduce((sum, point) => sum + point.linesAdded, 0),
    linesRemoved: team.reduce((sum, point) => sum + point.linesRemoved, 0),
    netLines: team.reduce((sum, point) => sum + point.linesAdded - point.linesRemoved, 0),
    filesTouched: users.reduce((sum, user) => sum + user.deterministic.filesTouched, 0),
    activeUsers: users.filter((user) => user.deterministic.commits > 0).length,
  };
}

/**
 * Extracts every data frame of the loaded report: period labels, team
 * and per-user series, LLM pies and tallies, totals and the bus
 * factor.
 *
 * @param report - The loaded trend report.
 * @returns The chart data.
 */
export function buildChartData(report: TrendReport): ChartData {
  const entries = report.periods.flatMap((period) => period.repositories);
  const masterUsers = buildMasterUsers(entries);
  const views = periodUserViews(report, masterUsers);
  const team = teamPoints(views);
  const contributions = allContributions(masterUsers);
  return {
    parameters: {
      repos: report.parameters.repos,
      since: report.parameters.since,
      until: report.parameters.until,
      ...(report.parameters.unit === undefined ? {} : { unit: report.parameters.unit }),
      llmEnabled: report.parameters.llmEnabled,
      ...(report.parameters.model === undefined ? {} : { model: report.parameters.model }),
      generatedAt: report.generatedAt,
    },
    periods: report.periods.map((period) => ({
      since: period.since,
      until: period.until,
      label: periodLabel(period.since, report.parameters.unit),
    })),
    team,
    repos: repoSummaries(report),
    users: userSeries(views, masterUsers, report),
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
    totals: teamTotalsOf(team, masterUsers),
    busFactor: computeBusFactor(masterUsers),
  };
}
