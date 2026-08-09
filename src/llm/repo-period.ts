/**
 * Per-period LLM analysis and report assembly for one repository: each
 * period gets the author groups' commits filtered to its bounds, an LLM
 * analysis for its active users (one in-process pi runtime shared by all
 * of the repo's periods), and an assembled repository entry. The config
 * builder (`llmRuntimeConfig`) shared by the runtime bootstrap lives
 * here too — a single source for the pi runtime configuration.
 */
import path from 'node:path';
import type { ReportOptions } from '../config.js';
import type { AuthorGroup } from '../deterministic/identity.js';
import { hasIgnorePaths } from '../deterministic/path-ignore.js';
import { analyzeRepositoryLLM } from './analyze.js';
import type { LlmRuntimeConfig } from './runtime.js';
import type { SessionLimitHit } from './session-limits.js';
import type { SessionService } from './session.js';
import { assembleRepository } from '../report/index.js';
import type { AnalyzedRange, LlmAnalysis, Repository } from '../report/index.js';
import type { CloneResult } from '../repo/clone.js';
import type { RepoSpec } from '../repo/repo-spec.js';
import { filterGroupsForPeriod } from '../trend/periods.js';
import { errorDetail } from '../util/error.js';
import { pluralize, rangeBound } from '../util/format.js';
import type { ScopedLog } from '../util/log.js';
import type { Limit } from '../util/pool.js';

/**
 * Assembles one repository entry per period: each period gets the
 * groups' commits filtered to its bounds, an LLM analysis for its
 * active users, and an assembled repository entry.
 *
 * @param repo - The repository spec, as given with its optional branch.
 * @param clone - The clone the analysis runs in.
 * @param periods - The run's period bounds.
 * @param groups - The author groups of the whole range.
 * @param service - The repo's session service, or `undefined` when LLM
 * analysis is disabled.
 * @param options - Validated CLI options.
 * @param log - The repository's scoped logger.
 * @param exclude - The resolved base commit sha of the branch-delta
 * exclusion, when one is in effect.
 * @param baseName - The resolved base branch name of the branch-delta,
 * when one is in effect.
 * @param limitHit - The session limit the previous attempt exceeded,
 * when this is a retry after such a failure; the retried prompts tell
 * the model to be less thorough but faster.
 * @param sessionLimit - The run's shared gate bounding concurrent LLM
 * sessions.
 * @returns One assembled repository entry per period.
 * @throws {Error} When the LLM phase fails; the message names the repo
 * — and the period when `unit` is set — plus the underlying cause.
 */
export async function assemblePeriods(
  repo: RepoSpec,
  clone: CloneResult,
  periods: AnalyzedRange[],
  groups: AuthorGroup[],
  service: SessionService | undefined,
  options: ReportOptions,
  log: ScopedLog,
  exclude: string | undefined,
  baseName: string | undefined,
  limitHit: SessionLimitHit | undefined,
  sessionLimit: Limit,
): Promise<Repository[]> {
  const repositories: Repository[] = [];
  for (const period of periods) {
    const filtered = filterGroupsForPeriod(groups, period);
    let llmResults: ReadonlyMap<string, LlmAnalysis> | undefined;
    if (service !== undefined) {
      try {
        llmResults = await analyzePeriodLlm(
          repo,
          clone,
          period,
          filtered,
          options,
          service,
          log,
          exclude,
          baseName,
          limitHit,
          sessionLimit,
        );
      } catch (error) {
        const where =
          options.unit === undefined
            ? ''
            : ` in period ${rangeBound(period.since)} to ${rangeBound(period.until)}`;
        throw new Error(`LLM analysis failed for ${repo.repo}${where}: ${errorDetail(error)}`, {
          cause: error,
        });
      }
    }
    repositories.push(assembleRepoEntry(repo, clone, period, filtered, llmResults, baseName));
  }
  return repositories;
}

/**
 * Runs the LLM phase for one period of a repository: the repo's
 * in-process runtime is reused, and `analyzeRepositoryLLM` produces
 * one analysis per user with commits in the period (cached results
 * reused unless `refresh`). Users without commits in the period get
 * no analysis — their report entries stay skipped. Returns `undefined`
 * when no user has commits in the period.
 *
 * @param repo - The repository spec, as given with its optional branch.
 * @param clone - The clone the analysis runs in.
 * @param period - The period bounds (UTC instants).
 * @param groups - The period's author groups (zero-commit groups kept).
 * @param options - Validated CLI options.
 * @param service - The session service bound to the repo's runtime.
 * @param log - The repository's scoped logger.
 * @param exclude - The resolved base commit sha of the branch-delta
 * exclusion, when one is in effect.
 * @param baseName - The resolved base branch name of the branch-delta,
 * when one is in effect.
 * @param limitHit - The session limit the previous attempt exceeded,
 * when this is a retry after such a failure.
 * @param sessionLimit - The run's shared gate bounding concurrent LLM
 * sessions.
 * @returns Completed analyses keyed by lowercased author email, or
 * `undefined` when the period has no active users.
 * @throws {Error} When an analysis fails; the message names the user
 * and session plus the underlying cause.
 */
async function analyzePeriodLlm(
  repo: RepoSpec,
  clone: CloneResult,
  period: AnalyzedRange,
  groups: AuthorGroup[],
  options: ReportOptions,
  service: SessionService,
  log: ScopedLog,
  exclude: string | undefined,
  baseName: string | undefined,
  limitHit: SessionLimitHit | undefined,
  sessionLimit: Limit,
): Promise<ReadonlyMap<string, LlmAnalysis> | undefined> {
  const active = groups.filter((group) => group.commits.length > 0);
  if (active.length === 0) {
    log.progress(
      `LLM: no authors in period ${rangeBound(period.since)} to ${rangeBound(period.until)}; skipping`,
    );
    return undefined;
  }
  const results = await analyzeRepositoryLLM({
    repo: repo.repo,
    cloneDir: clone.repoDir,
    entryDir: path.dirname(clone.repoDir),
    config: llmRuntimeConfig(options),
    branch: clone.branch,
    head: clone.head,
    ...(hasIgnorePaths(repo.ignore) ? { ignore: repo.ignore } : {}),
    ...(baseName === undefined ? {} : { base: baseName }),
    ...(exclude === undefined ? {} : { exclude }),
    range: period,
    groups: active,
    service,
    refresh: options.refresh === true,
    log,
    limit: sessionLimit,
    ...(limitHit === undefined ? {} : { limitHit }),
  });
  log.progress(
    `LLM: analyzed ${pluralize(results.length, 'user')} in period ${rangeBound(period.since)} to ${rangeBound(period.until)}`,
  );
  return new Map(results.map((result) => [result.email, result.llm]));
}

/**
 * Assembles one repository entry for a period from the repo's spec, the
 * clone identity, and the period's filtered groups and LLM results. The
 * configured ignored paths and the resolved base branch name
 * (branch-delta) are recorded on the entry when any were in effect.
 *
 * @param repo - The repository spec, as given with its optional branch.
 * @param clone - The clone the analysis runs in.
 * @param period - The period bounds (UTC instants).
 * @param groups - The period's author groups.
 * @param llmResults - LLM analyses keyed by lowercased email, if any.
 * @param baseName - The resolved base branch name of the branch-delta,
 * when one is in effect.
 * @returns The assembled repository entry.
 */
function assembleRepoEntry(
  repo: RepoSpec,
  clone: CloneResult,
  period: AnalyzedRange,
  groups: AuthorGroup[],
  llmResults: ReadonlyMap<string, LlmAnalysis> | undefined,
  baseName: string | undefined,
): Repository {
  return assembleRepository({
    repo: repo.repo,
    clonePath: clone.repoDir,
    branch: clone.branch,
    head: clone.head,
    range: period,
    groups,
    llmResults,
    ...(hasIgnorePaths(repo.ignore) ? { ignoredPaths: repo.ignore } : {}),
    ...(baseName === undefined ? {} : { baseBranch: baseName }),
  });
}

/**
 * Builds the pi runtime configuration from the validated CLI options.
 * `parseReportOptions` guarantees `model`, `providerUrl` and `apiKey`
 * (the key may come from the config file `api-key` key) whenever LLM
 * analysis is enabled; the guard is defensive for direct pipeline
 * callers.
 *
 * @param options - Validated CLI options (LLM enabled).
 * @returns The runtime configuration.
 * @throws {Error} When a required LLM option is missing — unreachable
 * after `parseReportOptions`, possible only when options are constructed
 * by hand.
 */
export function llmRuntimeConfig(options: ReportOptions): LlmRuntimeConfig {
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
