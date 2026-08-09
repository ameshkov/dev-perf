/**
 * Color system of the viewer: the categorical palette, the semantic
 * per-category color maps (sizes, complexity, work types, signal
 * kinds, added/removed lines), and the ECharts theme registration.
 */
import type { Complexity, ContributionSize, ContributionType } from '../report/index.js';

/** Qualitative palette for arbitrary categories (repos, languages). */
export const CATEGORY_PALETTE: string[] = [
  '#6d8bff',
  '#2dd4bf',
  '#f7b955',
  '#f27ba0',
  '#a78bfa',
  '#4ec9ff',
  '#8bd450',
  '#ff8f5e',
  '#f87171',
  '#94a3b8',
];

/** Size ramp (cool to warm as contributions get larger). */
export const SIZE_COLORS: Record<ContributionSize, string> = {
  xs: '#7dd3fc',
  s: '#60a5fa',
  m: '#818cf8',
  l: '#a78bfa',
  xl: '#c084fc',
};

/** Complexity colors (green, amber, red). */
export const COMPLEXITY_COLORS: Record<Complexity, string> = {
  low: '#34d399',
  medium: '#fbbf24',
  high: '#f87171',
};

/** Work-type colors for the known contribution types. */
export const WORK_TYPE_COLORS: Record<ContributionType, string> = {
  feature: '#6d8bff',
  bugfix: '#f87171',
  refactor: '#a78bfa',
  test: '#2dd4bf',
  docs: '#f7b955',
  tooling: '#4ec9ff',
  chore: '#94a3b8',
  security: '#ff8f5e',
};

/** Green ramp for quality-signal tags. */
export const QUALITY_PALETTE: string[] = [
  '#34d399',
  '#4ade80',
  '#a3e635',
  '#2dd4bf',
  '#86efac',
  '#5eead4',
];

/** Warm ramp for risk-flag tags. */
export const RISK_PALETTE: string[] = ['#f87171', '#fb923c', '#fbbf24', '#fda4af', '#fca5a5'];

/** Lines-added color. */
export const ADDED_COLOR = '#34d399';

/** Lines-removed color. */
export const REMOVED_COLOR = '#f87171';

/** Commits bar color. */
export const COMMITS_COLOR = '#6d8bff';

/** Cumulative line color (bars + cumulative line combo charts). */
export const CUMULATIVE_COLOR = '#f7b955';

/** Weighted-points bar gradient (bottom to top). */
export const POINTS_GRADIENT: [string, string] = ['#4ec9ff', '#a78bfa'];

/** Secondary text color of axis labels, kept in sync with base.css. */
const AXIS_LABEL_COLOR = '#98a2b8';

/** Faint text color of secondary axes. */
const AXIS_MUTED_COLOR = '#626c82';

/**
 * The ECharts theme of the viewer: dark, transparent background,
 * faint grid lines, rounded bar caps avoided (stacking-safe), and
 * tooltip styling matching the card surfaces.
 */
export const devperfTheme = {
  color: CATEGORY_PALETTE,
  backgroundColor: 'transparent',
  textStyle: {
    fontFamily:
      "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    color: AXIS_LABEL_COLOR,
  },
  legend: {
    textStyle: { color: AXIS_LABEL_COLOR, fontSize: 12 },
    inactiveColor: '#3a4152',
    pageIconColor: '#6d8bff',
    pageTextStyle: { color: AXIS_LABEL_COLOR },
  },
  tooltip: {
    backgroundColor: 'rgba(15, 19, 32, 0.94)',
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    padding: [10, 14],
    textStyle: { color: '#eef1f8', fontSize: 12 },
    extraCssText: 'border-radius: 10px; box-shadow: 0 10px 34px rgba(0, 0, 0, 0.5);',
  },
  categoryAxis: {
    axisLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.14)' } },
    axisTick: { show: false },
    axisLabel: { color: AXIS_LABEL_COLOR, margin: 12 },
    splitLine: { show: false },
  },
  valueAxis: {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: AXIS_MUTED_COLOR },
    splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.06)' } },
  },
  line: {
    smooth: 0.25,
    symbol: 'circle',
    symbolSize: 6,
    lineStyle: { width: 2.5 },
  },
  bar: {
    barMaxWidth: 46,
    itemStyle: { borderRadius: [4, 4, 0, 0] },
  },
  pie: {
    itemStyle: { borderColor: '#0c101b', borderWidth: 2 },
  },
};
