/**
 * Tests for the stderr logger (plan step 6): level gating (quiet vs
 * verbose) and stderr targeting (stdout untouched).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logDebug, logError, logInfo, logWarn, setVerbose } from './log.js';

/** Mock of a stream's `write` method. */
type WriteSpy = ReturnType<typeof vi.spyOn>;

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

    expect(stderrWrite).toHaveBeenCalledWith('boom\n');
    expect(stderrWrite).toHaveBeenCalledWith('heads up\n');
    expect(stderrWrite).not.toHaveBeenCalledWith('progress\n');
    expect(stderrWrite).not.toHaveBeenCalledWith('detail\n');
  });

  it('prints info and debug messages when verbose is enabled', () => {
    setVerbose(true);

    logInfo('cloned repo in 12 ms');
    logDebug('parsing 3 commits');

    expect(stderrWrite).toHaveBeenCalledWith('cloned repo in 12 ms\n');
    expect(stderrWrite).toHaveBeenCalledWith('parsing 3 commits\n');
  });

  it('resets to quiet mode after setVerbose(false)', () => {
    setVerbose(true);
    setVerbose(false);

    logInfo('progress');

    expect(stderrWrite).not.toHaveBeenCalled();
  });

  it('never writes to stdout', () => {
    setVerbose(true);
    logError('boom');
    logWarn('heads up');
    logInfo('progress');
    logDebug('detail');

    expect(stdoutWrite).not.toHaveBeenCalled();
  });
});
