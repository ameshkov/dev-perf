/**
 * Report schema — the single source of truth for the dev-perf report
 * document (docs/design.md §7). The same schemas are reused verbatim by
 * the deterministic layer and the LLM structured-output tool schema, so
 * nothing can drift. `churn` is reserved for v2 (§5.2); `llm.status`
 * defaults to `"skipped"`.
 */
import { z } from 'zod';

/**
 * Per-language contribution counts (design §5.2): cloc-style counting
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
 * Per-language contribution counts (design §5.2); consumed by the
 * deterministic layer.
 */
export type LanguageContribution = z.infer<typeof languageContributionSchema>;

/**
 * Churn per file (design §5.2, v2): deletions by the author on files
 * they added earlier in the range — an approximation of rework. The
 * metric is not computed in v1; the field stays reserved.
 *
 * @internal Exported for tests only; the field is reserved for the v2
 * churn metric. Remove the tag when a production importer exists.
 */
export const churnSchema = z.record(z.string(), z.number().int().nonnegative());

/**
 * Churn per file (design §5.2, v2) — reserved, not computed in v1.
 *
 * @internal Exported for tests only; the field is reserved for the v2
 * churn metric. Remove the tag when a production importer exists.
 */
export type Churn = z.infer<typeof churnSchema>;

/**
 * Deterministic per-user metrics counted from git history
 * (design §5.2); consumed by the deterministic layer and the report
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
  /** Distinct author dates (UTC) with commits in the range. */
  activeDays: z.number().int().nonnegative(),
  /** Author date of the first commit in the range (ISO 8601, UTC). */
  firstCommitAt: z.string(),
  /** Author date of the last commit in the range (ISO 8601, UTC). */
  lastCommitAt: z.string(),
  /** Total added + removed lines per non-merge commit. */
  avgCommitSize: z.number().nonnegative(),
  /** Per-language contributions, keyed by language name. */
  languages: z.record(z.string(), languageContributionSchema),
  /** Churn per file (v2, not computed in v1). */
  churn: churnSchema.optional(),
});

/**
 * Deterministic per-user metrics (design §5.2); consumed by the
 * deterministic layer and the report assembler.
 */
export type DeterministicMetrics = z.infer<typeof deterministicMetricsSchema>;

/**
 * Kind of change a contribution represents (design §6.5).
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
 * Kind of change a contribution represents (design §6.5).
 *
 * @internal Exported for tests only; consumed by the LLM tool schema
 * (step 7) once it exists. Remove the tag when a production importer
 * exists.
 */
export type ContributionType = z.infer<typeof contributionTypeSchema>;

/**
 * Complexity level of a contribution (design §6.5).
 *
 * @internal Exported for tests only; referenced by `contributionSchema`
 * within the module. Not part of the public module API.
 */
export const complexitySchema = z.enum(['low', 'medium', 'high']);

/**
 * Complexity level of a contribution (design §6.5).
 *
 * @internal Exported for tests only; referenced by `contributionSchema`
 * within the module. Not part of the public module API.
 */
export type Complexity = z.infer<typeof complexitySchema>;

/**
 * One distinct contribution from a user's work in the range
 * (design §6.5). Field descriptions double as the model-facing
 * documentation: `llmToolPayloadSchema` serializes them into the
 * `devperf_report` tool's JSON schema (plan step 7), so the LLM sees
 * exactly what the report schema requires.
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
  /** Repo areas/directories touched by this contribution. */
  areas: z
    .array(z.string())
    .describe('Repository areas or directories touched by this contribution.'),
  /** Commit shas grouped into this contribution. */
  commits: z
    .array(z.string())
    .describe('Commit shas (full or abbreviated) grouped into this contribution.'),
  /** Observable quality signals, e.g. tests added, docs updated. */
  qualitySignals: z
    .array(z.string())
    .describe('Observable quality signals, e.g. tests added, docs updated.'),
  /** Observable risk flags, e.g. large change without tests. */
  riskFlags: z
    .array(z.string())
    .describe(
      'Observable risk flags, e.g. a large change without accompanying tests. Only what is observable in the repository.',
    ),
});

/**
 * One distinct contribution from a user's work in the range
 * (design §6.5).
 *
 * @internal Exported for tests only; consumed by the LLM tool schema
 * (step 7) once it exists. Remove the tag when a production importer
 * exists.
 */
export type Contribution = z.infer<typeof contributionSchema>;

/**
 * Status of the LLM analysis for a user (design §7).
 *
 * @internal Exported for tests only; consumed by the LLM layer
 * (steps 7-9) once it exists. Remove the tag when a production
 * importer exists.
 */
export const llmStatusSchema = z.enum(['completed', 'skipped', 'failed']);

/**
 * Status of the LLM analysis for a user (design §7).
 *
 * @internal Exported for tests only; consumed by the LLM layer
 * (steps 7-9) once it exists. Remove the tag when a production
 * importer exists.
 */
export type LlmStatus = z.infer<typeof llmStatusSchema>;

/**
 * Token usage of an LLM analysis (design §6.6).
 *
 * @internal Exported for tests only; consumed by the LLM layer
 * (steps 7-9) once it exists. Remove the tag when a production
 * importer exists.
 */
export const tokenUsageSchema = z.object({
  /** Input tokens. */
  input: z.number().int().nonnegative(),
  /** Output tokens. */
  output: z.number().int().nonnegative(),
});

/**
 * Token usage of an LLM analysis (design §6.6).
 *
 * @internal Exported for tests only; consumed by the LLM layer
 * (steps 7-9) once it exists. Remove the tag when a production
 * importer exists.
 */
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

/**
 * LLM-based analysis for one user (design §6.5, §7). `status` defaults
 * to `"skipped"` so a deterministic-only report needs no explicit
 * LLM section.
 *
 * @internal Exported for tests only; consumed by the LLM tool schema
 * (steps 7-9) once it exists. Remove the tag when a production
 * importer exists.
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
  /** Estimated cost of the analysis in USD. */
  estimatedCostUsd: z.number().nonnegative().optional(),
  /** Error message when the analysis failed. */
  error: z.string().optional(),
});

/**
 * LLM-based analysis for one user (design §6.5, §7).
 *
 * @internal Exported for tests only; consumed by the LLM tool schema
 * (steps 7-9) once it exists. Remove the tag when a production
 * importer exists.
 */
export type LlmAnalysis = z.infer<typeof llmAnalysisSchema>;

/**
 * Payload the `devperf_report` tool accepts (design §6.5): the model's
 * analysis of one user — an optional overview and the changes split
 * into distinct contributions. Everything else in `llmAnalysisSchema`
 * (`status`, token usage, cost, error) is produced by dev-perf itself,
 * so the model never sees it. `src/llm/tools.ts` serializes this schema
 * (descriptions included) into the generated tool's argument schema,
 * keeping the model-facing shape in lockstep with the report schema.
 *
 * @internal The sole production importer is `src/llm/tools.ts`, which
 * Knip excludes from analysis (`src/llm/**` in `knip.config.ts`
 * `ignoreFiles`, removed when the pipeline wires the LLM layer in plan
 * step 9), so the import does not register as usage. Remove the tag
 * when the pipeline lands.
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
 * Payload the `devperf_report` tool accepts (design §6.5).
 *
 * @internal Exported for tests only; the `llmToolPayloadSchema` const is
 * the production export (consumed by `src/llm/tools.ts`). Not part of
 * the public module API.
 */
export type LlmToolPayload = z.infer<typeof llmToolPayloadSchema>;

/**
 * One analyzed user of a repository (design §7); the inferred `User`
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
 * One analyzed user of a repository (design §7); consumed by the
 * report assembler.
 */
export type User = z.infer<typeof userSchema>;

/**
 * One entry in the repository's top languages list.
 *
 * @internal Exported for tests only; referenced by
 * `repositoryStatsSchema` within the module. Remove the tag when a
 * production importer exists.
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
 * `repositoryStatsSchema` within the module. Remove the tag when a
 * production importer exists.
 */
export type TopLanguage = z.infer<typeof topLanguageSchema>;

/**
 * Repository-level statistics (design §5.2); consumed by the
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
});

/**
 * Repository-level statistics (design §5.2); consumed by the
 * deterministic layer.
 */
export type RepositoryStats = z.infer<typeof repositoryStatsSchema>;

/**
 * One analyzed repository entry (design §7).
 *
 * @internal Exported for tests only; referenced by `reportSchema`
 * within the module. Remove the tag when a production importer
 * exists.
 */
export const repositorySchema = z.object({
  /** Repository URL or local path as given on the command line. */
  repo: z.string(),
  /** Path of the cloned repository inside the cache. */
  clonePath: z.string(),
  /** Branch the clone was checked out on. */
  branch: z.string(),
  /** Head commit sha of the clone. */
  head: z.string(),
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
 * One analyzed repository entry (design §7); consumed by the report
 * assembler.
 */
export type Repository = z.infer<typeof repositorySchema>;

/**
 * Parameters of the analysis run that produced the report (design §7).
 *
 * @internal Exported for tests only; referenced by `reportSchema`
 * within the module. Remove the tag when a production importer
 * exists.
 */
export const parametersSchema = z.object({
  /** Repositories analyzed, as given on the command line. */
  repos: z.array(z.string()).min(1),
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
 * Parameters of the analysis run that produced the report (design §7).
 *
 * @internal Exported for tests only; referenced by `reportSchema`
 * within the module. Remove the tag when a production importer
 * exists.
 */
export type Parameters = z.infer<typeof parametersSchema>;

/**
 * The full dev-perf report document (design §7): parameters,
 * repository entries, and per-user analysis. Exported through the
 * module barrel as the report module's public API.
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
 * The full dev-perf report document (design §7).
 */
export type Report = z.infer<typeof reportSchema>;
