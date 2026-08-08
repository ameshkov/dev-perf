/**
 * Minimal stderr logger: level-based
 * with no dependencies. Every line is `[HH:mm:ss.SSS] [LEVEL]
 * [label] message` — the standard log format, so a redirected log
 * file (`2>run.log`) gets full syntax highlighting in editors that
 * understand it (e.g. VS Code's Log mode). The millisecond timestamp
 * prefixes every line; the `[LEVEL]` tag (`[ERROR]`, `[WARN]`,
 * `[INFO]`, `[DEBUG]`) carries the severity; scoped lines
 * (per-repository progress) additionally carry a `[label]` prefix so
 * concurrent analysis of several repositories can be told apart.
 * Quiet by default — `error` and `warn` messages are always printed,
 * and the coarse analysis-stage `progress` lines (clone/reuse, commit
 * reading, per-repository boundaries, the LLM phase) stay visible too,
 * so a long analysis never reads as a silent gap; `verbose` (from the
 * config `verbose` key) enables the detailed `info` (per-user and
 * session progress) and `debug` levels. Every message goes to stderr;
 * stdout carries nothing but the report JSON.
 */

/**
 * Whether verbose levels (`info`, `debug`) are enabled. Module-level
 * state, set once per invocation from the config `verbose` option by
 * the pipeline.
 */
let verbose = false;

/**
 * Enables or disables verbose logging for this process.
 *
 * @param enabled - True to print `info` and `debug` messages; false for
 * quiet mode (errors, warnings, and coarse `progress` lines only).
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
  /**
   * Logs a coarse analysis-stage progress message (clone/reuse, commit
   * reading, per-repository start/end, the LLM phase). Always printed,
   * even in quiet mode, so the current stage stays visible on every run.
   */
  progress(message: string): void;
  /** Logs a detailed progress message. Printed only when verbose is enabled. */
  info(message: string): void;
  /** Logs a debug message. Printed only when verbose is enabled. */
  debug(message: string): void;
}

/**
 * The severity tag of a log line. Rendered as `[LEVEL]` in the
 * standard log format; editors with log syntax highlighting color the
 * levels individually.
 */
type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

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
 * Writes one line to stderr: `[HH:mm:ss.SSS] [LEVEL] [label] message`
 * — the level tag is always present; the scope label is omitted for
 * unscoped (global) lines.
 *
 * @param level - The severity tag (`ERROR`, `WARN`, `INFO`, `DEBUG`).
 * @param scope - The scope label, or `undefined`/empty for the global
 * logger.
 * @param message - The message text; a trailing newline is appended.
 */
function writeLine(level: LogLevel, scope: string | undefined, message: string): void {
  const label = scope === undefined || scope === '' ? '' : ` [${scope}]`;
  process.stderr.write(`[${timestamp()}] [${level}]${label} ${message}\n`);
}

/**
 * Creates a scoped logger whose lines carry `[label]` after the level
 * tag — used for per-repository progress so concurrent analyses are
 * distinguishable. Scope labels must be stable per run; the caller
 * computes them once (e.g. repo basenames in input order). Without a
 * label the scoped logger behaves exactly like the global one.
 *
 * @param label - The scope label shown in every line (optional).
 * @returns The scoped logger.
 */
export function createScopedLog(label?: string): ScopedLog {
  return {
    error: (message) => writeLine('ERROR', label, message),
    warn: (message) => writeLine('WARN', label, message),
    progress: (message) => writeLine('INFO', label, message),
    info: (message) => {
      if (verbose) {
        writeLine('INFO', label, message);
      }
    },
    debug: (message) => {
      if (verbose) {
        writeLine('DEBUG', label, message);
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
  writeLine('ERROR', undefined, message);
}

/**
 * Logs a warning message. Always printed, even in quiet mode.
 *
 * @param message - The message to write to stderr.
 */
export function logWarn(message: string): void {
  writeLine('WARN', undefined, message);
}

/**
 * Logs an informational line that is always printed, regardless of
 * verbose mode — the run-startup block (the application version and
 * the per-line run configuration) and the command start/end markers
 * (`starting report` / `finished report in 1234 ms`) must be visible
 * on every run, not only in verbose logs.
 *
 * @param message - The message to write to stderr.
 */
export function logConfig(message: string): void {
  writeLine('INFO', undefined, message);
}

/**
 * Logs a detailed progress message. Printed only when verbose logging is
 * enabled (`--verbose`); hidden in quiet mode. Coarse analysis-stage
 * markers use the always-printed scoped `progress` method instead.
 *
 * @param message - The message to write to stderr.
 */
export function logInfo(message: string): void {
  if (verbose) {
    writeLine('INFO', undefined, message);
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
    writeLine('DEBUG', undefined, message);
  }
}
