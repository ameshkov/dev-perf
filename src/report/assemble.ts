/**
 * Report assembly: builds the report document from
 * the deterministic analysis results. The assembler is pure — all git
 * access happens in the pipeline; here the report is constructed and
 * validated against the shared schema, so nothing can drift.
 */
import type { AuthorGroup } from '../deterministic/identity.js';
import { repoStats, userMetrics } from '../deterministic/metrics.js';
import { reportSchema, trendReportSchema } from './schema.js';
import type { LlmAnalysis, PeriodUnit, Report, Repository, TrendReport, User } from './schema.js';

/**
 * Analyzed author-date range as resolved UTC instants; the empty
 * string marks an unbounded side.
 */
export interface AnalyzedRange {
  /** Inclusive start of the range; `''` when unbounded. */
  since: string;
  /** Inclusive end of the range; `''` when unbounded. */
  until: string;
}

/** Everything the assembler needs for one repository entry. */
export interface RepositoryEntryInput {
  /** Repository URL or local path as given on the command line. */
  repo: string;
  /** Absolute path of the cloned repository inside the cache. */
  clonePath: string;
  /** Branch the clone was checked out on. */
  branch: string;
  /** Head commit sha of the clone. */
  head: string;
  /** Analyzed author-date range (UTC instants). */
  range: AnalyzedRange;
  /** Author groups of the range, one per user. */
  groups: AuthorGroup[];
  /**
   * LLM analyses keyed by lowercased author email, from the LLM phase;
   * users without a result get a skipped analysis.
   */
  llmResults?: ReadonlyMap<string, LlmAnalysis>;
}

/** Everything the v1 assembler needs for the report document. */
interface ReportInput {
  /** Repositories analyzed, as given on the command line. */
  repos: string[];
  /** Analyzed author-date range (UTC instants). */
  range: AnalyzedRange;
  /** Model used for LLM analysis; absent when LLM was disabled. */
  model?: string;
  /** Whether LLM analysis was enabled for this run. */
  llmEnabled: boolean;
  /** When the report was generated (ISO 8601, UTC). */
  generatedAt: string;
  /** Assembled repository entries. */
  repositories: Repository[];
}

/** Everything the trend assembler needs for one period. */
interface TrendPeriodInput {
  /** Period bounds (UTC instants, inclusive). */
  range: AnalyzedRange;
  /** Assembled repository entries of the period, one per repo. */
  repositories: Repository[];
}

/** Everything the trend assembler needs for the report document. */
export interface TrendReportInput {
  /** Repositories analyzed, as given on the command line. */
  repos: string[];
  /** Analyzed author-date range (UTC instants). */
  range: AnalyzedRange;
  /** Period unit the range was split into; absent without `--unit`. */
  unit?: PeriodUnit;
  /** Model used for LLM analysis; absent when LLM was disabled. */
  model?: string;
  /** Whether LLM analysis was enabled for this run. */
  llmEnabled: boolean;
  /** When the report was generated (ISO 8601, UTC). */
  generatedAt: string;
  /** One per-period repository list per period, oldest first. */
  periods: TrendPeriodInput[];
}

/**
 * Builds one repository entry: identity, analyzed range,
 * repository statistics, and one user entry per author group with
 * deterministic metrics and the user's LLM analysis — the completed
 * result when the LLM phase produced one, skipped otherwise. User
 * entries keep the group order (first-encounter order of the parsed
 * commits).
 *
 * @param input - Clone identity, range, author groups, and LLM results.
 * @returns The repository entry.
 */
export function assembleRepository(input: RepositoryEntryInput): Repository {
  return {
    repo: input.repo,
    clonePath: input.clonePath,
    branch: input.branch,
    head: input.head,
    range: input.range,
    stats: repoStats(input.groups),
    users: input.groups.map((group) => userEntry(group, input.llmResults)),
  };
}

/**
 * Builds the user entry for one author group: display
 * name, the grouped emails, bot flag, deterministic metrics, and the
 * LLM analysis — the completed result from the LLM phase when one
 * exists for the group's primary email, otherwise a skipped analysis.
 *
 * @param group - The author group.
 * @param llmResults - LLM analyses keyed by lowercased email, if the
 * LLM phase ran.
 * @returns The user entry.
 */
function userEntry(group: AuthorGroup, llmResults?: ReadonlyMap<string, LlmAnalysis>): User {
  return {
    name: group.name,
    emails: group.emails,
    isBot: group.isBot,
    deterministic: userMetrics(group.commits),
    llm: llmResults?.get(group.email) ?? { status: 'skipped', contributions: [] },
  };
}

/**
 * Builds the v1 report document: parameters, the
 * generated-at timestamp, and one entry per repository. The result is
 * validated against `reportSchema`, which applies defaults (e.g.
 * `llm.contributions`) — an invalid assembly fails here rather than at
 * the consumer.
 *
 * @param input - Run parameters and assembled repository entries.
 * @returns The validated v1 report document.
 * @throws {ZodError} When the assembled document does not validate.
 *
 * @internal Exported for tests only; the production pipeline assembles
 * `TrendReport` documents through `assembleTrendReport`. Not part of
 * the public module API.
 */
export function assembleReport(input: ReportInput): Report {
  return reportSchema.parse({
    schemaVersion: 1 as const,
    generatedAt: input.generatedAt,
    parameters: {
      repos: input.repos,
      since: input.range.since,
      until: input.range.until,
      // The model key stays absent (not `undefined`) when LLM analysis
      // was disabled, matching the JSON output.
      ...(input.model === undefined ? {} : { model: input.model }),
      llmEnabled: input.llmEnabled,
    },
    repositories: input.repositories,
  });
}

/**
 * Builds the trend report document (schema v2): parameters with the
 * optional period unit, the generated-at timestamp, and one full
 * per-repository report per period. The result is validated against
 * `trendReportSchema`, which applies defaults (e.g.
 * `llm.contributions`) — an invalid assembly fails here rather than at
 * the consumer.
 *
 * @param input - Run parameters and the per-period repository lists.
 * @returns The validated trend report document.
 * @throws {ZodError} When the assembled document does not validate.
 */
export function assembleTrendReport(input: TrendReportInput): TrendReport {
  return trendReportSchema.parse({
    schemaVersion: 2 as const,
    generatedAt: input.generatedAt,
    parameters: {
      repos: input.repos,
      since: input.range.since,
      until: input.range.until,
      // The model and unit keys stay absent (not `undefined`) when
      // unset, matching the JSON output.
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.unit === undefined ? {} : { unit: input.unit }),
      llmEnabled: input.llmEnabled,
    },
    periods: input.periods.map((period) => ({
      since: period.range.since,
      until: period.range.until,
      repositories: period.repositories,
    })),
  });
}
