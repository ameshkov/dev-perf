/**
 * Tests for the stderr logger: level gating (quiet vs
 * verbose), the millisecond timestamp prefix, the `[LEVEL]` tag,
 * scoped labels, and stderr targeting (stdout untouched).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createScopedLog,
  logConfig,
  logDebug,
  logError,
  logInfo,
  logWarn,
  setVerbose,
} from './log.js';

/** Mock of a stream's `write` method. */
type WriteSpy = ReturnType<typeof vi.spyOn>;

/**
 * A regex matching one log line in the standard format:
 * `[HH:mm:ss.SSS] [LEVEL]` with an optional `[label]` scope prefix
 * before the message.
 *
 * @param level - The expected `[LEVEL]` tag.
 * @param message - The expected message text (regex-escaped).
 * @param scope - The expected scope label, or `undefined` for none.
 * @returns The line regex.
 */
function stampedLine(level: string, message: string, scope?: string): RegExp {
  const label = scope === undefined ? '' : ` \\[${scope}\\]`;
  return new RegExp(`^\\[\\d{2}:\\d{2}:\\d{2}\\.\\d{3}\\] \\[${level}\\]${label} ${message}\n$`);
}

describe('log', () => {
  let stderrWrite: WriteSpy;
  let stdoutWrite: WriteSpy;

  beforeEach(() => {
    setVerbose(false);
    stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints errors and warnings in quiet mode and gates info and debug', () => {
    logError('boom');
    logWarn('heads up');
    logInfo('progress');
    logDebug('detail');

    expect(stderrWrite).toHaveBeenCalledWith(expect.stringMatching(stampedLine('ERROR', 'boom')));
    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringMatching(stampedLine('WARN', 'heads up')),
    );
    expect(stderrWrite).not.toHaveBeenCalledWith(
      expect.stringMatching(stampedLine('INFO', 'progress')),
    );
    expect(stderrWrite).not.toHaveBeenCalledWith(
      expect.stringMatching(stampedLine('DEBUG', 'detail')),
    );
  });

  it('prints info and debug messages when verbose is enabled', () => {
    setVerbose(true);

    logInfo('cloned repo in 12 ms');
    logDebug('parsing 3 commits');

    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringMatching(stampedLine('INFO', 'cloned repo in 12 ms')),
    );
    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringMatching(stampedLine('DEBUG', 'parsing 3 commits')),
    );
  });

  it('resets to quiet mode after setVerbose(false)', () => {
    setVerbose(true);
    setVerbose(false);

    logInfo('progress');

    expect(stderrWrite).not.toHaveBeenCalled();
  });

  it('always prints config lines as INFO, regardless of verbose mode', () => {
    logConfig('dev-perf 0.1.0');
    logConfig('  cacheDir: /tmp/cache');

    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringMatching(stampedLine('INFO', 'dev-perf 0.1.0')),
    );
    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringMatching(stampedLine('INFO', '  cacheDir: /tmp/cache')),
    );
  });

  it('prefixes every line with a millisecond timestamp and a level tag', () => {
    setVerbose(true);

    logInfo('timed');
    logError('boom');

    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringMatching(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\] \[INFO\] timed\n$/),
    );
    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringMatching(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\] \[ERROR\] boom\n$/),
    );
  });

  it('carries the scope label after the level tag', () => {
    setVerbose(true);
    const scoped = createScopedLog('repo-a');

    scoped.info('parsing commits');
    scoped.warn('partial clone failed');

    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringMatching(stampedLine('INFO', 'parsing commits', 'repo-a')),
    );
    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringMatching(stampedLine('WARN', 'partial clone failed', 'repo-a')),
    );
  });

  it('gates scoped info and debug in quiet mode while scoped warns always print', () => {
    const scoped = createScopedLog('repo-a');

    scoped.info('hidden progress');
    scoped.warn('visible warning');

    expect(stderrWrite).not.toHaveBeenCalledWith(
      expect.stringMatching(stampedLine('INFO', 'hidden progress', 'repo-a')),
    );
    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringMatching(stampedLine('WARN', 'visible warning', 'repo-a')),
    );
  });

  it('never writes to stdout', () => {
    setVerbose(true);
    const scoped = createScopedLog('repo-a');
    logError('boom');
    logWarn('heads up');
    logInfo('progress');
    logDebug('detail');
    scoped.info('scoped');

    expect(stdoutWrite).not.toHaveBeenCalled();
  });
});
