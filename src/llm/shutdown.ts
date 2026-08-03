/**
 * opencode server shutdown: the SDK's `server.close()` sends the
 * spawned `opencode serve` process a single SIGTERM and returns
 * immediately — it does not wait for the process to exit and does not
 * escalate. A server that does not exit on SIGTERM (e.g. one stuck
 * bundling a tool in esbuild) keeps dev-perf's event loop alive
 * forever through its stdio pipes, hanging the CLI after the report
 * was written. This module waits for the server's port to stop
 * accepting (bounded), then force-kills the listening process, so a
 * stuck server can neither hang the CLI nor leak a process.
 */
import { connect } from 'node:net';
import { execa } from 'execa';
import { logWarn } from '../util/log.js';

/** How long to wait for the server to exit after SIGTERM before force-killing it. */
const SERVER_STOP_TIMEOUT_MS = 5_000;

/** Poll interval of the server liveness probe. */
const POLL_INTERVAL_MS = 200;

/** Connect timeout of one liveness probe, in milliseconds. */
const CONNECT_TIMEOUT_MS = 500;

/** Options accepted by `waitForServerExit`. */
interface WaitForServerExitOptions {
  /** How long to wait for the port to close before force-killing. */
  timeoutMs?: number;
  /** Force-kill implementation; injectable for tests. */
  kill?: (url: string) => Promise<number | undefined>;
}

/**
 * Waits for the opencode server at `url` to exit: the server's port
 * is probed until it stops accepting or `timeoutMs` elapses, then the
 * listening process is force-killed via `kill` (defaults to
 * `killPortListener`). A server that exits on its own makes this
 * resolve after the first dead probe; the force-kill path logs what
 * happened. Never throws — shutdown is best effort.
 *
 * @param url - The server base URL, e.g. `http://127.0.0.1:4096`.
 * @param options - Timeout and kill-function overrides (tests).
 * @returns A promise resolving when the server is gone or the
 * force-kill was attempted.
 */
export async function waitForServerExit(
  url: string,
  options: WaitForServerExitOptions = {},
): Promise<void> {
  const { timeoutMs = SERVER_STOP_TIMEOUT_MS, kill = killPortListener } = options;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await serverAlive(url))) {
      return;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  const pid = await kill(url);
  if (pid === undefined) {
    logWarn(`LLM server did not exit on SIGTERM and could not be force-killed: ${url}`);
  } else {
    logWarn(`LLM server did not exit on SIGTERM; force-killed PID ${pid}`);
  }
}

/**
 * Probes whether the server at `url` is still listening by attempting
 * a TCP connection to its port. A successful connect means something
 * still listens; a refused connection means the server is gone. A
 * probe that gets no response counts as alive — the server may be
 * wedged but still holding the port, and escalation is the caller's
 * business.
 *
 * @param url - The server base URL.
 * @returns True when the port accepts connections.
 *
 * @internal Exported for tests only (`shutdown.test.ts`); also used by
 * `waitForServerExit` within the module. Not part of the public module
 * API.
 */
export async function serverAlive(url: string): Promise<boolean> {
  const { hostname, port } = new URL(url);
  return new Promise((resolve) => {
    const socket = connect({
      host: hostname,
      port: Number(port),
      timeout: CONNECT_TIMEOUT_MS,
    });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => {
      socket.destroy();
      resolve(true);
    });
  });
}

/**
 * Force-kills the process listening on the URL's port (POSIX only)
 * and returns its PID. On Windows this is a no-op — the SDK's own
 * shutdown already kills the whole process tree with `taskkill /T`.
 *
 * @param url - The server base URL.
 * @returns The killed PID, or `undefined` when nothing could be killed
 * (lsof unavailable, no listener, or the process is already gone).
 *
 * @internal Exported for tests only (`shutdown.test.ts`); also used as
 * the default kill function of `waitForServerExit` within the module.
 * Not part of the public module API.
 */
export async function killPortListener(url: string): Promise<number | undefined> {
  if (process.platform === 'win32') {
    return undefined;
  }
  const { port } = new URL(url);
  if (port === '') {
    return undefined;
  }
  let pid: number | undefined;
  try {
    // `lsof -t` prints PIDs only; exit code 1 (no match) rejects.
    const { stdout } = await execa('lsof', ['-nP', '-t', '-sTCP:LISTEN', `-iTCP:${port}`]);
    pid = Number(stdout.trim().split('\n')[0]);
  } catch {
    return undefined; // lsof unavailable or nothing listening.
  }
  if (!Number.isInteger(pid) || (pid ?? 0) <= 0) {
    return undefined;
  }
  try {
    process.kill(pid, 'SIGKILL');
    return pid;
  } catch {
    return undefined; // Already gone (ESRCH) or not ours.
  }
}

/**
 * Waits without resolving early.
 *
 * @param ms - Milliseconds to wait.
 * @returns A promise resolving after `ms` milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
