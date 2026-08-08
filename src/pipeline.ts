/**
 * Analysis pipeline orchestration: for each repository — clone/cache,
 * deterministic analysis, the LLM phase when enabled — then assemble
 * the report and write it to stdout or the `output` file. The run's
 * range is resolved once from the first clone (git date parsing is
 * repo-independent) before the repositories are analyzed — in parallel
 * up to `parallel`; each repository's progress lines carry a scoped
 * label. With `unit`, the analyzed range is split into UTC-aligned
 * periods and the report carries one full per-repository report per
 * period. LLM failures are retried (`llmRetries`, each attempt with a
 * fresh in-process runtime) and remain fatal when every attempt fails:
 * the error propagates and the report is not written. A failing
 * repository does not abort its siblings — every repository runs to
 * completion (each disposes its LLM runtime in `finally`), the
 * first failure is rethrown, and any additional failures are logged.
 */
import type { ReportOptions } from './config.js';
import { resolveBoundDate } from './deterministic/commits.js';
import { analyzeRepository } from './analyze-repo.js';
import { assembleTrendReport } from './report/index.js';
import type { AnalyzedRange, Repository, TrendReport } from './report/index.js';
import { ensureClone } from './repo/clone.js';
import type { RepoSpec } from './repo/repo-spec.js';
import { runConfigLines } from './run-config.js';
import { splitPeriods } from './trend/periods.js';
import { loadEmailMap } from './util/email-map.js';
import type { EmailMap } from './util/email-map.js';
import { errorDetail } from './util/error.js';
import { pluralize, rangeBound } from './util/format.js';
import { createScopedLog, logConfig, logInfo, logWarn, setVerbose } from './util/log.js';
import type { ScopedLog } from './util/log.js';
import { prettyJson, writeJsonFile } from './util/json.js';
import { mapLimit } from './util/pool.js';
import { appVersion } from './version.js';

/** Date string git resolves for the default `until` bound. */
const DEFAULT_UNTIL = 'today';

/** Per-run analysis state: the range, its periods, and the entries. */
interface RunAnalysis {
  /** Resolved author-date range of the run. */
  range: AnalyzedRange;
  /** Period bounds of the run, oldest first. */
  periods: AnalyzedRange[];
  /** Assembled repository entries per period, one per repo each. */
  repositories: Repository[][];
}

/**
 * Runs the analysis pipeline end to end: clones or reuses the cached
 * clone for each repository, resolves the analyzed author-date range
 * (once per run — date parsing is repo-independent), splits it into
 * periods when `unit` is set, extracts commits and groups them by
 * author once per repo, runs the LLM phase when enabled (one in-process
 * runtime per repo shared by its periods, per-period analyses merged into the
 * report), assembles the report, and writes it as pretty JSON to
 * stdout or the `output` file. Duplicate repository specs are
 * analyzed once (their entries are identical anyway, and parallel
 * analysis of the same cache entry would race); the report parameters
 * list one full repository spec per analyzed entry, in input order. The
 * run starts by logging the application version and the full resolved
 * configuration to stderr
 * through the logger — one indented line per config field, always
 * printed even in quiet mode — so the effective settings are visible
 * before the analysis, and even when the run fails before the report
 * is written; stdout carries the report JSON only. With
 * `options.verbose`, progress (clone/reuse with duration, the resolved
 * range, the period split, per-repo commit counts, LLM sessions) is
 * additionally logged to stderr — per-repo lines carry the repo's
 * label.
 *
 * @param options - Validated report options (see `parseReportOptions`).
 * @returns The assembled trend report document.
 * @throws {GitError} When a clone or a git log fails, or when a bound
 * date cannot be parsed.
 * @throws {Error} When the LLM phase fails (runtime creation, a prompt, or
 * the `devperf_report` enforcement loop); the message names the repo —
 * and the period when `--unit` is set — plus the underlying cause, and
 * the report is not written.
 */
export async function runPipeline(options: ReportOptions): Promise<TrendReport> {
  setVerbose(options.verbose === true);
  const startedAt = Date.now();
  const repos = dedupeRepos(options.repos);
  // The command start/end pair always visible on stderr, like the
  // startup block below: `starting report` right before the work, then
  // `finished report in <ms> ms` with the outcome and its duration —
  // every run shows the command that ran and how long it took.
  logConfig(`starting report`);
  // The startup block — application version, then the resolved
  // configuration as one indented line per field — is always logged
  // to stderr, so the effective settings are visible on every run,
  // even in quiet mode and when the run fails before the report is
  // written. Stdout stays reserved for the report JSON.
  logConfig(`dev-perf ${appVersion}`);
  for (const line of runConfigLines(options, repos)) {
    logConfig(line);
  }
  // The finish marker runs in `finally`, so every run — success or
  // failure — closes the start marker with the same duration line;
  // an error thrown below propagates after the end marker is logged.
  try {
    // The email mappings are loaded once per run and applied at the
    // author-grouping stage of every repository, so deterministic
    // metrics merge exactly and the LLM phase runs one session per
    // merged identity.
    const emailMap = loadEmailMap(options.maps ?? []);
    // Each repository spec may carry its own branch and ignored paths;
    // the specs drive the clone (branch) and the report entries.
    const analyzed = await analyzeAllRepos(options, repos, emailMap);
    const report = assembleTrendReport({
      repos,
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
  } finally {
    logConfig(`finished report in ${Date.now() - startedAt} ms`);
  }
}

/**
 * Analyzes all repositories of the run: the range is resolved once
 * from the first clone (date parsing is repo-independent) and split
 * into periods once; each repository is then analyzed across those
 * periods — in parallel up to `parallel`. Returns the run range, the
 * period bounds, and the assembled repository entries grouped by
 * period (one entry per repo per period). Every repository runs to
 * completion (each one's `finally` disposes its LLM runtime);
 * the first failure is rethrown after the pool settled, and any
 * additional failures are logged as warnings.
 *
 * @param options - Validated report options.
 * @param repos - The deduplicated repository specs, in input order.
 * @param emailMap - The compiled email mappings for identity merging.
 * @returns The run range, periods, and per-period repository entries.
 * @throws {GitError} When a clone or git log fails, or a bound date
 * cannot be parsed.
 * @throws {Error} When the LLM phase fails; the message names the repo
 * — and the period when `unit` is set — plus the underlying cause.
 */
async function analyzeAllRepos(
  options: ReportOptions,
  specs: RepoSpec[],
  emailMap: EmailMap,
): Promise<RunAnalysis> {
  const logs = scopedLogs(specs);
  const first = specs[0];
  const firstLog = logs[0];
  if (first === undefined || firstLog === undefined) {
    return {
      range: { since: '', until: '' },
      periods: [{ since: '', until: '' }],
      repositories: [],
    };
  }
  // Serial prefix: clone the first repo and resolve the run's range
  // and periods from it — git date parsing is repo-independent, and
  // the first clone is then a cache hit inside the parallel pool.
  const startedAt = Date.now();
  const clone = await ensureClone(first.repo, {
    cacheDir: options.cacheDir,
    refresh: options.refresh,
    branch: first.branch,
    log: firstLog,
  });
  firstLog.progress(
    `${clone.reused ? 'reused cached clone' : 'cloned'} "${first.repo}" in ${Date.now() - startedAt} ms (cache "${clone.entryDir}")`,
  );
  const range = await resolveRange(clone.repoDir, options.since, options.until);
  const periods = splitPeriods(range, options.unit);
  logInfo(`range: ${rangeBound(range.since)} to ${rangeBound(range.until)}`);
  if (options.unit !== undefined) {
    const firstPeriod = periods[0];
    const lastPeriod = periods[periods.length - 1];
    logInfo(
      `periods: ${pluralize(periods.length, options.unit)} from ${rangeBound(firstPeriod.since)} to ${rangeBound(lastPeriod.until)}`,
    );
  }

  const repositories = await analyzeReposInParallel(options, specs, logs, range, periods, emailMap);
  return { range, periods, repositories };
}

/**
 * Runs the parallel analysis of all repositories with the run's
 * resolved range and periods: every repository — the first one hits
 * the cache — runs to completion, so each task's `finally` disposes its
 * LLM runtime; the first failure is rethrown once the pool
 * settled, with any additional failures logged as warnings. Returns
 * the assembled entries grouped by period (one entry per repo per
 * period).
 *
 * @param options - Validated CLI options.
 * @param repos - The deduplicated repository specs (with branch), in input order.
 * @param logs - The per-repository scoped loggers, aligned with `repos`.
 * @param range - The run's resolved author-date range.
 * @param periods - The run's period bounds.
 * @param emailMap - The compiled email mappings for identity merging.
 * @returns The per-period repository entries.
 * @throws {GitError} When a clone or git log fails.
 * @throws {Error} When the LLM phase fails; the message names the repo
 * — and the period when `unit` is set — plus the underlying cause.
 */
async function analyzeReposInParallel(
  options: ReportOptions,
  repos: readonly RepoSpec[],
  logs: readonly ScopedLog[],
  range: AnalyzedRange,
  periods: AnalyzedRange[],
  emailMap: EmailMap,
): Promise<Repository[][]> {
  const failures: unknown[] = [];
  const analyzed = await mapLimit(repos, options.parallel, (repo, index) =>
    analyzeRepository(repo, options, range, periods, logs[index], emailMap).catch(
      (error: unknown) => {
        failures.push(error);
        throw error;
      },
    ),
  ).catch((error: unknown) => {
    for (const failure of failures) {
      if (failure !== error) {
        logWarn(`analysis of another repository failed: ${errorDetail(failure)}`);
      }
    }
    throw error;
  });

  const repositories: Repository[][] = [];
  for (const entry of analyzed) {
    for (let index = 0; index < entry.repositories.length; index += 1) {
      (repositories[index] ??= []).push(entry.repositories[index]);
    }
  }
  return repositories;
}

/**
 * Removes duplicate repository specs, preserving input order. Duplicate
 * specs — same repo, same branch, same base scoping, and same ignored
 * paths — would race on the same cache entry (concurrent re-clone and
 * LLM writes) and their report entries are identical anyway; a warning
 * names each dropped duplicate.
 * The dedupe key is the full spec identity — the repo, the analyzed
 * branch, the base the analysis is scoped against (branch-delta), and
 * the ignore patterns — so two structured entries that share a repo but
 * use different branches, bases, or exclusions are distinct specs,
 * never silently merged. The ignore patterns are sorted before the key
 * is built, so a different listing order is not a different spec; and
 * the base distinguishes the default delta (`undefined`) from the
 * full-history opt-out (`''`), which are distinct analyses.
 *
 * @param repos - The repository specs as resolved from the config.
 * @returns The unique specs, in input order.
 */
function dedupeRepos(repos: readonly RepoSpec[]): RepoSpec[] {
  const seen = new Set<string>();
  const unique: RepoSpec[] = [];
  for (const repo of repos) {
    // The ignore list is sorted before joining, so two specs listing the
    // same patterns in a different order build the same key and the
    // second one is dropped instead of racing on a shared cache entry.
    const ignoreKey = (repo.ignore === undefined ? [] : [...repo.ignore].sort()).join('\u0000');
    // `base: undefined` (the default main/master delta) and `base: ''`
    // (the full-history opt-out) are distinct analyses, so each gets a
    // distinct key.
    const baseKey = repo.base === undefined ? '<default>' : repo.base;
    const key = `${repo.repo}\u0000${repo.branch ?? ''}\u0000${baseKey}\u0000${ignoreKey}`;
    if (seen.has(key)) {
      logWarn(`duplicate repository skipped: "${repo.repo}"`);
      continue;
    }
    seen.add(key);
    unique.push(repo);
  }
  return unique;
}

/**
 * The scope label of one repository: the basename without a trailing
 * `.git` — for URLs (`https://host/org/repo.git` → `repo`) and local
 * paths (`/path/to/repo` → `repo`) alike.
 *
 * @param repo - Repository URL or local path as given on the command line.
 * @returns The label.
 */
function repoLabel(repo: string): string {
  const withoutSuffix = repo.replace(/\.git$/, '');
  return withoutSuffix.split('/').pop() ?? withoutSuffix;
}

/**
 * One scoped logger per repository, computed once in input order:
 * colliding repository labels get a `#2`, `#3`, … suffix so parallel
 * progress lines stay distinguishable. The label carries the analyzed
 * branch when one is in effect (`repo#branch`), so two entries analyzing
 * the same repository — e.g. at different branches — stay
 * distinguishable in the log without depending on order.
 *
 * @param specs - The deduplicated repository specs.
 * @returns The scoped loggers, aligned with `specs`.
 */
function scopedLogs(specs: readonly RepoSpec[]): ScopedLog[] {
  const seen = new Map<string, number>();
  return specs.map((spec) => {
    const branch = spec.branch === undefined || spec.branch === '' ? '' : `#${spec.branch}`;
    const base = `${repoLabel(spec.repo)}${branch}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return createScopedLog(count === 0 ? base : `${base}#${count + 1}`);
  });
}

/**
 * Resolves the analyzed author-date range to UTC instants with git's
 * own date parser — the same interpretation the scan bounds get.
 * A missing `since` leaves the start unbounded (`''`); a
 * missing `until` defaults to `today`. A date-only bound resolves
 * to a fixed time of day instead of the run moment: midnight for
 * `since` and for `until` alike, so a date-only `until` bounds the
 * range at the start of its day (e.g. `since` 2026-01-01, `until`
 * 2026-03-01 covers exactly two months).
 *
 * @param repoDir - Directory to run git in; date parsing needs no repo.
 * @param since - Start bound as given in the config, if any.
 * @param until - End bound as given in the config, if any.
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
