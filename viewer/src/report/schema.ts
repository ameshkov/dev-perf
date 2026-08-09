/**
 * Read-only port of the dev-perf report schema — user and repository
 * level types: contribution metadata, deterministic metrics, the LLM
 * analysis, and repository entries. Mirrors `src/report/schema.ts` in
 * the parent CLI (the single source of truth); kept in sync manually
 * — the viewer never writes reports, so only the reading side is
 * ported and optional fields default the same way.
 */
import { z } from 'zod';

/** Kind of change a contribution represents.
 *
 * @internal Exported for schema composition and tests only; not part
 * of the public module API.
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

/** Kind of change a contribution represents. */
export type ContributionType = z.infer<typeof contributionTypeSchema>;

/** Observable quality signal of a contribution.
 *
 * @internal Exported for schema composition and tests only; not part
 * of the public module API.
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

/** Observable quality signal of a contribution.
 *
 * @internal Exported for tests only; no production importer. Not part
 * of the public module API.
 */
export type QualitySignal = z.infer<typeof qualitySignalSchema>;

/** Observable risk flag of a contribution.
 *
 * @internal Exported for schema composition and tests only; not part
 * of the public module API.
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

/** Observable risk flag of a contribution.
 *
 * @internal Exported for tests only; no production importer. Not part
 * of the public module API.
 */
export type RiskFlag = z.infer<typeof riskFlagSchema>;

/** Complexity level of a contribution.
 *
 * @internal Exported for schema composition and tests only; not part
 * of the public module API.
 */
export const complexitySchema = z.enum(['low', 'medium', 'high']);

/** Complexity level of a contribution. */
export type Complexity = z.infer<typeof complexitySchema>;

/** Size level of a contribution (t-shirt sizing).
 *
 * @internal Exported for schema composition and tests only; not part
 * of the public module API.
 */
export const contributionSizeSchema = z.enum(['xs', 's', 'm', 'l', 'xl']);

/** Size level of a contribution (t-shirt sizing). */
export type ContributionSize = z.infer<typeof contributionSizeSchema>;

/**
 * One distinct contribution from a user's work in the range. Only the
 * fields the viewer renders are described; the shape is identical to
 * the parent CLI's `contributionSchema`.
 *
 * @internal Exported for schema composition and tests only; not part
 * of the public module API.
 */
export const contributionSchema = z.object({
  /** Short name of the contribution. */
  title: z.string(),
  /** What was done and how. */
  summary: z.string(),
  /** Kinds of change this contribution mixes. */
  types: z.array(contributionTypeSchema),
  /** Overall complexity of the contribution. */
  complexity: complexitySchema,
  /** Why the complexity level was chosen. */
  complexityReasoning: z.string(),
  /** Overall size of the contribution (t-shirt sizing). */
  size: contributionSizeSchema,
  /** Why the size level was chosen. */
  sizeReasoning: z.string(),
  /** Repo areas/directories touched by this contribution. */
  areas: z.array(z.string()),
  /** Commit shas grouped into this contribution. */
  commits: z.array(z.string()),
  /** Observable quality signals from the fixed enum. */
  qualitySignals: z.array(qualitySignalSchema),
  /** Observable risk flags from the fixed enum. */
  riskFlags: z.array(riskFlagSchema),
});

/** One distinct contribution from a user's work in the range. */
export type Contribution = z.infer<typeof contributionSchema>;

/** Per-language contribution counts.
 *
 * @internal Exported for schema composition and tests only; not part
 * of the public module API.
 */
export const languageContributionSchema = z.object({
  /** Lines added in this language across the range. */
  linesAdded: z.number().int().nonnegative(),
  /** Lines removed in this language across the range. */
  linesRemoved: z.number().int().nonnegative(),
  /** Files touched (commit-file pairs) in this language. */
  filesTouched: z.number().int().nonnegative(),
});

/** Per-language contribution counts. */
export type LanguageContribution = z.infer<typeof languageContributionSchema>;

/** Deterministic per-user metrics counted from git history.
 *
 * @internal Exported for schema composition and tests only; not part
 * of the public module API.
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
  /** Distinct author dates (UTC, `YYYY-MM-DD`) with commits. */
  activeDays: z.array(z.string()),
  /** Author date of the first commit in the range (ISO 8601, UTC). */
  firstCommitAt: z.string(),
  /** Author date of the last commit in the range (ISO 8601, UTC). */
  lastCommitAt: z.string(),
  /** Total added + removed lines per non-merge commit. */
  avgCommitSize: z.number().nonnegative(),
  /** Per-language contributions, keyed by language name. */
  languages: z.record(z.string(), languageContributionSchema),
});

/** Deterministic per-user metrics counted from git history. */
export type DeterministicMetrics = z.infer<typeof deterministicMetricsSchema>;

/** Status of the LLM analysis for a user.
 *
 * @internal Exported for schema composition and tests only; not part
 * of the public module API.
 */
export const llmStatusSchema = z.enum(['completed', 'skipped', 'failed']);

/** Status of the LLM analysis for a user.
 *
 * @internal Exported for tests only; no production importer. Not part
 * of the public module API.
 */
export type LlmStatus = z.infer<typeof llmStatusSchema>;

/** Token usage of an LLM analysis.
 *
 * @internal Exported for schema composition and tests only; not part
 * of the public module API.
 */
export const tokenUsageSchema = z.object({
  /** Non-cached input tokens. */
  input: z.number().int().nonnegative(),
  /** Input tokens read from the prompt cache. */
  cacheRead: z.number().int().nonnegative().default(0),
  /** Output tokens. */
  output: z.number().int().nonnegative(),
});

/** Token usage of an LLM analysis. */
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

/**
 * LLM-based analysis for one user. `status` defaults to `"skipped"`
 * so a deterministic-only report needs no explicit LLM section.
 *
 * @internal Exported for schema composition and tests only; not part
 * of the public module API.
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

/** LLM-based analysis for one user. */
export type LlmAnalysis = z.infer<typeof llmAnalysisSchema>;

/** One analyzed user of a repository.
 *
 * @internal Exported for schema composition and tests only; not part
 * of the public module API.
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

/** One analyzed user of a repository. */
export type User = z.infer<typeof userSchema>;

/** One entry in the repository's top languages list.
 *
 * @internal Exported for schema composition and tests only; not part
 * of the public module API.
 */
export const topLanguageSchema = z.object({
  /** Language name (mapped from the file extension). */
  language: z.string(),
  /** Lines added in this language across the range. */
  linesAdded: z.number().int().nonnegative(),
});

/** Repository-level statistics of one repository entry.
 *
 * @internal Exported for schema composition and tests only; not part
 * of the public module API.
 */
export const repositoryStatsSchema = z.object({
  /** Total commits in the range, merges included. */
  totalCommits: z.number().int().nonnegative(),
  /** Distinct users in the range. */
  totalUsers: z.number().int().nonnegative(),
  /** Top languages by lines added, best first. */
  topLanguages: z.array(topLanguageSchema),
});

/** One analyzed repository entry. */
export const repositorySchema = z.object({
  /** Repository URL or local path as given on the command line. */
  repo: z.string(),
  /** Path of the cloned repository inside the cache. */
  clonePath: z.string(),
  /** Branch the clone was checked out on. */
  branch: z.string(),
  /** The resolved base branch the analysis was scoped against. */
  baseBranch: z.string().optional(),
  /** Head commit sha of the clone. */
  head: z.string(),
  /** Gitignore-style paths excluded from the analysis. */
  ignoredPaths: z.array(z.string()).optional(),
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

/** One analyzed repository entry. */
export type Repository = z.infer<typeof repositorySchema>;
