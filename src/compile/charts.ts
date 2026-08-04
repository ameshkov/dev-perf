/**
 * The chart inventory of the `compile` command: turns the extracted
 * chart data into the concrete chart list of the report — file name,
 * caption, and Vega-Lite spec. The team dynamics charts, the
 * per-repository comparison, and the LLM distribution pies live here;
 * the per-user charts live in `charts-user.ts`. LLM-based charts are
 * included only when the report has LLM analysis; per-period charts
 * are skipped for single-period reports (no `--unit`); the per-repo
 * comparison chart appears only with multiple repositories.
 */
import type { ContributionSize } from '../report/index.js';
import { userCharts } from './charts-user.js';
import type { ChartData } from './chart-data.js';
import { COMPLEXITY_ORDER, SIZE_ORDER } from './chart-data.js';
import { barLineRows, lineRows, stackedRows } from './chart-util.js';
import type { ChartAsset } from './chart-util.js';
import { barLineSpec, lineSeriesSpec, pieSpec, stackedBarSpec } from './vega.js';

/**
 * The LLM-based team dynamics charts: contributions by size and
 * contributions vs weighted points.
 *
 * @param data - The chart data.
 * @param charts - The chart list to append to.
 * @param labels - The period labels.
 */
function llmTeamCharts(data: ChartData, charts: ChartAsset[], labels: string[]): void {
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
    file: 'team-contributions-and-points.svg',
    caption: 'Contributions per period (bars) and size-weighted points (line).',
    spec: barLineSpec(
      'Team contributions and weighted points per period',
      labels,
      barLineRows(
        labels,
        data.team.map((point) => point.contributions),
        data.team.map((point) => point.weightedPoints),
      ),
      'Count',
    ),
  });
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
 * repository.
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
      data.repos.map((repo) => repo.repo),
      lineRows(
        labels,
        data.repos.map((repo) => ({ key: repo.repo, values: repo.perPeriodCommits })),
      ),
      'Commits',
      'Repository',
    ),
  });
}

/**
 * The LLM distribution pies: work types, sizes and complexity. Size
 * and complexity legends follow the natural category order.
 *
 * @param data - The chart data.
 * @param charts - The chart list to append to.
 */
function llmPieCharts(data: ChartData, charts: ChartAsset[]): void {
  charts.push({
    file: 'work-types.svg',
    caption: 'Share of contributions by work type (a contribution may mix types).',
    spec: pieSpec(
      'Work types',
      data.pies.workTypes.map((row) => ({ x: row.key, key: row.key, value: row.value })),
      'Type',
    ),
  });
  charts.push({
    file: 'size-distribution.svg',
    caption: 'Share of contributions by size.',
    spec: pieSpec(
      'Size distribution',
      data.pies.sizes.map((row) => ({ x: row.key, key: row.key, value: row.value })),
      'Size',
      SIZE_ORDER,
    ),
  });
  charts.push({
    file: 'complexity-distribution.svg',
    caption: 'Share of contributions by complexity.',
    spec: pieSpec(
      'Complexity distribution',
      data.pies.complexity.map((row) => ({ x: row.key, key: row.key, value: row.value })),
      'Complexity',
      COMPLEXITY_ORDER,
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
