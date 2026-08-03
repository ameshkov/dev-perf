/**
 * Minimal stderr logger: level-based
 * with no dependencies. Quiet by default — `error` and `warn` messages
 * are always printed; `--verbose` enables `info` (progress) and
 * `debug`. Every message goes to stderr; stdout carries nothing but
 * the report JSON.
 */

/**
 * Whether verbose levels (`info`, `debug`) are enabled. Module-level
 * state, set once per invocation from the `--verbose` CLI option by the
 * pipeline.
 */
let verbose = false;

/**
 * Enables or disables verbose logging for this process.
 *
 * @param enabled - True to print `info` and `debug` messages; false for
 * quiet mode (errors and warnings only).
 */
export function setVerbose(enabled: boolean): void {
  verbose = enabled;
}

/**
 * Writes one line to stderr.
 *
 * @param message - The message text; a trailing newline is appended.
 */
function writeLine(message: string): void {
  process.stderr.write(`${message}\n`);
}

/**
 * Logs an error message. Always printed, even in quiet mode.
 *
 * @param message - The message to write to stderr.
 */
export function logError(message: string): void {
  writeLine(message);
}

/**
 * Logs a warning message. Always printed, even in quiet mode.
 *
 * @param message - The message to write to stderr.
 */
export function logWarn(message: string): void {
  writeLine(message);
}

/**
 * Logs a progress message. Printed only when verbose logging is enabled
 * (`--verbose`); hidden in quiet mode.
 *
 * @param message - The message to write to stderr.
 */
export function logInfo(message: string): void {
  if (verbose) {
    writeLine(message);
  }
}

/**
 * Logs a debug message. Printed only when verbose logging is enabled
 * (`--verbose`); hidden in quiet mode.
 *
 * @param message - The message to write to stderr.
 */
export function logDebug(message: string): void {
  if (verbose) {
    writeLine(message);
  }
}
