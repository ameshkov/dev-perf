/**
 * ECharts option builders of the viewer: one builder per chart kind
 * used across the sections — single and grouped bars, stacked bars,
 * multi-series lines, the bars-plus-cumulative-line combo, and the
 * donut pies. Builders are pure: labels, named series, and a value
 * formatter go in, a complete `EChartsOption` comes out.
 */
import type { EChartsOption } from 'echarts';
import type { CountRow } from '../data/index.js';

/** One named series with its per-period values. */
export interface NamedSeries {
  /** Series name shown in the legend and tooltips. */
  name: string;
  /** One value per period label, aligned with the labels. */
  data: number[];
  /** Series color; falls back to the theme palette when absent. */
  color?: string;
}

/** The value formatter of a chart's axes and tooltips. */
type ValueFormatter = (value: number) => string;

/** Grid margins shared by every cartesian chart. */
const GRID = { left: 56, right: 24, top: 46, bottom: 34, containLabel: false };

/** Approximate pixel width of one label character at the theme font size. */
const LABEL_CHAR_WIDTH = 7;

/** Horizontal breathing room reserved between two neighboring labels. */
const LABEL_GAP = 6;

/**
 * The plot width the rotation decision assumes: the plot of a
 * two-column chart card, the narrowest common layout.
 */
const ASSUMED_PLOT_WIDTH = 460;

/**
 * The category-label rotation: 45 degrees once the unrotated labels
 * no longer fit the assumed plot width; whatever still overlaps at
 * other container widths is hidden by the axis `hideOverlap`.
 *
 * @param labels - The period labels.
 * @returns The rotation angle.
 */
function axisRotate(labels: string[]): number {
  const longest = labels.reduce((max, label) => Math.max(max, label.length), 0);
  const needed = labels.length * (longest * LABEL_CHAR_WIDTH + LABEL_GAP);
  return needed > ASSUMED_PLOT_WIDTH ? 45 : 0;
}

/**
 * The category axis shared by every cartesian builder: period labels
 * rotated once they no longer fit, overlapping labels hidden.
 *
 * @param labels - The period labels.
 * @returns The x-axis object.
 */
function categoryAxis(labels: string[]): object {
  return {
    type: 'category',
    data: labels,
    axisLabel: { interval: 0, hideOverlap: true, rotate: axisRotate(labels) },
  };
}

/**
 * The shared axis tooltip of a cartesian chart: one row per series,
 * values rendered through the chart's formatter.
 *
 * @param format - The value formatter.
 * @returns The tooltip object.
 */
function axisTooltip(format: ValueFormatter): object {
  return {
    trigger: 'axis',
    valueFormatter: (value: unknown) => format(Number(value)),
  };
}

/**
 * The scrollable top legend shared by the sections.
 *
 * @returns The legend object.
 */
function topLegend(): object {
  return { type: 'scroll', top: 4, left: 0, itemWidth: 14, itemHeight: 8, icon: 'roundRect' };
}

/**
 * The option of a single bar series, with an optional two-stop
 * vertical gradient fill (bottom color first).
 *
 * @param labels - The period labels.
 * @param series - The bar series.
 * @param format - The value formatter.
 * @param gradient - Optional bottom/top gradient colors.
 * @returns The chart option.
 */
export function barOption(
  labels: string[],
  series: NamedSeries,
  format: ValueFormatter,
  gradient?: [string, string],
): EChartsOption {
  const itemStyle =
    gradient === undefined
      ? { color: series.color }
      : {
          color: {
            type: 'linear' as const,
            x: 0,
            y: 1,
            x2: 0,
            y2: 0,
            colorStops: [
              { offset: 0, color: gradient[0] },
              { offset: 1, color: gradient[1] },
            ],
          },
        };
  return {
    grid: GRID,
    tooltip: axisTooltip(format),
    xAxis: categoryAxis(labels),
    yAxis: { type: 'value' },
    series: [{ type: 'bar', name: series.name, data: series.data, itemStyle }],
  };
}

/**
 * The option of grouped (side-by-side) bar series — the chart kind of
 * the per-period signal shares.
 *
 * @param labels - The period labels.
 * @param series - The bar series, one per tag.
 * @param format - The value formatter.
 * @returns The chart option.
 */
export function groupedBarOption(
  labels: string[],
  series: NamedSeries[],
  format: ValueFormatter,
): EChartsOption {
  return {
    grid: GRID,
    tooltip: axisTooltip(format),
    legend: topLegend(),
    xAxis: categoryAxis(labels),
    yAxis: { type: 'value' },
    series: series.map((entry) => ({
      type: 'bar',
      name: entry.name,
      data: entry.data,
      barMaxWidth: 26,
      itemStyle: entry.color === undefined ? undefined : { color: entry.color },
    })),
  };
}

/**
 * The option of stacked bar series (one stack): the chart kind of the
 * size, complexity, work-type and language breakdowns. Stacked
 * segments get square corners so the stack reads as one bar.
 *
 * @param labels - The period labels.
 * @param series - The bar series, bottom segment first.
 * @param format - The value formatter.
 * @returns The chart option.
 */
export function stackedBarOption(
  labels: string[],
  series: NamedSeries[],
  format: ValueFormatter,
): EChartsOption {
  return {
    grid: GRID,
    tooltip: axisTooltip(format),
    legend: topLegend(),
    xAxis: categoryAxis(labels),
    yAxis: { type: 'value' },
    series: series.map((entry) => ({
      type: 'bar',
      stack: 'total',
      name: entry.name,
      data: entry.data,
      itemStyle: {
        borderRadius: 0,
        ...(entry.color === undefined ? {} : { color: entry.color }),
      },
    })),
  };
}

/**
 * The option of one or more line series: the chart kind of lines
 * added vs removed, active users, and the repository comparison.
 *
 * @param labels - The period labels.
 * @param series - The line series.
 * @param format - The value formatter.
 * @returns The chart option.
 */
export function linesOption(
  labels: string[],
  series: NamedSeries[],
  format: ValueFormatter,
): EChartsOption {
  return {
    grid: GRID,
    tooltip: axisTooltip(format),
    legend: series.length > 1 ? topLegend() : undefined,
    xAxis: categoryAxis(labels),
    yAxis: { type: 'value' },
    series: series.map((entry) => ({
      type: 'line',
      name: entry.name,
      data: entry.data,
      showSymbol: true,
      lineStyle: entry.color === undefined ? undefined : { color: entry.color },
      itemStyle: entry.color === undefined ? undefined : { color: entry.color },
    })),
  };
}

/**
 * The option of the bars-plus-cumulative-line combo: the bar series
 * on the left axis, the cumulative line on the right axis.
 *
 * @param labels - The period labels.
 * @param bars - The per-period bar series.
 * @param line - The cumulative line series.
 * @param format - The value formatter.
 * @returns The chart option.
 */
export function barLineOption(
  labels: string[],
  bars: NamedSeries,
  line: NamedSeries,
  format: ValueFormatter,
): EChartsOption {
  return {
    grid: { ...GRID, right: 56 },
    tooltip: axisTooltip(format),
    legend: topLegend(),
    xAxis: categoryAxis(labels),
    yAxis: [{ type: 'value' }, { type: 'value', splitLine: { show: false } }],
    series: [
      {
        type: 'bar',
        name: bars.name,
        data: bars.data,
        itemStyle: bars.color === undefined ? undefined : { color: bars.color },
      },
      {
        type: 'line',
        name: line.name,
        data: line.data,
        yAxisIndex: 1,
        showSymbol: true,
        lineStyle: { width: 2, type: 'dashed' },
        itemStyle: line.color === undefined ? undefined : { color: line.color },
      },
    ],
  };
}

/**
 * The option of one bar per category with an individual color per
 * bar — the chart kind of the whole-range size and complexity
 * distributions. Bars carry no legend: the category axis names them.
 *
 * @param rows - One bar per row, in display order.
 * @param colorOf - The bar color per row key; palette when absent.
 * @param format - The value formatter.
 * @returns The chart option.
 */
export function categoryBarOption(
  rows: CountRow[],
  colorOf: (key: string) => string | undefined,
  format: ValueFormatter,
): EChartsOption {
  return {
    grid: { ...GRID, top: 24 },
    tooltip: axisTooltip(format),
    xAxis: categoryAxis(rows.map((row) => row.key)),
    yAxis: { type: 'value' },
    series: [
      {
        type: 'bar',
        name: 'Contributions',
        data: rows.map((row) => ({
          value: row.value,
          itemStyle: { color: colorOf(row.key) },
        })),
      },
    ],
  };
}

/**
 * The option of a donut pie: one slice per counted row, legend under
 * the ring, slice labels with the name and the formatted value.
 *
 * @param rows - The counted rows, one slice each.
 * @param colorOf - The slice color per row key; palette when absent.
 * @param format - The value formatter.
 * @returns The chart option.
 */
export function donutOption(
  rows: CountRow[],
  colorOf: (key: string) => string | undefined,
  format: ValueFormatter,
): EChartsOption {
  return {
    tooltip: {
      trigger: 'item',
      valueFormatter: (value: unknown) => format(Number(value)),
    },
    legend: {
      type: 'scroll',
      orient: 'vertical',
      right: 0,
      top: 'middle',
      itemWidth: 12,
      itemHeight: 8,
      icon: 'roundRect',
    },
    series: [
      {
        type: 'pie',
        radius: ['54%', '76%'],
        center: ['36%', '50%'],
        avoidLabelOverlap: true,
        label: { show: false },
        emphasis: {
          label: { show: true, fontSize: 14, fontWeight: 600, color: '#eef1f8' },
          itemStyle: { shadowBlur: 18, shadowColor: 'rgba(0, 0, 0, 0.45)' },
        },
        data: rows.map((row) => ({
          name: row.key,
          value: row.value,
          itemStyle: { color: colorOf(row.key) },
        })),
      },
    ],
  };
}
