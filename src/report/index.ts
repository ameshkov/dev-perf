/**
 * Public API of the report module: the trend report document (v2) and
 * its period/repository entry types, the deterministic metrics types
 * consumed by the deterministic layer, the `devperf_report` tool
 * payload schema, and the assembler that builds report documents.
 * External code imports from this barrel only.
 */
export { assembleRepository, assembleTrendReport } from './assemble.js';
export type { AnalyzedRange } from './assemble.js';

/**
 * Payload schema of the `devperf_report` tool, the token-usage schema
 * of an LLM analysis, and the period-unit enum — consumed by the LLM
 * layer (`src/llm/tools.ts`, `src/llm/session.ts`, `src/llm/analyze.ts`)
 * and the CLI option validation (`src/config.ts`).
 */
export { llmToolPayloadSchema, periodUnitSchema, tokenUsageSchema } from './schema.js';

/**
 * LLM analysis types consumed by the LLM layer (`src/llm/analyze.ts`,
 * `src/llm/session.ts`) and the pipeline (`src/pipeline.ts`).
 */
export type { LlmAnalysis, LlmToolPayload, TokenUsage } from './schema.js';
export type {
  DeterministicMetrics,
  LanguageContribution,
  PeriodUnit,
  Repository,
  RepositoryStats,
  TrendReport,
} from './schema.js';
