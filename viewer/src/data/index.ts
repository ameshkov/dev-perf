/**
 * Public API of the viewer's data layer: the extraction entry point
 * and the helpers, constants, formatters and types consumed by the
 * sections and components. External code imports from this barrel
 * only.
 */
export type { ChartData, CountRow, PeriodInfo, UserSeries } from './types.js';
export { COMPLEXITY_ORDER, SIZE_ORDER } from './constants.js';
export { countByKey, countContributionsByKey, weightedPointsOf } from './aggregate.js';
export { buildChartData } from './chart-data.js';
export type { ReportSelection } from './filter.js';
export {
  collectRepoOptions,
  collectUserOptions,
  filterReport,
  toggleScopedValue,
} from './filter.js';
export { flagsPerContribution, signalShareValues } from './signals.js';
export type { RepoChip } from './repo-label.js';
export { repoChips, repoLabel, repoName } from './repo-label.js';
export { formatCompact, formatDateTime, formatInt, formatNumber, formatRange } from './format.js';
