/**
 * The whole-range LLM chart blocks of one user for the nature-of-work
 * group: the contribution size and complexity distributions, and the
 * work-type share donut — the per-user counterparts of the team
 * distributions.
 */
import type { UserSeries } from '../data/index.js';
import { COMPLEXITY_ORDER, SIZE_ORDER, countByKey, formatInt } from '../data/index.js';
import type { ChartBlockDescriptor } from '../components/index.js';
import {
  CATEGORY_PALETTE,
  COMPLEXITY_COLORS,
  SIZE_COLORS,
  WORK_TYPE_COLORS,
  categoryBarOption,
  cycleColor,
  donutOption,
} from '../charts/index.js';

/**
 * The contribution sizes block of one user over the whole range.
 *
 * @param series - The user's series.
 * @returns The descriptor.
 */
function overallSizesBlock(series: UserSeries): ChartBlockDescriptor {
  const contributions = series.user.llm.contributions;
  return {
    id: 'user-sizes',
    title: 'Contribution sizes',
    description: 'Contribution sizes over the whole range (xs to xl t-shirt sizing).',
    optionOf: () =>
      categoryBarOption(
        SIZE_ORDER.map((size) => ({
          key: size,
          value: contributions.filter((contribution) => contribution.size === size).length,
        })),
        (key) => (SIZE_COLORS as Record<string, string>)[key],
        formatInt,
      ),
  };
}

/**
 * The complexity distribution block of one user over the whole range.
 *
 * @param series - The user's series.
 * @returns The descriptor.
 */
function overallComplexityBlock(series: UserSeries): ChartBlockDescriptor {
  const contributions = series.user.llm.contributions;
  return {
    id: 'user-complexity',
    title: 'Complexity distribution',
    description: 'Contribution complexity over the whole range (low, medium, high).',
    optionOf: () =>
      categoryBarOption(
        COMPLEXITY_ORDER.map((level) => ({
          key: level,
          value: contributions.filter((contribution) => contribution.complexity === level).length,
        })),
        (key) => (COMPLEXITY_COLORS as Record<string, string>)[key],
        formatInt,
      ),
  };
}

/**
 * The work-type share donut of one user over the whole range.
 *
 * @param series - The user's series.
 * @returns The descriptor.
 */
function overallWorkTypesBlock(series: UserSeries): ChartBlockDescriptor {
  const workTypes = countByKey((contribution) => contribution.types, series.user.llm.contributions);
  return {
    id: 'user-work-types',
    title: 'Work-type share',
    description:
      'Share of contributions by work type over the whole range — a contribution may mix types.',
    optionOf: () =>
      donutOption(
        workTypes,
        (key) =>
          (WORK_TYPE_COLORS as Record<string, string>)[key] ??
          cycleColor(
            CATEGORY_PALETTE,
            workTypes.findIndex((row) => row.key === key),
          ),
        formatInt,
      ),
  };
}

/**
 * The whole-range LLM blocks of one user, in document order.
 *
 * @param series - The user's series.
 * @returns The descriptors.
 */
export function buildOverallLlmBlocks(series: UserSeries): ChartBlockDescriptor[] {
  return [overallSizesBlock(series), overallComplexityBlock(series), overallWorkTypesBlock(series)];
}
