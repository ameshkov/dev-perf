/**
 * opencode server shutdown: the SDK's `server.close()` sends the
 * spawned `opencode serve` process a single SIGTERM and returns
 * immediately — it does not wait for the process to exit and does not
 * escalate. A server that does not exit on SIGTERM (e.g. one stuck
 * bundling a tool in esbuild) keeps dev-perf's event loop alive
 * forever through its stdio pipes, hanging the CLI after the report
 * was written. This module waits (bounded) for the server's port to
 * stop accepting, then force-kills the listening process and its
 * whole process tree, so a stuck server can neither hang the CLI nor
 * leak a process.
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
 * Waits for the opencode server at `url` to exit: the server's port is
 * probed until it stops accepting or `timeoutMs` elapses, then the
 * listening process is force-killed via `kill` (defaults to
 * `killPortListener`). The escalation is unconditional — the probe is
 * only the grace period for the SDK's SIGTERM to complete, and the
 * kill is a no-op when the server already exited. A server that exits
 * on its own makes this resolve after the first dead probe with
 * nothing to kill; the force-kill path logs what happened. Never
 * throws — shutdown is best effort.
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
  let alive = true;
  while (Date.now() < deadline) {
    if (!(await serverAlive(url))) {
      alive = false;
      break;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  // Escalate unconditionally: a server that exited gracefully leaves
  // nothing listening, so the kill is a no-op; a server that is gone
  // but leaked a child holding the port is still cleaned up.
  const pid = await kill(url);
  if (pid !== undefined) {
    logWarn(`LLM server did not exit on SIGTERM; force-killed PID ${pid} (process tree)`);
  } else if (alive) {
    logWarn(`LLM server did not exit on SIGTERM and could not be force-killed: ${url}`);
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
 * Force-kills every process listening on the URL's port together with
 * its whole process tree (POSIX only): first the process group when
 * the listener leads one (the SDK spawns `opencode serve` without
 * `detached`, so normally it shares dev-perf's group and this is a
 * no-op), then every descendant process — e.g. the esbuild child a
 * stuck server is waiting on — and finally the listener itself. On
 * Windows this is a no-op — the SDK's own shutdown already kills the
 * whole process tree with `taskkill /T`.
 *
 * @param url - The server base URL.
 * @returns The killed PID, or `undefined` when nothing could be killed
 * (lsof unavailable, no listener, or every process is already gone).
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
  let pids: number[] = [];
  try {
    // `lsof -t` prints PIDs only; exit code 1 (no match) rejects.
    const { stdout } = await execa('lsof', ['-nP', '-t', '-sTCP:LISTEN', `-iTCP:${port}`]);
    pids = parsePidList(stdout);
  } catch {
    return undefined; // lsof unavailable or nothing listening.
  }
  let killed: number | undefined;
  for (const pid of pids) {
    if ((await killProcessTree(pid)) && killed === undefined) {
      killed = pid;
    }
  }
  return killed;
}

/**
 * Force-kills one process and everything it spawned: the process group
 * when the pid leads one (a harmless no-op otherwise), then every
 * descendant, then the pid itself.
 *
 * @param pid - The process to kill with its tree.
 * @returns True when at least one kill signal was delivered.
 */
async function killProcessTree(pid: number): Promise<boolean> {
  let signaled = false;
  const signal = (target: number) => {
    try {
      process.kill(target, 'SIGKILL');
      signaled = true;
    } catch {
      // Already gone (ESRCH) or not ours.
    }
  };
  try {
    process.kill(-pid, 'SIGKILL'); // The whole group, when it leads one.
    signaled = true;
  } catch {
    // Not a group leader — kill its descendants individually instead.
  }
  for (const descendant of await descendantPids(pid)) {
    signal(descendant);
  }
  signal(pid);
  return signaled;
}

/**
 * Collects the PIDs of every descendant of `pid` (children,
 * grandchildren, …) via `pgrep -P`. Returns an empty list when pgrep
 * is unavailable or the process has no children.
 *
 * @param pid - The parent PID.
 * @returns The descendant PIDs.
 */
async function descendantPids(pid: number): Promise<number[]> {
  const descendants: number[] = [];
  const queue = [pid];
  while (queue.length > 0) {
    const current = queue.shift() ?? 0;
    let children: number[] = [];
    try {
      // `pgrep -P` prints direct children only; exit code 1 rejects.
      const { stdout } = await execa('pgrep', ['-P', String(current)]);
      children = parsePidList(stdout);
    } catch {
      children = [];
    }
    for (const child of children) {
      descendants.push(child);
      queue.push(child);
    }
  }
  return descendants;
}

/**
 * Parses a whitespace-separated list of PIDs (the output format of
 * `lsof -t` and `pgrep -P`) into a list of positive integers.
 *
 * @param text - The command output.
 * @returns The parsed PIDs.
 */
function parsePidList(text: string): number[] {
  return text
    .trim()
    .split(/\s+/)
    .map((entry) => Number(entry))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
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
