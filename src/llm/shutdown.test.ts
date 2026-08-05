/**
 * Tests for the opencode server shutdown helpers: `serverAlive` is
 * probed against a real local TCP server (so the connect semantics are
 * exercised for real), `waitForServerExit` runs against a real server
 * with an injected kill function (the force-kill is never actually
 * executed against the test runner), and `killPortListener`'s lsof and
 * pgrep parsing and tree kill are covered with a mocked `execa` — the
 * real command would resolve to the test process's own PID and SIGKILL
 * the runner, so mocking is required there.
 */
import { createServer, type Server } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { killPortListener, serverAlive, waitForServerExit } from './shutdown.js';

/** The execa mock: `killPortListener` resolves lsof/pgrep output through it. */
const execaMock = vi.hoisted(() => ({ execa: vi.fn() }));

vi.mock('execa', () => ({ execa: execaMock.execa }));

/** A no-op scoped logger whose `warn` calls are asserted. */
function stubLog() {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
}

/**
 * Starts a real TCP server on an ephemeral localhost port.
 *
 * @returns The listening server.
 */
async function startListener(): Promise<Server> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

/**
 * Closes a listening server.
 *
 * @param server - The server to close.
 */
async function stopListener(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
}

/**
 * The base URL of a listening server.
 *
 * @param server - The listening server.
 * @returns `http://127.0.0.1:<port>`.
 */
function serverUrl(server: Server): string {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('server is not listening');
  }
  return `http://127.0.0.1:${address.port}`;
}

describe('serverAlive', () => {
  it('is true while a server listens and false once it is gone', async () => {
    const server = await startListener();
    try {
      const url = serverUrl(server);
      expect(await serverAlive(url)).toBe(true);
      await stopListener(server);
      expect(await serverAlive(url)).toBe(false);
    } finally {
      await stopListener(server).catch(() => {});
    }
  });

  it('is false for a port nothing listens on', async () => {
    const server = await startListener();
    const url = serverUrl(server);
    await stopListener(server);
    expect(await serverAlive(url)).toBe(false);
  });
});

describe('waitForServerExit', () => {
  beforeEach(() => {
    execaMock.execa.mockReset();
  });

  it('runs the force-kill after a prompt exit but kills and logs nothing', async () => {
    const server = await startListener();
    const kill = vi.fn(async () => undefined);
    const log = stubLog();
    try {
      const url = serverUrl(server);
      const waiting = waitForServerExit(url, { timeoutMs: 2_000, kill, log });
      await stopListener(server);
      await waiting;
      // Escalation is unconditional: the kill runs even after a prompt
      // exit, but finds nothing to kill and logs no warning.
      expect(kill).toHaveBeenCalledTimes(1);
      expect(kill).toHaveBeenCalledWith(url);
      expect(log.warn).not.toHaveBeenCalled();
    } finally {
      await stopListener(server).catch(() => {});
    }
  });

  it('force-kills a server that does not exit within the timeout and logs the PID', async () => {
    const server = await startListener();
    const kill = vi.fn(async () => 4321);
    const log = stubLog();
    try {
      await waitForServerExit(serverUrl(server), { timeoutMs: 100, kill, log });
      expect(kill).toHaveBeenCalledWith(serverUrl(server));
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('force-killed PID 4321'));
    } finally {
      await stopListener(server).catch(() => {});
    }
  });

  it('logs a warning when the force-kill finds nothing to kill', async () => {
    const server = await startListener();
    const kill = vi.fn(async () => undefined);
    const log = stubLog();
    try {
      await waitForServerExit(serverUrl(server), { timeoutMs: 100, kill, log });
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('could not be force-killed'));
    } finally {
      await stopListener(server).catch(() => {});
    }
  });
});

describe('killPortListener', () => {
  beforeEach(() => {
    execaMock.execa.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('force-kills the PID lsof reports for the port', async () => {
    execaMock.execa
      .mockResolvedValueOnce({ stdout: '12345\n' }) // lsof
      .mockResolvedValueOnce({ stdout: '' }); // pgrep -P 12345 (no children)
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    await expect(killPortListener('http://127.0.0.1:4096')).resolves.toBe(12345);
    expect(execaMock.execa).toHaveBeenNthCalledWith(1, 'lsof', [
      '-nP',
      '-t',
      '-sTCP:LISTEN',
      '-iTCP:4096',
    ]);
    expect(execaMock.execa).toHaveBeenNthCalledWith(2, 'pgrep', ['-P', '12345']);
    expect(kill).toHaveBeenCalledWith(-12345, 'SIGKILL');
    expect(kill).toHaveBeenCalledWith(12345, 'SIGKILL');
  });

  it('force-kills the listener and its whole process tree', async () => {
    execaMock.execa
      .mockResolvedValueOnce({ stdout: '12345\n' }) // lsof
      .mockResolvedValueOnce({ stdout: '111\n222\n' }) // pgrep -P 12345
      .mockResolvedValueOnce({ stdout: '' }) // pgrep -P 111 (no children)
      .mockResolvedValueOnce({ stdout: '' }); // pgrep -P 222 (no children)
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    await expect(killPortListener('http://127.0.0.1:4096')).resolves.toBe(12345);
    expect(kill).toHaveBeenCalledWith(111, 'SIGKILL');
    expect(kill).toHaveBeenCalledWith(222, 'SIGKILL');
    expect(kill).toHaveBeenCalledWith(12345, 'SIGKILL');
  });

  it('kills every listener the port reports', async () => {
    execaMock.execa
      .mockResolvedValueOnce({ stdout: '100\n200\n' }) // lsof
      .mockResolvedValueOnce({ stdout: '' }) // pgrep -P 100
      .mockResolvedValueOnce({ stdout: '' }); // pgrep -P 200
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    await expect(killPortListener('http://127.0.0.1:4096')).resolves.toBe(100);
    expect(kill).toHaveBeenCalledWith(100, 'SIGKILL');
    expect(kill).toHaveBeenCalledWith(200, 'SIGKILL');
  });

  it('returns undefined when lsof fails or finds nothing', async () => {
    execaMock.execa.mockRejectedValue(new Error('lsof exited with code 1'));
    await expect(killPortListener('http://127.0.0.1:4096')).resolves.toBeUndefined();
    expect(execaMock.execa).toHaveBeenCalledWith('lsof', [
      '-nP',
      '-t',
      '-sTCP:LISTEN',
      '-iTCP:4096',
    ]);
  });

  it('returns undefined when lsof output has no PID', async () => {
    execaMock.execa.mockResolvedValue({ stdout: '' });
    await expect(killPortListener('http://127.0.0.1:4096')).resolves.toBeUndefined();
    expect(execaMock.execa).toHaveBeenCalledTimes(1);
  });

  it('returns undefined when the process is already gone', async () => {
    execaMock.execa
      .mockResolvedValueOnce({ stdout: '777\n' }) // lsof
      .mockResolvedValueOnce({ stdout: '' }); // pgrep -P 777 (no children)
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH: no such process');
    });
    await expect(killPortListener('http://127.0.0.1:4096')).resolves.toBeUndefined();
  });

  it('is a no-op on Windows (the SDK taskkills the tree itself)', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    if (platform === undefined) {
      throw new Error('process.platform descriptor missing');
    }
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
    try {
      await expect(killPortListener('http://127.0.0.1:4096')).resolves.toBeUndefined();
      expect(execaMock.execa).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, 'platform', platform);
    }
  });
});
