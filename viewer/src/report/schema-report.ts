/**
 * Read-only port of the dev-perf report schema — report level types:
 * the analysis parameters, the v3 trend report (periods of repository
 * entries), and the legacy v1 report shape the viewer additionally
 * accepts. Mirrors `src/report/schema.ts` and `src/repo/repo-spec.ts`
 * in the parent CLI; kept in sync manually.
 */
import { z } from 'zod';
import { repositorySchema } from './schema.js';

/**
 * One analyzed repository's spec as recorded in the report: the clone
 * target plus the optional branch, base scoping, and ignored paths.
 * Accepts a legacy plain-string entry — a bare clone target — from
 * reports written before the spec was recorded; both forms normalize
 * to a spec.
 *
 * @internal Exported for tests only; referenced by `parametersSchema`
 * within the module. Not part of the public module API.
 */
export const repoSpecSchema = z.preprocess(
  (value) => (typeof value === 'string' ? { repo: value } : value),
  z.object({
    /** The clone target (URL or local path), as given. */
    repo: z.string().min(1),
    /** The branch analyzed, when one was in effect. */
    branch: z.string().optional(),
    /** The base branch the analysis was scoped against, if any. */
    base: z.string().optional(),
    /** Gitignore-style paths excluded from the analysis, when any. */
    ignore: z.array(z.string()).optional(),
  }),
);

/** One analyzed repository's spec as recorded in the report. */
export type RepoSpec = z.infer<typeof repoSpecSchema>;

/** Period unit of a trend report: day/week/month/quarter/year.
 *
 * @internal Exported for tests only; referenced by `trendReportSchema`
 * within the module. Not part of the public module API.
 */
export const periodUnitSchema = z.enum(['day', 'week', 'month', 'quarter', 'year']);

/** Period unit of a trend report. */
export type PeriodUnit = z.infer<typeof periodUnitSchema>;

/**
 * Parameters of the analysis run that produced the report.
 *
 * @internal Exported for tests only; referenced by the report schemas
 * within the module. Not part of the public module API.
 */
export const parametersSchema = z.object({
  /** Repositories analyzed, as full specs, in input order. */
  repos: z.array(repoSpecSchema).min(1),
  /** Start of the analyzed range (author date, UTC). */
  since: z.string(),
  /** End of the analyzed range (author date, UTC). */
  until: z.string(),
  /** Model used for LLM analysis; absent when LLM was disabled. */
  model: z.string().optional(),
  /** Whether LLM analysis was enabled for this run. */
  llmEnabled: z.boolean(),
});

/** Parameters of the analysis run that produced the report.
 *
 * @internal Exported for tests only; no production importer. Not part
 * of the public module API.
 */
export type Parameters = z.infer<typeof parametersSchema>;

/** One time-based period of a trend report.
 *
 * @internal Exported for tests only; referenced by `trendReportSchema`
 * within the module. Not part of the public module API.
 */
export const periodReportSchema = z.object({
  /** Period start (UTC instant, inclusive; trimmed to the range). */
  since: z.string(),
  /** Period end (UTC instant, inclusive; trimmed to the range). */
  until: z.string(),
  /** One entry per analyzed repository, for this period only. */
  repositories: z.array(repositorySchema),
});

/** One time-based period of a trend report. */
export type PeriodReport = z.infer<typeof periodReportSchema>;

/**
 * The full trend report document (schema v3): parameters plus one
 * per-repository report per time-based period. This is the shape the
 * current `dev-perf report` command writes.
 */
export const trendReportSchema = z.object({
  /** Schema version; 3 for the v3 trend report shape. */
  schemaVersion: z.literal(3),
  /** When the report was generated (ISO 8601, UTC). */
  generatedAt: z.string(),
  /** Parameters of the analysis run. */
  parameters: parametersSchema.extend({
    /** Period unit the range was split into; absent without `--unit`. */
    unit: periodUnitSchema.optional(),
  }),
  /** One per-period report per period, oldest first. */
  periods: z.array(periodReportSchema).min(1),
});

/** The full trend report document (schema v3). */
export type TrendReport = z.infer<typeof trendReportSchema>;

/**
 * The legacy v1 dev-perf report document: parameters, repository
 * entries and per-user analysis without periods. The viewer wraps it
 * into a single-period trend report (`v1ToTrendReport`).
 */
export const legacyReportSchema = z.object({
  /** Schema version; 1 for the v1 report shape. */
  schemaVersion: z.literal(1),
  /** When the report was generated (ISO 8601, UTC). */
  generatedAt: z.string(),
  /** Parameters of the analysis run. */
  parameters: parametersSchema,
  /** One entry per analyzed repository. */
  repositories: z.array(repositorySchema),
});

/** The legacy v1 dev-perf report document. */
export type LegacyReport = z.infer<typeof legacyReportSchema>;

/**
 * Wraps a legacy v1 report into a single-period trend report so the
 * viewer's data layer sees one shape: the whole analyzed range becomes
 * the only period, and the parameters carry no period unit.
 *
 * @param legacy - The validated v1 report.
 * @returns The equivalent single-period trend report.
 */
export function v1ToTrendReport(legacy: LegacyReport): TrendReport {
  return {
    schemaVersion: 3,
    generatedAt: legacy.generatedAt,
    parameters: { ...legacy.parameters },
    periods: [
      {
        since: legacy.parameters.since,
        until: legacy.parameters.until,
        repositories: legacy.repositories,
      },
    ],
  };
}
