/**
 * Public API of the compile module: the `compile` command's
 * orchestration (`runCompile`) and its option resolution and
 * validation, consumed by the CLI command (`src/commands/compile.ts`).
 * External code imports from this barrel only.
 */
export { runCompile } from './compile.js';
export type { CompileResult } from './compile.js';
export { parseCompileOptions, resolveCompileOptions } from './options.js';
