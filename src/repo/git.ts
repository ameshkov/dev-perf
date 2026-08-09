/**
 * The small `execa`-based git wrapper: all git
 * operations in the project go through `runGit` or one of the helpers,
 * so failure handling stays in one place. Transient failures — a
 * dropped connection, a timing-out remote, a partial clone whose
 * on-demand blob fetch fails — are retried with the backoff in
 * `./git-retry.ts` (1s, 5s, 30s with jitter) and a warning per retry.
 */
import { execa, ExecaError } from 'execa';
import {
  DEFAULT_RETRY_DELAYS_MS,
  jitteredDelay,
  shouldRetryGitError,
  transientDetail,
} from './git-retry.js';
import { logWarn } from '../util/log.js';

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
  /** Original execa error. */
  cause?: unknown;
}

/**
 * Typed error for a failed git invocation: carries the arguments, the
 * working directory, the exit code, and stderr so callers can react to
 * specific failures (e.g. a host rejecting partial clones).
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

  constructor(args: string[], options: GitErrorOptions) {
    const where = options.cwd === undefined ? '' : ` in ${options.cwd}`;
    const status = options.exitCode === undefined ? 'could not start' : `exit ${options.exitCode}`;
    const detail = options.stderr.trim() === '' ? '' : `: ${options.stderr.trim()}`;
    super(`git ${args.join(' ')} failed with ${status}${where}${detail}`, {
      cause: options.cause,
    });
    this.name = 'GitError';
    this.args = args;
    this.cwd = options.cwd;
    this.exitCode = options.exitCode;
    this.stderr = options.stderr;
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
 * unchanged — they are not transient and are not retried.
 *
 * @param args - Args of the failing git invocation.
 * @param repoDir - Directory the command ran in.
 * @param error - The thrown error.
 * @returns The typed git error.
 */
function toGitError(args: string[], repoDir: string, error: unknown): GitError {
  if (error instanceof ExecaError) {
    return new GitError(args, {
      cwd: repoDir,
      exitCode: error.exitCode,
      stderr: error.stderr ?? '',
      cause: error,
    });
  }
  throw error;
}

/**
 * Runs a git command in the given directory and returns its stdout
 * (without the trailing newline). Transient failures — a refused or
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
 * @throws {GitError} When the command fails (non-zero exit or could not
 * start), after all retries are exhausted for a transient failure.
 */
export async function runGit(
  repoDir: string,
  args: string[],
  options: RunGitOptions = {},
): Promise<string> {
  const { gitBinary = 'git', env, retryDelays } = options;
  const delays = retryDelays ?? DEFAULT_RETRY_DELAYS_MS;
  let attempt = 0;
  for (;;) {
    try {
      const result = await execa(gitBinary, args, { cwd: repoDir, env });
      return result.stdout;
    } catch (error) {
      const gitError = toGitError(args, repoDir, error);
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
