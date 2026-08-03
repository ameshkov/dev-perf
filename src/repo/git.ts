/**
 * The small `execa`-based git wrapper (docs/design.md §4): all git
 * operations in the project go through `runGit` or one of the helpers,
 * so failure handling stays in one place.
 */
import { execa, ExecaError } from 'execa';

/** Options accepted by `runGit`. */
export interface RunGitOptions {
  /** Git executable to run; defaults to `git`. */
  gitBinary?: string;
  /**
   * Extra environment variables for the git process, merged over the
   * parent environment. Used to pin dates (`GIT_AUTHOR_DATE`,
   * `GIT_COMMITTER_DATE`) and to force UTC date interpretation
   * (`TZ=UTC`, design §5.4).
   */
  env?: NodeJS.ProcessEnv;
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
 * Runs a git command in the given directory and returns its stdout
 * (without the trailing newline).
 *
 * @param repoDir - Directory to run git in (the repo working tree for
 * repo operations, the cache entry dir for clones).
 * @param args - Arguments passed to git, e.g. `['rev-parse', 'HEAD']`.
 * @param options - Executable overrides.
 * @returns The command's stdout.
 * @throws {GitError} When the command fails (non-zero exit or could not
 * start).
 */
export async function runGit(
  repoDir: string,
  args: string[],
  options: RunGitOptions = {},
): Promise<string> {
  const { gitBinary = 'git', env } = options;
  try {
    const result = await execa(gitBinary, args, { cwd: repoDir, env });
    return result.stdout;
  } catch (error) {
    if (error instanceof ExecaError) {
      throw new GitError(args, {
        cwd: repoDir,
        exitCode: error.exitCode,
        stderr: error.stderr ?? '',
        cause: error,
      });
    }
    throw error;
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
 */
export async function gitRevParse(repoDir: string, args: string[]): Promise<string> {
  return runGit(repoDir, ['rev-parse', ...args]);
}
