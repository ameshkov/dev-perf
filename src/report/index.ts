/**
 * Public API of the report module. `Report` is the report document;
 * the deterministic layer (plan step 4) consumes the metrics,
 * language-contribution, and repo-stats types through the barrel.
 * Those three are tagged as internal JSDoc while `src/deterministic/**`
 * is excluded from Knip analysis (`knip.config.ts` `ignoreFiles`);
 * the tags are removed when the pipeline lands (plan step 5). The
 * remaining schema exports stay internal (imported by tests directly)
 * until the LLM layer and the report assembler land.
 */
export type { Report } from './schema.js';

/**
 * Deterministic per-user metrics (design §5.2), consumed by the
 * deterministic layer (plan step 4).
 *
 * @internal The deterministic layer is excluded from Knip analysis
 * (`src/deterministic/**` in `knip.config.ts` `ignoreFiles`, removed
 * when the pipeline lands in plan step 5), so its imports do not
 * register as usage. Remove the tag when the pipeline wires the
 * layer.
 */
export type { DeterministicMetrics } from './schema.js';

/**
 * Per-language contribution counts (design §5.2), consumed by the
 * deterministic layer (plan step 4).
 *
 * @internal The deterministic layer is excluded from Knip analysis
 * (`src/deterministic/**` in `knip.config.ts` `ignoreFiles`, removed
 * when the pipeline lands in plan step 5), so its imports do not
 * register as usage. Remove the tag when the pipeline wires the
 * layer.
 */
export type { LanguageContribution } from './schema.js';

/**
 * Repository-level statistics (design §5.2), consumed by the
 * deterministic layer (plan step 4).
 *
 * @internal The deterministic layer is excluded from Knip analysis
 * (`src/deterministic/**` in `knip.config.ts` `ignoreFiles`, removed
 * when the pipeline lands in plan step 5), so its imports do not
 * register as usage. Remove the tag when the pipeline wires the
 * layer.
 */
export type { RepositoryStats } from './schema.js';
