/**
 * Public API of the report module: the report document and repository
 * entry types, the deterministic metrics types consumed by the
 * deterministic layer, the `devperf_report` tool payload schema, and
 * the assembler that builds report documents. External code imports
 * from this barrel only.
 */
export { assembleReport, assembleRepository } from './assemble.js';
export type { AnalyzedRange } from './assemble.js';

/**
 * Payload schema of the `devperf_report` tool (design §6.5), consumed
 * by the LLM layer (plan step 7).
 *
 * @internal The sole production importer is `src/llm/tools.ts`, which
 * Knip excludes from analysis (`src/llm/**` in `knip.config.ts`
 * `ignoreFiles`, removed when the pipeline wires the LLM layer in plan
 * step 9), so the import does not register as usage. Remove the tag
 * when the pipeline lands.
 */
export { llmToolPayloadSchema, tokenUsageSchema } from './schema.js';

/**
 * LLM analysis types consumed by the LLM layer (plan step 8:
 * `src/llm/session.ts` and `src/llm/analyze.ts`), which Knip excludes
 * from analysis (`src/llm/**` in `knip.config.ts` `ignoreFiles`,
 * removed when the pipeline wires the LLM layer in plan step 9), so
 * the imports do not register as usage. Remove the tag when the
 * pipeline lands.
 *
 * @internal Transitional until the pipeline lands (plan step 9).
 */
export type { LlmAnalysis, LlmToolPayload, TokenUsage } from './schema.js';
export type {
  DeterministicMetrics,
  LanguageContribution,
  Repository,
  RepositoryStats,
} from './schema.js';
export type { Report } from './schema.js';
