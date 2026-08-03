/**
 * Analysis pipeline orchestration: for each repository — clone/cache,
 * deterministic analysis, the LLM phase when enabled (one opencode
 * server per repo), report assembly — then write the report to stdout
 * or the `--output` file. LLM failures are fatal: the error propagates
 * and the report is not written.
 */
import path from 'node:path';
import type { CliOptions } from './config.js';
import { readCommits, resolveBoundDate } from './deterministic/commits.js';
import type { AuthorGroup } from './deterministic/identity.js';
import { groupByAuthor } from './deterministic/identity.js';
import { analyzeRepositoryLLM } from './llm/analyze.js';
import { createSessionService } from './llm/session.js';
import { startServer } from './llm/server.js';
import type { LlmServerConfig } from './llm/server.js';
import { assembleReport, assembleRepository } from './report/index.js';
import type { AnalyzedRange, LlmAnalysis, Report, Repository } from './report/index.js';
import { ensureClone } from './repo/clone.js';
import type { CloneResult } from './repo/clone.js';
import { errorDetail } from './util/error.js';
import { prettyJson, writeJsonFile } from './util/json.js';
import { logInfo, logWarn, setVerbose } from './util/log.js';

/** Date string git resolves for the default `--until` bound. */
const DEFAULT_UNTIL = 'today';

/**
 * Runs the analysis pipeline end to end: clones or reuses the cached
 * clone for each repository, resolves the analyzed author-date range,
 * extracts commits and groups them by author, runs the LLM phase when
 * enabled (one server per repo, per-user analyses merged into the
 * report), assembles the report, and writes it as pretty JSON to
 * stdout or the `--output` file. With `options.verbose`, progress
 * (clone/reuse with duration, the resolved range, per-repo commit
 * counts, LLM sessions) is logged to stderr; stdout stays reserved for
 * the report JSON.
 *
 * @param options - Validated CLI options (see `parseCliOptions`).
 * @returns The assembled report document.
 * @throws {GitError} When a clone or a git log fails, or when a bound
 * date cannot be parsed.
 * @throws {Error} When the LLM phase fails (server start, a prompt, or
 * the `devperf_report` enforcement loop); the message names the repo
 * and the underlying cause, and the report is not written.
 */
export async function runPipeline(options: CliOptions): Promise<Report> {
  setVerbose(options.verbose === true);
  const repositories: Repository[] = [];
  let range: AnalyzedRange | undefined;
  for (const repo of options.repos) {
    const repository = await analyzeRepository(repo, options);
    repositories.push(repository);
    range ??= repository.range;
  }
  const report = assembleReport({
    repos: options.repos,
    range: range ?? { since: '', until: '' },
    model: options.llm ? options.model : undefined,
    llmEnabled: options.llm,
    generatedAt: new Date().toISOString(),
    repositories,
  });
  if (options.output !== undefined) {
    await writeJsonFile(options.output, report);
  } else {
    process.stdout.write(prettyJson(report));
  }
  return report;
}

/**
 * Analyzes one repository: ensures the clone (reusing the cache when
 * possible), resolves the analyzed range, reads the commits, groups
 * them by author, runs the LLM phase when enabled and the range has
 * authors, and assembles the repository entry.
 *
 * @param repo - Repository URL or local path as given on the command line.
 * @param options - Validated CLI options.
 * @returns The assembled repository entry.
 */
async function analyzeRepository(repo: string, options: CliOptions): Promise<Repository> {
  const startedAt = Date.now();
  const clone = await ensureClone(repo, { cacheDir: options.cacheDir, refresh: options.refresh });
  logInfo(
    `${clone.reused ? 'reused cached clone' : 'cloned'} ${repo} in ${Date.now() - startedAt} ms`,
  );
  const range = await resolveRange(clone.repoDir, options.since, options.until);
  logInfo(`range: ${rangeBound(range.since)} to ${rangeBound(range.until)}`);
  const commits = await readCommits(clone.repoDir, { since: options.since, until: options.until });
  const groups = groupByAuthor(commits);
  logInfo(
    `${repo}: ${pluralize(commits.length, 'commit')} from ${pluralize(Object.keys(groups).length, 'author')}`,
  );
  let llmResults: ReadonlyMap<string, LlmAnalysis> | undefined;
  if (options.llm && groups.length > 0) {
    try {
      llmResults = await analyzeLlm(repo, clone, range, groups, options);
    } catch (error) {
      // errorDetail walks the cause chain: a bare `fetch failed` from
      // the opencode SDK gets its real reason (e.g. `connect ECONNREFUSED
      // 127.0.0.1:50664`) appended.
      const detail = errorDetail(error);
      throw new Error(`LLM analysis failed for ${repo}: ${detail}`, { cause: error });
    }
  } else if (options.llm) {
    logInfo(`LLM: ${repo} has no authors in the range; skipping LLM analysis`);
  }
  return assembleRepository({
    repo,
    clonePath: clone.repoDir,
    branch: clone.branch,
    head: clone.head,
    range,
    groups,
    llmResults,
  });
}

/**
 * Runs the LLM phase for one repository: one
 * opencode server is started for the clone, the session service is
 * bound to it, and `analyzeRepositoryLLM` produces one analysis per
 * user (cached results reused unless `--refresh`). The server is
 * always shut down before returning; a shutdown failure is logged but
 * does not mask an analysis error.
 *
 * @param repo - Repository URL or local path as given on the command line.
 * @param clone - The clone the analysis runs in.
 * @param range - Analyzed author-date range (UTC instants).
 * @param groups - Author groups of the range, one per user.
 * @param options - Validated CLI options.
 * @returns Completed analyses keyed by lowercased author email.
 * @throws {Error} When the server cannot start or an analysis fails;
 * the server is shut down first.
 */
async function analyzeLlm(
  repo: string,
  clone: CloneResult,
  range: AnalyzedRange,
  groups: AuthorGroup[],
  options: CliOptions,
): Promise<ReadonlyMap<string, LlmAnalysis>> {
  const config = llmServerConfig(options);
  const server = await startServer(clone.repoDir, config);
  try {
    const service = createSessionService(server.client);
    const results = await analyzeRepositoryLLM({
      repo,
      cloneDir: clone.repoDir,
      entryDir: path.dirname(clone.repoDir),
      config,
      range,
      groups,
      service,
      refresh: options.refresh === true,
    });
    logInfo(`LLM: ${repo}: analyzed ${pluralize(results.length, 'user')}`);
    return new Map(results.map((result) => [result.email, result.llm]));
  } finally {
    try {
      await server.close();
    } catch (error) {
      logWarn(`LLM server shutdown failed: ${errorDetail(error)}`);
    }
  }
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
 * `since`, end of day for `until`.
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
    since:
      since === undefined ? '' : (await resolveBoundDate(repoDir, since, 'since')).toISOString(),
    until:
      until === undefined
        ? (await resolveBoundDate(repoDir, DEFAULT_UNTIL, 'until')).toISOString()
        : (await resolveBoundDate(repoDir, until, 'until')).toISOString(),
  };
}
