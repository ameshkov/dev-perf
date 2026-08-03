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
 * Payload schema of the `devperf_report` tool and the
 * token-usage schema of an LLM analysis, consumed by the LLM
 * layer (`src/llm/tools.ts`, `src/llm/session.ts`, `src/llm/analyze.ts`).
 */
export { llmToolPayloadSchema, tokenUsageSchema } from './schema.js';

/**
 * LLM analysis types consumed by the LLM layer (`src/llm/analyze.ts`,
 * `src/llm/session.ts`) and the pipeline (`src/pipeline.ts`).
 */
export type { LlmAnalysis, LlmToolPayload, TokenUsage } from './schema.js';
export type {
  DeterministicMetrics,
  LanguageContribution,
  Repository,
  RepositoryStats,
} from './schema.js';
export type { Report } from './schema.js';
