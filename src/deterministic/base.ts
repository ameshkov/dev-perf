/**
 * Base-branch resolution for branch-delta analysis: finds the ref a
 * repository's analysis is scoped against. The delta is the commits
 * reachable from the analyzed branch head but not from the base
 * (`git log HEAD --not <base>`) — per-release attribution, where a
 * release branch's own commits are the contributor's work and the
 * base's merged history is out of scope.
 *
 * An explicit base resolves to `<base>` then `origin/<base>`. Without
 * one, the repository's own default branch is preferred — resolved
 * from `refs/remotes/origin/HEAD` (the remote's canonical default,
 * e.g. `origin/main`) so a stale leftover `master` in a main-migrated
 * repository never wins — and the static defaults `main`, `origin/main`,
 * `master`, `origin/master` follow, the first candidate that
 * `git rev-parse --verify` resolves. When no candidate resolves,
 * `resolveBaseSha` returns `undefined` and the caller analyzes the
 * full history instead of failing. The empty-string base is the
 * full-history opt-out: the caller configured no delta, so this
 * function reports `undefined` immediately.
 */
import { GitError, runGit } from '../repo/git.js';
import type { RunGitOptions } from '../repo/git.js';

/** Default base candidates when no explicit base is configured. */
const DEFAULT_CANDIDATES = ['main', 'origin/main', 'master', 'origin/master'];

/** A resolved base ref: the ref name that resolved and its commit sha. */
export interface ResolvedBase {
  /** The ref name that resolved (e.g. `master` or `origin/main`). */
  base: string;
  /** The resolved commit sha. */
  sha: string;
}

/**
 * Resolves the base ref a repository's branch-delta is computed
 * against, or `undefined` when no base is in effect: the empty-string
 * opt-out, or no candidate resolving. The first resolving candidate
 * wins: the repository's own default branch (from
 * `refs/remotes/origin/HEAD`, when it is not the analyzed head itself)
 * beats the static candidates, `main` beats a stale `master` when both
 * exist, and an explicit base never silently falls through to a global
 * default.
 *
 * @param repoDir - The clone's working tree.
 * @param base - The configured base branch; `undefined` selects the
 * default candidates, `''` the full-history opt-out.
 * @param head - The analyzed branch's head sha; a default candidate
 * equal to it is skipped, so a branch is never scoped against itself.
 * @param options - Overrides for the git invocations (see `runGit`).
 * @returns The resolved base ref name and sha, or `undefined`.
 */
export async function resolveBaseSha(
  repoDir: string,
  base?: string,
  head?: string,
  options: RunGitOptions = {},
): Promise<ResolvedBase | undefined> {
  if (base === '') {
    // The empty-string base is the explicit full-history opt-out.
    return undefined;
  }
  const candidates =
    base === undefined
      ? await resolveDefaultCandidates(repoDir, head ?? '', options)
      : [base, `origin/${base}`];
  for (const candidate of candidates) {
    const sha = await resolveRef(repoDir, candidate, options);
    if (sha !== undefined) {
      return { base: candidate, sha };
    }
  }
  return undefined;
}

/**
 * The default base candidates of a repository: its own default branch
 * first — resolved from `refs/remotes/origin/HEAD`, the remote's
 * canonical default (e.g. `main`) — followed by the static
 * `main`-before-`master` defaults. Preferring the repository's real
 * default keeps a stale `master` left over from a `main` migration
 * from being selected as the base, which would silently over-credit
 * the analyzed branch. A canonical default equal to the analyzed
 * branch's own head (e.g. a local checkout whose `origin/HEAD` points
 * at the checked-out branch) is meaningless as a base — it would
 * collapse the delta to full history — so it is skipped and the static
 * candidates apply. Without a remote default, the static candidates
 * follow.
 *
 * @param repoDir - The clone's working tree.
 * @param head - The analyzed branch's head sha.
 * @param options - Overrides for the git invocations (see `runGit`).
 * @returns The default candidates, most preferred first.
 */
async function resolveDefaultCandidates(
  repoDir: string,
  head: string,
  options: RunGitOptions,
): Promise<string[]> {
  const defaultBranch = await parseDefaultBranch(repoDir, options);
  if (defaultBranch !== undefined && (await resolveRef(repoDir, defaultBranch, options)) !== head) {
    return [...new Set([defaultBranch, `origin/${defaultBranch}`, ...DEFAULT_CANDIDATES])];
  }
  return DEFAULT_CANDIDATES;
}

/**
 * Resolves the remote's canonical default branch from
 * `refs/remotes/origin/HEAD` (`git symbolic-ref`), as the bare branch
 * name (e.g. `main`) — or `undefined` when no remote default exists. A
 * clone with no upstream, or a repository without `origin/HEAD`
 * (detached or deleted remote HEAD), yields `undefined` and the static
 * candidates are used.
 *
 * @param repoDir - The clone's working tree.
 * @param options - Overrides for the git invocations (see `runGit`).
 * @returns The remote default branch name, or `undefined`.
 */
async function parseDefaultBranch(
  repoDir: string,
  options: RunGitOptions,
): Promise<string | undefined> {
  try {
    const output = await runGit(repoDir, ['symbolic-ref', 'refs/remotes/origin/HEAD'], options);
    const ref = output.trim();
    const prefix = 'refs/remotes/origin/';
    if (ref.startsWith(prefix) && ref.length > prefix.length) {
      return ref.slice(prefix.length);
    }
    return undefined;
  } catch (error) {
    // A missing or detached origin/HEAD fails `symbolic-ref` — exit 128
    // with "not a symbolic ref" (older git uses exit 1) — the normal
    // fall-through to the static candidates. Genuine failures (a corrupt
    // clone, a missing git binary) must propagate instead of silently
    // degrading to full history.
    if (
      error instanceof GitError &&
      (error.exitCode === 1 || /not a symbolic ref/u.test(error.stderr))
    ) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Resolves a single ref to its full sha with `git rev-parse --verify
 * --quiet --end-of-options`, or `undefined` when the ref does not
 * exist. The `--quiet` flag suppresses the error message of a missing
 * ref and `--end-of-options` marks the ref as a positional argument, so
 * an option-like value (e.g. a branch named `--all`) is parsed as a ref
 * name, never as a git flag. A missing ref (`rev-parse --verify` exits
 * `1`) is the documented fall-through, reported as "not found"; any
 * other failure (a corrupt clone, a missing git binary) exits `128` or
 * throws without an exit code and must surface with its cause instead
 * of degrading to a silently-wrong full-history analysis.
 *
 * @param repoDir - The clone's working tree.
 * @param ref - The ref to resolve, e.g. `master` or `origin/main`.
 * @param options - Overrides for the git invocations (see `runGit`).
 * @returns The resolved full sha, or `undefined`.
 */
async function resolveRef(
  repoDir: string,
  ref: string,
  options: RunGitOptions,
): Promise<string | undefined> {
  try {
    const output = await runGit(
      repoDir,
      ['rev-parse', '--verify', '--quiet', '--end-of-options', ref],
      options,
    );
    const trimmed = output.trim();
    return trimmed === '' ? undefined : trimmed;
  } catch (error) {
    // `rev-parse --verify` exits 1 for a ref that does not exist — the
    // normal fall-through; genuine failures (exit 128, could-not-start)
    // must propagate instead of silently degrading to full history.
    if (error instanceof GitError && error.exitCode === 1) {
      return undefined;
    }
    throw error;
  }
}
