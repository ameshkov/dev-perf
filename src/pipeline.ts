/**
 * Analysis pipeline orchestration: for each repository — clone/cache,
 * deterministic analysis, the LLM phase when enabled (one opencode
 * server per repo, shared by all its periods), per-period report
 * assembly — then write the report to stdout or the `--output` file.
 * With `--unit`, the analyzed range is split into UTC-aligned periods
 * and the report carries one full per-repository report per period.
 * LLM failures are fatal: the error propagates and the report is not
 * written.
 */
import path from 'node:path';
import type { CliOptions } from './config.js';
import { readCommits, resolveBoundDate } from './deterministic/commits.js';
import type { AuthorGroup } from './deterministic/identity.js';
import { groupByAuthor } from './deterministic/identity.js';
import { analyzeRepositoryLLM } from './llm/analyze.js';
import { createSessionService } from './llm/session.js';
import type { SessionService } from './llm/session.js';
import { startServer } from './llm/server.js';
import type { LlmServerConfig, LlmServerHandle } from './llm/server.js';
import { assembleRepository, assembleTrendReport } from './report/index.js';
import type { AnalyzedRange, LlmAnalysis, Repository, TrendReport } from './report/index.js';
import { ensureClone } from './repo/clone.js';
import type { CloneResult } from './repo/clone.js';
import { filterGroupsForPeriod, splitPeriods } from './trend/periods.js';
import { errorDetail } from './util/error.js';
import { prettyJson, writeJsonFile } from './util/json.js';
import { logInfo, logWarn, setVerbose } from './util/log.js';

/** Date string git resolves for the default `--until` bound. */
const DEFAULT_UNTIL = 'today';

/** One repository analyzed across all periods of the run. */
interface RepoAnalysis {
  /** Resolved author-date range of the run (UTC instants). */
  range: AnalyzedRange;
  /** Period bounds of the run; one whole-range period without `--unit`. */
  periods: AnalyzedRange[];
  /** Assembled repository entries, one per period. */
  repositories: Repository[];
}

/** Per-run analysis state: the range, its periods, and the entries. */
interface RunAnalysis {
  /** Resolved author-date range of the run. */
  range: AnalyzedRange;
  /** Period bounds of the run, oldest first. */
  periods: AnalyzedRange[];
  /** Assembled repository entries per period, one per repo each. */
  repositories: Repository[][];
}

/** The repo's LLM phase: one opencode server and its session service. */
interface LlmPhase {
  /** The running server, closed by the caller. */
  server: LlmServerHandle;
  /** The session service bound to the server. */
  service: SessionService;
}

/**
 * Runs the analysis pipeline end to end: clones or reuses the cached
 * clone for each repository, resolves the analyzed author-date range
 * (once per run — date parsing is repo-independent), splits it into
 * periods when `--unit` is set, extracts commits and groups them by
 * author once per repo, runs the LLM phase when enabled (one server
 * per repo shared by its periods, per-period analyses merged into the
 * report), assembles the report, and writes it as pretty JSON to
 * stdout or the `--output` file. With `options.verbose`, progress
 * (clone/reuse with duration, the resolved range, the period split,
 * per-repo commit counts, LLM sessions) is logged to stderr; stdout
 * stays reserved for the report JSON.
 *
 * @param options - Validated CLI options (see `parseCliOptions`).
 * @returns The assembled trend report document.
 * @throws {GitError} When a clone or a git log fails, or when a bound
 * date cannot be parsed.
 * @throws {Error} When the LLM phase fails (server start, a prompt, or
 * the `devperf_report` enforcement loop); the message names the repo —
 * and the period when `--unit` is set — plus the underlying cause, and
 * the report is not written.
 */
export async function runPipeline(options: CliOptions): Promise<TrendReport> {
  setVerbose(options.verbose === true);
  const analyzed = await analyzeAllRepos(options);
  const report = assembleTrendReport({
    repos: options.repos,
    range: analyzed.range,
    unit: options.unit,
    model: options.llm ? options.model : undefined,
    llmEnabled: options.llm,
    generatedAt: new Date().toISOString(),
    periods: analyzed.periods.map((period, index) => ({
      range: period,
      repositories: analyzed.repositories[index] ?? [],
    })),
  });
  if (options.output !== undefined) {
    await writeJsonFile(options.output, report);
  } else {
    process.stdout.write(prettyJson(report));
  }
  return report;
}

/**
 * Analyzes all repositories of the run: the range is resolved once
 * from the first clone (date parsing is repo-independent) and split
 * into periods once; each repository is then analyzed across those
 * periods. Returns the run range, the period bounds, and the assembled
 * repository entries grouped by period (one entry per repo per
 * period).
 *
 * @param options - Validated CLI options.
 * @returns The run range, periods, and per-period repository entries.
 */
async function analyzeAllRepos(options: CliOptions): Promise<RunAnalysis> {
  let range: AnalyzedRange | undefined;
  let periods: AnalyzedRange[] | undefined;
  const repositories: Repository[][] = [];
  for (const repo of options.repos) {
    const analyzed = await analyzeRepository(repo, options, range, periods);
    range ??= analyzed.range;
    periods ??= analyzed.periods;
    for (let index = 0; index < analyzed.repositories.length; index += 1) {
      (repositories[index] ??= []).push(analyzed.repositories[index]);
    }
  }
  return {
    range: range ?? { since: '', until: '' },
    periods: periods ?? [{ since: '', until: '' }],
    repositories,
  };
}

/**
 * Analyzes one repository across all periods of the run: ensures the
 * clone (reusing the cache when possible), reads the commits of the
 * whole range once, groups them by author, and — when LLM analysis is
 * enabled — starts one opencode server shared by all periods. Each
 * period gets the groups' commits filtered to its bounds, an LLM
 * analysis for its active users, and an assembled repository entry.
 * The range and periods are reused from the run when the first
 * repository already resolved them.
 *
 * @param repo - Repository URL or local path as given on the command line.
 * @param options - Validated CLI options.
 * @param runRange - The run's resolved range, when already resolved.
 * @param runPeriods - The run's period bounds, when already resolved.
 * @returns The resolved range, the period bounds, and the per-period
 * entries.
 * @throws {GitError} When a clone or git log fails, or a bound date
 * cannot be parsed.
 * @throws {Error} When the LLM phase fails; the message names the repo
 * — and the period when `--unit` is set — plus the underlying cause.
 */
async function analyzeRepository(
  repo: string,
  options: CliOptions,
  runRange: AnalyzedRange | undefined,
  runPeriods: AnalyzedRange[] | undefined,
): Promise<RepoAnalysis> {
  const startedAt = Date.now();
  const clone = await ensureClone(repo, { cacheDir: options.cacheDir, refresh: options.refresh });
  logInfo(
    `${clone.reused ? 'reused cached clone' : 'cloned'} ${repo} in ${Date.now() - startedAt} ms`,
  );
  const range = runRange ?? (await resolveRange(clone.repoDir, options.since, options.until));
  const periods = runPeriods ?? splitPeriods(range, options.unit);
  if (runRange === undefined) {
    logInfo(`range: ${rangeBound(range.since)} to ${rangeBound(range.until)}`);
    if (options.unit !== undefined) {
      const first = periods[0];
      const last = periods[periods.length - 1];
      logInfo(
        `periods: ${pluralize(periods.length, options.unit)} from ${rangeBound(first.since)} to ${rangeBound(last.until)}`,
      );
    }
  }
  const commits = await readCommits(clone.repoDir, { since: options.since, until: options.until });
  const groups = groupByAuthor(commits);
  logInfo(
    `${repo}: ${pluralize(commits.length, 'commit')} from ${pluralize(groups.length, 'author')}`,
  );

  const llm = await startLlmServer(repo, clone, groups, options);
  try {
    const repositories = await assemblePeriods(repo, clone, periods, groups, llm, options);
    return { range, periods, repositories };
  } finally {
    await closeLlmServer(llm);
  }
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
 * @returns The server and its session service, or `undefined`.
 * @throws {Error} When the server cannot start; the message names the
 * repo and the underlying cause.
 */
async function startLlmServer(
  repo: string,
  clone: CloneResult,
  groups: AuthorGroup[],
  options: CliOptions,
): Promise<LlmPhase | undefined> {
  if (!options.llm || groups.length === 0) {
    if (options.llm) {
      logInfo(`LLM: ${repo} has no authors in the range; skipping LLM analysis`);
    }
    return undefined;
  }
  try {
    const server = await startServer(clone.repoDir, llmServerConfig(options));
    return { server, service: createSessionService(server.client) };
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
): Promise<Repository[]> {
  const repositories: Repository[] = [];
  for (const period of periods) {
    const filtered = filterGroupsForPeriod(groups, period);
    let llmResults: ReadonlyMap<string, LlmAnalysis> | undefined;
    if (llm !== undefined) {
      try {
        llmResults = await analyzePeriodLlm(repo, clone, period, filtered, options, llm.service);
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
 */
async function closeLlmServer(llm: LlmPhase | undefined): Promise<void> {
  if (llm === undefined) {
    return;
  }
  try {
    await llm.server.close();
  } catch (error) {
    logWarn(`LLM server shutdown failed: ${errorDetail(error)}`);
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
): Promise<ReadonlyMap<string, LlmAnalysis> | undefined> {
  const active = groups.filter((group) => group.commits.length > 0);
  if (active.length === 0) {
    logInfo(
      `LLM: ${repo}: no authors in period ${rangeBound(period.since)} to ${rangeBound(period.until)}; skipping`,
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
  });
  logInfo(
    `LLM: ${repo}: analyzed ${pluralize(results.length, 'user')} in period ${rangeBound(period.since)} to ${rangeBound(period.until)}`,
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

/**
 * Formats one side of the analyzed range for progress logging: an
 * empty string means that side is unbounded.
 *
 * @param bound - The resolved UTC instant, or `''` when unbounded.
 * @returns A human-readable label.
 */
function rangeBound(bound: string): string {
  return bound === '' ? 'unbounded' : bound;
}

/**
 * Renders a count with its unit, pluralizing the unit unless the count
 * is exactly one.
 *
 * @param count - The number.
 * @param unit - The unit in singular form, e.g. `'commit'`.
 * @returns `"1 commit"` or `"3 commits"` etc.
 */
function pluralize(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

/**
 * Resolves the analyzed author-date range to UTC instants with git's
 * own date parser — the same interpretation the scan bounds get.
 * A missing `--since` leaves the start unbounded (`''`); a
 * missing `--until` defaults to `today`. A date-only bound resolves
 * to a fixed time of day instead of the run moment: midnight for
 * `since` and for `until` alike, so a date-only `until` bounds the
 * range at the start of its day (e.g. `--since 2026-01-01 --until
 * 2026-03-01` covers exactly two months).
 *
 * @param repoDir - Directory to run git in; date parsing needs no repo.
 * @param since - Start bound as given on the command line, if any.
 * @param until - End bound as given on the command line, if any.
 * @returns The resolved range.
 */
async function resolveRange(
  repoDir: string,
  since: string | undefined,
  until: string | undefined,
): Promise<AnalyzedRange> {
  return {
    since: since === undefined ? '' : (await resolveBoundDate(repoDir, since)).toISOString(),
    until:
      until === undefined
        ? (await resolveBoundDate(repoDir, DEFAULT_UNTIL)).toISOString()
        : (await resolveBoundDate(repoDir, until)).toISOString(),
  };
}
