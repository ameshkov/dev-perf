/**
 * The EChart component: initializes one ECharts instance on mount,
 * pushes option updates, keeps the canvas sized to its container via
 * a `ResizeObserver`, and disposes on unmount.
 */
import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import type { EChartsOption } from 'echarts';
import type { EChartsType } from 'echarts/core';
import { CHART_THEME, echarts } from '../charts/index.js';

/** The props of the {@link EChart} component. */
export interface EChartProps {
  /** The chart option to render; replaced wholesale on change. */
  option: EChartsOption;
  /** Chart height in pixels; defaults to 300. */
  height?: number;
  /** Accessible label describing the chart. */
  label?: string;
}

/**
 * Renders one interactive ECharts chart sized to its container.
 *
 * @param props - The chart option, optional height and label.
 * @returns The chart container element.
 */
export function EChart({ option, height = 300, label }: EChartProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return undefined;
    }
    const chart = echarts.init(container, CHART_THEME);
    chartRef.current = chart;
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => chart.resize());
    observer?.observe(container);
    return () => {
      observer?.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  return (
    <div
      className="e-chart"
      ref={containerRef}
      style={{ height: `${height}px` }}
      role="img"
      aria-label={label}
    />
  );
}
