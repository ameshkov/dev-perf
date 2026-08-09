/**
 * The whole-range LLM distribution blocks of the team section:
 * work-type share, contribution sizes, and the complexity
 * distribution — the donut counterparts of the compiled report's
 * appendix pies.
 */
import type { ChartData } from '../data/index.js';
import { COMPLEXITY_ORDER, SIZE_ORDER, formatInt } from '../data/index.js';
import type { ChartBlockDescriptor } from '../components/index.js';
import type { CountRow } from '../data/index.js';
import {
  COMPLEXITY_COLORS,
  SIZE_COLORS,
  WORK_TYPE_COLORS,
  CATEGORY_PALETTE,
  cycleColor,
  donutOption,
} from '../charts/index.js';

/**
 * One whole-range distribution donut block.
 *
 * @param id - The block id.
 * @param title - The block name.
 * @param description - What the donut shows.
 * @param rows - The counted rows, one slice each.
 * @param colorOf - The slice color per key.
 * @returns The descriptor.
 */
function distBlock(
  id: string,
  title: string,
  description: string,
  rows: CountRow[],
  colorOf: (key: string) => string | undefined,
): ChartBlockDescriptor {
  return {
    id,
    title,
    description,
    optionOf: () => donutOption(rows, colorOf, formatInt),
  };
}

/**
 * The distribution blocks; only present when the report has LLM
 * analysis.
 *
 * @param data - The chart data.
 * @returns The descriptors.
 */
export function buildDistributionBlocks(data: ChartData): ChartBlockDescriptor[] {
  const sizeColors = SIZE_COLORS as Record<string, string>;
  const complexityColors = COMPLEXITY_COLORS as Record<string, string>;
  return [
    distBlock(
      'team-dist-work-types',
      'Work-type share',
      'Share of contributions by work type over the whole range — a contribution may mix types, so shares can sum to more than the total.',
      data.pies.workTypes,
      (key) =>
        (WORK_TYPE_COLORS as Record<string, string>)[key] ??
        cycleColor(
          CATEGORY_PALETTE,
          data.pies.workTypes.findIndex((row) => row.key === key),
        ),
    ),
    distBlock(
      'team-dist-sizes',
      'Contribution sizes',
      'Distribution of contribution sizes (xs to xl) over the whole range.',
      SIZE_ORDER.map((size) => ({
        key: size,
        value: data.pies.sizes.find((row) => row.key === size)?.value ?? 0,
      })),
      (key) => sizeColors[key],
    ),
    distBlock(
      'team-dist-complexity',
      'Complexity distribution',
      'Distribution of contribution complexity (low, medium, high) over the whole range.',
      COMPLEXITY_ORDER.map((level) => ({
        key: level,
        value: data.pies.complexity.find((row) => row.key === level)?.value ?? 0,
      })),
      (key) => complexityColors[key],
    ),
  ];
}
