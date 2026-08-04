/**
 * The per-user charts of the `compile` command: contribution sizes and
 * per-period contributions with LLM analysis, commits with the
 * cumulative line, added vs removed lines, and per-period top
 * languages. Per-period charts are skipped for single-period reports;
 * the LLM-based charts only with LLM analysis.
 */
import type { ContributionSize } from '../report/index.js';
import type { ChartData, UserSeries } from './chart-data.js';
import { COMPLEXITY_ORDER, SIZE_ORDER } from './chart-data.js';
import { barLineRows, lineRows, stackedRows, userSlug } from './chart-util.js';
import type { ChartAsset } from './chart-util.js';
import type { ChartRow } from './vega.js';
import { barLineSpec, horizontalBarSpec, lineSeriesSpec, stackedBarSpec } from './vega.js';

/**
 * The contribution size rows of one user across the whole report.
 *
 * @param series - The user's series.
 * @returns The rows, one per size.
 */
function userSizeRows(series: UserSeries): ChartRow[] {
  return SIZE_ORDER.map((size) => ({
    x: size,
    key: size,
    value: series.points.reduce((sum, point) => sum + point.sizes[size], 0),
  }));
}

/**
 * The contribution complexity rows of one user across the whole
 * report.
 *
 * @param series - The user's series.
 * @returns The rows, one per complexity level.
 */
function userComplexityRows(series: UserSeries): ChartRow[] {
  return COMPLEXITY_ORDER.map((level) => ({
    x: level,
    key: level,
    value: series.points.reduce((sum, point) => sum + (point.complexity[level] ?? 0), 0),
  }));
}

/**
 * The LLM-based per-user charts: contributions per period stacked by
 * size, contribution sizes over the whole range, and the complexity
 * distribution.
 *
 * @param series - The user's series.
 * @param charts - The chart list to append to.
 * @param labels - The period labels.
 * @param slug - The user's file-name slug.
 * @param multiPeriod - Whether the report has more than one period.
 */
function llmUserCharts(
  series: UserSeries,
  charts: ChartAsset[],
  labels: string[],
  slug: string,
  multiPeriod: boolean,
): void {
  if (multiPeriod) {
    charts.push({
      file: `${slug}-contributions-per-period.svg`,
      caption: 'Contributions per period, stacked by size (xs–xl).',
      spec: stackedBarSpec(
        `${series.user.name} — contributions per period`,
        labels,
        SIZE_ORDER,
        stackedRows(labels, SIZE_ORDER, (key, index) => {
          const size = key as ContributionSize;
          return series.points[index].sizes[size];
        }),
        'Contributions',
        'Size',
      ),
    });
  }
  charts.push({
    file: `${slug}-contributions-by-size.svg`,
    caption: 'Contribution sizes over the whole range.',
    spec: horizontalBarSpec(
      `${series.user.name} — contributions by size`,
      SIZE_ORDER,
      userSizeRows(series),
      'Contributions',
    ),
  });
  charts.push({
    file: `${slug}-contributions-by-complexity.svg`,
    caption: 'Complexity distribution over the whole range.',
    spec: horizontalBarSpec(
      `${series.user.name} — contributions by complexity`,
      COMPLEXITY_ORDER,
      userComplexityRows(series),
      'Contributions',
    ),
  });
}

/**
 * The per-period top-languages chart of one user.
 *
 * @param series - The user's series.
 * @param data - The chart data, for the top-language order.
 * @param charts - The chart list to append to.
 * @param labels - The period labels.
 * @param slug - The user's file-name slug.
 */
function languagesUserChart(
  series: UserSeries,
  data: ChartData,
  charts: ChartAsset[],
  labels: string[],
  slug: string,
): void {
  charts.push({
    file: `${slug}-languages-per-period.svg`,
    caption: `Lines added per period for the top languages (${data.topLanguages.join(', ')}).`,
    spec: stackedBarSpec(
      `${series.user.name} — languages per period`,
      labels,
      data.topLanguages,
      stackedRows(labels, data.topLanguages, (key, index) => {
        return series.points[index].languages[key] ?? 0;
      }),
      'Lines added',
      'Language',
    ),
  });
}

/**
 * The deterministic per-user charts: commits with the cumulative
 * line, added vs removed lines, and per-period top languages.
 *
 * @param series - The user's series.
 * @param data - The chart data, for the top-language order.
 * @param charts - The chart list to append to.
 * @param labels - The period labels.
 * @param slug - The user's file-name slug.
 */
function deterministicUserCharts(
  series: UserSeries,
  data: ChartData,
  charts: ChartAsset[],
  labels: string[],
  slug: string,
): void {
  charts.push({
    file: `${slug}-commits-per-period.svg`,
    caption: 'Commits per period (bars) and cumulative commits (line).',
    spec: barLineSpec(
      `${series.user.name} — commits per period`,
      labels,
      barLineRows(
        labels,
        series.points.map((point) => point.commits),
        series.points.map((point) => point.cumulativeCommits),
      ),
      'Commits',
    ),
  });
  charts.push({
    file: `${slug}-lines-per-period.svg`,
    caption: 'Lines added vs removed per period.',
    spec: lineSeriesSpec(
      `${series.user.name} — lines per period`,
      labels,
      ['added', 'removed'],
      lineRows(labels, [
        { key: 'added', values: series.points.map((point) => point.linesAdded) },
        { key: 'removed', values: series.points.map((point) => point.linesRemoved) },
      ]),
      'Lines',
      'Lines',
    ),
  });
  languagesUserChart(series, data, charts, labels, slug);
}

/**
 * The per-user dynamics charts of the report, in master user order:
 * the LLM-based pair first, then the deterministic set.
 *
 * @param data - The chart data.
 * @param charts - The chart list to append to.
 * @param labels - The period labels.
 * @param multiPeriod - Whether the report has more than one period.
 */
export function userCharts(
  data: ChartData,
  charts: ChartAsset[],
  labels: string[],
  multiPeriod: boolean,
): void {
  for (const series of data.users) {
    const slug = userSlug(series.user.name);
    if (data.parameters.llmEnabled) {
      llmUserCharts(series, charts, labels, slug, multiPeriod);
    }
    if (multiPeriod) {
      deterministicUserCharts(series, data, charts, labels, slug);
    }
  }
}
