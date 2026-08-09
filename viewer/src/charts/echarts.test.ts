/**
 * Smoke test for the one-time ECharts setup: the module registers the
 * used modules and the theme without ever initializing a chart on a
 * DOM element.
 */
import { describe, expect, it } from 'vitest';
import { CHART_THEME, echarts } from './index.js';

describe('the configured echarts core', () => {
  it('exports an init function and the registered theme name', () => {
    expect(typeof echarts.init).toBe('function');
    expect(typeof echarts.registerTheme).toBe('function');
    expect(CHART_THEME).toBe('dev-perf');
  });
});
