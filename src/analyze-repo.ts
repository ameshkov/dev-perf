/**
 * Per-repository analysis entry: clone/cache reuse, branch-delta base
 * resolution, commit reading and author grouping for the run's whole
 * range, and the LLM phase when enabled (orchestrated in
 * `src/llm/repo-phase.ts`, per-period assembly in `src/llm/repo-period.ts`).
 * `analyzeRepository` is the single entry; the pipeline runs it once
 * per repository — in parallel up to `parallel` — with the run's
 * resolved range and periods. The run's shared LLM session gate
 * (`sessionLimit`) travels into the LLM phase, so user sessions from
 * every repository share one concurrency cap instead of running one at
 * a time per repository. Repositories are cloned in full, so the
 * commit read is a local `git log --numstat` that never touches the
 * remote.
 */
import type { ReportOptions } from './config.js';
import { resolveBaseSha } from './deterministic/base.js';
import { readCommits } from './deterministic/commits.js';
import type { Commit } from './deterministic/commits.js';
import type { AuthorGroup } from './deterministic/identity.js';
import { groupByAuthor } from './deterministic/identity.js';
import { filterIgnoredCommits, hasIgnoreCommits } from './deterministic/commit-ignore.js';
import { filterCommitsIgnoring, hasIgnorePaths } from './deterministic/path-ignore.js';
import { runLlmPhase } from './llm/repo-phase.js';
import type { AnalyzedRange, Repository } from './report/index.js';
import { cacheEntryDir, resolveCacheDir } from './repo/cache.js';
import { ensureClone, withEntryAnalysisLock } from './repo/clone.js';
import type { CloneResult } from './repo/clone.js';
import type { RunGitOptions } from './repo/git.js';
import type { IgnoreCommitsSpec, RepoSpec } from './repo/repo-spec.js';
import type { EmailMap } from './util/email-map.js';
import { pluralize } from './util/format.js';
import type { ScopedLog } from './util/log.js';
import type { Limit } from './util/pool.js';

/** One repository analyzed across all periods of the run. */
interface RepoAnalysis {
  /** Resolved author-date range of the run (UTC instants). */
  range: AnalyzedRange;
  /** Period bounds of the run; one whole-range period without `unit`. */
  periods: AnalyzedRange[];
  /** Assembled repository entries, one per period. */
  repositories: Repository[];
}

/**
 * Analyzes one repository across the run's periods: ensures the clone
 * (reusing the cache when possible), reads the commits of the whole
 * range once, groups them by author, and runs the LLM phase when
 * enabled (`runLlmPhase` — one in-process pi runtime per attempt,
 * recreated between retries). Each period gets the groups' commits filtered to
 * its bounds, an LLM analysis for its active users, and an assembled
 * repository entry. The range and periods come from the run — the
 * pipeline resolved them from the first clone before the parallel
 * phase. The analysis is bracketed by an always-visible start/end
 * progress pair (`starting analysis of ...` then `finished analysis of
 * ... in <ms> ms`), its end line closed even when the analysis fails.
 *
 * @param repo - The repository spec as given (URL or local path, with
 * an optional branch selecting the branch to analyze).
 * @param options - Validated CLI options.
 * @param range - The run's resolved author-date range.
 * @param periods - The run's period bounds.
 * @param log - The repository's scoped logger.
 * @param emailMap - The compiled email mappings for identity merging.
 * @param sessionLimit - The run's shared gate bounding concurrent LLM
 * sessions, threaded into this repository's LLM phase.
 * @param gitOptions - Overrides for the git invocations (see `runGit`),
 * unset in production. Tests pass a fake `gitBinary` and `retryDelays:
 * []` to keep fixtures fast.
 * @returns The resolved range, the period bounds, and the per-period
 * entries.
 * @throws {GitError} When a clone or git log fails, or a bound date
 * cannot be parsed.
 * @throws {Error} When the LLM phase fails; the message names the repo
 * — and the period when `unit` is set — plus the underlying cause.
 */
export async function analyzeRepository(
  repo: RepoSpec,
  options: ReportOptions,
  range: AnalyzedRange,
  periods: AnalyzedRange[],
  log: ScopedLog,
  emailMap: EmailMap,
  sessionLimit: Limit,
  gitOptions: RunGitOptions = {},
): Promise<RepoAnalysis> {
  const startedAt = Date.now();
  // The whole analysis of one cache entry — the clone, the commit
  // scan, and the LLM phase that reads the clone — runs under an
  // exclusive per-entry lock: concurrent analyses of the same URL+branch
  // (specs that differ only in base or ignored paths) never race on
  // `repo/` or on the LLM results cache. The entry is derived the same
  // way `ensureClone` derives it, so the lock key matches the directory
  // it protects. Different repositories and branches analyze in
  // parallel as usual.
  const entryDir = cacheEntryDir(resolveCacheDir(options.cacheDir), repo.repo, repo.branch);
  // The per-repo start/end pair brackets the whole analysis: the start
  // right before the clone, then a finish line with the duration after
  // the LLM phase settles — in `finally`, so a failing repository
  // still closes the marker it opened (mirroring the run-level
  // `starting report` / `finished report in <ms> ms` pair). Both are
  // coarse stage progress, always visible in quiet mode.
  log.progress(`starting analysis of "${repo.repo}"`);
  try {
    return await withEntryAnalysisLock(entryDir, () =>
      analyzeEntry(repo, options, range, periods, log, emailMap, sessionLimit, gitOptions),
    );
  } finally {
    log.progress(`finished analysis of "${repo.repo}" in ${Date.now() - startedAt} ms`);
  }
}

/**
 * Runs the exclusive per-entry section of one repository: the clone and
 * commit scan happen while no sibling spec sharing the cache entry
 * touches `repo/` (the per-entry lock this runs under guarantees that).
 * The clone and the branch-delta base resolution run before the commit
 * scan; the resolved base name travels to the report entry and the LLM
 * phase, the base sha narrows the scan. Reading the whole-range commit
 * history is the dominant git cost on a large repository; the `reading
 * commits` progress line (and the caller's final `N commits from M
 * authors` line) keeps that visible.
 *
 * @param repo - The repository spec as given.
 * @param options - Validated CLI options.
 * @param range - The run's resolved author-date range.
 * @param periods - The run's period bounds.
 * @param log - The repository's scoped logger.
 * @param emailMap - The compiled email mappings for identity merging.
 * @param sessionLimit - The run's shared gate bounding concurrent LLM
 * sessions.
 * @param gitOptions - Overrides for the git invocations (see `runGit`).
 * @returns The resolved range, the period bounds, and the per-period
 * entries.
 * @throws {GitError} When a clone or git log fails, or a bound date
 * cannot be parsed.
 * @throws {Error} When the LLM phase fails; the message names the repo
 * — and the period when `unit` is set — plus the underlying cause.
 */
async function analyzeEntry(
  repo: RepoSpec,
  options: ReportOptions,
  range: AnalyzedRange,
  periods: AnalyzedRange[],
  log: ScopedLog,
  emailMap: EmailMap,
  sessionLimit: Limit,
  gitOptions: RunGitOptions,
): Promise<RepoAnalysis> {
  // The clone (always in full — every blob local) and the branch-delta
  // base resolution run before the commit scan; the resolved base name
  // travels to the report entry and the LLM phase, the base sha narrows
  // the scan.
  const { clone, exclude, baseName } = await prepareClone(repo, options, log, gitOptions);
  // Reading the whole-range commit history is the dominant git cost on
  // a large repository; log that it started so the user sees what
  // dev-perf is doing instead of a silent wait. The aggregated count
  // (`N commits from M authors`) is logged once this returns. Both
  // lines are coarse stage progress, always visible in quiet mode.
  log.progress(`reading commits`);
  const commits = await readCommits(clone.repoDir, commitRange(options, exclude), gitOptions);
  const groups = filterAndGroup(repo, commits, emailMap, log);

  const repositories = await runLlmPhase(
    repo,
    clone,
    periods,
    groups,
    options,
    log,
    exclude,
    baseName,
    sessionLimit,
  );
  return { range, periods, repositories };
}

/**
 * The commit-range arguments of the whole-range read: the configured
 * author-date bounds, plus the branch-delta exclusion when one is in
 * effect.
 *
 * @param options - Validated CLI options.
 * @param exclude - The resolved base-commit sha of the branch-delta
 * exclusion, when one is in effect.
 * @returns The range to read.
 */
function commitRange(
  options: ReportOptions,
  exclude: string | undefined,
): { since?: string; until?: string; exclude?: string } {
  return {
    since: options.since,
    until: options.until,
    ...(exclude === undefined ? {} : { exclude }),
  };
}

/**
 * Clones (or reuses the cached clone of) the repository and resolves
 * its branch-delta base. The clone progress line and the base outcome
 * are logged here, before the (dominant) commit scan.
 *
 * @param repo - The repository spec as given.
 * @param options - Validated CLI options.
 * @param log - The repository's scoped logger.
 * @param gitOptions - Overrides for the git invocations (see `runGit`).
 * @returns The clone, the base-commit exclusion sha, and the resolved
 * base name.
 * @throws {GitError} When a clone or a base resolution fails.
 */
async function prepareClone(
  repo: RepoSpec,
  options: ReportOptions,
  log: ScopedLog,
  gitOptions: RunGitOptions,
): Promise<{ clone: CloneResult; exclude: string | undefined; baseName: string | undefined }> {
  const startedAt = Date.now();
  const clone = await ensureClone(repo.repo, {
    cacheDir: options.cacheDir,
    refresh: options.refresh,
    branch: repo.branch,
    log,
    gitBinary: gitOptions.gitBinary,
  });
  log.progress(
    `${clone.reused ? 'reused cached clone' : 'cloned'} "${repo.repo}" in ${Date.now() - startedAt} ms (cache "${clone.entryDir}")`,
  );
  // Resolve the branch-delta base once, after the clone, and log the
  // outcome before the commit scan starts.
  const { exclude, baseName } = await resolveBranchDelta(repo, clone, log);
  return { clone, exclude, baseName };
}

/**
 * Removes the repository's excluded commits — by hash and/or message
 * pattern — and its ignored-path commits, and groups the rest by
 * author. Both exclusions are applied here, once, so both the
 * deterministic metrics and the LLM commit list are exclusion-free;
 * without any exclusions the list passes through untouched. The
 * exclusions and the resulting counts are logged.
 *
 * @param repo - The repository spec as given.
 * @param commits - The commits of the whole range, newest first.
 * @param emailMap - The compiled email mappings for identity merging.
 * @param log - The repository's scoped logger.
 * @returns The author groups of the filtered commits.
 */
function filterAndGroup(
  repo: RepoSpec,
  commits: Commit[],
  emailMap: EmailMap,
  log: ScopedLog,
): AuthorGroup[] {
  // The commit exclusions apply first, so the ignored-path pass below
  // counts against the commits that survived them.
  const afterCommits = dropIgnoredCommits(repo, commits, log);
  const ignore = repo.ignore;
  const filtered = hasIgnorePaths(ignore)
    ? filterCommitsIgnoring(afterCommits, ignore)
    : afterCommits;
  if (hasIgnorePaths(ignore)) {
    log.info(`ignored paths for "${repo.repo}": ${ignore.map((path) => `"${path}"`).join(', ')}`);
    if (filtered.length < afterCommits.length) {
      const dropped = afterCommits.length - filtered.length;
      const message = `${pluralize(dropped, 'commit')} dropped by ignored paths for "${repo.repo}"`;
      // A config that excluded the entire history is almost certainly a
      // misconfiguration: surface it as a warning instead of a quiet
      // under-count. A partial drop is normal and stays at `info`.
      if (filtered.length === 0) {
        log.warn(`${message}; the report for this repository will be empty`);
      } else {
        log.info(message);
      }
    }
  }
  const groups = groupByAuthor(filtered, emailMap);
  log.progress(
    `${pluralize(filtered.length, 'commit')} from ${pluralize(groups.length, 'author')}`,
  );
  return groups;
}

/**
 * Drops the repository's excluded commits — by hash and/or message
 * pattern — and logs the exclusions and the resulting count. Without
 * any exclusions the list passes through untouched.
 *
 * @param repo - The repository spec as given.
 * @param commits - The commits of the whole range, newest first.
 * @param log - The repository's scoped logger.
 * @returns The commits after the exclusions.
 */
function dropIgnoredCommits(repo: RepoSpec, commits: Commit[], log: ScopedLog): Commit[] {
  const spec = repo.ignoreCommits;
  if (!hasIgnoreCommits(spec)) {
    return commits;
  }
  log.info(`ignored commits for "${repo.repo}": ${ignoredCommitsSummary(spec)}`);
  const filtered = filterIgnoredCommits(commits, spec);
  if (filtered.length < commits.length) {
    const dropped = commits.length - filtered.length;
    const message = `${pluralize(dropped, 'commit')} dropped by ignored commits for "${repo.repo}"`;
    // A config that excluded the entire history is almost certainly a
    // misconfiguration: surface it as a warning instead of a quiet
    // under-count. A partial drop is normal and stays at `info`.
    if (filtered.length === 0) {
      log.warn(`${message}; the report for this repository will be empty`);
    } else {
      log.info(message);
    }
  }
  return filtered;
}

/**
 * Renders a commit-ignore spec for the log: the hashes and the message
 * patterns as quoted, comma-separated lists, so empty values stay
 * visible.
 *
 * @param spec - The commit exclusions.
 * @returns The renderable summary.
 */
function ignoredCommitsSummary(spec: IgnoreCommitsSpec): string {
  const parts: string[] = [];
  if (spec.hashes !== undefined && spec.hashes.length > 0) {
    parts.push(`hashes ${spec.hashes.map((hash) => `"${hash}"`).join(', ')}`);
  }
  if (spec.messages !== undefined && spec.messages.length > 0) {
    parts.push(`messages ${spec.messages.map((pattern) => `"${pattern}"`).join(', ')}`);
  }
  return parts.join('; ');
}

/**
 * Resolves the branch-delta base of a clone and logs the outcome: the
 * analysis scopes to the commits reachable from the branch head but not
 * from the base (per-release attribution). A base that is the analyzed
 * branch head itself means full history — a branch is never emptied by
 * its own delta — and an unresolvable explicit base falls back to full
 * history with a warning instead of failing. The resolved base *name*
 * (e.g. `origin/main`) travels to the report entry and the LLM phase;
 * only the delta's sha narrows the commit scan.
 *
 * @param repo - The repository spec, as given with its optional base.
 * @param clone - The clone the analysis runs in.
 * @param log - The repository's scoped logger.
 * @returns The base-commit exclusion sha and the resolved base name,
 * when delta analysis is in effect.
 */
async function resolveBranchDelta(
  repo: RepoSpec,
  clone: CloneResult,
  log: ScopedLog,
): Promise<{ exclude: string | undefined; baseName: string | undefined }> {
  const base = await resolveBaseSha(clone.repoDir, repo.base, clone.head);
  const delta = base !== undefined && base.sha !== clone.head ? base : undefined;
  if (delta !== undefined) {
    log.info(`analyzing "${repo.repo}" excluding base "${delta.base}"`);
  } else if (base !== undefined) {
    log.info(`base "${base.base}" is the head of "${repo.repo}"; analyzing the full history`);
  } else if (repo.base !== undefined && repo.base !== '') {
    log.warn(`base branch "${repo.base}" not found for "${repo.repo}"; analyzing the full history`);
  } else if (repo.base === undefined) {
    // A repository with no resolvable default base (`main` → `master`)
    // degrades to full history — a normal, benign fallback, so it is
    // logged at `info` rather than `warn`; only an explicitly
    // configured base that cannot be resolved merits a warning.
    log.info(`no base branch (main/master) found for "${repo.repo}"; analyzing the full history`);
  }
  return { exclude: delta?.sha, baseName: delta?.base };
}
