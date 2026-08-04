/**
 * Shared chart-inventory pieces of the `compile` command: the chart
 * asset type, the user file-name slug, and the data-row builders that
 * both the team charts (`charts.ts`) and the per-user charts
 * (`charts-user.ts`) use.
 */
import type { TopLevelSpec } from 'vega-lite';
import type { CountRow } from './chart-data.js';
import type { ChartRow } from './vega.js';

/** One chart of the compiled report. */
export interface ChartAsset {
  /** File name inside the `assets/` directory. */
  file: string;
  /** Markdown caption placed under the chart. */
  caption: string;
  /** The chart's Vega-Lite spec. */
  spec: TopLevelSpec;
}

/**
 * A kebab-case file-name slug of a user display name: lowercased,
 * runs of non-alphanumeric characters replaced by dashes.
 *
 * @param name - The user display name.
 * @returns The slug.
 */
export function userSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Rows of a stacked chart from per-period keys: one row per category
 * per key, with missing keys zeroed so every segment keeps its place.
 *
 * @param categories - The period labels.
 * @param keys - The segment keys.
 * @param valueOf - The value of a key within one period.
 * @returns The rows.
 */
export function stackedRows(
  categories: string[],
  keys: string[],
  valueOf: (key: string, index: number) => number,
): ChartRow[] {
  const rows: ChartRow[] = [];
  for (let index = 0; index < categories.length; index += 1) {
    for (const key of keys) {
      rows.push({ x: categories[index], key, value: valueOf(key, index) });
    }
  }
  return rows;
}

/**
 * One row set of a bar-plus-line chart: the bar series and the line
 * series share the category axis.
 *
 * @param labels - The period labels.
 * @param bars - The bar values.
 * @param lines - The line values.
 * @returns The rows.
 */
export function barLineRows(labels: string[], bars: number[], lines: number[]): ChartRow[] {
  const rows: ChartRow[] = [];
  for (let index = 0; index < labels.length; index += 1) {
    rows.push({ x: labels[index], key: 'bars', value: bars[index] });
    rows.push({ x: labels[index], key: 'lines', value: lines[index] });
  }
  return rows;
}

/**
 * One row set of a multi-series line chart. The series keys must
 * match the color scale domain of the spec, or the marks render
 * without a color.
 *
 * @param labels - The period labels.
 * @param series - The named series values, one entry per series.
 * @returns The rows.
 */
export function lineRows(
  labels: string[],
  series: Array<{ key: string; values: number[] }>,
): ChartRow[] {
  const rows: ChartRow[] = [];
  for (let index = 0; index < labels.length; index += 1) {
    for (const entry of series) {
      rows.push({
        x: labels[index],
        key: entry.key,
        value: entry.values[index],
      });
    }
  }
  return rows;
}

/**
 * The top rows of a counted-value list, collapsed into an `other`
 * bucket: the first `n` rows keep their counts, every remaining row is
 * summed into one `{ key: 'other' }` row. With at most `n` rows, the
 * list is returned unchanged — an empty `other` bucket is never
 * emitted. The input must be sorted by value descending, as the
 * tallies of `chart-data.ts` are.
 *
 * @param rows - The counted rows, sorted by value descending.
 * @param n - The number of top rows to keep.
 * @returns The collapsed rows.
 */
export function topWithOther(rows: CountRow[], n: number): CountRow[] {
  if (rows.length <= n) {
    return rows;
  }
  const other = rows.slice(n).reduce((sum, row) => sum + row.value, 0);
  return [...rows.slice(0, n), { key: 'other', value: other }];
}
