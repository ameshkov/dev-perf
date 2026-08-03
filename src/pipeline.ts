/**
 * Analysis pipeline orchestration (docs/design.md §2, §7): for each
 * repository — clone/cache (design §4), deterministic analysis (§5),
 * report assembly — then write the report to stdout or the `--output`
 * file. The LLM phase (plan steps 6-8) plugs in between deterministic
 * analysis and assembly.
 */
import type { CliOptions } from './config.js';
import { readCommits, resolveBoundDate } from './deterministic/commits.js';
import { groupByAuthor } from './deterministic/identity.js';
import { assembleReport, assembleRepository } from './report/index.js';
import type { AnalyzedRange, Report, Repository } from './report/index.js';
import { ensureClone } from './repo/clone.js';
import { prettyJson, writeJsonFile } from './util/json.js';

/** Date string git resolves for the default `--until` bound (§3). */
const DEFAULT_UNTIL = 'today';

/**
 * Runs the deterministic analysis pipeline end to end: clones or
 * reuses the cached clone for each repository, resolves the analyzed
 * author-date range, extracts commits and groups them by author,
 * assembles the report, and writes it as pretty JSON to stdout or the
 * `--output` file.
 *
 * @param options - Validated CLI options (see `parseCliOptions`).
 * @returns The assembled report document.
 * @throws {GitError} When a clone or a git log fails, or when a bound
 * date cannot be parsed.
 */
export async function runPipeline(options: CliOptions): Promise<Report> {
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
 * them by author, and assembles the repository entry.
 *
 * @param repo - Repository URL or local path as given on the command line.
 * @param options - Validated CLI options.
 * @returns The assembled repository entry.
 */
async function analyzeRepository(repo: string, options: CliOptions): Promise<Repository> {
  const clone = await ensureClone(repo, { cacheDir: options.cacheDir, refresh: options.refresh });
  const range = await resolveRange(clone.repoDir, options.since, options.until);
  const commits = await readCommits(clone.repoDir, { since: options.since, until: options.until });
  return assembleRepository({
    repo,
    clonePath: clone.repoDir,
    branch: clone.branch,
    head: clone.head,
    range,
    groups: groupByAuthor(commits),
  });
}

/**
 * Resolves the analyzed author-date range to UTC instants with git's
 * own date parser — the same interpretation the scan bounds get
 * (§5.4). A missing `--since` leaves the start unbounded (`''`); a
 * missing `--until` defaults to `today` (design §3).
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
