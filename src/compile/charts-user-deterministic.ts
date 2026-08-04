/**
 * The deterministic per-user charts of the `compile` command: commits
 * with the cumulative line, added vs removed lines, and per-period
 * top languages. Extracted from `charts-user.ts` so the per-user chart
 * inventory stays within the file size limit.
 */
import type { ChartData, UserSeries } from './chart-data.js';
import { barLineRows, lineRows, stackedRows } from './chart-util.js';
import type { ChartAsset } from './chart-util.js';
import { barLineSpec, lineSeriesSpec, stackedBarSpec } from './vega.js';

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
export function deterministicUserCharts(
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
