/**
 * The LLM-based team chart blocks, authored per chart group: the
 * activity blocks (points and contributions per period), the
 * nature-of-work blocks (contributions stacked by size, complexity
 * and work type), and the signal blocks (the per-period risk-flag and
 * quality-signal shares, tag-selectable and full-width, plus the
 * per-period flag rates). Mirrors the LLM half of the parent CLI's
 * compile inventory, as interactive charts.
 */
import type { ContributionType } from '../report/index.js';
import type { ChartData, CountRow } from '../data/index.js';
import {
  COMPLEXITY_ORDER,
  SIZE_ORDER,
  flagsPerContribution,
  formatInt,
  formatNumber,
  signalShareValues,
} from '../data/index.js';
import type { ChartBlockDescriptor } from '../components/index.js';
import type { NamedSeries } from '../charts/index.js';
import {
  COMPLEXITY_COLORS,
  CATEGORY_PALETTE,
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
 * The color of one work type: the fixed color of the known types,
 * the palette cycle of the rest.
 *
 * @param keys - All work types in display order.
 * @param key - The work type.
 * @returns The color.
 */
function workTypeColor(keys: string[], key: string): string {
  const known = (WORK_TYPE_COLORS as Record<string, string>)[key as ContributionType];
  if (known !== undefined) {
    return known;
  }
  return cycleColor(CATEGORY_PALETTE, keys.indexOf(key));
}

/**
 * The color of one signal tag by its position in the full tally, so
 * colors stay stable for any selected subset.
 *
 * @param palette - The signal palette (risk or quality).
 * @param tally - The full tally in display order.
 * @param key - The signal.
 * @returns The color.
 */
function signalColor(palette: string[], tally: CountRow[], key: string): string {
  return cycleColor(
    palette,
    tally.findIndex((row) => row.key === key),
  );
}

/**
 * The points block: the complexity- and size-weighted contribution
 * points per period.
 *
 * @param data - The chart data.
 * @param labels - The period labels.
 * @returns The descriptor.
 */
function pointsBlock(data: ChartData, labels: string[]): ChartBlockDescriptor {
  return {
    id: 'team-points',
    title: 'Points per period',
    description:
      'Contribution points per period: every contribution scores its t-shirt size (xs=1, s=2, m=3, l=5, xl=8) scaled by complexity (low=1, medium=1.5, high=2) — a signal of shipped scope as assessed by the LLM.',
    optionOf: () =>
      barOption(
        labels,
        { name: 'Points', data: data.team.map((point) => point.weightedPoints) },
        formatInt,
        POINTS_GRADIENT,
      ),
  };
}

/**
 * The work-types block: contributions per period stacked by work
 * type, tag-selectable.
 *
 * @param data - The chart data.
 * @param labels - The period labels.
 * @returns The descriptor.
 */
function workTypesBlock(data: ChartData, labels: string[]): ChartBlockDescriptor {
  const keys = data.pies.workTypes.map((row) => row.key);
  return {
    id: 'team-work-types',
    title: 'Work types per period',
    description:
      'Contributions per period, stacked by work type. A contribution may mix types, so a bar can exceed the number of contributions in a period. Pick the types you care about with the tag selector.',
    tags: data.pies.workTypes,
    optionOf: (selected) =>
      stackedBarOption(
        labels,
        keys
          .filter((key) => selected === undefined || selected.has(key))
          .map((key) => ({
            name: key,
            data: data.team.map((point) => point.workTypes[key] ?? 0),
            color: workTypeColor(keys, key),
          })),
        formatInt,
      ),
  };
}

/**
 * The sizes block: contributions per period stacked by size.
 *
 * @param data - The chart data.
 * @param labels - The period labels.
 * @returns The descriptor.
 */
function sizesBlock(data: ChartData, labels: string[]): ChartBlockDescriptor {
  return {
    id: 'team-sizes',
    title: 'Contribution sizes per period',
    description: 'Contributions per period, stacked by size (xs to xl t-shirt sizing).',
    optionOf: () =>
      stackedBarOption(
        labels,
        SIZE_ORDER.map((size) => ({
          name: size,
          data: data.team.map((point) => point.sizes[size]),
          color: SIZE_COLORS[size],
        })),
        formatInt,
      ),
  };
}

/**
 * The complexity block: contributions per period stacked by
 * complexity.
 *
 * @param data - The chart data.
 * @param labels - The period labels.
 * @returns The descriptor.
 */
function complexityBlock(data: ChartData, labels: string[]): ChartBlockDescriptor {
  return {
    id: 'team-complexity',
    title: 'Complexity per period',
    description: 'Contributions per period, stacked by complexity (low, medium, high).',
    optionOf: () =>
      stackedBarOption(
        labels,
        COMPLEXITY_ORDER.map((level) => ({
          name: level,
          data: data.team.map((point) => point.complexity[level] ?? 0),
          color: COMPLEXITY_COLORS[level as keyof typeof COMPLEXITY_COLORS],
        })),
        formatInt,
      ),
  };
}

/**
 * The contributions block: contributions per period with the
 * cumulative line.
 *
 * @param data - The chart data.
 * @param labels - The period labels.
 * @returns The descriptor.
 */
function contributionsBlock(data: ChartData, labels: string[]): ChartBlockDescriptor {
  return {
    id: 'team-contributions',
    title: 'Contributions per period',
    description:
      'Contributions per period (bars) and the cumulative contribution count over the range (dashed line).',
    optionOf: () =>
      barLineOption(
        labels,
        { name: 'Contributions', data: data.team.map((point) => point.contributions) },
        {
          name: 'Cumulative',
          data: data.team.map((point) => point.cumulativeContributions),
          color: CUMULATIVE_COLOR,
        },
        formatInt,
      ),
  };
}

/**
 * One signal-share block (risk flags or quality signals): grouped
 * bars of the share of each period's contributions carrying each of
 * the selected tags.
 *
 * @param data - The chart data.
 * @param labels - The period labels.
 * @param kind - The signal kind.
 * @returns The descriptor.
 */
function signalBlock(
  data: ChartData,
  labels: string[],
  kind: 'risk' | 'quality',
): ChartBlockDescriptor {
  const palette = kind === 'risk' ? RISK_PALETTE : QUALITY_PALETTE;
  const noun = kind === 'risk' ? 'Risk flags' : 'Quality signals';
  const tally = data.tallies[kind];
  return {
    id: kind === 'risk' ? 'team-risk-per-period' : 'team-quality-per-period',
    title: `${noun} per period`,
    description: `Share of each period's contributions carrying each of the selected ${kind === 'risk' ? 'risk flags' : 'quality signals'}. Shares keep periods with more contributions comparable.`,
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
        data.signals[kind],
        data.team.map((point) => point.contributions),
      );
      const series: NamedSeries[] = shares.map((share) => ({
        name: share.key,
        data: share.values,
        color: signalColor(palette, tally, share.key),
      }));
      return groupedBarOption(labels, series, percentFormat);
    },
  };
}

/**
 * One flag-rate block (risk flags or quality signals): the average
 * number of flags per contribution, one bar per period.
 *
 * @param data - The chart data.
 * @param labels - The period labels.
 * @param kind - The signal kind.
 * @returns The descriptor.
 */
function rateBlock(
  data: ChartData,
  labels: string[],
  kind: 'risk' | 'quality',
): ChartBlockDescriptor {
  const noun = kind === 'risk' ? 'risk flags' : 'quality signals';
  const values = labels.map((_label, index) =>
    flagsPerContribution(data.signals[kind][index], data.team[index].contributions),
  );
  return {
    id: kind === 'risk' ? 'team-risk-rate' : 'team-quality-rate',
    title: `${kind === 'risk' ? 'Risk flags' : 'Quality signals'} per contribution`,
    description: `Average ${noun} per contribution per period — the flag density of the team's work over time.`,
    optionOf: () => barOption(labels, { name: 'Per contribution', data: values }, formatNumber),
  };
}

/**
 * The activity blocks of the LLM analysis: points and contributions
 * per period.
 *
 * @param data - The chart data.
 * @param labels - The period labels.
 * @returns The descriptors.
 */
export function buildLlmActivityBlocks(data: ChartData, labels: string[]): ChartBlockDescriptor[] {
  return [pointsBlock(data, labels), contributionsBlock(data, labels)];
}

/**
 * The nature-of-work blocks of the LLM analysis: contributions per
 * period stacked by work type, size, and complexity.
 *
 * @param data - The chart data.
 * @param labels - The period labels.
 * @returns The descriptors.
 */
export function buildLlmWorkBlocks(data: ChartData, labels: string[]): ChartBlockDescriptor[] {
  return [workTypesBlock(data, labels), sizesBlock(data, labels), complexityBlock(data, labels)];
}

/**
 * The signal blocks of the LLM analysis: the risk-flag and
 * quality-signal shares per period (full-width, tag-selectable) and
 * the per-period flag rates.
 *
 * @param data - The chart data.
 * @param labels - The period labels.
 * @returns The descriptors.
 */
export function buildLlmSignalBlocks(data: ChartData, labels: string[]): ChartBlockDescriptor[] {
  return [
    signalBlock(data, labels, 'risk'),
    signalBlock(data, labels, 'quality'),
    rateBlock(data, labels, 'risk'),
    rateBlock(data, labels, 'quality'),
  ];
}
