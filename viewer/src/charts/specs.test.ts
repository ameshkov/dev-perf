/**
 * Tests for the ECharts option builders: concrete series shapes, axis
 * kinds, stacks and legends — no deep snapshots.
 */
import { describe, expect, it } from 'vitest';
import type { EChartsOption } from 'echarts';
import type { CountRow } from '../data/index.js';
import {
  barLineOption,
  barOption,
  donutOption,
  groupedBarOption,
  linesOption,
  stackedBarOption,
} from './index.js';

/** A loosely typed view of one series entry for assertions. */
type AnySeries = Record<string, unknown>;

/**
 * Extracts the series array of an option for shape assertions.
 *
 * @param option - The chart option.
 * @returns The series entries.
 */
function seriesOf(option: EChartsOption): AnySeries[] {
  return option.series as unknown as AnySeries[];
}

/**
 * Extracts the axis tooltip's value formatter of an option.
 *
 * @param option - The chart option.
 * @returns The formatter.
 */
function tooltipFormatter(option: EChartsOption): (value: number) => string {
  return (option.tooltip as Record<string, unknown>).valueFormatter as (value: number) => string;
}

const format = (value: number): string => `${value} pts`;

describe('barOption', () => {
  it('builds one bar series with the category axis and the formatter', () => {
    const option = barOption(
      ['Jan', 'Feb'],
      { name: 'Points', data: [3, 5], color: '#6d8bff' },
      format,
    );
    const series = seriesOf(option);
    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({ type: 'bar', name: 'Points', data: [3, 5] });
    expect((series[0].itemStyle as Record<string, unknown>).color).toBe('#6d8bff');
    expect((option.xAxis as Record<string, unknown>).data).toEqual(['Jan', 'Feb']);
    expect(tooltipFormatter(option)(4)).toBe('4 pts');
  });

  it('builds a vertical gradient when gradient colors are given', () => {
    const option = barOption(['Jan'], { name: 'Points', data: [1] }, format, [
      '#000000',
      '#ffffff',
    ]);
    const color = (seriesOf(option)[0].itemStyle as Record<string, unknown>).color as Record<
      string,
      unknown
    >;
    expect(color.type).toBe('linear');
    expect(color.colorStops).toEqual([
      { offset: 0, color: '#000000' },
      { offset: 1, color: '#ffffff' },
    ]);
  });
});

describe('groupedBarOption', () => {
  it('builds one unstacked bar series per group with the color applied', () => {
    const option = groupedBarOption(
      ['Jan'],
      [
        { name: 'A', data: [1], color: '#111111' },
        { name: 'B', data: [2] },
      ],
      format,
    );
    const series = seriesOf(option);
    expect(series).toHaveLength(2);
    expect(series[0]).toMatchObject({ type: 'bar', name: 'A', barMaxWidth: 26 });
    expect((series[0].itemStyle as Record<string, unknown>).color).toBe('#111111');
    expect(series[1].itemStyle).toBeUndefined();
    expect(series.every((entry) => entry.stack === undefined)).toBe(true);
    expect(option.legend).toBeDefined();
  });
});

describe('stackedBarOption', () => {
  it('builds bar series sharing one stack key', () => {
    const option = stackedBarOption(
      ['Jan'],
      [
        { name: 'A', data: [1], color: '#111111' },
        { name: 'B', data: [2] },
      ],
      format,
    );
    const series = seriesOf(option);
    expect(series).toHaveLength(2);
    expect(series.map((entry) => entry.stack)).toEqual(['total', 'total']);
    expect(series[0].itemStyle).toEqual({ borderRadius: 0, color: '#111111' });
    expect(series[1].itemStyle).toEqual({ borderRadius: 0 });
  });
});

describe('linesOption', () => {
  it('builds line series and shows the legend only for multiple series', () => {
    const single = linesOption(['Jan'], [{ name: 'Only', data: [1] }], format);
    expect(seriesOf(single)[0]).toMatchObject({ type: 'line', name: 'Only', data: [1] });
    expect(single.legend).toBeUndefined();

    const multiple = linesOption(
      ['Jan'],
      [
        { name: 'Added', data: [1], color: '#34d399' },
        { name: 'Removed', data: [2] },
      ],
      format,
    );
    expect(multiple.legend).toBeDefined();
    const first = seriesOf(multiple)[0];
    expect((first.lineStyle as Record<string, unknown>).color).toBe('#34d399');
    expect((first.itemStyle as Record<string, unknown>).color).toBe('#34d399');
  });
});

describe('barLineOption', () => {
  it('puts the bar on the left axis and the cumulative line on the right axis', () => {
    const option = barLineOption(
      ['Jan'],
      { name: 'Commits', data: [4] },
      { name: 'Cumulative', data: [9], color: '#f7b955' },
      format,
    );
    expect(option.yAxis).toHaveLength(2);
    expect((option.grid as Record<string, unknown>).right).toBe(56);
    const [bars, line] = seriesOf(option);
    expect(bars).toMatchObject({ type: 'bar', name: 'Commits', data: [4] });
    expect(line).toMatchObject({ type: 'line', name: 'Cumulative', yAxisIndex: 1, data: [9] });
    expect((line.lineStyle as Record<string, unknown>).type).toBe('dashed');
  });
});

describe('donutOption', () => {
  it('builds one pie series with an item tooltip and a right legend', () => {
    const rows: CountRow[] = [
      { key: 'feature', value: 3 },
      { key: 'bugfix', value: 1 },
    ];
    const option = donutOption(rows, (key) => (key === 'feature' ? '#6d8bff' : '#f87171'), format);
    expect((option.tooltip as Record<string, unknown>).trigger).toBe('item');
    expect((option.legend as Record<string, unknown>).orient).toBe('vertical');
    const [series] = seriesOf(option);
    expect(series).toMatchObject({ type: 'pie', radius: ['54%', '76%'] });
    expect(series.data).toEqual([
      { name: 'feature', value: 3, itemStyle: { color: '#6d8bff' } },
      { name: 'bugfix', value: 1, itemStyle: { color: '#f87171' } },
    ]);
  });
});

describe('category axis labels', () => {
  it('shows every label and hides whatever still overlaps', () => {
    const option = barOption(['Jan'], { name: 'S', data: [] }, format);
    const axisLabel = (option.xAxis as Record<string, unknown>).axisLabel as Record<
      string,
      unknown
    >;
    expect(axisLabel.interval).toBe(0);
    expect(axisLabel.hideOverlap).toBe(true);
  });

  it('rotates labels once the unrotated width no longer fits', () => {
    const shortLabels = Array.from({ length: 14 }, (_unused, index) => `P${index}`);
    const monthLabels = Array.from(
      { length: 12 },
      (_unused, index) => `2025-${String(index + 1).padStart(2, '0')}`,
    );
    const short = barOption(shortLabels, { name: 'S', data: [] }, format);
    const months = barOption(monthLabels, { name: 'S', data: [] }, format);
    const shortAxis = short.xAxis as Record<string, unknown>;
    const monthsAxis = months.xAxis as Record<string, unknown>;
    expect((shortAxis.axisLabel as Record<string, unknown>).rotate).toBe(0);
    expect((monthsAxis.axisLabel as Record<string, unknown>).rotate).toBe(45);
  });
});
