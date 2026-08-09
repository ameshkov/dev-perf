/**
 * The per-period LLM chart blocks of one user, authored per chart
 * group: the activity blocks (points and contributions with the
 * cumulative line), the nature-of-work blocks (contributions stacked
 * by size, complexity and work type), and the signal blocks (the
 * risk-flag and quality-signal shares, tag-selectable and
 * full-width, plus the flag rates) — the per-user counterparts of the
 * team blocks.
 */
import type { CountRow, UserSeries } from '../data/index.js';
import {
  COMPLEXITY_ORDER,
  SIZE_ORDER,
  countByKey,
  countContributionsByKey,
  flagsPerContribution,
  formatInt,
  formatNumber,
  signalShareValues,
} from '../data/index.js';
import type { ChartBlockDescriptor } from '../components/index.js';
import type { NamedSeries } from '../charts/index.js';
import {
  CATEGORY_PALETTE,
  COMPLEXITY_COLORS,
  CUMULATIVE_COLOR,
  POINTS_GRADIENT,
  QUALITY_PALETTE,
  RISK_PALETTE,
  SIZE_COLORS,
  WORK_TYPE_COLORS,
  barLineOption,
  barOption,
  cycleColor,
  groupedBarOption,
  percentFormat,
  stackedBarOption,
} from '../charts/index.js';

/**
 * The user's own tag list of one kind: work types, quality signals or
 * risk flags counted over the user's contributions, most frequent
 * first.
 *
 * @param series - The user's series.
 * @param kind - The tag kind.
 * @returns The counted tags.
 */
function userTags(series: UserSeries, kind: 'workTypes' | 'quality' | 'risk'): CountRow[] {
  const contributions = series.user.llm.contributions;
  if (kind === 'workTypes') {
    return countByKey((contribution) => contribution.types, contributions);
  }
  if (kind === 'quality') {
    return countContributionsByKey((contribution) => contribution.qualitySignals, contributions);
  }
  return countContributionsByKey((contribution) => contribution.riskFlags, contributions);
}

/**
 * The points block of one user: size-weighted points per period.
 *
 * @param series - The user's series.
 * @param labels - The period labels.
 * @returns The descriptor.
 */
function userPointsBlock(series: UserSeries, labels: string[]): ChartBlockDescriptor {
  return {
    id: 'user-points',
    title: 'Points per period',
    description: 'Size-weighted contribution points per period (xs=1 to xl=8).',
    optionOf: () =>
      barOption(
        labels,
        { name: 'Points', data: series.points.map((point) => point.weightedPoints) },
        formatInt,
        POINTS_GRADIENT,
      ),
  };
}

/**
 * The sizes block of one user: contributions per period stacked by
 * size.
 *
 * @param series - The user's series.
 * @param labels - The period labels.
 * @returns The descriptor.
 */
function userSizesBlock(series: UserSeries, labels: string[]): ChartBlockDescriptor {
  return {
    id: 'user-sizes-per-period',
    title: 'Contribution sizes per period',
    description: 'Contributions per period, stacked by size (xs to xl).',
    optionOf: () =>
      stackedBarOption(
        labels,
        SIZE_ORDER.map((size) => ({
          name: size,
          data: series.points.map((point) => point.sizes[size]),
          color: SIZE_COLORS[size],
        })),
        formatInt,
      ),
  };
}

/**
 * The complexity block of one user: contributions per period stacked
 * by complexity.
 *
 * @param series - The user's series.
 * @param labels - The period labels.
 * @returns The descriptor.
 */
function userComplexityBlock(series: UserSeries, labels: string[]): ChartBlockDescriptor {
  return {
    id: 'user-complexity-per-period',
    title: 'Complexity per period',
    description: 'Contributions per period, stacked by complexity (low to high).',
    optionOf: () =>
      stackedBarOption(
        labels,
        COMPLEXITY_ORDER.map((level) => ({
          name: level,
          data: series.points.map((point) => point.complexity[level] ?? 0),
          color: COMPLEXITY_COLORS[level as keyof typeof COMPLEXITY_COLORS],
        })),
        formatInt,
      ),
  };
}

/**
 * The work-types block of one user: contributions per period stacked
 * by the user's own work types, tag-selectable.
 *
 * @param series - The user's series.
 * @param labels - The period labels.
 * @returns The descriptor.
 */
function userWorkTypesBlock(series: UserSeries, labels: string[]): ChartBlockDescriptor {
  const workTypes = userTags(series, 'workTypes');
  return {
    id: 'user-work-types-per-period',
    title: 'Work types per period',
    description:
      'Contributions per period, stacked by work type — pick the types you care about with the tag selector.',
    tags: workTypes,
    optionOf: (selected) =>
      stackedBarOption(
        labels,
        workTypes
          .filter((row) => selected === undefined || selected.has(row.key))
          .map((row) => ({
            name: row.key,
            data: series.points.map((point) => point.workTypes[row.key] ?? 0),
            color:
              (WORK_TYPE_COLORS as Record<string, string>)[row.key] ??
              cycleColor(CATEGORY_PALETTE, workTypes.indexOf(row)),
          })),
        formatInt,
      ),
  };
}

/**
 * The contributions block of one user: contributions per period with
 * the cumulative line.
 *
 * @param series - The user's series.
 * @param labels - The period labels.
 * @returns The descriptor.
 */
function userContributionsBlock(series: UserSeries, labels: string[]): ChartBlockDescriptor {
  return {
    id: 'user-contributions-cumulative',
    title: 'Contributions per period',
    description: 'Contributions per period (bars) and the cumulative count (dashed line).',
    optionOf: () =>
      barLineOption(
        labels,
        { name: 'Contributions', data: series.points.map((point) => point.contributions) },
        {
          name: 'Cumulative',
          data: series.points.map((point) => point.cumulativeContributions),
          color: CUMULATIVE_COLOR,
        },
        formatInt,
      ),
  };
}

/**
 * One per-period signal-share block of the user: grouped bars of the
 * share of the user's contributions carrying each selected tag.
 *
 * @param series - The user's series.
 * @param labels - The period labels.
 * @param kind - The signal kind.
 * @returns The descriptor.
 */
function userSignalBlock(
  series: UserSeries,
  labels: string[],
  kind: 'risk' | 'quality',
): ChartBlockDescriptor {
  const palette = kind === 'risk' ? RISK_PALETTE : QUALITY_PALETTE;
  const tally = userTags(series, kind);
  const noun = kind === 'risk' ? 'risk flags' : 'quality signals';
  return {
    id: kind === 'risk' ? 'user-risk-per-period' : 'user-quality-per-period',
    title: `${kind === 'risk' ? 'Risk flags' : 'Quality signals'} per period`,
    description: `Share of the period's contributions carrying each of the selected ${noun}.`,
    // The tag list of the signals is long; the block reads full-width.
    wide: true,
    tags: tally,
    optionOf: (selected) => {
      const keys = tally
        .filter((row) => selected === undefined || selected.has(row.key))
        .map((row) => row.key);
      const shares = signalShareValues(
        labels,
        keys,
        series.signals[kind],
        series.points.map((point) => point.contributions),
      );
      const chartSeries: NamedSeries[] = shares.map((share) => ({
        name: share.key,
        data: share.values,
        color: cycleColor(
          palette,
          tally.findIndex((row) => row.key === share.key),
        ),
      }));
      return groupedBarOption(labels, chartSeries, percentFormat);
    },
  };
}

/**
 * One flag-rate block of the user: the average flags per
 * contribution, one bar per period.
 *
 * @param series - The user's series.
 * @param labels - The period labels.
 * @param kind - The signal kind.
 * @returns The descriptor.
 */
function userRateBlock(
  series: UserSeries,
  labels: string[],
  kind: 'risk' | 'quality',
): ChartBlockDescriptor {
  const noun = kind === 'risk' ? 'risk flags' : 'quality signals';
  return {
    id: kind === 'risk' ? 'user-risk-rate' : 'user-quality-rate',
    title: `${kind === 'risk' ? 'Risk flags' : 'Quality signals'} per contribution`,
    description: `Average ${noun} per contribution per period.`,
    optionOf: () =>
      barOption(
        labels,
        {
          name: 'Per contribution',
          data: labels.map((_label, index) =>
            flagsPerContribution(series.signals[kind][index], series.points[index].contributions),
          ),
        },
        formatNumber,
      ),
  };
}

/**
 * The per-period activity blocks of one user: points and
 * contributions with the cumulative line.
 *
 * @param series - The user's series.
 * @param labels - The period labels.
 * @returns The descriptors.
 */
export function buildPeriodLlmActivityBlocks(
  series: UserSeries,
  labels: string[],
): ChartBlockDescriptor[] {
  return [userPointsBlock(series, labels), userContributionsBlock(series, labels)];
}

/**
 * The per-period nature-of-work blocks of one user: contributions
 * stacked by size, complexity and work type.
 *
 * @param series - The user's series.
 * @param labels - The period labels.
 * @returns The descriptors.
 */
export function buildPeriodLlmWorkBlocks(
  series: UserSeries,
  labels: string[],
): ChartBlockDescriptor[] {
  return [
    userSizesBlock(series, labels),
    userComplexityBlock(series, labels),
    userWorkTypesBlock(series, labels),
  ];
}

/**
 * The per-period signal blocks of one user: the risk-flag and
 * quality-signal shares (full-width, tag-selectable) and the
 * per-period flag rates.
 *
 * @param series - The user's series.
 * @param labels - The period labels.
 * @returns The descriptors.
 */
export function buildPeriodLlmSignalBlocks(
  series: UserSeries,
  labels: string[],
): ChartBlockDescriptor[] {
  return [
    userSignalBlock(series, labels, 'risk'),
    userSignalBlock(series, labels, 'quality'),
    userRateBlock(series, labels, 'risk'),
    userRateBlock(series, labels, 'quality'),
  ];
}
