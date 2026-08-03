/**
 * Public API of the report module. Only `Report` is consumed by
 * production code today; the remaining schema exports are internal
 * (imported by tests directly) until the deterministic and LLM layers
 * land — they are then added to this barrel and their internal tags
 * are removed.
 */
export type { Report } from './schema.js';
