/**
 * The chart inventory of the `compile` command: turns the extracted
 * chart data into the concrete chart list of the report — file name,
 * caption, and Vega-Lite spec. The team dynamics charts and the
 * per-repository comparison live here; the per-user charts live in
 * `charts-user.ts` and the LLM distribution pies in `charts-pies.ts`.
 * LLM-based charts are included only when the report has LLM
 * analysis; per-period charts are skipped for single-period reports
 * (no `--unit`); the per-repo comparison chart appears only with
 * multiple repositories.
 */
import type { ContributionSize } from '../report/index.js';
import { llmPieCharts } from './charts-pies.js';
import { userCharts } from './charts-user.js';
import type { ChartData } from './chart-data.js';
import { COMPLEXITY_ORDER, SIZE_ORDER } from './chart-data.js';
import {
  barLineRows,
  flagsPerContribution,
  lineRows,
  signalShareRows,
  stackedRows,
  topWithOther,
} from './chart-util.js';
import type { ChartAsset } from './chart-util.js';
import { repoName } from './repo-label.js';
import { barLineSpec, barSpec, groupedBarSpec, lineSeriesSpec, stackedBarSpec } from './vega.js';

/** The number of top signals kept in the signal charts, rest as `other`. */
const TOP_SIGNALS = 5;

/**
 * The points chart of the team: the size- and complexity-weighted
 * contribution points per period, the lead chart of the team dynamics.
 *
 * @param data - The chart data.
 * @param labels - The period labels.
 * @returns The chart asset.
 */
function teamPointsChart(data: ChartData, labels: string[]): ChartAsset {
  return {
    file: 'team-points-per-period.svg',
    caption: 'Points per period (size × complexity).',
    spec: barSpec(
      'Team points per period',
      labels,
      labels.map((label, index) => ({
        x: label,
        key: label,
        value: data.team[index].weightedPoints,
      })),
      'Points',
    ),
  };
}

/**
 * The stacked work-type chart of the team: contributions per period
 * divided into one segment per work type, in the whole-report work
 * type order. Multi-type contributions count in each of their types,
 * so the segments do not sum to the period's contributions.
 *
 * @param data - The chart data.
 * @param labels - The period labels.
 * @returns The chart asset.
 */
function teamWorkTypesChart(data: ChartData, labels: string[]): ChartAsset {
  const keys = data.pies.workTypes.map((row) => row.key);
  return {
    file: 'team-work-types-per-period.svg',
    caption: 'Contributions per period, stacked by work type (a contribution may mix types).',
    spec: stackedBarSpec(
      'Team work types per period',
      labels,
      keys,
      stackedRows(labels, keys, (key, index) => data.team[index].workTypes[key] ?? 0),
      'Contributions',
      'Work type',
    ),
  };
}

/**
 * The LLM-based team dynamics charts: points per period, contributions
 * per period stacked by size, complexity and work type, contributions
 * with the cumulative line, the risk flags and quality signals per
 * period (normalized to the share of contributions), and the average
 * flags per contribution per period.
 *
 * @param data - The chart data.
 * @param charts - The chart list to append to.
 * @param labels - The period labels.
 */
function llmTeamCharts(data: ChartData, charts: ChartAsset[], labels: string[]): void {
  charts.push(teamPointsChart(data, labels));
  charts.push({
    file: 'team-contributions-by-size.svg',
    caption: 'Contributions per period, stacked by size (xs–xl).',
    spec: stackedBarSpec(
      'Team contributions by size per period',
      labels,
      SIZE_ORDER,
      stackedRows(labels, SIZE_ORDER, (key, index) => {
        const size = key as ContributionSize;
        return data.team[index].sizes[size];
      }),
      'Contributions',
      'Size',
    ),
  });
  charts.push({
    file: 'team-complexity-per-period.svg',
    caption: 'Contributions per period, stacked by complexity (low–high).',
    spec: stackedBarSpec(
      'Team contributions by complexity per period',
      labels,
      COMPLEXITY_ORDER,
      stackedRows(labels, COMPLEXITY_ORDER, (key, index) => {
        return data.team[index].complexity[key] ?? 0;
      }),
      'Contributions',
      'Complexity',
    ),
  });
  charts.push(teamWorkTypesChart(data, labels));
  charts.push({
    file: 'team-contributions-per-period.svg',
    caption: 'Contributions per period (bars) and cumulative contributions (line).',
    spec: barLineSpec(
      'Team contributions per period',
      labels,
      barLineRows(
        labels,
        data.team.map((point) => point.contributions),
        data.team.map((point) => point.cumulativeContributions),
      ),
      'Contributions',
    ),
  });
  signalTeamCharts(data, charts, labels);
  signalRateCharts(data, charts, labels);
}

/**
 * One per-period signal chart (risk flags or quality signals):
 * grouped bars of the top `TOP_SIGNALS` categories of the whole
 * report, with everything else collapsed into an `other` bar. Values
 * are normalized to the share of the period's contributions, so
 * periods with more contributions are not shown with more flags, and
 * grouped bars keep each flag's share independently readable.
 *
 * @param data - The chart data.
 * @param charts - The chart list to append to.
 * @param labels - The period labels.
 * @param kind - The signal kind: `risk` flags or `quality` signals.
 */
function signalTeamCharts(data: ChartData, charts: ChartAsset[], labels: string[]): void {
  for (const kind of ['risk', 'quality'] as const) {
    const keys = topWithOther(data.tallies[kind], TOP_SIGNALS).map((row) => row.key);
    const rows = signalShareRows(
      labels,
      keys,
      data.signals[kind],
      data.team.map((point) => point.contributions),
    );
    const file = kind === 'risk' ? 'team-risk-per-period.svg' : 'team-quality-per-period.svg';
    const noun = kind === 'risk' ? 'flags' : 'signals';
    charts.push({
      file,
      caption: `${kind === 'risk' ? 'Risk flags' : 'Quality signals'} per period — share of contributions (top ${TOP_SIGNALS} ${noun} plus other).`,
      spec: groupedBarSpec(
        `Team ${kind === 'risk' ? 'risk flags' : 'quality signals'} per period`,
        labels,
        keys,
        rows,
        '% of contributions',
        kind === 'risk' ? 'Risk flag' : 'Quality signal',
      ),
    });
  }
}

/**
 * The per-period signal-rate charts (risk flags and quality signals):
 * the average number of flags per contribution of each period, one bar
 * per period, so the flag density of the team's work is visible period
 * by period.
 *
 * @param data - The chart data.
 * @param charts - The chart list to append to.
 * @param labels - The period labels.
 */
function signalRateCharts(data: ChartData, charts: ChartAsset[], labels: string[]): void {
  for (const kind of ['risk', 'quality'] as const) {
    const name = kind === 'risk' ? 'risk flags' : 'quality signals';
    charts.push({
      file:
        kind === 'risk'
          ? 'team-risk-flags-per-contribution.svg'
          : 'team-quality-signals-per-contribution.svg',
      caption: `Average ${name} per contribution per period.`,
      spec: barSpec(
        `Team ${name} per contribution`,
        labels,
        labels.map((label, index) => ({
          x: label,
          key: label,
          value: flagsPerContribution(data.signals[kind][index], data.team[index].contributions),
        })),
        'Per contribution',
      ),
    });
  }
}

/**
 * The commits and lines team charts: commits with the cumulative
 * line, and lines added vs removed.
 *
 * @param data - The chart data.
 * @param charts - The chart list to append to.
 * @param labels - The period labels.
 */
function velocityTeamCharts(data: ChartData, charts: ChartAsset[], labels: string[]): void {
  charts.push({
    file: 'team-commits-per-period.svg',
    caption: 'Commits per period (bars) and cumulative commits (line).',
    spec: barLineSpec(
      'Team commits per period',
      labels,
      barLineRows(
        labels,
        data.team.map((point) => point.commits),
        data.team.map((point) => point.cumulativeCommits),
      ),
      'Commits',
    ),
  });
  charts.push({
    file: 'team-lines-per-period.svg',
    caption: 'Lines added vs removed per period.',
    spec: lineSeriesSpec(
      'Team lines per period',
      labels,
      ['added', 'removed'],
      lineRows(labels, [
        { key: 'added', values: data.team.map((point) => point.linesAdded) },
        { key: 'removed', values: data.team.map((point) => point.linesRemoved) },
      ]),
      'Lines',
      'Lines',
    ),
  });
}

/**
 * The engagement and composition team charts: active users and top
 * languages.
 *
 * @param data - The chart data.
 * @param charts - The chart list to append to.
 * @param labels - The period labels.
 */
function engagementTeamCharts(data: ChartData, charts: ChartAsset[], labels: string[]): void {
  charts.push({
    file: 'team-active-users.svg',
    caption: 'Active users per period (users with at least one commit).',
    spec: lineSeriesSpec(
      'Team active users per period',
      labels,
      ['users'],
      lineRows(labels, [{ key: 'users', values: data.team.map((point) => point.activeUsers) }]),
      'Users',
      'Users',
    ),
  });
  charts.push({
    file: 'team-languages-per-period.svg',
    caption: `Lines added per period for the top languages (${data.topLanguages.join(', ')}).`,
    spec: stackedBarSpec(
      'Top languages per period',
      labels,
      data.topLanguages,
      stackedRows(labels, data.topLanguages, (key, index) => data.team[index].languages[key] ?? 0),
      'Lines added',
      'Language',
    ),
  });
}

/**
 * The team dynamics charts: the LLM-based pair and the deterministic
 * set — one chart per period series.
 *
 * @param data - The chart data.
 * @param charts - The chart list to append to.
 * @param labels - The period labels.
 */
function teamCharts(data: ChartData, charts: ChartAsset[], labels: string[]): void {
  if (data.parameters.llmEnabled) {
    llmTeamCharts(data, charts, labels);
  }
  velocityTeamCharts(data, charts, labels);
  engagementTeamCharts(data, charts, labels);
}

/**
 * The repository comparison chart: commits per period, one line per
 * repository. The legend uses just the repository name, since the
 * full `host/org/repo` label would not be visible anyway.
 *
 * @param data - The chart data.
 * @param charts - The chart list to append to.
 * @param labels - The period labels.
 */
function repoCharts(data: ChartData, charts: ChartAsset[], labels: string[]): void {
  charts.push({
    file: 'repos-commits-per-period.svg',
    caption: 'Commits per period, one line per repository.',
    spec: lineSeriesSpec(
      'Commits per repository per period',
      labels,
      data.repos.map((repo) => repoName(repo.repo)),
      lineRows(
        labels,
        data.repos.map((repo) => ({ key: repoName(repo.repo), values: repo.perPeriodCommits })),
      ),
      'Commits',
      'Repository',
    ),
  });
}

/**
 * Builds the chart list of the report in document order. Per-period
 * charts are skipped when the report has a single period; LLM charts
 * are skipped when the report has no LLM analysis.
 *
 * @param data - The chart data.
 * @returns The charts to render, in document order.
 */
export function buildChartAssets(data: ChartData): ChartAsset[] {
  const charts: ChartAsset[] = [];
  const labels = data.periods.map((period) => period.label);
  const multiPeriod = data.periods.length > 1;
  if (multiPeriod) {
    teamCharts(data, charts, labels);
  }
  if (data.repos.length > 1 && multiPeriod) {
    repoCharts(data, charts, labels);
  }
  userCharts(data, charts, labels, multiPeriod);
  if (data.parameters.llmEnabled) {
    llmPieCharts(data, charts);
  }
  return charts;
}
