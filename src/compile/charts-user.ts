/**
 * The per-user charts of the `compile` command: points and
 * contributions per period with LLM analysis (including the
 * per-period risk-flag and quality-signal charts) and the LLM
 * whole-range distributions; the deterministic per-user charts live
 * in `charts-user-deterministic.ts`. Per-period charts are skipped
 * for single-period reports; the LLM-based charts only with LLM
 * analysis.
 */
import type { Contribution, ContributionSize } from '../report/index.js';
import { countByKey, countContributionsByKey } from './aggregate.js';
import type { ChartData, UserSeries } from './chart-data.js';
import { COMPLEXITY_ORDER, SIZE_ORDER } from './chart-data.js';
import {
  barLineRows,
  flagsPerContribution,
  signalShareRows,
  stackedRows,
  topWithOther,
  userSlug,
} from './chart-util.js';
import type { ChartAsset } from './chart-util.js';
import { deterministicUserCharts } from './charts-user-deterministic.js';
import type { ChartRow } from './vega.js';
import {
  barLineSpec,
  barSpec,
  groupedBarSpec,
  horizontalBarSpec,
  pieSpec,
  stackedBarSpec,
} from './vega.js';

/** The number of top signals kept in the per-user signal charts, rest
 * as `other`. */
const TOP_SIGNALS = 5;

/** The signal kinds of the per-user signal charts, with their labels. */
const SIGNAL_KINDS = [
  { kind: 'risk', noun: 'flags', name: 'risk flags' },
  { kind: 'quality', noun: 'signals', name: 'quality signals' },
] as const;

/** The signal extractor of one kind. */
function signalExtract(kind: 'risk' | 'quality'): (contribution: Contribution) => string[] {
  return kind === 'risk'
    ? (contribution) => contribution.riskFlags
    : (contribution) => contribution.qualitySignals;
}

/**
 * The contribution size rows of one user across the whole report.
 *
 * @param series - The user's series.
 * @returns The rows, one per size.
 */
function userSizeRows(series: UserSeries): ChartRow[] {
  return SIZE_ORDER.map((size) => ({
    x: size,
    key: size,
    value: series.points.reduce((sum, point) => sum + point.sizes[size], 0),
  }));
}

/**
 * The contribution complexity rows of one user across the whole
 * report.
 *
 * @param series - The user's series.
 * @returns The rows, one per complexity level.
 */
function userComplexityRows(series: UserSeries): ChartRow[] {
  return COMPLEXITY_ORDER.map((level) => ({
    x: level,
    key: level,
    value: series.points.reduce((sum, point) => sum + (point.complexity[level] ?? 0), 0),
  }));
}

/**
 * The per-period signal-share charts of one user: the risk flags and
 * quality signals per period, normalized to the share of the user's
 * contributions — the per-user counterparts of the team signal charts.
 * The top signals are the user's own most frequent categories of the
 * whole report.
 *
 * @param series - The user's series.
 * @param charts - The chart list to append to.
 * @param labels - The period labels.
 * @param slug - The user's file-name slug.
 */
function signalUserCharts(
  series: UserSeries,
  charts: ChartAsset[],
  labels: string[],
  slug: string,
): void {
  for (const { kind, noun, name } of SIGNAL_KINDS) {
    const keys = topWithOther(
      countContributionsByKey(signalExtract(kind), series.user.llm.contributions),
      TOP_SIGNALS,
    ).map((row) => row.key);
    const rows = signalShareRows(
      labels,
      keys,
      series.signals[kind],
      series.points.map((point) => point.contributions),
    );
    charts.push({
      file: `${slug}-${kind}-per-period.svg`,
      caption: `${kind === 'risk' ? 'Risk flags' : 'Quality signals'} per period — share of contributions (top ${TOP_SIGNALS} ${noun} plus other).`,
      spec: groupedBarSpec(
        `${series.user.name} — ${name} per period`,
        labels,
        keys,
        rows,
        '% of contributions',
        kind === 'risk' ? 'Risk flag' : 'Quality signal',
      ),
    });
  }
}

/**
 * The per-period signal-rate charts of one user: the average number of
 * flags per contribution of each period, one bar per period, so the
 * flag density of the user's work is visible period by period.
 *
 * @param series - The user's series.
 * @param charts - The chart list to append to.
 * @param labels - The period labels.
 * @param slug - The user's file-name slug.
 */
function signalRateUserCharts(
  series: UserSeries,
  charts: ChartAsset[],
  labels: string[],
  slug: string,
): void {
  for (const { kind, name } of SIGNAL_KINDS) {
    charts.push({
      file: `${slug}-${kind}-per-contribution.svg`,
      caption: `Average ${name} per contribution per period.`,
      spec: barSpec(
        `${series.user.name} — ${name} per contribution`,
        labels,
        labels.map((label, index) => ({
          x: label,
          key: label,
          value: flagsPerContribution(
            series.signals[kind][index],
            series.points[index].contributions,
          ),
        })),
        'Per contribution',
      ),
    });
  }
}

/**
 * The stacked work-type chart of one user: contributions per period
 * divided into one segment per work type, in the user's own work-type
 * order. Multi-type contributions count in each of their types.
 *
 * @param series - The user's series.
 * @param labels - The period labels.
 * @param slug - The user's file-name slug.
 * @returns The chart asset.
 */
function workTypesPerPeriodChart(series: UserSeries, labels: string[], slug: string): ChartAsset {
  const keys = countByKey((contribution) => contribution.types, series.user.llm.contributions).map(
    (row) => row.key,
  );
  return {
    file: `${slug}-work-types-per-period.svg`,
    caption: 'Contributions per period, stacked by work type (a contribution may mix types).',
    spec: stackedBarSpec(
      `${series.user.name} — work types per period`,
      labels,
      keys,
      stackedRows(labels, keys, (key, index) => series.points[index].workTypes[key] ?? 0),
      'Contributions',
      'Work type',
    ),
  };
}

/**
 * The work-type pie of one user: the share of the user's contributions
 * per work type over the whole range.
 *
 * @param series - The user's series.
 * @param slug - The user's file-name slug.
 * @returns The chart asset.
 */
function workTypesPieChart(series: UserSeries, slug: string): ChartAsset {
  return {
    file: `${slug}-work-types.svg`,
    caption: 'Share of contributions by work type (a contribution may mix types).',
    spec: pieSpec(
      `${series.user.name} — work types`,
      countByKey((contribution) => contribution.types, series.user.llm.contributions).map(
        (row) => ({ x: row.key, key: row.key, value: row.value }),
      ),
      'Type',
    ),
  };
}

/**
 * The contributions-with-cumulative-line chart of one user: the LLM
 * counterpart of the commits chart.
 *
 * @param series - The user's series.
 * @param labels - The period labels.
 * @param slug - The user's file-name slug.
 * @returns The chart asset.
 */
function contributionsCumulativeChart(
  series: UserSeries,
  labels: string[],
  slug: string,
): ChartAsset {
  return {
    file: `${slug}-contributions-and-cumulative-per-period.svg`,
    caption: 'Contributions per period (bars) and cumulative contributions (line).',
    spec: barLineSpec(
      `${series.user.name} — contributions per period`,
      labels,
      barLineRows(
        labels,
        series.points.map((point) => point.contributions),
        series.points.map((point) => point.cumulativeContributions),
      ),
      'Contributions',
    ),
  };
}

/**
 * The points chart of one user: the size- and complexity-weighted
 * contribution points per period, the lead chart of the user's LLM
 * dynamics.
 *
 * @param series - The user's series.
 * @param labels - The period labels.
 * @param slug - The user's file-name slug.
 * @returns The chart asset.
 */
function pointsChart(series: UserSeries, labels: string[], slug: string): ChartAsset {
  return {
    file: `${slug}-points-per-period.svg`,
    caption: 'Points per period (size × complexity).',
    spec: barSpec(
      `${series.user.name} — points per period`,
      labels,
      labels.map((label, index) => ({
        x: label,
        key: label,
        value: series.points[index].weightedPoints,
      })),
      'Points',
    ),
  };
}

/**
 * The per-period LLM-based charts of one user: points per period,
 * contributions per period stacked by size, complexity and work type,
 * contributions with the cumulative line, plus the per-period
 * risk-flag and quality-signal charts.
 *
 * @param series - The user's series.
 * @param charts - The chart list to append to.
 * @param labels - The period labels.
 * @param slug - The user's file-name slug.
 */
function periodUserCharts(
  series: UserSeries,
  charts: ChartAsset[],
  labels: string[],
  slug: string,
): void {
  charts.push(pointsChart(series, labels, slug));
  charts.push({
    file: `${slug}-contributions-per-period.svg`,
    caption: 'Contributions per period, stacked by size (xs–xl).',
    spec: stackedBarSpec(
      `${series.user.name} — contributions per period`,
      labels,
      SIZE_ORDER,
      stackedRows(labels, SIZE_ORDER, (key, index) => {
        const size = key as ContributionSize;
        return series.points[index].sizes[size];
      }),
      'Contributions',
      'Size',
    ),
  });
  charts.push({
    file: `${slug}-contributions-by-complexity-per-period.svg`,
    caption: 'Contributions per period, stacked by complexity (low–high).',
    spec: stackedBarSpec(
      `${series.user.name} — contributions by complexity per period`,
      labels,
      COMPLEXITY_ORDER,
      stackedRows(labels, COMPLEXITY_ORDER, (key, index) => {
        return series.points[index].complexity[key] ?? 0;
      }),
      'Contributions',
      'Complexity',
    ),
  });
  charts.push(workTypesPerPeriodChart(series, labels, slug));
  charts.push(contributionsCumulativeChart(series, labels, slug));
  signalUserCharts(series, charts, labels, slug);
  signalRateUserCharts(series, charts, labels, slug);
}

/**
 * The LLM-based per-user charts: the per-period charts when the report
 * has more than one period, contribution sizes and the work-type share
 * over the whole range, and the complexity distribution.
 *
 * @param series - The user's series.
 * @param charts - The chart list to append to.
 * @param labels - The period labels.
 * @param slug - The user's file-name slug.
 * @param multiPeriod - Whether the report has more than one period.
 */
function llmUserCharts(
  series: UserSeries,
  charts: ChartAsset[],
  labels: string[],
  slug: string,
  multiPeriod: boolean,
): void {
  if (multiPeriod) {
    periodUserCharts(series, charts, labels, slug);
  }
  charts.push({
    file: `${slug}-contributions-by-size.svg`,
    caption: 'Contribution sizes over the whole range.',
    spec: horizontalBarSpec(
      `${series.user.name} — contributions by size`,
      SIZE_ORDER,
      userSizeRows(series),
      'Contributions',
    ),
  });
  charts.push({
    file: `${slug}-contributions-by-complexity.svg`,
    caption: 'Complexity distribution over the whole range.',
    spec: horizontalBarSpec(
      `${series.user.name} — contributions by complexity`,
      COMPLEXITY_ORDER,
      userComplexityRows(series),
      'Contributions',
    ),
  });
  charts.push(workTypesPieChart(series, slug));
}

/**
 * The per-user dynamics charts of the report, in master user order:
 * the LLM-based pair first, then the deterministic set.
 *
 * @param data - The chart data.
 * @param charts - The chart list to append to.
 * @param labels - The period labels.
 * @param multiPeriod - Whether the report has more than one period.
 */
export function userCharts(
  data: ChartData,
  charts: ChartAsset[],
  labels: string[],
  multiPeriod: boolean,
): void {
  for (const series of data.users) {
    const slug = userSlug(series.user.name);
    if (data.parameters.llmEnabled) {
      llmUserCharts(series, charts, labels, slug, multiPeriod);
    }
    if (multiPeriod) {
      deterministicUserCharts(series, data, charts, labels, slug);
    }
  }
}
