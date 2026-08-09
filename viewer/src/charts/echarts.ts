/**
 * One-time ECharts setup of the viewer: registers only the modules
 * the app uses (bar, line, pie charts with grid, tooltip and legend
 * components, canvas renderer) and the `dev-perf` dark theme. Every
 * chart component initializes through this instance.
 */
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { devperfTheme } from './theme.js';

/** The name the dark theme is registered under. */
export const CHART_THEME = 'dev-perf';

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);
echarts.registerTheme(CHART_THEME, devperfTheme);

/** The configured ECharts core, ready for `echarts.init`. */
export { echarts };
