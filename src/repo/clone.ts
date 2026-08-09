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
import { createScopedLog } from '../util/log.js';
import type { ScopedLog } from '../util/log.js';

/** Matches URLs with a scheme, e.g. `https://`, `ssh://`, `file://`. */
const SCHEME_URL_RE = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

/** Matches scp-like remote URLs, e.g. `git@github.com:org/repo.git`. */
const SCP_LIKE_URL_RE = /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:/;

/** Options accepted by `ensureClone`. */
export interface EnsureCloneOptions {
  /** Cache directory (default: `.dev-cache` under the OS temp dir). */
  cacheDir?: string;
  /** Force a fresh clone even when the cache matches. */
  refresh?: boolean;
  /** Branch to check out and analyze, when not the repository's
   * default branch. Branch-specific clones and LLM results are cached
   * under their own entry, so switching branches never reuses the wrong
   * clone. */
  branch?: string;
  /** Clone as a full clone, without the `--filter=blob:none` partial
   * clone (default: partial). A full clone keeps every blob locally, so
   * none of the analysis depends on the promisor remote — the fallback
   * for a partial clone whose on-demand blob fetch failed. */
  full?: boolean;
  /** The repository's scoped logger for clone warnings. */
  log?: ScopedLog;
  /** Git executable to run; defaults to `git`. Tests override it to
   * simulate hosts that reject partial clones. */
  gitBinary?: string;
}

/**
 * In-flight clone promises keyed by cache entry directory: the pipeline
 * analyzes repositories in parallel, and two specs that share a URL and
 * branch but differ in their base or ignored paths are distinct
 * analyses that land on the *same* cache entry. Without this lock the
 * two would call `ensureClone` on the same entry concurrently and race
 * on its `repo/` directory (a concurrent `rm`/`mkdir`/clone). Instead
 * the first caller clones and later callers await the same in-flight
 * promise, so one entry is cloned exactly once per run.
 */
const inFlightClones = new Map<string, Promise<CloneResult>>();

/**
 * The current tail of each cache entry's analysis queue: analyses of the
 * same cache entry are serialized, so a fallback that re-clones the
 * entry (`rm` + clone of `repo/`) never runs while a concurrent
 * analysis of the same entry is still reading it. Without this, two
 * specs that share a URL and branch — but differ in base or ignored
 * paths, so they analyze in parallel — could race: one's full-clone
 * fallback removes `repo/` under the other's in-flight `git log` or LLM
 * file reads, which then fail with a non-promisor error and abort the
 * run. Entries are unique per URL+branch, so only shared entries
 * contend; different repositories still analyze in parallel.
 */
const entryAnalysisTails = new Map<string, Promise<void>>();

/**
 * Runs a per-cache-entry analysis section under an exclusive lock:
 * concurrent callers for the same entry wait — in first-come order —
 * for the previous caller to settle (success or failure) before they
 * run, so one entry is never analyzed, re-cloned, or read at the same
 * time. Different entries never contend.
 *
 * @param entryDir - The cache entry directory the section touches.
 * @param run - The exclusive section: clone/reuse, commit reading, the
 * full-clone fallback, and the repository's analysis.
 * @returns The section's result.
 * @throws {unknown} The section's error; the lock is released either way.
 */
export async function withEntryAnalysisLock<T>(
  entryDir: string,
  run: () => Promise<T>,
): Promise<T> {
  const previous = entryAnalysisTails.get(entryDir) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  // The next caller chains onto this section's gate; the chain never
  // rejects (a failed analysis still lets the next one through). The
  // gate resolves in `finally`, after the section and its cleanup settle.
  const tail = previous.catch(() => undefined).then(() => gate);
  entryAnalysisTails.set(entryDir, tail);
  // Wait for the previous owner to settle before starting the section.
  await previous.catch(() => undefined);
  try {
    return await run();
  } finally {
    release();
    if (entryAnalysisTails.get(entryDir) === tail) {
      entryAnalysisTails.delete(entryDir);
    }
  }
}

/** Result of `ensureClone`. */
export interface CloneResult {
  /** Absolute path of the clone's cache entry directory
   * (`<cacheDir>/<hash>`); its basename is the entry hash that maps a
   * repository to its cache entry. */
  entryDir: string;
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
 * clones with `--filter=blob:none` — or as a full clone when the
 * `full` option is set — and falls back to a full clone when the
 * hosting rejects partial clones. Writes `clone.json` after cloning.
 * The cache entry is keyed by the URL and the requested branch, so
 * different branches never share a cache entry. Concurrent calls for
 * the *same* entry (the parallel analysis of specs that share a URL and
 * branch but differ in base or ignored paths) share one clone: the
 * first caller clones and the rest await the same in-flight promise,
 * so the entry's `repo/` directory is never touched by two clones at
 * once. The clone start, naming the cache entry directory, is logged
 * through the scoped logger (verbose); the caller logs the outcome
 * with its duration.
 *
 * @param url - Repository URL or local path as given on the command line.
 * @param options - Cache directory, refresh flag, branch, and git overrides.
 * @returns The clone location and identity.
 * @throws {GitError} When cloning fails and the fallback does not apply.
 */
export async function ensureClone(
  url: string,
  options: EnsureCloneOptions = {},
): Promise<CloneResult> {
  const log = options.log ?? createScopedLog();
  const cacheDir = resolveCacheDir(options.cacheDir);
  const entryDir = cacheEntryDir(cacheDir, url, options.branch);

  // Share the in-flight clone of a sibling spec that landed on the same
  // cache entry, instead of racing on its `repo/` directory.
  const inFlight = inFlightClones.get(entryDir);
  if (inFlight !== undefined) {
    return inFlight;
  }

  const clone = cloneIntoEntry(entryDir, url, options, log);
  inFlightClones.set(entryDir, clone);
  try {
    return await clone;
  } finally {
    if (inFlightClones.get(entryDir) === clone) {
      inFlightClones.delete(entryDir);
    }
  }
}

/**
 * The single clone body `ensureClone` protects with its in-flight lock:
 * reuses the cached clone when it matches, or removes the old `repo/`
 * and clones fresh — as a partial clone (`--filter=blob:none`), or as
 * a full clone when the `full` option is set, with the full-clone
 * fallback on hosts that reject partial clones — recording the clone
 * identity in `clone.json`.
 *
 * @param entryDir - The cache entry directory to clone into.
 * @param url - Repository URL or local path as given on the command line.
 * @param options - Cache directory, refresh flag, branch, and git overrides.
 * @param log - The repository's scoped logger for clone warnings.
 * @returns The clone location and identity.
 * @throws {GitError} When cloning fails and the fallback does not apply.
 */
async function cloneIntoEntry(
  entryDir: string,
  url: string,
  options: EnsureCloneOptions,
  log: ScopedLog,
): Promise<CloneResult> {
  const gitOptions = { gitBinary: options.gitBinary };

  const cached = await readCloneInfo(entryDir);
  if (!options.refresh && cached !== undefined && cached.url === url) {
    const existing = repoDir(entryDir);
    const existingStat = await stat(existing).catch(() => undefined);
    if (existingStat?.isDirectory()) {
      return {
        entryDir,
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
  const branchArgs =
    options.branch === undefined || options.branch === '' ? [] : ['--branch', options.branch];
  const filterArgs = options.full ? [] : ['--filter=blob:none'];
  // A clone can take a long time; log that it started so the user sees
  // what dev-perf is doing instead of a silent wait. Naming the cache
  // entry directory lets the user match the repository to its cache
  // entry from the log. The caller logs the outcome (`cloned "..." in
  // N ms (cache "...")`) once this returns. The start line is coarse
  // stage progress, so it stays visible even in quiet mode.
  log.progress(`cloning "${url}" (cache "${entryDir}")`);
  try {
    await gitClone(entryDir, [...filterArgs, ...branchArgs, target, 'repo'], gitOptions);
  } catch (error) {
    if (error instanceof GitError && isPartialCloneFailure(error)) {
      log.warn(`partial clone failed (${error.message}); falling back to a full clone`);
      await gitClone(entryDir, [...branchArgs, target, 'repo'], gitOptions);
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

  return { entryDir, repoDir: cloneDir, branch, head, clonedAt, reused: false };
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
