/**
 * Clone/cache management: `ensureClone` reuses a
 * cached clone when `repo/` exists and `clone.json` matches the URL,
 * re-clones on `--refresh`, and clones with `--filter=blob:none`
 * (partial clone), falling back to a full clone when the hosting
 * rejects the filter.
 */
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cacheEntryDir, readCloneInfo, repoDir, resolveCacheDir, writeCloneInfo } from './cache.js';
import { GitError, gitClone, runGit } from './git.js';
import type { RunGitOptions } from './git.js';
import { logWarn } from '../util/log.js';

/** Matches URLs with a scheme, e.g. `https://`, `ssh://`, `file://`. */
const SCHEME_URL_RE = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

/** Matches scp-like remote URLs, e.g. `git@github.com:org/repo.git`. */
const SCP_LIKE_URL_RE = /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:/;

/** Options accepted by `ensureClone`. */
export interface EnsureCloneOptions {
  /** Cache directory (default: `.dev-perf/cache` under the cwd). */
  cacheDir?: string;
  /** Force a fresh clone even when the cache matches. */
  refresh?: boolean;
  /** Git executable to run; defaults to `git`. Tests override it to
   * simulate hosts that reject partial clones. */
  gitBinary?: string;
}

/** Result of `ensureClone`. */
export interface CloneResult {
  /** Absolute path of the cloned repository working tree. */
  repoDir: string;
  /** Branch the clone was checked out on. */
  branch: string;
  /** Head commit sha of the clone. */
  head: string;
  /** When the clone was made (ISO 8601, UTC; from clone.json when reused). */
  clonedAt: string;
  /** Whether an existing clone was reused instead of re-cloning. */
  reused: boolean;
}

/**
 * Whether a clone failure means the hosting rejected the partial-clone
 * filter, so a full-clone retry makes sense. Hosts that silently ignore
 * the filter (a warning, not an error) need no fallback; hosts that
 * hard-fail without mentioning the filter (e.g. a dropped connection)
 * are indistinguishable from network failures and are not retried.
 *
 * @param error - The failed clone's error.
 * @returns True when the error plausibly relates to `--filter`.
 */
function isPartialCloneFailure(error: GitError): boolean {
  return /filter/i.test(`${error.message}\n${error.stderr}`);
}

/**
 * Whether the given repo spec is a remote URL rather than a local path.
 *
 * @param repo - Repository URL or local path as given on the command line.
 * @returns True for remote URLs (scheme or scp-like forms).
 *
 * @internal Exported for tests only (`clone.test.ts`); used by
 * `cloneTarget` within the module. Not part of the public module API.
 */
export function isRemoteUrl(repo: string): boolean {
  return SCHEME_URL_RE.test(repo) || SCP_LIKE_URL_RE.test(repo);
}

/**
 * The target passed to `git clone`: remote URLs pass through as-is;
 * local paths are converted to the `file://` form so `--filter` applies
 * (plain paths make git ignore the filter with a warning).
 *
 * @param repo - Repository URL or local path as given on the command line.
 * @returns The clone target.
 *
 * @internal Exported for tests only (`clone.test.ts`); used by
 * `ensureClone` within the module. Not part of the public module API.
 */
export function cloneTarget(repo: string): string {
  if (isRemoteUrl(repo)) {
    return repo;
  }
  return pathToFileURL(path.resolve(repo)).href;
}

/**
 * Ensures a repository is cloned into the cache: reuses the
 * clone when `repo/` exists and `clone.json` matches the URL; re-clones
 * (removing the old `repo/`) on `--refresh` or when the cache is stale;
 * clones with `--filter=blob:none` and falls back to a full clone when
 * the hosting rejects partial clones. Writes `clone.json` after cloning.
 *
 * @param url - Repository URL or local path as given on the command line.
 * @param options - Cache directory, refresh flag, and git overrides.
 * @returns The clone location and identity.
 * @throws {GitError} When cloning fails and the fallback does not apply.
 */
export async function ensureClone(
  url: string,
  options: EnsureCloneOptions = {},
): Promise<CloneResult> {
  const cacheDir = resolveCacheDir(options.cacheDir);
  const entryDir = cacheEntryDir(cacheDir, url);
  const gitOptions = { gitBinary: options.gitBinary };

  const cached = await readCloneInfo(entryDir);
  if (!options.refresh && cached !== undefined && cached.url === url) {
    const existing = repoDir(entryDir);
    const existingStat = await stat(existing).catch(() => undefined);
    if (existingStat?.isDirectory()) {
      return {
        repoDir: existing,
        branch: cached.branch,
        head: cached.head,
        clonedAt: cached.clonedAt,
        reused: true,
      };
    }
  }

  // (Re-)clone: remove the old repo/ first, then clone into a fresh one.
  await rm(repoDir(entryDir), { recursive: true, force: true });
  await mkdir(entryDir, { recursive: true });

  const target = cloneTarget(url);
  try {
    await gitClone(entryDir, ['--filter=blob:none', target, 'repo'], gitOptions);
  } catch (error) {
    if (error instanceof GitError && isPartialCloneFailure(error)) {
      logWarn(`partial clone failed (${error.message}); falling back to a full clone`);
      await gitClone(entryDir, [target, 'repo'], gitOptions);
    } else {
      throw error;
    }
  }

  const cloneDir = repoDir(entryDir);
  // `git branch --show-current` (not `rev-parse --abbrev-ref HEAD`)
  // also works in an empty repository with no commits yet.
  const [branch, head] = await Promise.all([
    runGit(cloneDir, ['branch', '--show-current'], gitOptions),
    resolveHeadSha(cloneDir, gitOptions),
  ]);

  const clonedAt = new Date().toISOString();
  await writeCloneInfo(entryDir, { url, clonedAt, branch, head });

  return { repoDir: cloneDir, branch, head, clonedAt, reused: false };
}

/**
 * Resolves the head sha of a fresh clone. An empty repository (no
 * commits yet) has no HEAD — git fails with an ambiguous-argument
 * error, which is recorded as the empty string so cloning empty
 * repositories still works (the report then carries an empty head).
 *
 * @param cloneDir - The fresh clone's working tree.
 * @param gitOptions - Overrides for the git invocation.
 * @returns The head sha, or `''` when the repository has no commits.
 * @throws {GitError} When rev-parse fails for another reason.
 */
async function resolveHeadSha(cloneDir: string, gitOptions: RunGitOptions): Promise<string> {
  try {
    return await runGit(cloneDir, ['rev-parse', 'HEAD'], gitOptions);
  } catch (error) {
    if (error instanceof GitError && error.stderr.includes('unknown revision')) {
      return '';
    }
    throw error;
  }
}
