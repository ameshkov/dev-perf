/**
 * Report schema — the single source of truth for the dev-perf report
 * document. The same schemas are reused verbatim by
 * the deterministic layer and the LLM structured-output tool schema, so
 * nothing can drift. `churn` is reserved for v2; `llm.status`
 * defaults to `"skipped"`.
 */
import { z } from 'zod';
import { repoSpecSchema } from '../repo/repo-spec.js';

/**
 * Per-language contribution counts: cloc-style counting
 * applied to the contributions, not the whole tree. Consumed by the
 * deterministic layer through the `LanguageContribution` type.
 *
 * @internal Exported for tests only; referenced by
 * `deterministicMetricsSchema` within the module. Not part of the
 * public module API.
 */
export const languageContributionSchema = z.object({
  /** Lines added in this language across the range. */
  linesAdded: z.number().int().nonnegative(),
  /** Lines removed in this language across the range. */
  linesRemoved: z.number().int().nonnegative(),
  /** Files touched (commit-file pairs) in this language. */
  filesTouched: z.number().int().nonnegative(),
});

/**
 * Per-language contribution counts; consumed by the
 * deterministic layer.
 */
export type LanguageContribution = z.infer<typeof languageContributionSchema>;

/**
 * Churn per file (v2): deletions by the author on files
 * they added earlier in the range — an approximation of rework. The
 * metric is not computed in v1; the field stays reserved.
 *
 * @internal Exported for tests only; the field is reserved for the v2
 * churn metric. Remove the tag when a production importer exists.
 */
export const churnSchema = z.record(z.string(), z.number().int().nonnegative());

/**
 * Churn per file (v2) — reserved, not computed in v1.
 *
 * @internal Exported for tests only; the field is reserved for the v2
 * churn metric. Remove the tag when a production importer exists.
 */
export type Churn = z.infer<typeof churnSchema>;

/**
 * Deterministic per-user metrics counted from git history;
 * consumed by the deterministic layer and the report
 * assembler through the `DeterministicMetrics` type.
 *
 * @internal Exported for tests only; referenced by `userSchema`
 * within the module. Not part of the public module API.
 */
export const deterministicMetricsSchema = z.object({
  /** Commits authored in the range, merges included. */
  commits: z.number().int().nonnegative(),
  /** Commits with at most one parent. */
  nonMergeCommits: z.number().int().nonnegative(),
  /** Commits with more than one parent. */
  mergeCommits: z.number().int().nonnegative(),
  /** Sum of numstat additions over the range. */
  linesAdded: z.number().int().nonnegative(),
  /** Sum of numstat deletions over the range. */
  linesRemoved: z.number().int().nonnegative(),
  /** Lines added minus lines removed. */
  netLines: z.number().int(),
  /** Commit-file pairs touched in the range. */
  filesTouched: z.number().int().nonnegative(),
  /** Distinct file paths touched in the range. */
  uniqueFilesTouched: z.number().int().nonnegative(),
  /** Distinct author dates (UTC, `YYYY-MM-DD`) with commits in the
   * range, sorted ascending. The active-days count is
   * `activeDays.length`; keeping the dates lets consumers compute the
   * exact union when repository specs alias the same repository. */
  activeDays: z.array(z.string()),
  /** Author date of the first commit in the range (ISO 8601, UTC). */
  firstCommitAt: z.string(),
  /** Author date of the last commit in the range (ISO 8601, UTC). */
  lastCommitAt: z.string(),
  /** Total added + removed lines per non-merge commit. */
  avgCommitSize: z.number().nonnegative(),
  /** Per-language contributions, keyed by language name. */
  languages: z.record(z.string(), languageContributionSchema),
  /**
   * Contributions of generated files — lock files, test snapshots,
   * minified/build artifacts — kept separate from `languages`, which
   * excludes them. Absent when the user touched no generated file.
   */
  generated: languageContributionSchema.optional(),
  /** Churn per file (v2, not computed in v1). */
  churn: churnSchema.optional(),
});

/**
 * Deterministic per-user metrics; consumed by the
 * deterministic layer and the report assembler.
 */
export type DeterministicMetrics = z.infer<typeof deterministicMetricsSchema>;

/**
 * Kind of change a contribution represents.
 *
 * @internal Exported for tests only; referenced by `contributionSchema`
 * within the module. Not part of the public module API.
 */
export const contributionTypeSchema = z.enum([
  'feature',
  'bugfix',
  'refactor',
  'test',
  'docs',
  'tooling',
  'chore',
  'security',
]);

/**
 * Kind of change a contribution represents.
 *
 * @internal Exported for tests only; no production importer (the
 * model-facing shapes are serialized from `llmToolPayloadSchema` in
 * `src/llm/tools.ts`). Not part of the public module API.
 */
export type ContributionType = z.infer<typeof contributionTypeSchema>;

/**
 * Observability quality signal of a contribution: anything positive the
 * change brings to the repository that can be seen in git history.
 *
 * @internal Exported for tests only; referenced by `contributionSchema`
 * within the module. Not part of the public module API.
 */
export const qualitySignalSchema = z.enum([
  'tests-added',
  'tests-updated',
  'test-coverage-expanded',
  'docs-added',
  'docs-updated',
  'changelog-updated',
  'migration-guide-added',
  'examples-added',
  'comments-added',
  'validation-added',
  'error-handling-added',
  'error-messages-improved',
  'logging-added',
  'observability-added',
  'performance-improved',
  'memory-usage-improved',
  'security-hardened',
  'deprecation-marked',
  'backwards-compatible',
  'code-reuse-improved',
  'naming-improved',
  'dead-code-removed',
  'accessibility-improved',
  'i18n-added',
  'benchmarks-added',
]);

/**
 * Observable quality signal of a contribution.
 *
 * @internal Exported for tests only; referenced by `contributionSchema`
 * within the module. Not part of the public module API.
 */
export type QualitySignal = z.infer<typeof qualitySignalSchema>;

/**
 * Observable risk flag of a contribution: anything that may bite later
 * and is visible in git history (review status, for instance, is not).
 *
 * @internal Exported for tests only; referenced by `contributionSchema`
 * within the module. Not part of the public module API.
 */
export const riskFlagSchema = z.enum([
  'no-tests',
  'snapshot-only-tests',
  'test-assertions-weak',
  'large-diff',
  'breaking-change',
  'api-changed-without-deprecation',
  'undocumented-public-api',
  'dead-code-introduced',
  'duplicated-logic',
  'commented-out-code',
  'leftover-debug-code',
  'temporary-workaround',
  'todo-left-behind',
  'unfinished-migration',
  'incomplete-error-handling',
  'silent-failure',
  'swallowed-errors',
  'unsafe-type-cast',
  'any-type-usage',
  'hardcoded-values',
  'magic-numbers',
  'hardcoded-secrets',
  'sensitive-data-logged',
  'config-changed-without-docs',
  'dependency-added',
  'dependency-removed',
  'generated-code-modified',
  'vendored-code-modified',
  'concurrency-risk',
  'performance-regression-risk',
  'memory-regression-risk',
  'touches-critical-path',
  'permissions-widened',
]);

/**
 * Observable risk flag of a contribution.
 *
 * @internal Exported for tests only; referenced by `contributionSchema`
 * within the module. Not part of the public module API.
 */
export type RiskFlag = z.infer<typeof riskFlagSchema>;

/**
 * Complexity level of a contribution.
 *
 * @internal Exported for tests only; referenced by `contributionSchema`
 * within the module. Not part of the public module API.
 */
export const complexitySchema = z.enum(['low', 'medium', 'high']);

/**
 * Complexity level of a contribution, derived from {@link
 * complexitySchema}.
 */
export type Complexity = z.infer<typeof complexitySchema>;

/**
 * Size level of a contribution (t-shirt sizing).
 *
 * @internal Exported for tests only; the compile layer consumes the
 * `ContributionSize` type, not the schema. Not part of the public
 * module API.
 */
export const contributionSizeSchema = z.enum(['xs', 's', 'm', 'l', 'xl']);

/**
 * Size level of a contribution (t-shirt sizing).
 */
export type ContributionSize = z.infer<typeof contributionSizeSchema>;

/**
 * One distinct contribution from a user's work in the range.
 * Field descriptions double as the model-facing
 * documentation: `llmToolPayloadSchema` serializes them into the
 * `devperf_report` tool's JSON schema, so the LLM sees
 * exactly what the report schema requires. The compile layer consumes
 * the `Contribution` type, not the schema.
 *
 * @internal Exported for tests only; referenced by `llmToolPayloadSchema`
 * within the module. Not part of the public module API.
 */
export const contributionSchema = z.object({
  /** Short name of the contribution. */
  title: z.string().describe('Short name of the contribution.'),
  /** What was done and how. */
  summary: z.string().describe('What was done and how.'),
  /** Kinds of change this contribution mixes. */
  types: z
    .array(contributionTypeSchema)
    .describe(
      'Kinds of change this contribution mixes: feature, bugfix, refactor, test, docs, tooling, chore, security.',
    ),
  /** Overall complexity of the contribution. */
  complexity: z
    .enum(['low', 'medium', 'high'])
    .describe('Overall complexity of the contribution: low, medium, or high.'),
  /** Why the complexity level was chosen. */
  complexityReasoning: z.string().describe('Why the complexity level was chosen.'),
  /** Overall size of the contribution (t-shirt sizing). */
  size: contributionSizeSchema.describe(
    'Overall size of the contribution (t-shirt sizing): xs, s, m, l, or xl.',
  ),
  /** Why the size level was chosen. */
  sizeReasoning: z.string().describe('Why the size level was chosen.'),
  /** Repo areas/directories touched by this contribution. */
  areas: z
    .array(z.string())
    .describe('Repository areas or directories touched by this contribution.'),
  /** Commit shas grouped into this contribution. */
  commits: z
    .array(z.string())
    .describe('Commit shas (full or abbreviated) grouped into this contribution.'),
  /** Observable quality signals from the fixed enum, e.g. tests added. */
  qualitySignals: z
    .array(qualitySignalSchema)
    .describe(
      'Observable quality signals from the fixed list (tests-added, docs-updated, ' +
        'test-coverage-expanded, ...); only what is observable in the repository.',
    ),
  /** Observable risk flags from the fixed enum, e.g. no tests. */
  riskFlags: z
    .array(riskFlagSchema)
    .describe(
      'Observable risk flags from the fixed list (no-tests, large-diff, breaking-change, ...); ' +
        'only what is observable in the repository, never inferred review status.',
    ),
});

/**
 * One distinct contribution from a user's work in the range; consumed
 * by the compile layer through the `Contribution` type.
 */
export type Contribution = z.infer<typeof contributionSchema>;

/**
 * Status of the LLM analysis for a user.
 *
 * @internal Exported for tests only; referenced by `llmAnalysisSchema`
 * within the module. Not part of the public module API.
 */
export const llmStatusSchema = z.enum(['completed', 'skipped', 'failed']);

/**
 * Status of the LLM analysis for a user.
 *
 * @internal Exported for tests only; referenced by `llmAnalysisSchema`
 * within the module. Not part of the public module API.
 */
export type LlmStatus = z.infer<typeof llmStatusSchema>;

/**
 * Token usage of an LLM analysis; consumed by the LLM
 * layer (`src/llm/analyze.ts`). The pi session reports
 * non-overlapping counts: `input` excludes the tokens served from the
 * prompt cache, which `cacheRead` carries separately (openai-compatible
 * providers subtract the cached tokens from the reported prompt tokens;
 * Anthropic reports them as separate fields). `cacheRead` defaults to 0
 * so reports written before cache tracking stay valid.
 */
export const tokenUsageSchema = z.object({
  /** Non-cached input tokens. */
  input: z.number().int().nonnegative(),
  /** Input tokens read from the prompt cache. */
  cacheRead: z.number().int().nonnegative().default(0),
  /** Output tokens. */
  output: z.number().int().nonnegative(),
});

/**
 * Token usage of an LLM analysis; consumed by the LLM
 * layer.
 */
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

/**
 * LLM-based analysis for one user. `status` defaults
 * to `"skipped"` so a deterministic-only report needs no explicit
 * LLM section.
 *
 * @internal Exported for tests only; referenced by `userSchema` within
 * the module. The inferred `LlmAnalysis` type is the production export.
 * Not part of the public module API.
 */
export const llmAnalysisSchema = z.object({
  /** Whether the analysis completed, was skipped, or failed. */
  status: llmStatusSchema.default('skipped'),
  /** 1-2 sentence summary of the user's work in the range. */
  overview: z.string().optional(),
  /** The user's changes split into distinct contributions. */
  contributions: z.array(contributionSchema).default([]),
  /** Token usage reported by the provider. */
  tokenUsage: tokenUsageSchema.optional(),
  /** Error message when the analysis failed. */
  error: z.string().optional(),
});

/**
 * LLM-based analysis for one user; consumed by the
 * report assembler and the LLM layer (`src/llm/analyze.ts`).
 */
export type LlmAnalysis = z.infer<typeof llmAnalysisSchema>;

/**
 * Payload the `devperf_report` tool accepts: the model's
 * analysis of one user — an optional overview and the changes split
 * into distinct contributions. Everything else in `llmAnalysisSchema`
 * (`status`, token usage, error) is produced by dev-perf itself, so
 * the model never sees it. `src/llm/tools.ts` derives the
 * `devperf_report` tool's parameter schema from this schema
 * (descriptions included), keeping the model-facing shape in lockstep
 * with the report schema.
 */
export const llmToolPayloadSchema = z.object({
  /** 1-2 sentences summarizing the user's work in the range. */
  overview: z
    .string()
    .describe("1-2 sentences summarizing the user's work in the analyzed range.")
    .optional(),
  /** The user's changes split into distinct contributions. */
  contributions: z
    .array(contributionSchema)
    .describe(
      "The user's changes split into a list of distinct contributions: one feature, one bug fix, one refactor, and so on. Changes of different complexity are reported as separate contributions rather than averaged into one description.",
    ),
});

/**
 * Payload the `devperf_report` tool accepts; consumed by
 * the LLM layer (`src/llm/analyze.ts`, `src/llm/session.ts`).
 */
export type LlmToolPayload = z.infer<typeof llmToolPayloadSchema>;

/**
 * One analyzed user of a repository; the inferred `User`
 * type is consumed by the report assembler.
 *
 * @internal Exported for tests only; referenced by `repositorySchema`
 * within the module. Not part of the public module API.
 */
export const userSchema = z.object({
  /** Display name: the most frequent author name for the email. */
  name: z.string(),
  /** Author emails grouped into this identity (lowercased). */
  emails: z.array(z.string()).min(1),
  /** Heuristic bot flag; bots are counted like everyone else. */
  isBot: z.boolean(),
  /** Metrics counted straight from git history. */
  deterministic: deterministicMetricsSchema,
  /** LLM-based assessment; skipped when LLM analysis is off. */
  llm: llmAnalysisSchema,
});

/**
 * One analyzed user of a repository; consumed by the
 * report assembler.
 */
export type User = z.infer<typeof userSchema>;

/**
 * One entry in the repository's top languages list.
 *
 * @internal Exported for tests only; referenced by
 * `repositoryStatsSchema` within the module. Not part of the public
 * module API.
 */
export const topLanguageSchema = z.object({
  /** Language name (mapped from the file extension). */
  language: z.string(),
  /** Lines added in this language across the range. */
  linesAdded: z.number().int().nonnegative(),
});

/**
 * One entry in the repository's top languages list.
 *
 * @internal Exported for tests only; referenced by
 * `repositoryStatsSchema` within the module. Not part of the public
 * module API.
 */
export type TopLanguage = z.infer<typeof topLanguageSchema>;

/**
 * Repository-level statistics; consumed by the
 * deterministic layer through the `RepositoryStats` type.
 *
 * @internal Exported for tests only; referenced by `repositorySchema`
 * within the module. Not part of the public module API.
 */
export const repositoryStatsSchema = z.object({
  /** Total commits in the range, merges included. */
  totalCommits: z.number().int().nonnegative(),
  /** Distinct users in the range. */
  totalUsers: z.number().int().nonnegative(),
  /** Top languages by lines added, best first. */
  topLanguages: z.array(topLanguageSchema),
  /**
   * Contribution of generated files — lock files, test snapshots,
   * minified/build artifacts — excluded from `topLanguages`. Absent
   * when no generated file was touched in the range.
   */
  generated: languageContributionSchema.optional(),
});

/**
 * Repository-level statistics; consumed by the
 * deterministic layer.
 */
export type RepositoryStats = z.infer<typeof repositoryStatsSchema>;

/**
 * The commits excluded from the analysis of one repository: full or
 * abbreviated hashes and/or case-insensitive message patterns, as
 * configured. Mirrors `IgnoreCommitsSpec`.
 *
 * @internal Exported for tests only; referenced by `repositorySchema`
 * within the module. Not part of the public module API.
 */
export const ignoredCommitsSchema = z.object({
  /** Full or abbreviated commit hashes excluded. */
  hashes: z.array(z.string()).optional(),
  /** Case-insensitive message patterns excluded. */
  messages: z.array(z.string()).optional(),
});

/**
 * One analyzed repository entry.
 *
 * @internal Exported for tests only; referenced by `reportSchema`
 * within the module. Not part of the public module API.
 */
export const repositorySchema = z.object({
  /** Repository URL or local path as given on the command line. */
  repo: z.string(),
  /** Path of the cloned repository inside the cache. */
  clonePath: z.string(),
  /** Branch the clone was checked out on. */
  branch: z.string(),
  /** The resolved base branch the analysis was scoped against
   * (branch-delta): the entry's commits are those not reachable from
   * it, when delta analysis was in effect. */
  baseBranch: z.string().optional(),
  /** Head commit sha of the clone. */
  head: z.string(),
  /** Gitignore-style paths excluded from the analysis of this
   * repository, when any were configured. */
  ignoredPaths: z.array(z.string()).optional(),
  /** Commits excluded from the analysis of this repository, when any
   * were configured — by hash and/or by message pattern. */
  ignoredCommits: ignoredCommitsSchema.optional(),
  /** Analyzed date range (author dates, UTC). */
  range: z.object({
    /** Start of the range. */
    since: z.string(),
    /** End of the range. */
    until: z.string(),
  }),
  /** Repository-level statistics. */
  stats: repositoryStatsSchema,
  /** Per-user analysis, one entry per distinct author. */
  users: z.array(userSchema),
});

/**
 * One analyzed repository entry; consumed by the report
 * assembler.
 */
export type Repository = z.infer<typeof repositorySchema>;

/**
 * One `parameters.repos` entry: the full spec of an analyzed
 * repository — the clone target plus its optional branch, the base the
 * analysis is scoped against, and the ignored paths and commits. The
 * entry schema reuses `repoSpecSchema` (the same validation as the
 * resolved config specs), and additionally accepts a legacy plain-string
 * entry — a bare clone target — from reports written before the spec
 * was recorded; both forms normalize to a spec, so the report type
 * always carries `RepoSpec[]`.
 */
const repoSpecEntrySchema = z.preprocess(
  (value) => (typeof value === 'string' ? { repo: value } : value),
  repoSpecSchema,
);

/**
 * Parameters of the analysis run that produced the report.
 *
 * @internal Exported for tests only; referenced by `reportSchema`
 * within the module. Not part of the public module API.
 */
export const parametersSchema = z.object({
  /** Repositories analyzed, as full specs — the clone target plus the
   * branch, base scoping, and ignored paths and commits used for the
   * analysis — in input order, one per analyzed entry. */
  repos: z.array(repoSpecEntrySchema).min(1),
  /** Start of the analyzed range (author date, UTC). */
  since: z.string(),
  /** End of the analyzed range (author date, UTC). */
  until: z.string(),
  /** Model used for LLM analysis; absent when LLM was disabled. */
  model: z.string().optional(),
  /** Whether LLM analysis was enabled for this run. */
  llmEnabled: z.boolean(),
});

/**
 * Parameters of the analysis run that produced the report.
 *
 * @internal Exported for tests only; referenced by `reportSchema`
 * within the module. Not part of the public module API.
 */
export type Parameters = z.infer<typeof parametersSchema>;

/**
 * The v1 dev-perf report document: parameters, repository entries, and
 * per-user analysis. Superseded by `trendReportSchema` (v3) in the
 * production pipeline; kept so the v1 shape stays covered by the
 * schema tests and the v1 assembler (`src/report/assemble.ts`).
 */
export const reportSchema = z.object({
  /** Schema version; 1 for the v1 report shape. */
  schemaVersion: z.literal(1),
  /** When the report was generated (ISO 8601, UTC). */
  generatedAt: z.string(),
  /** Parameters of the analysis run. */
  parameters: parametersSchema,
  /** One entry per analyzed repository. */
  repositories: z.array(repositorySchema),
});

/**
 * The v1 dev-perf report document; kept for the v1 assembler
 * (`src/report/assemble.ts`) and the schema tests.
 */
export type Report = z.infer<typeof reportSchema>;

/**
 * Period unit of a trend report: splits the analyzed range into
 * UTC-aligned periods of this size (day/week/month/quarter/year).
 */
export const periodUnitSchema = z.enum(['day', 'week', 'month', 'quarter', 'year']);

/**
 * Period unit of a trend report.
 */
export type PeriodUnit = z.infer<typeof periodUnitSchema>;

/**
 * One time-based period of a trend report: the period bounds and one
 * repository entry per analyzed repository, each restricted to the
 * period.
 *
 * @internal Exported for tests only; referenced by `trendReportSchema`
 * within the module. Not part of the public module API.
 */
export const periodReportSchema = z.object({
  /** Period start (UTC instant, inclusive; trimmed to the analyzed range). */
  since: z.string(),
  /** Period end (UTC instant, inclusive; trimmed to the analyzed range). */
  until: z.string(),
  /** One entry per analyzed repository, for this period only. */
  repositories: z.array(repositorySchema),
});

/**
 * The full trend report document (schema v3): parameters plus one
 * full per-repository report per time-based period. Without `--unit`,
 * a single period covers the whole analyzed range.
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

/**
 * The full trend report document (schema v2).
 */
export type TrendReport = z.infer<typeof trendReportSchema>;
