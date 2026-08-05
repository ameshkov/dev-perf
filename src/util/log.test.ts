/**
 * Tests for the stderr logger: level gating (quiet vs
 * verbose), the millisecond timestamp prefix, scoped labels, and stderr
 * targeting (stdout untouched).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScopedLog, logDebug, logError, logInfo, logWarn, setVerbose } from './log.js';

/** Mock of a stream's `write` method. */
type WriteSpy = ReturnType<typeof vi.spyOn>;

/**
 * A regex matching one timestamped log line: `[HH:mm:ss.SSS]` with an
 * optional `[label]` scope prefix before the message.
 *
 * @param message - The expected message text (regex-escaped).
 * @param scope - The expected scope label, or `undefined` for none.
 * @returns The line regex.
 */
function stampedLine(message: string, scope?: string): RegExp {
  const label = scope === undefined ? '' : ` \\[${scope}\\]`;
  return new RegExp(`^\\[\\d{2}:\\d{2}:\\d{2}\\.\\d{3}\\]${label} ${message}\n$`);
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

    expect(stderrWrite).toHaveBeenCalledWith(expect.stringMatching(stampedLine('boom')));
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringMatching(stampedLine('heads up')));
    expect(stderrWrite).not.toHaveBeenCalledWith(expect.stringMatching(stampedLine('progress')));
    expect(stderrWrite).not.toHaveBeenCalledWith(expect.stringMatching(stampedLine('detail')));
  });

  it('prints info and debug messages when verbose is enabled', () => {
    setVerbose(true);

    logInfo('cloned repo in 12 ms');
    logDebug('parsing 3 commits');

    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringMatching(stampedLine('cloned repo in 12 ms')),
    );
    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringMatching(stampedLine('parsing 3 commits')),
    );
  });

  it('resets to quiet mode after setVerbose(false)', () => {
    setVerbose(true);
    setVerbose(false);

    logInfo('progress');

    expect(stderrWrite).not.toHaveBeenCalled();
  });

  it('prefixes every line with a millisecond timestamp', () => {
    setVerbose(true);

    logInfo('timed');

    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringMatching(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\] timed\n$/),
    );
  });

  it('carries the scope label between the timestamp and the message', () => {
    setVerbose(true);
    const scoped = createScopedLog('repo-a');

    scoped.info('parsing commits');
    scoped.warn('partial clone failed');

    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringMatching(stampedLine('parsing commits', 'repo-a')),
    );
    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringMatching(stampedLine('partial clone failed', 'repo-a')),
    );
  });

  it('gates scoped info and debug in quiet mode while scoped warns always print', () => {
    const scoped = createScopedLog('repo-a');

    scoped.info('hidden progress');
    scoped.warn('visible warning');

    expect(stderrWrite).not.toHaveBeenCalledWith(
      expect.stringMatching(stampedLine('hidden progress', 'repo-a')),
    );
    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringMatching(stampedLine('visible warning', 'repo-a')),
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
