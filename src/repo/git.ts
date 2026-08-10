/**
 * The small `execa`-based git wrapper: all git
 * operations in the project go through `runGit` or one of the helpers,
 * so failure handling stays in one place. Every command runs under a
 * per-command timeout (default `DEFAULT_GIT_TIMEOUT_MS`), so a git
 * invocation that hangs — e.g. a `git log --numstat` on a partial
 * clone whose lazy blob fetch stalls against an unresponsive promisor
 * remote — is killed and surfaces as a typed failure instead of
 * blocking the run forever. Transient failures — a
 * dropped connection, a timing-out remote, a partial clone whose
 * on-demand blob fetch fails — are retried with the backoff in
 * `./git-retry.ts` (1s, 5s, 30s with jitter) and a warning per retry;
 * a time-out is deliberately *not* retried (a stuck command would just
 * hang again).
 */
import { execa, ExecaError } from 'execa';
import {
  DEFAULT_RETRY_DELAYS_MS,
  jitteredDelay,
  shouldRetryGitError,
  transientDetail,
} from './git-retry.js';
import { logWarn } from '../util/log.js';

/**
 * Default per-command timeout for git operations, in milliseconds: a
 * git command still running after this is killed and surfaces as a
 * failure. Hard-coded like the retry backoff in `./git-retry.ts` — a
 * hang is rare and the timeout is the safety net, not a budget to
 * tune. Callers can override per call through
 * `RunGitOptions.timeoutMs`; `0` disables the timeout.
 */
const DEFAULT_GIT_TIMEOUT_MS = 5 * 60 * 1000;

/** Options accepted by `runGit`. */
export interface RunGitOptions {
  /** Git executable to run; defaults to `git`. */
  gitBinary?: string;
  /**
   * Extra environment variables for the git process, merged over the
   * parent environment. Used to pin dates (`GIT_AUTHOR_DATE`,
   * `GIT_COMMITTER_DATE`) and to force UTC date interpretation
   * (`TZ=UTC`).
   */
  env?: NodeJS.ProcessEnv;
  /**
   * Per-command timeout in milliseconds: a git command still running
   * after this is killed (SIGTERM, then SIGKILL) and surfaces as a
   * non-retried `GitError`. Defaults to `DEFAULT_GIT_TIMEOUT_MS`;
   * `0` disables the timeout. Tests pass small values.
   */
  timeoutMs?: number;
  /**
   * Backoff delays between attempts, in milliseconds, after each
   * transient failure until the last one — one entry per retry, skipped
   * once the list ends. Production always uses the built-in defaults
   * (`1s`, `5s`, `30s` with jitter); tests pass `0` delays so a
   * retried fixture finishes without waiting out the backoff.
   */
  retryDelays?: readonly number[];
}

/** Options accepted by `GitError`. */
export interface GitErrorOptions {
  /** Directory the command ran in. */
  cwd?: string;
  /** Exit code of the failed command; undefined when it could not start. */
  exitCode?: number;
  /** Stderr of the failed command. */
  stderr: string;
  /** True when the command was killed for exceeding the per-command
   * timeout, instead of failing on its own. */
  isTimeout?: boolean;
  /** The per-command timeout in milliseconds, when the command timed out. */
  timeoutMs?: number;
  /** Original execa error. */
  cause?: unknown;
}

/**
 * Typed error for a failed git invocation: carries the arguments, the
 * working directory, the exit code, and stderr so callers can react to
 * specific failures (e.g. a host rejecting partial clones). A command
 * killed by the per-command timeout is marked with `isTimeout` and
 * reported distinctly (`timed out after N s`), so the cause of the
 * failure — a hang, not an error git produced — stays visible.
 */
export class GitError extends Error {
  /** Args of the failing git invocation (without the git binary). */
  readonly args: string[];
  /** Directory the command ran in. */
  readonly cwd?: string;
  /** Exit code of the failed command; undefined when it could not start. */
  readonly exitCode?: number;
  /** Stderr of the failed command. */
  readonly stderr: string;
  /** True when the command was killed for exceeding the per-command
   * timeout, instead of failing on its own. */
  readonly isTimeout: boolean;
  /** The per-command timeout in milliseconds, when the command timed out. */
  readonly timeoutMs: number | undefined;

  constructor(args: string[], options: GitErrorOptions) {
    const where = options.cwd === undefined ? '' : ` in ${options.cwd}`;
    let message: string;
    if (options.isTimeout === true) {
      const seconds = (options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS) / 1000;
      message = `git ${args.join(' ')} timed out after ${seconds.toFixed(seconds < 1 ? 1 : 0)} s${where}`;
    } else {
      const status =
        options.exitCode === undefined ? 'could not start' : `exit ${options.exitCode}`;
      const detail = options.stderr.trim() === '' ? '' : `: ${options.stderr.trim()}`;
      message = `git ${args.join(' ')} failed with ${status}${where}${detail}`;
    }
    super(message, { cause: options.cause });
    this.name = 'GitError';
    this.args = args;
    this.cwd = options.cwd;
    this.exitCode = options.exitCode;
    this.stderr = options.stderr;
    this.isTimeout = options.isTimeout ?? false;
    this.timeoutMs = options.timeoutMs;
  }
}

/**
 * Waits the given number of milliseconds.
 *
 * @param ms - Time to sleep.
 * @returns A promise that resolves after the delay.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Converts a thrown execa error into the module's typed `GitError`;
 * errors that are not execa failures (e.g. a broken spawn) propagate
 * unchanged — they are not transient and are not retried. A command
 * killed by the per-command timeout (execa's `timedOut`) is marked
 * `isTimeout`, so callers and the retry classification can tell a
 * hang from an error git produced itself.
 *
 * @param args - Args of the failing git invocation.
 * @param repoDir - Directory the command ran in.
 * @param timeoutMs - The per-command timeout in effect, for the error.
 * @param error - The thrown error.
 * @returns The typed git error.
 */
function toGitError(args: string[], repoDir: string, timeoutMs: number, error: unknown): GitError {
  if (error instanceof ExecaError) {
    return new GitError(args, {
      cwd: repoDir,
      exitCode: error.exitCode,
      stderr: error.stderr ?? '',
      isTimeout: error.timedOut,
      timeoutMs: error.timedOut ? timeoutMs : undefined,
      cause: error,
    });
  }
  throw error;
}

/**
 * Runs a git command in the given directory and returns its stdout
 * (without the trailing newline). Every command runs under the
 * per-command timeout (`DEFAULT_GIT_TIMEOUT_MS`, or
 * `options.timeoutMs`): one still running after it is killed and
 * surfaces as a non-retried `GitError` — a hang is a failure, not
 * something to wait out. Transient failures — a refused or
 * timed-out connection, a dropped remote, a partial clone whose
 * on-demand blob fetch fails — are retried with the built-in backoff
 * (~1s, ~5s, ~30s, each with jitter), logging a warning per retry, and
 * the last attempt's error is thrown when they all fail. All other
 * (permanent) failures throw immediately.
 *
 * @param repoDir - Directory to run git in (the repo working tree for
 * repo operations, the cache entry dir for clones).
 * @param args - Arguments passed to git, e.g. `['rev-parse', 'HEAD']`.
 * @param options - Executable overrides.
 * @returns The command's stdout.
 * @throws {GitError} When the command fails (non-zero exit, could not
 * start, or timed out), after all retries are exhausted for a transient
 * failure.
 */
export async function runGit(
  repoDir: string,
  args: string[],
  options: RunGitOptions = {},
): Promise<string> {
  const { gitBinary = 'git', env, retryDelays, timeoutMs } = options;
  const delays = retryDelays ?? DEFAULT_RETRY_DELAYS_MS;
  const timeout = timeoutMs === undefined ? DEFAULT_GIT_TIMEOUT_MS : timeoutMs;
  let attempt = 0;
  for (;;) {
    try {
      const result = await execa(gitBinary, args, { cwd: repoDir, env, timeout });
      return result.stdout;
    } catch (error) {
      const gitError = toGitError(args, repoDir, timeout, error);
      const delayMs = delays[attempt];
      if (delayMs === undefined || !shouldRetryGitError(gitError)) {
        throw gitError;
      }
      const waitMs = jitteredDelay(delayMs);
      logWarn(
        `git "${args[0] ?? 'git'}" failed (attempt ${attempt + 1}/${delays.length + 1}; ` +
          `retrying in ${(waitMs / 1000).toFixed(1)} s): ${transientDetail(gitError)}`,
      );
      await sleep(waitMs);
      attempt += 1;
    }
  }
}

/**
 * Runs `git clone` with cwd set to the destination's parent directory
 * (`repo/` is created inside it).
 *
 * @param cwd - Directory to run the clone in (the cache entry dir).
 * @param args - Arguments after `clone`, e.g. `['--filter=blob:none',
 * url, 'repo']`.
 * @param options - Overrides for the git invocation.
 * @returns The clone command's stdout.
 * @throws {GitError} When the clone fails.
 */
export async function gitClone(
  cwd: string,
  args: string[],
  options: RunGitOptions = {},
): Promise<string> {
  return runGit(cwd, ['clone', ...args], options);
}

/**
 * Runs `git log` in a repository.
 *
 * @param repoDir - The repository working tree.
 * @param args - Arguments after `log`.
 * @returns The log output.
 * @throws {GitError} When the command fails.
 *
 * @internal Exported for tests only (`git.test.ts`, `commits.test.ts`);
 * production code goes through `runGit`. Not part of the public module
 * API.
 */
export async function gitLog(repoDir: string, args: string[]): Promise<string> {
  return runGit(repoDir, ['log', ...args]);
}

/**
 * Runs `git show` in a repository.
 *
 * @param repoDir - The repository working tree.
 * @param args - Arguments after `show`.
 * @returns The show output.
 * @throws {GitError} When the command fails.
 *
 * @internal Exported for tests only (`git.test.ts`); production code
 * goes through `runGit`. Not part of the public module API.
 */
export async function gitShow(repoDir: string, args: string[]): Promise<string> {
  return runGit(repoDir, ['show', ...args]);
}

/**
 * Runs `git shortlog` in a repository.
 *
 * @param repoDir - The repository working tree.
 * @param args - Arguments after `shortlog`.
 * @returns The shortlog output.
 * @throws {GitError} When the command fails.
 *
 * @internal Exported for tests only (`git.test.ts`); production code
 * goes through `runGit`. Not part of the public module API.
 */
export async function gitShortlog(repoDir: string, args: string[]): Promise<string> {
  return runGit(repoDir, ['shortlog', ...args]);
}

/**
 * Runs `git rev-parse` in a repository.
 *
 * @param repoDir - The repository working tree.
 * @param args - Arguments after `rev-parse`, e.g. `['HEAD']` or
 * `['--abbrev-ref', 'HEAD']`.
 * @returns The rev-parse output.
 * @throws {GitError} When the command fails.
 *
 * @internal Exported for tests only (`git.test.ts`, `clone.test.ts`,
 * and the e2e suite); production code goes through `runGit`. Not part
 * of the public module API.
 */
export async function gitRevParse(repoDir: string, args: string[]): Promise<string> {
  return runGit(repoDir, ['rev-parse', ...args]);
}
