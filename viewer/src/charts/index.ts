/**
 * Charts layer of the viewer: the configured ECharts core, the dark
 * theme and color system, and the pure option builders.
 */
export { CHART_THEME, echarts } from './echarts.js';
export {
  ADDED_COLOR,
  CATEGORY_PALETTE,
  COMMITS_COLOR,
  COMPLEXITY_COLORS,
  CUMULATIVE_COLOR,
  POINTS_GRADIENT,
  QUALITY_PALETTE,
  REMOVED_COLOR,
  RISK_PALETTE,
  SIZE_COLORS,
  WORK_TYPE_COLORS,
} from './theme.js';
export type { NamedSeries } from './specs.js';
export { cycleColor, percentFormat } from './labels.js';
export {
  barLineOption,
  barOption,
  donutOption,
  groupedBarOption,
  linesOption,
  stackedBarOption,
} from './specs.js';
