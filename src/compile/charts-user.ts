/**
 * The per-user charts of the `compile` command: contribution sizes
 * plus per-period contributions with LLM analysis, commits and lines
 * without. The per-period charts are skipped for single-period
 * reports.
 */
import type { ChartData, UserSeries } from './chart-data.js';
import { SIZE_ORDER } from './chart-data.js';
import { lineRows, userSlug } from './chart-util.js';
import type { ChartAsset } from './chart-util.js';
import type { ChartRow } from './vega.js';
import { barSpec, horizontalBarSpec, lineSeriesSpec } from './vega.js';

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
 * The LLM-based per-user charts: contribution sizes and per-period
 * contributions.
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
  if (multiPeriod) {
    charts.push({
      file: `${slug}-contributions-per-period.svg`,
      caption: 'Contributions per period.',
      spec: barSpec(
        `${series.user.name} — contributions per period`,
        labels,
        labels.map((label, index) => ({
          x: label,
          key: 'contributions',
          value: series.points[index].contributions,
        })),
        'Contributions',
      ),
    });
  }
}

/**
 * The deterministic per-user charts: commits and lines per period.
 *
 * @param series - The user's series.
 * @param charts - The chart list to append to.
 * @param labels - The period labels.
 * @param slug - The user's file-name slug.
 */
function deterministicUserCharts(
  series: UserSeries,
  charts: ChartAsset[],
  labels: string[],
  slug: string,
): void {
  charts.push({
    file: `${slug}-commits-per-period.svg`,
    caption: 'Commits per period.',
    spec: barSpec(
      `${series.user.name} — commits per period`,
      labels,
      labels.map((label, index) => ({
        x: label,
        key: 'commits',
        value: series.points[index].commits,
      })),
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
}

/**
 * The per-user dynamics charts of the report, in master user order.
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
    } else if (multiPeriod) {
      deterministicUserCharts(series, charts, labels, slug);
    }
  }
}
