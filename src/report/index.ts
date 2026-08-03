/**
 * Public API of the report module: the report document and repository
 * entry types, the deterministic metrics types consumed by the
 * deterministic layer, and the assembler that builds report documents.
 * External code imports from this barrel only.
 */
export { assembleReport, assembleRepository } from './assemble.js';
export type { AnalyzedRange } from './assemble.js';
export type {
  DeterministicMetrics,
  LanguageContribution,
  Repository,
  RepositoryStats,
} from './schema.js';
export type { Report } from './schema.js';
