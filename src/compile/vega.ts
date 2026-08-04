/**
 * Vega-Lite chart building and SVG rendering for the `compile`
 * command: small spec builders cover the chart shapes the report uses
 * (stacked bars, bar+line combos, multi-series lines, horizontal bars,
 * pies) and `renderSvg` compiles a spec and renders it to SVG in pure
 * Node (no browser). Category order is always explicit — vega-lite
 * sorts nominal axes alphabetically by default, which would scramble
 * months and sizes.
 */
import * as vega from 'vega';
import { compile as vegaLiteCompile } from 'vega-lite';
import type { TopLevelSpec } from 'vega-lite';

/** Default chart width in pixels. */
const CHART_WIDTH = 1024;

/** Default chart height in pixels: keeps the 3:2 width-to-height ratio. */
const CHART_HEIGHT = 683;

/** Categorical color scheme shared by all charts. */
const COLOR_SCHEME = 'tableau10';

/** One row of a chart's data frame. */
export interface ChartRow {
  /** The category on the shared axis (period label, size, ...). */
  x: string;
  /** The series (or stacked segment) the row belongs to. */
  key: string;
  /** The row's value. */
  value: number;
}

/**
 * Compiles a Vega-Lite spec and renders it to an SVG string.
 *
 * @param spec - The Vega-Lite spec.
 * @returns The SVG markup.
 */
export async function renderSvg(spec: TopLevelSpec): Promise<string> {
  const view = new vega.View(vega.parse(vegaLiteCompile(spec).spec), {
    renderer: 'none',
  });
  return view.toSVG();
}

/** The frame shared by every chart spec: schema, title, data, size. */
interface SpecFrame {
  $schema: string;
  title: string;
  data: { values: ChartRow[] };
  width: number;
  height: number;
  autosize: { type: 'fit'; contains: 'padding' };
  config: { range: { category: { scheme: string } } };
}

/**
 * Shared chart frame: title, size, the categorical color scheme, and
 * `fit` autosizing so every chart renders at the full shared width —
 * axes, legends and padding included — instead of letting the SVG
 * root grow with the chart's margins.
 *
 * @param title - The chart title.
 * @param rows - The data rows.
 * @returns The shared frame.
 */
function frame(title: string, rows: ChartRow[]): SpecFrame {
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    title,
    data: { values: rows },
    width: CHART_WIDTH,
    height: CHART_HEIGHT,
    autosize: { type: 'fit', contains: 'padding' },
    config: {
      range: { category: { scheme: COLOR_SCHEME } },
    },
  };
}

/**
 * The shared categorical encoding: the x category with an explicit
 * order and the quantitative value.
 *
 * @param categories - The category order.
 * @param yTitle - The y-axis title.
 * @returns The encodings.
 */
function categoryEncodings(categories: string[], yTitle: string) {
  return {
    x: { field: 'x', type: 'nominal', title: null, sort: categories },
    y: { field: 'value', type: 'quantitative', title: yTitle },
  } as const;
}

/**
 * A stacked bar chart: one bar per category, divided into colored
 * segments by `key`. Used for contributions by size per period and
 * top languages per period.
 *
 * @param title - The chart title.
 * @param categories - The category order.
 * @param keys - The segment order (legend order).
 * @param rows - The data rows.
 * @param yTitle - The y-axis title.
 * @param keyTitle - The legend title.
 * @returns The spec.
 */
export function stackedBarSpec(
  title: string,
  categories: string[],
  keys: string[],
  rows: ChartRow[],
  yTitle: string,
  keyTitle: string,
): TopLevelSpec {
  return {
    ...frame(title, rows),
    mark: 'bar',
    encoding: {
      x: { field: 'x', type: 'nominal', title: null, sort: categories },
      color: {
        field: 'key',
        type: 'nominal',
        title: keyTitle,
        scale: { domain: keys },
      },
      y: {
        field: 'value',
        type: 'quantitative',
        title: yTitle,
        stack: 'zero',
      },
    },
  };
}

/**
 * A grouped bar chart: one bar per category per key, side by side.
 * Used for the per-period risk flags and quality signals, where the
 * values are shares of contributions and a contribution may carry
 * several flags, so the segments do not sum to 100% and stacked bars
 * would be hard to read.
 *
 * @param title - The chart title.
 * @param categories - The category order.
 * @param keys - The group order (legend order).
 * @param rows - The data rows.
 * @param yTitle - The y-axis title.
 * @param keyTitle - The legend title.
 * @returns The spec.
 */
export function groupedBarSpec(
  title: string,
  categories: string[],
  keys: string[],
  rows: ChartRow[],
  yTitle: string,
  keyTitle: string,
): TopLevelSpec {
  return {
    ...frame(title, rows),
    mark: 'bar',
    encoding: {
      x: { field: 'x', type: 'nominal', title: null, sort: categories },
      xOffset: { field: 'key', type: 'nominal', sort: keys },
      y: {
        field: 'value',
        type: 'quantitative',
        title: yTitle,
      },
      color: {
        field: 'key',
        type: 'nominal',
        title: keyTitle,
        scale: { domain: keys },
      },
    },
  };
}

/**
 * A bar series with a line series on top, sharing the category axis.
 * Used for contributions plus weighted points, and commits plus the
 * cumulative line. The two series are distinguished by color only;
 * the markdown caption explains the mapping.
 *
 * @param title - The chart title.
 * @param categories - The category order.
 * @param rows - The data rows (one per category per series).
 * @param yTitle - The y-axis title.
 * @returns The spec.
 */
export function barLineSpec(
  title: string,
  categories: string[],
  rows: ChartRow[],
  yTitle: string,
): TopLevelSpec {
  const bars = rows.filter((row) => row.key === 'bars');
  const lines = rows.filter((row) => row.key === 'lines');
  const base = categoryEncodings(categories, yTitle);
  return {
    ...frame(title, rows),
    layer: [
      {
        mark: 'bar',
        data: { values: bars },
        encoding: {
          x: base.x,
          y: base.y,
        },
      },
      {
        mark: 'line',
        data: { values: lines },
        encoding: {
          x: base.x,
          y: base.y,
          color: { value: '#e45756' },
        },
      },
    ],
  };
}

/**
 * A single-series bar chart: one bar per category. Used for the
 * per-period points charts.
 *
 * @param title - The chart title.
 * @param categories - The category order.
 * @param rows - The data rows (one per category).
 * @param yTitle - The y-axis title.
 * @returns The spec.
 */
export function barSpec(
  title: string,
  categories: string[],
  rows: ChartRow[],
  yTitle: string,
): TopLevelSpec {
  return {
    ...frame(title, rows),
    mark: 'bar',
    encoding: categoryEncodings(categories, yTitle),
  };
}

/**
 * A multi-series line chart: one line per `key`, with points and a
 * legend. Used for lines added vs removed, active users, and the
 * per-repo comparison.
 *
 * @param title - The chart title.
 * @param categories - The category order.
 * @param keys - The series order (legend order).
 * @param rows - The data rows.
 * @param yTitle - The y-axis title.
 * @param keyTitle - The legend title.
 * @returns The spec.
 */
export function lineSeriesSpec(
  title: string,
  categories: string[],
  keys: string[],
  rows: ChartRow[],
  yTitle: string,
  keyTitle: string,
): TopLevelSpec {
  return {
    ...frame(title, rows),
    mark: { type: 'line', point: true },
    encoding: {
      ...categoryEncodings(categories, yTitle),
      color: {
        field: 'key',
        type: 'nominal',
        title: keyTitle,
        scale: { domain: keys },
      },
    },
  };
}

/**
 * A single-series horizontal bar chart: categories on the y axis.
 * Used for per-user contribution sizes.
 *
 * @param title - The chart title.
 * @param categories - The category order, bottom to top.
 * @param rows - The data rows.
 * @param xTitle - The x-axis title.
 * @returns The spec.
 */
export function horizontalBarSpec(
  title: string,
  categories: string[],
  rows: ChartRow[],
  xTitle: string,
): TopLevelSpec {
  return {
    ...frame(title, rows),
    mark: 'bar',
    encoding: {
      y: { field: 'x', type: 'nominal', title: null, sort: categories },
      x: { field: 'value', type: 'quantitative', title: xTitle },
    },
  };
}

/**
 * A pie chart of categorical shares. Used for work types, sizes and
 * complexity distributions.
 *
 * @param title - The chart title.
 * @param rows - The data rows (one per category).
 * @param keyTitle - The legend title.
 * @param keys - Optional legend order; without it, the legend is
 * alphabetical.
 * @returns The spec.
 */
export function pieSpec(
  title: string,
  rows: ChartRow[],
  keyTitle: string,
  keys?: string[],
): TopLevelSpec {
  return {
    ...frame(title, rows),
    mark: 'arc',
    encoding: {
      theta: { field: 'value', type: 'quantitative' },
      color: {
        field: 'key',
        type: 'nominal',
        title: keyTitle,
        scale: {
          scheme: COLOR_SCHEME,
          ...(keys === undefined ? {} : { domain: keys }),
        },
      },
    },
  };
}
