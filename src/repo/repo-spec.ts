/**
 * Repository spec parsing: a repository argument may carry an optional
 * `#branch` suffix (`https://host/org/repo.git#dev`, `/path/to/repo#dev`)
 * selecting the branch to analyze for that repository alone — every
 * repository of a run gets its own branch or the default. The suffix is
 * separated on the first `#`; git ref names cannot contain the
 * characters that would make this ambiguous in a clone URL, and a local
 * path or URL with a trailing `#` and nothing after it counts as "no
 * branch".
 */

/**
 * A parsed repository argument: the full spec as given (used for
 * logging and the run's parameter list) split into the bare clone
 * target and the branch to analyze.
 */
export interface RepoSpec {
  /** The full spec as given, e.g. `https://host/org/repo.git#dev`. */
  spec: string;
  /** The clone target without any `#branch` suffix (URL or local path). */
  repo: string;
  /** The branch to analyze, when the spec carried a `#branch` suffix. */
  branch?: string;
}

/**
 * Parses a repository argument into its clone target and branch: a
 * `#branch` suffix picks the branch to analyze for this repository
 * alone; without one, the repository's default branch is used. The
 * split happens on the first `#`, so the whole suffix — including
 * slash-containing branch names like `feat/foo` — is the branch.
 *
 * @param spec - Repository URL or local path, optionally with a
 * `#branch` suffix, as given on the command line or in the config.
 * @returns The clone target and the branch to analyze, if any.
 */
export function parseRepoSpec(spec: string): RepoSpec {
  const hash = spec.indexOf('#');
  if (hash === -1) {
    return { spec, repo: spec };
  }
  const branch = spec.slice(hash + 1);
  const repo = spec.slice(0, hash);
  return branch === '' ? { spec, repo } : { spec, repo, branch };
}
