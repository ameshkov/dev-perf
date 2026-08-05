/**
 * Per-repository analysis: clone/cache reuse, commit reading and author
 * grouping for the run's whole range, the LLM phase when enabled (one
 * opencode server per repo, shared by all its periods, restarted with a
 * fresh server when an attempt fails), and per-period report assembly.
 * `analyzeRepository` is the single entry; the pipeline runs it once
 * per repository — in parallel up to `--parallel` — with the run's
 * resolved range and periods.
 */
import path from 'node:path';
import type { CliOptions } from './config.js';
import { readCommits } from './deterministic/commits.js';
import type { AuthorGroup } from './deterministic/identity.js';
import { groupByAuthor } from './deterministic/identity.js';
import { analyzeRepositoryLLM } from './llm/analyze.js';
import { createSessionService } from './llm/session.js';
import type { SessionService } from './llm/session.js';
import { startServer } from './llm/server.js';
import type { LlmServerConfig, LlmServerHandle } from './llm/server.js';
import { assembleRepository } from './report/index.js';
import type { AnalyzedRange, LlmAnalysis, Repository } from './report/index.js';
import { ensureClone } from './repo/clone.js';
import type { CloneResult } from './repo/clone.js';
import { filterGroupsForPeriod } from './trend/periods.js';
import { errorDetail } from './util/error.js';
import { pluralize, rangeBound } from './util/format.js';
import type { ScopedLog } from './util/log.js';

/** One repository analyzed across all periods of the run. */
interface RepoAnalysis {
  /** Resolved author-date range of the run (UTC instants). */
  range: AnalyzedRange;
  /** Period bounds of the run; one whole-range period without `--unit`. */
  periods: AnalyzedRange[];
  /** Assembled repository entries, one per period. */
  repositories: Repository[];
}

/** The repo's LLM phase: one opencode server and its session service. */
interface LlmPhase {
  /** The running server, closed by the caller. */
  server: LlmServerHandle;
  /** The session service bound to the server. */
  service: SessionService;
}

/**
 * Analyzes one repository across the run's periods: ensures the clone
 * (reusing the cache when possible), reads the commits of the whole
 * range once, groups them by author, and runs the LLM phase when
 * enabled (`runLlmPhase` — one opencode server per attempt, restarted
 * between retries). Each period gets the groups' commits filtered to
 * its bounds, an LLM analysis for its active users, and an assembled
 * repository entry. The range and periods come from the run — the
 * pipeline resolved them from the first clone before the parallel
 * phase.
 *
 * @param repo - Repository URL or local path as given on the command line.
 * @param options - Validated CLI options.
 * @param range - The run's resolved author-date range.
 * @param periods - The run's period bounds.
 * @param log - The repository's scoped logger.
 * @returns The resolved range, the period bounds, and the per-period
 * entries.
 * @throws {GitError} When a clone or git log fails, or a bound date
 * cannot be parsed.
 * @throws {Error} When the LLM phase fails; the message names the repo
 * — and the period when `--unit` is set — plus the underlying cause.
 */
export async function analyzeRepository(
  repo: string,
  options: CliOptions,
  range: AnalyzedRange,
  periods: AnalyzedRange[],
  log: ScopedLog,
): Promise<RepoAnalysis> {
  const startedAt = Date.now();
  const clone = await ensureClone(repo, {
    cacheDir: options.cacheDir,
    refresh: options.refresh,
    log,
  });
  log.info(
    `${clone.reused ? 'reused cached clone' : 'cloned'} "${repo}" in ${Date.now() - startedAt} ms`,
  );
  const commits = await readCommits(clone.repoDir, { since: options.since, until: options.until });
  const groups = groupByAuthor(commits);
  log.info(`${pluralize(commits.length, 'commit')} from ${pluralize(groups.length, 'author')}`);

  const repositories = await runLlmPhase(repo, clone, periods, groups, options, log);
  return { range, periods, repositories };
}

/**
 * Runs a repository's LLM phase with automatic retries: the analysis
 * (server start plus per-period sessions) is attempted up to
 * `1 + llmRetries` times, and every failed attempt is retried with a
 * fully restarted opencode server — the server is stopped and its
 * whole process tree force-killed when it does not exit, so the next
 * attempt starts from a clean slate. Completed per-user analyses are
 * cached and reused across attempts, so a retry only re-runs the
 * sessions that failed. The analysis succeeds as soon as one attempt
 * completes; when every attempt fails, the error names the repository
 * and the attempt count. With `llmRetries: 0` the original error is
 * rethrown unchanged (fail fast).
 *
 * @param repo - Repository URL or local path as given on the command line.
 * @param clone - The clone the analysis runs in.
 * @param periods - The run's period bounds.
 * @param groups - The author groups of the whole range.
 * @param options - Validated CLI options.
 * @param log - The repository's scoped logger.
 * @returns One assembled repository entry per period.
 * @throws {Error} When every LLM attempt fails; the message names the
 * repo — and the period when `--unit` is set — plus the underlying
 * cause.
 */
async function runLlmPhase(
  repo: string,
  clone: CloneResult,
  periods: AnalyzedRange[],
  groups: AuthorGroup[],
  options: CliOptions,
  log: ScopedLog,
): Promise<Repository[]> {
  const attempts = 1 + options.llmRetries;
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) {
      log.warn(
        `LLM: attempt ${attempt - 1} of ${attempts} failed; ` +
          `restarting the opencode server and retrying: ${errorDetail(lastError)}`,
      );
    }
    let llm: LlmPhase | undefined;
    try {
      llm = await startLlmServer(repo, clone, groups, options, log);
      return await assemblePeriods(repo, clone, periods, groups, llm, options, log);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(errorDetail(error));
    } finally {
      // Fully stop the server — SIGTERM, a bounded wait, and a
      // force-kill of its whole process tree when it ignores SIGTERM —
      // so the next attempt starts from a clean slate.
      await closeLlmServer(llm, log);
    }
  }
  if (attempts === 1) {
    // No retries configured: surface the original error unchanged.
    throw lastError ?? new Error(`LLM analysis failed for ${repo}`);
  }
  throw new Error(
    `LLM analysis failed for ${repo} after ${attempts} attempts: ${errorDetail(lastError)}`,
    { cause: lastError },
  );
}

/**
 * Starts the repo's LLM phase when enabled and the range has authors:
 * one opencode server with its session service, shared by all of the
 * repo's periods. Returns `undefined` when LLM analysis is disabled or
 * the repo has no authors in the range.
 *
 * @param repo - Repository URL or local path as given on the command line.
 * @param clone - The clone the analysis runs in.
 * @param groups - The author groups of the whole range.
 * @param options - Validated CLI options.
 * @param log - The repository's scoped logger.
 * @returns The server and its session service, or `undefined`.
 * @throws {Error} When the server cannot start; the message names the
 * repo and the underlying cause.
 */
async function startLlmServer(
  repo: string,
  clone: CloneResult,
  groups: AuthorGroup[],
  options: CliOptions,
  log: ScopedLog,
): Promise<LlmPhase | undefined> {
  if (!options.llm || groups.length === 0) {
    if (options.llm) {
      log.info(`LLM: no authors in the range; skipping LLM analysis`);
    }
    return undefined;
  }
  try {
    const server = await startServer(clone.repoDir, llmServerConfig(options), log);
    return { server, service: createSessionService(server.client, log) };
  } catch (error) {
    // errorDetail walks the cause chain: a bare `fetch failed` from
    // the opencode SDK gets its real reason (e.g. `connect ECONNREFUSED
    // 127.0.0.1:50664`) appended.
    throw new Error(`LLM analysis failed for ${repo}: ${errorDetail(error)}`, { cause: error });
  }
}

/**
 * Assembles one repository entry per period: each period gets the
 * groups' commits filtered to its bounds, an LLM analysis for its
 * active users, and an assembled repository entry.
 *
 * @param repo - Repository URL or local path as given on the command line.
 * @param clone - The clone the analysis runs in.
 * @param periods - The run's period bounds.
 * @param groups - The author groups of the whole range.
 * @param llm - The repo's LLM phase, or `undefined` when disabled.
 * @param options - Validated CLI options.
 * @param log - The repository's scoped logger.
 * @returns One assembled repository entry per period.
 * @throws {Error} When the LLM phase fails; the message names the repo
 * — and the period when `--unit` is set — plus the underlying cause.
 */
async function assemblePeriods(
  repo: string,
  clone: CloneResult,
  periods: AnalyzedRange[],
  groups: AuthorGroup[],
  llm: LlmPhase | undefined,
  options: CliOptions,
  log: ScopedLog,
): Promise<Repository[]> {
  const repositories: Repository[] = [];
  for (const period of periods) {
    const filtered = filterGroupsForPeriod(groups, period);
    let llmResults: ReadonlyMap<string, LlmAnalysis> | undefined;
    if (llm !== undefined) {
      try {
        llmResults = await analyzePeriodLlm(
          repo,
          clone,
          period,
          filtered,
          options,
          llm.service,
          log,
        );
      } catch (error) {
        const where =
          options.unit === undefined
            ? ''
            : ` in period ${rangeBound(period.since)} to ${rangeBound(period.until)}`;
        throw new Error(`LLM analysis failed for ${repo}${where}: ${errorDetail(error)}`, {
          cause: error,
        });
      }
    }
    repositories.push(
      assembleRepository({
        repo,
        clonePath: clone.repoDir,
        branch: clone.branch,
        head: clone.head,
        range: period,
        groups: filtered,
        llmResults,
      }),
    );
  }
  return repositories;
}

/**
 * Shuts the repo's LLM server down. A shutdown failure is logged but
 * does not mask an analysis error.
 *
 * @param llm - The repo's LLM phase, or `undefined` when none started.
 * @param log - The repository's scoped logger.
 */
async function closeLlmServer(llm: LlmPhase | undefined, log: ScopedLog): Promise<void> {
  if (llm === undefined) {
    return;
  }
  try {
    await llm.server.close();
  } catch (error) {
    log.warn(`LLM server shutdown failed: ${errorDetail(error)}`);
  }
}

/**
 * Runs the LLM phase for one period of a repository: the repo's
 * opencode server is reused, and `analyzeRepositoryLLM` produces one
 * analysis per user with commits in the period (cached results reused
 * unless `--refresh`). Users without commits in the period get no
 * analysis — their report entries stay skipped. Returns `undefined`
 * when no user has commits in the period.
 *
 * @param repo - Repository URL or local path as given on the command line.
 * @param clone - The clone the analysis runs in.
 * @param period - The period bounds (UTC instants).
 * @param groups - The period's author groups (zero-commit groups kept).
 * @param options - Validated CLI options.
 * @param service - The session service bound to the repo's server.
 * @param log - The repository's scoped logger.
 * @returns Completed analyses keyed by lowercased author email, or
 * `undefined` when the period has no active users.
 * @throws {Error} When an analysis fails; the message names the user
 * and session plus the underlying cause.
 */
async function analyzePeriodLlm(
  repo: string,
  clone: CloneResult,
  period: AnalyzedRange,
  groups: AuthorGroup[],
  options: CliOptions,
  service: SessionService,
  log: ScopedLog,
): Promise<ReadonlyMap<string, LlmAnalysis> | undefined> {
  const active = groups.filter((group) => group.commits.length > 0);
  if (active.length === 0) {
    log.info(
      `LLM: no authors in period ${rangeBound(period.since)} to ${rangeBound(period.until)}; skipping`,
    );
    return undefined;
  }
  const results = await analyzeRepositoryLLM({
    repo,
    cloneDir: clone.repoDir,
    entryDir: path.dirname(clone.repoDir),
    config: llmServerConfig(options),
    range: period,
    groups: active,
    service,
    refresh: options.refresh === true,
    log,
  });
  log.info(
    `LLM: analyzed ${pluralize(results.length, 'user')} in period ${rangeBound(period.since)} to ${rangeBound(period.until)}`,
  );
  return new Map(results.map((result) => [result.email, result.llm]));
}

/**
 * Builds the LLM server configuration from the validated CLI options.
 * `parseCliOptions` guarantees `model`, `providerUrl` and `apiKey`
 * (the key may come from `DEV_PERF_API_KEY`, resolved by
 * `resolveRawOptions`) whenever LLM analysis is enabled; the guard is
 * defensive for direct pipeline callers.
 *
 * @param options - Validated CLI options (LLM enabled).
 * @returns The server configuration.
 * @throws {Error} When a required LLM option is missing — unreachable
 * after `parseCliOptions`, possible only when options are constructed
 * by hand.
 */
function llmServerConfig(options: CliOptions): LlmServerConfig {
  if (
    options.model === undefined ||
    options.providerUrl === undefined ||
    options.apiKey === undefined
  ) {
    throw new Error('model, provider URL and API key are required for LLM analysis');
  }
  return {
    providerUrl: options.providerUrl,
    model: options.model,
    apiKey: options.apiKey,
    limitContext: options.limitContext,
    limitOutput: options.limitOutput,
  };
}
