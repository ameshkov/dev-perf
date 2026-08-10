/**
 * Clone/cache management: `ensureClone` reuses a cached full clone when
 * `repo/` exists, `clone.json` matches the URL, and the clone carries
 * no partial-clone config (an old `blob:none` clone — created before
 * dev-perf switched to full clones — would fetch blobs lazily and is
 * re-cloned); it re-clones on `--refresh`, and it always clones in
 * full (`git clone`, no object filter): every blob is local right
 * after the clone, so the commit read (`git log --numstat`), the
 * branch-delta base resolution, and the LLM phase never depend on the
 * remote again.
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
  /** The repository's scoped logger for clone warnings. */
  log?: ScopedLog;
  /** Git executable to run; defaults to `git`. Tests override it to
   * simulate specific git behaviors. */
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
 * same cache entry are serialized, so a re-clone (a stale partial
 * clone re-cloned as full, or `--refresh`) that replaces `repo/` never
 * runs while a concurrent analysis of the same entry is still reading
 * it. Without this, two specs that share a URL and branch — but differ
 * in base or ignored paths, so they analyze in parallel — could race:
 * one's re-clone removes `repo/` under the other's in-flight `git log`
 * or LLM file reads, which then fail and abort the run. Entries are
 * unique per URL+branch, so only shared entries contend; different
 * repositories still analyze in parallel.
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
 * @param run - The exclusive section: clone/reuse, commit reading, and
 * the repository's analysis.
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
 * local paths are converted to the `file://` form so the clone is
 * uniform (a plain local path makes git hardlink the objects, while
 * `file://` forces a full object copy — a behavior difference this
 * conversion removes).
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
 * Ensures a repository is cloned into the cache: reuses the full
 * clone when `repo/` exists, `clone.json` matches the URL (and branch),
 * and the clone is not a stale partial clone (`isPromisorClone`);
 * re-clones (removing the old `repo/`) on `--refresh` or when the cache
 * is stale. Clones always in full — every blob is local after the
 * clone, so nothing later depends on the remote. Writes `clone.json`
 * after cloning. The cache entry is keyed by the URL and the requested
 * branch, so different branches never share a cache entry. Concurrent
 * calls for the *same* entry (the parallel analysis of specs that share
 * a URL and branch but differ in base or ignored paths) share one
 * clone: the first caller clones and the rest await the same in-flight
 * promise, so the entry's `repo/` directory is never touched by two
 * clones at once. The clone start, naming the cache entry directory, is
 * logged through the scoped logger; the caller logs the outcome with
 * its duration.
 *
 * @param url - Repository URL or local path as given on the command line.
 * @param options - Cache directory, refresh flag, branch, and git overrides.
 * @returns The clone location and identity.
 * @throws {GitError} When the clone fails after all retries.
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
 * reuses the cached clone when it matches and carries no partial-clone
 * config (a stale `blob:none` clone — created before dev-perf switched
 * to full clones — would fetch blobs lazily, so it is re-cloned), or
 * removes the old `repo/` and clones fresh in full — every blob is
 * local after the clone, so the analysis never touches the remote
 * again — recording the clone identity in `clone.json`.
 *
 * @param entryDir - The cache entry directory to clone into.
 * @param url - Repository URL or local path as given on the command line.
 * @param options - Cache directory, refresh flag, branch, and git overrides.
 * @param log - The repository's scoped logger for clone warnings.
 * @returns The clone location and identity.
 * @throws {GitError} When the clone fails after all retries.
 */
async function cloneIntoEntry(
  entryDir: string,
  url: string,
  options: EnsureCloneOptions,
  log: ScopedLog,
): Promise<CloneResult> {
  const gitOptions = cloneGitOptions(options);

  // A cached clone is reused only when it is a full clone: a stale
  // partial clone (`remote.origin.promisor` = `true`, created before
  // dev-perf switched to full clones) would fetch missing blobs lazily
  // and depend on the remote, so it is re-cloned as a full clone.
  const cached = await readCloneInfo(entryDir);
  if (!options.refresh && cached !== undefined && cached.url === url) {
    const existing = repoDir(entryDir);
    const existingStat = await stat(existing).catch(() => undefined);
    if (existingStat?.isDirectory()) {
      const stalePartial = await isPromisorClone(existing, gitOptions);
      if (!stalePartial) {
        return {
          entryDir,
          repoDir: existing,
          branch: cached.branch,
          head: cached.head,
          clonedAt: cached.clonedAt,
          reused: true,
        };
      }
      log.warn(`cached clone of "${url}" is a stale partial clone; re-cloning as a full clone`);
    }
  }

  // (Re-)clone: remove the old repo/ first, then clone into a fresh one.
  await rm(repoDir(entryDir), { recursive: true, force: true });
  await mkdir(entryDir, { recursive: true });

  const target = cloneTarget(url);
  const branchArgs =
    options.branch === undefined || options.branch === '' ? [] : ['--branch', options.branch];
  // A clone can take a long time; log that it started so the user sees
  // what dev-perf is doing instead of a silent wait. Naming the cache
  // entry directory lets the user match the repository to its cache
  // entry from the log. The caller logs the outcome (`cloned "..." in
  // N ms (cache "...")`) once this returns. The start line is coarse
  // stage progress, so it stays visible even in quiet mode.
  log.progress(`cloning "${url}" (cache "${entryDir}")`);
  await gitClone(entryDir, [...branchArgs, target, 'repo'], gitOptions);

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
 * Whether the clone at `repoDir` is a partial (promisor) clone: carries
 * the `remote.origin.promisor` = `true` config written by `git clone
 * --filter=blob:none`. dev-perf clones in full, so a cached clone
 * showing this config is a stale partial clone created by an older
 * version — it would fetch missing blobs lazily during the commit read
 * (one connection per blob, and dependent on the remote) — and is
 * re-cloned as a full clone instead of reused. A failed probe (a
 * missing config key, or git erroring) means a full clone, so the
 * cached clone is reused.
 *
 * @param repoDir - The clone's working tree.
 * @param gitOptions - Overrides for the git invocation (see `runGit`).
 * @returns True when the clone carries partial-clone (promisor) config.
 */
async function isPromisorClone(repoDir: string, gitOptions: RunGitOptions): Promise<boolean> {
  try {
    return (
      (await runGit(repoDir, ['config', '--get', 'remote.origin.promisor'], gitOptions)).trim() ===
      'true'
    );
  } catch {
    return false;
  }
}

/**
 * The git invocation options of a clone: the configured git binary.
 *
 * @param options - The clone options as passed to `ensureClone`.
 * @returns The git options for the clone and its post-clone commands.
 */
function cloneGitOptions(options: EnsureCloneOptions): RunGitOptions {
  return {
    gitBinary: options.gitBinary,
  };
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
