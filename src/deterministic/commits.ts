/**
 * Commit extraction from git history: a single
 * `git log --numstat --no-renames` pass with the `%x1f` / `%x1e`
 * record format, plus author-date range filtering in code.
 *
 * `git log --since/--until` filters by *commit* date, so those bounds
 * are passed through only to limit the scan; the author-date range is
 * applied on the parsed `%aI` field so the returned commits honor
 * author dates. Both the scan bound and the in-code filter resolve
 * dates with git's own date parser (any git date format) under
 * `TZ=UTC`, so naive dates are interpreted in UTC. Date-only bounds
 * (`2026-01-01`) get a fixed default time of midnight (`00:00:00`)
 * appended — git would otherwise resolve them to the current time of
 * day, making the analyzed range depend on the run moment. A date-only
 * `until` therefore bounds the range at the start of its day, so
 * `--since 2026-01-01 --until 2026-03-01` covers exactly two months.
 */
import { GitError, runGit } from '../repo/git.js';

/** Record separator between the commit header and its numstat rows. */
const RECORD_SEP = '\x1e';

/** Field separator inside the commit header. */
const FIELD_SEP = '\x1f';

/** Git date parsing runs in UTC so naive dates are interpreted as UTC. */
const UTC_ENV: NodeJS.ProcessEnv = { TZ: 'UTC' };

/** One file changed by a commit, from a numstat row; consumed
 * by the LLM prompt builder (`src/llm/prompts.ts`). */
export interface CommitFile {
  /** Path as reported by git numstat. */
  path: string;
  /**
   * Lines added; `undefined` for binary files (numstat `-`), which are
   * recorded without line counts.
   */
  added: number | undefined;
  /**
   * Lines removed; `undefined` for binary files (numstat `-`), which
   * are recorded without line counts.
   */
  deleted: number | undefined;
}

/**
 * One parsed commit: the header fields from the `%x1f` /
 * `%x1e` format followed by its numstat rows. Consumed by the
 * deterministic metrics layer.
 */
export interface Commit {
  /** Full commit sha. */
  sha: string;
  /** Parent shas; more than one marks a merge commit. */
  parents: string[];
  /** Author name as written in the commit. */
  authorName: string;
  /** Author email as written in the commit. */
  authorEmail: string;
  /** Author date, ISO 8601 with offset (the raw `%aI` value). */
  authorDate: string;
  /** Commit subject. */
  subject: string;
  /** Files changed by this commit; empty for merge commits. */
  files: CommitFile[];
  /** Whether the commit has more than one parent. */
  isMerge: boolean;
}

/**
 * Date range the scan is bounded by and filtered to, plus an optional
 * base commit the scan excludes. Date-only bounds are normalized to a
 * fixed time of day (`normalizeBoundDate`).
 */
export interface CommitRange {
  /** Start bound, any git date format; both ends of the range inclusive. */
  since?: string;
  /** End bound, any git date format; both ends of the range inclusive. */
  until?: string;
  /**
   * Base commit sha to exclude (branch-delta): only commits reachable
   * from the branch head but not from this commit are scanned
   * (`git log HEAD --not <sha>`). Must not equal the branch head — the
   * caller drops the exclusion in that case, so the analyzed branch is
   * never emptied by its own delta.
   */
  exclude?: string;
}

/**
 * Matches a date-only bound: `YYYY-MM-DD`, also with `/` or `.`
 * separators and 1-2 digit month/day. Git's own parser resolves such
 * strings to the *current time of day*, which would make the analyzed
 * range depend on the run moment; they are normalized to a fixed time
 * instead (see `normalizeBoundDate`).
 */
const DATE_ONLY_PATTERN = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/;

/**
 * Normalizes a date-only bound (e.g. `2026-01-01`) to midnight
 * (`00:00:00`) so git resolves it deterministically, regardless of
 * which side of the range it bounds: the `since` side starts at the
 * beginning of its day, and the `until` side ends at the beginning of
 * its day too — so `--since 2026-01-01 --until 2026-03-01` covers
 * exactly two months, not the whole boundary day. Bounds that already
 * carry a time, and other git date formats (e.g. `yesterday`), pass
 * through unchanged.
 *
 * @param date - The bound as given on the command line.
 * @returns The bound, with midnight appended when date-only.
 */
function normalizeBoundDate(date: string): string {
  return DATE_ONLY_PATTERN.test(date) ? `${date} 00:00:00` : date;
}

/**
 * Applies the date-only midnight normalization to both sides of a
 * range, so the scan bound and the in-code filter agree with the
 * resolved range reported in the output. The optional base exclusion
 * passes through untouched.
 *
 * @param range - The range as given on the command line.
 * @returns The range with date-only bounds normalized.
 */
function normalizeRange(range: CommitRange): CommitRange {
  return {
    since: range.since === undefined ? undefined : normalizeBoundDate(range.since),
    until: range.until === undefined ? undefined : normalizeBoundDate(range.until),
    ...(range.exclude === undefined ? {} : { exclude: range.exclude }),
  };
}

/**
 * Parses the output of the single-pass `git log --pretty=format:
 * %H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e --numstat --no-renames` into
 * commits (newest first). Header lines end with the `\x1e` record
 * separator; numstat rows follow until the blank line. Binary files
 * (numstat `-`) are recorded without line counts, and merge commits
 * (no numstat rows of their own) are detected via parent count.
 *
 * @param output - Raw git log output; may be empty for an empty repo.
 * @returns The parsed commits, newest first.
 *
 * @internal Exported for tests only (`commits.test.ts` asserts the
 * golden format); used by `readCommits` within the module. Not part
 * of the public module API.
 */
export function parseCommitLog(output: string): Commit[] {
  const commits: Commit[] = [];
  let current: Commit | undefined;
  for (const line of output.split('\n')) {
    if (line.endsWith(RECORD_SEP)) {
      current = commitFromHeader(line);
      commits.push(current);
    } else if (current !== undefined && line !== '') {
      current.files.push(parseNumstatRow(line));
    }
  }
  return commits;
}

/**
 * Parses one commit header line (`fields\x1e`) into a `Commit`; merge
 * commits are detected by the parent count.
 *
 * @param line - Header line ending with the `\x1e` record separator.
 * @returns The parsed commit with an empty file list.
 */
function commitFromHeader(line: string): Commit {
  const fields = line.slice(0, -RECORD_SEP.length).split(FIELD_SEP);
  const parents = fields[1] === '' ? [] : fields[1].split(' ');
  return {
    sha: fields[0],
    parents,
    authorName: fields[2],
    authorEmail: fields[3],
    authorDate: fields[4],
    subject: fields[5],
    files: [],
    isMerge: parents.length > 1,
  };
}

/**
 * Parses one numstat row `added\tdeleted\tpath`; a `-` count marks a
 * binary file, recorded without line counts.
 *
 * @param line - The numstat row.
 * @returns The changed file with its line counts.
 */
function parseNumstatRow(line: string): CommitFile {
  const [added, deleted, ...pathParts] = line.split('\t');
  return {
    path: pathParts.join('\t'),
    added: added === '-' ? undefined : Number(added),
    deleted: deleted === '-' ? undefined : Number(deleted),
  };
}

/**
 * Reads all commits of a repository with one `git log --numstat
 * --no-renames` pass. `--since`/`--until` bound the scan
 * by *commit* date; the author-date range is then applied in code on
 * the parsed `%aI` field, so the returned list honors author
 * dates. Bounds are resolved by git's own date parser under `TZ=UTC`;
 * a date-only bound is normalized to UTC midnight
 * (`normalizeBoundDate`), so the range starts at the beginning of the
 * boundary days regardless of when the analysis runs. An optional
 * `range.exclude` (branch-delta) restricts the scan to commits not
 * reachable from that base commit. An empty
 * repository yields an empty list.
 *
 * @param repoDir - The repository working tree.
 * @param range - Author-date range, both ends inclusive.
 * @returns The commits in range, newest first.
 * @throws {GitError} When git log fails for a reason other than an
 * empty repository, or when a bound date cannot be parsed.
 */
export async function readCommits(repoDir: string, range: CommitRange = {}): Promise<Commit[]> {
  const bounds = normalizeRange(range);
  const output = await gitLogBounded(repoDir, bounds);
  const commits = parseCommitLog(output);
  const since =
    bounds.since === undefined ? undefined : await resolveBoundEpoch(repoDir, bounds.since);
  const until =
    bounds.until === undefined ? undefined : await resolveBoundEpoch(repoDir, bounds.until);
  return commits.filter((commit) => inAuthorRange(commit, since, until));
}

/**
 * Runs the single-pass `git log` with the `%x1f`/`%x1e` record format,
 * bounded by commit dates via `--since`/`--until` when given, and — for
 * branch-delta — scoped to the commits not reachable from the excluded
 * base via `HEAD --not <sha>`. The positive side is named explicitly
 * (`HEAD`) because `git log --not <sha>` without a prior rev defaults
 * to nothing, not to the branch head. An empty
 * repository fails git log with "does not have any commits yet"; that
 * is caught here and reported as an empty log.
 *
 * @param repoDir - The repository working tree.
 * @param range - Scan bounds (commit dates) and the optional base
 * exclusion.
 * @returns The raw git log output.
 * @throws {GitError} When git log fails for a reason other than an
 * empty repository.
 */
async function gitLogBounded(repoDir: string, range: CommitRange): Promise<string> {
  const args = ['log'];
  if (range.exclude !== undefined) {
    args.push('HEAD', '--not', range.exclude);
  }
  if (range.since !== undefined) {
    args.push(`--since=${range.since}`);
  }
  if (range.until !== undefined) {
    args.push(`--until=${range.until}`);
  }
  args.push('--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e', '--numstat', '--no-renames');
  try {
    return await runGit(repoDir, args, { env: UTC_ENV });
  } catch (error) {
    if (isEmptyRepoError(error)) {
      return '';
    }
    throw error;
  }
}

/**
 * True when git log failed only because the repository has no commits
 * yet ("your current branch 'main' does not have any commits yet").
 *
 * @param error - The caught error.
 * @returns Whether the failure means an empty repository.
 */
function isEmptyRepoError(error: unknown): boolean {
  return error instanceof GitError && error.stderr.includes('does not have any commits yet');
}

/**
 * Resolves a git-format date to the instant git itself uses for the
 * scan bounds (`--since`/`--until`): the same
 * approxidate interpretation the scan gets, under `TZ=UTC`, with a
 * date-only bound normalized to midnight (`normalizeBoundDate`). The
 * pipeline uses it to record the analyzed range in the report.
 *
 * @param repoDir - Directory to run git in; date parsing needs no repo.
 * @param date - Date in any git date format.
 * @returns The resolved instant (UTC).
 * @throws {GitError} When git cannot parse the date.
 */
export async function resolveBoundDate(repoDir: string, date: string): Promise<Date> {
  return new Date(await resolveBoundEpoch(repoDir, normalizeBoundDate(date)));
}

/**
 * Resolves a git-format date to epoch milliseconds using git's own
 * date parser (approxidate) in UTC — the same interpretation the scan
 * bound gets from `git log --since/--until`.
 *
 * @param repoDir - Directory to run git in; date parsing needs no repo.
 * @param date - Date in any git date format.
 * @returns The epoch milliseconds of the resolved date.
 * @throws {GitError} When git cannot parse the date.
 */
async function resolveBoundEpoch(repoDir: string, date: string): Promise<number> {
  const output = await runGit(repoDir, ['rev-parse', `--since=${date}`], { env: UTC_ENV });
  // `git rev-parse --since=<date>` prints `--max-age=<epoch>` (older
  // git) or the bare `<epoch>` (newer git); either way the epoch is the
  // trailing digits.
  const epoch = Number.parseInt(output.replace(/^--(max|min)-age=/, ''), 10);
  if (!Number.isInteger(epoch)) {
    throw new GitError(['rev-parse', `--since=${date}`], {
      cwd: repoDir,
      stderr: `cannot parse date: ${date}`,
    });
  }
  return epoch * 1000;
}

/**
 * Inclusive author-date range check; dates are compared
 * as instants in UTC.
 *
 * @param commit - The commit to test.
 * @param since - Inclusive start bound in epoch milliseconds, if any.
 * @param until - Inclusive end bound in epoch milliseconds, if any.
 * @returns Whether the commit's author date lies within the bounds.
 */
function inAuthorRange(
  commit: Commit,
  since: number | undefined,
  until: number | undefined,
): boolean {
  const epoch = Date.parse(commit.authorDate);
  if (since !== undefined && epoch < since) {
    return false;
  }
  if (until !== undefined && epoch > until) {
    return false;
  }
  return true;
}
