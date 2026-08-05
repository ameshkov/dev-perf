/**
 * The application version, read once from package.json at module
 * load. Single source for `--version`, the `version` command, and
 * the version line of every run's startup log block.
 */
import { createRequire } from 'node:module';

/** `require` scoped to this module so package.json resolves in `src/`
 * and `build/` alike. */
const require = createRequire(import.meta.url);

/**
 * The `version` field of package.json.
 */
export const appVersion: string = (require('../package.json') as { version: string }).version;
