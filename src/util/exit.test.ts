import { afterEach, describe, expect, it, vi } from 'vitest';
import { exitAfterStdoutFlushed } from './exit.js';

/** A fake flushable stdout with a spiable `once`. */
interface StdoutStub {
  writableLength: number;
  once: ReturnType<typeof vi.fn> & ((event: 'drain', listener: () => void) => unknown);
}

/**
 * Builds a stdout stub with the given buffer state.
 *
 * @param writableLength - The buffered-bytes count to report.
 * @returns The stub.
 */
function stdoutStub(writableLength: number): StdoutStub {
  return { writableLength, once: vi.fn() as unknown as StdoutStub['once'] };
}

describe('exitAfterStdoutFlushed', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('exits immediately when stdout has no buffered data', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const stdout = stdoutStub(0);

    exitAfterStdoutFlushed(0, stdout);

    expect(exit).toHaveBeenCalledWith(0);
    expect(stdout.once).not.toHaveBeenCalled();
  });

  it('waits for the drain event before exiting when stdout is buffered', () => {
    vi.useFakeTimers();
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const stdout = stdoutStub(4096);

    exitAfterStdoutFlushed(0, stdout);

    expect(exit).not.toHaveBeenCalled();
    expect(stdout.once).toHaveBeenCalledWith('drain', expect.any(Function));
    const onDrain = stdout.once.mock.calls[0][1] as () => void;
    onDrain();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('exits via the safety timeout when stdout never drains', () => {
    vi.useFakeTimers();
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    exitAfterStdoutFlushed(1, stdoutStub(4096));

    vi.advanceTimersByTime(999);
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
