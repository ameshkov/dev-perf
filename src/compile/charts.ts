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
import type { ChartData, CountRow } from './chart-data.js';
import { COMPLEXITY_ORDER, SIZE_ORDER } from './chart-data.js';
import { barLineRows, lineRows, stackedRows, topWithOther } from './chart-util.js';
import type { ChartAsset } from './chart-util.js';
import { barLineSpec, groupedBarSpec, lineSeriesSpec, pieSpec, stackedBarSpec } from './vega.js';

/** The number of top signals kept in the signal charts, rest as `other`. */
const TOP_SIGNALS = 9;

/**
 * The count of one category within a period's tallies.
 *
 * @param rows - The period's counted rows.
 * @param key - The category.
 * @returns The count, zeroed when absent.
 */
function periodCount(rows: CountRow[], key: string): number {
  return rows.find((row) => row.key === key)?.value ?? 0;
}

/**
 * The total of a period's tallies.
 *
 * @param rows - The period's counted rows.
 * @returns The total count.
 */
function periodTotal(rows: CountRow[]): number {
  return rows.reduce((sum, row) => sum + row.value, 0);
}

/**
 * The LLM-based team dynamics charts: contributions by size and
 * complexity, and the risk flags and quality signals per period
 * (normalized to the share of contributions).
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
  signalTeamCharts(data, charts, labels);
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
    const top = data.tallies[kind].slice(0, TOP_SIGNALS);
    const hasOther = data.tallies[kind].length > TOP_SIGNALS;
    const keys = [...top.map((row) => row.key), ...(hasOther ? ['other'] : [])];
    const rows = stackedRows(labels, keys, (key, index) => {
      const periodRows = data.signals[kind][index];
      const contributions = data.team[index].contributions;
      if (contributions === 0) {
        return 0;
      }
      const count =
        key === 'other'
          ? periodTotal(periodRows) -
            top.reduce((sum, row) => sum + periodCount(periodRows, row.key), 0)
          : periodCount(periodRows, key);
      return (count / contributions) * 100;
    });
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
 * The risk-flag and quality-signal distribution pies: the top
 * `TOP_SIGNALS` categories plus an `other` slice.
 *
 * @param data - The chart data.
 * @param charts - The chart list to append to.
 */
function signalPieCharts(data: ChartData, charts: ChartAsset[]): void {
  charts.push({
    file: 'risk-distribution.svg',
    caption: `Share of contributions by risk flag (top ${TOP_SIGNALS} flags plus other).`,
    spec: pieSpec(
      'Risk distribution',
      topWithOther(data.tallies.risk, TOP_SIGNALS).map((row) => ({
        x: row.key,
        key: row.key,
        value: row.value,
      })),
      'Risk flag',
    ),
  });
  charts.push({
    file: 'quality-distribution.svg',
    caption: `Share of contributions by quality signal (top ${TOP_SIGNALS} signals plus other).`,
    spec: pieSpec(
      'Quality distribution',
      topWithOther(data.tallies.quality, TOP_SIGNALS).map((row) => ({
        x: row.key,
        key: row.key,
        value: row.value,
      })),
      'Quality signal',
    ),
  });
}

/**
 * The LLM distribution pies: work types, sizes, complexity, and the
 * risk flags and quality signals (top `TOP_SIGNALS` plus `other`).
 * Size and complexity legends follow the natural category order.
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
  signalPieCharts(data, charts);
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
