/**
 * Minimal stderr logger: level-based
 * with no dependencies. Every line carries a millisecond timestamp;
 * scoped lines (per-repository progress) additionally carry a `[label]`
 * prefix so concurrent analysis of several repositories can be told
 * apart. Quiet by default — `error` and `warn` messages are always
 * printed; `--verbose` enables `info` (progress) and `debug`. Every
 * message goes to stderr; stdout carries nothing but the report JSON.
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
 * The leveled logging surface, optionally bound to a scope label.
 * `createScopedLog` produces it; the module-level `logError`/`logWarn`/
 * `logInfo`/`logDebug` functions are the unscoped global logger.
 */
export interface ScopedLog {
  /** Logs an error message. Always printed, even in quiet mode. */
  error(message: string): void;
  /** Logs a warning message. Always printed, even in quiet mode. */
  warn(message: string): void;
  /** Logs a progress message. Printed only when verbose is enabled. */
  info(message: string): void;
  /** Logs a debug message. Printed only when verbose is enabled. */
  debug(message: string): void;
}

/**
 * The current local time as `HH:mm:ss.SSS`, the timestamp prefix of
 * every log line.
 *
 * @returns The formatted timestamp.
 */
function timestamp(): string {
  const now = new Date();
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
}

/**
 * Writes one line to stderr: `[HH:mm:ss.SSS] [label] message` — the
 * scope label is omitted for unscoped (global) lines.
 *
 * @param scope - The scope label, or `undefined`/empty for the global
 * logger.
 * @param message - The message text; a trailing newline is appended.
 */
function writeLine(scope: string | undefined, message: string): void {
  const label = scope === undefined || scope === '' ? '' : ` [${scope}]`;
  process.stderr.write(`[${timestamp()}]${label} ${message}\n`);
}

/**
 * Creates a scoped logger whose lines carry `[label]` next to the
 * timestamp — used for per-repository progress so concurrent analyses
 * are distinguishable. Scope labels must be stable per run; the caller
 * computes them once (e.g. repo basenames in input order). Without a
 * label the scoped logger behaves exactly like the global one.
 *
 * @param label - The scope label shown in every line (optional).
 * @returns The scoped logger.
 */
export function createScopedLog(label?: string): ScopedLog {
  return {
    error: (message) => writeLine(label, message),
    warn: (message) => writeLine(label, message),
    info: (message) => {
      if (verbose) {
        writeLine(label, message);
      }
    },
    debug: (message) => {
      if (verbose) {
        writeLine(label, message);
      }
    },
  };
}

/**
 * Logs an error message. Always printed, even in quiet mode.
 *
 * @param message - The message to write to stderr.
 */
export function logError(message: string): void {
  writeLine(undefined, message);
}

/**
 * Logs a warning message. Always printed, even in quiet mode.
 *
 * @param message - The message to write to stderr.
 */
export function logWarn(message: string): void {
  writeLine(undefined, message);
}

/**
 * Logs a progress message. Printed only when verbose logging is enabled
 * (`--verbose`); hidden in quiet mode.
 *
 * @param message - The message to write to stderr.
 */
export function logInfo(message: string): void {
  if (verbose) {
    writeLine(undefined, message);
  }
}

/**
 * Logs a debug message. Printed only when verbose logging is enabled
 * (`--verbose`); hidden in quiet mode.
 *
 * @param message - The message to write to stderr.
 *
 * @internal Exported for tests only (`log.test.ts`); production code
 * uses the scoped `debug` method of `createScopedLog`. Not part of the
 * public module API.
 */
export function logDebug(message: string): void {
  if (verbose) {
    writeLine(undefined, message);
  }
}
