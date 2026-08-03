/**
 * Process-exit helper: exits with a code once stdout has flushed. A
 * forced exit is required because the opencode server's child process
 * may still be alive when the report is done — its stdio pipes keep
 * the Node event loop from draining on its own, so returning from the
 * pipeline is not enough to terminate. The report is written to stdout
 * as one buffered write, so the exit waits for the drain first: a
 * large report piped to a slow consumer could otherwise be truncated.
 */

/** How long to wait for stdout to drain before exiting anyway. */
const EXIT_FLUSH_TIMEOUT_MS = 1_000;

/** The minimal stdout surface the exit helper needs. */
interface FlushableStdout {
  /** Bytes buffered but not yet handed to the OS. */
  readonly writableLength: number;
  /** Registers a one-time `drain` listener, fired when the buffer empties. */
  once(event: 'drain', listener: () => void): unknown;
}

/**
 * Exits the process with the given code once stdout has flushed:
 * immediately when nothing is buffered, otherwise on the next `drain`
 * event — bounded by `EXIT_FLUSH_TIMEOUT_MS` so a consumer that
 * stopped reading cannot hang the CLI forever.
 *
 * @param code - The exit code (0 on success, non-zero on failure).
 * @param stdout - The stdout stream to flush; injectable for tests.
 */
export function exitAfterStdoutFlushed(
  code: number,
  stdout: FlushableStdout = process.stdout,
): void {
  if (stdout.writableLength === 0) {
    process.exit(code);
    return;
  }
  const exit = (): void => process.exit(code);
  stdout.once('drain', exit);
  // The report is complete; a consumer that stopped reading must not
  // hang the CLI forever.
  setTimeout(exit, EXIT_FLUSH_TIMEOUT_MS).unref();
}
