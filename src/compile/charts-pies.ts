/**
 * The LLM distribution pies of the `compile` command: work types,
 * sizes, complexity, and the risk flags and quality signals — the
 * whole-report distributions rendered in the LLM analysis summary.
 * Extracted from `charts.ts` so the team chart inventory stays within
 * the file size limit.
 */
import type { ChartData } from './chart-data.js';
import { COMPLEXITY_ORDER, SIZE_ORDER } from './chart-data.js';
import { topWithOther } from './chart-util.js';
import type { ChartAsset } from './chart-util.js';
import { pieSpec } from './vega.js';

/** The number of top signals kept in the signal pies, rest as `other`. */
const TOP_SIGNALS = 5;

/**
 * The risk-flag and quality-signal distribution pies: the top
 * `TOP_SIGNALS` categories plus an `other` slice.
 *
 * @param data - The chart data.
 * @param charts - The chart list to append to.
 */
function signalPieCharts(data: ChartData, charts: ChartAsset[]): void {
  charts.push({
    file: 'risk-distribution.svg',
    caption: `Share of contributions by risk flag (top ${TOP_SIGNALS} flags plus other).`,
    spec: pieSpec(
      'Risk distribution',
      topWithOther(data.tallies.risk, TOP_SIGNALS).map((row) => ({
        x: row.key,
        key: row.key,
        value: row.value,
      })),
      'Risk flag',
    ),
  });
  charts.push({
    file: 'quality-distribution.svg',
    caption: `Share of contributions by quality signal (top ${TOP_SIGNALS} signals plus other).`,
    spec: pieSpec(
      'Quality distribution',
      topWithOther(data.tallies.quality, TOP_SIGNALS).map((row) => ({
        x: row.key,
        key: row.key,
        value: row.value,
      })),
      'Quality signal',
    ),
  });
}

/**
 * The LLM distribution pies: work types, sizes, complexity, and the
 * risk flags and quality signals (top `TOP_SIGNALS` plus `other`).
 * Size and complexity legends follow the natural category order.
 *
 * @param data - The chart data.
 * @param charts - The chart list to append to.
 */
export function llmPieCharts(data: ChartData, charts: ChartAsset[]): void {
  charts.push({
    file: 'work-types.svg',
    caption: 'Share of contributions by work type (a contribution may mix types).',
    spec: pieSpec(
      'Work types',
      data.pies.workTypes.map((row) => ({ x: row.key, key: row.key, value: row.value })),
      'Type',
    ),
  });
  charts.push({
    file: 'size-distribution.svg',
    caption: 'Share of contributions by size.',
    spec: pieSpec(
      'Size distribution',
      data.pies.sizes.map((row) => ({ x: row.key, key: row.key, value: row.value })),
      'Size',
      SIZE_ORDER,
    ),
  });
  charts.push({
    file: 'complexity-distribution.svg',
    caption: 'Share of contributions by complexity.',
    spec: pieSpec(
      'Complexity distribution',
      data.pies.complexity.map((row) => ({ x: row.key, key: row.key, value: row.value })),
      'Complexity',
      COMPLEXITY_ORDER,
    ),
  });
  signalPieCharts(data, charts);
}
