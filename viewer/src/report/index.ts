/**
 * Public API of the viewer's report layer: the loader that validates
 * uploaded files and the report types consumed by the data layer and
 * the UI. External code imports from this barrel only.
 */
export { parseReportText } from './load.js';
export type {
  Complexity,
  Contribution,
  ContributionSize,
  ContributionType,
  DeterministicMetrics,
  LanguageContribution,
  LlmAnalysis,
  Repository,
  TokenUsage,
  User,
} from './schema.js';
export type { PeriodReport, PeriodUnit, RepoSpec, TrendReport } from './schema-report.js';
