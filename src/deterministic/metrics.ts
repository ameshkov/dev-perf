/**
 * Deterministic metrics aggregation (docs/design.md §5.2): per-user
 * metrics counted from parsed commits, and repo-level statistics.
 */
import type { DeterministicMetrics, RepositoryStats } from '../report/index.js';
import type { Commit } from './commits.js';
import type { AuthorGroup } from './identity.js';
import { countLanguageContributions } from './languages.js';

/** How many entries the repo's top-languages list keeps. */
const TOP_LANGUAGES_LIMIT = 10;

/** Line and file sums over one author's commits. */
interface ChangeTotals {
  /** Sum of numstat additions over the range. */
  linesAdded: number;
  /** Sum of numstat deletions over the range. */
  linesRemoved: number;
  /** Commit-file pairs touched in the range. */
  filesTouched: number;
  /** Distinct file paths touched in the range. */
  uniqueFilesTouched: number;
  /** Commits with at most one parent. */
  nonMergeCommits: number;
  /** Sum of added + removed lines over non-merge commits. */
  nonMergeSize: number;
}

/** Date-derived per-user values. */
interface DateTotals {
  /** Earliest author-date instant. */
  firstAt: Date;
  /** Latest author-date instant. */
  lastAt: Date;
  /** Distinct author dates (UTC) with commits in the range. */
  activeDays: number;
}

/**
 * Computes the deterministic per-user metrics for one author's commits
 * (design §5.2): counts, line sums, file and day distinctness, first
 * and last author dates (UTC), the average non-merge commit size, and
 * per-language contributions. Merge commits count toward `commits` and
 * `mergeCommits` but carry no numstat rows of their own, so they do
 * not skew the line sums or `avgCommitSize` (computed per non-merge
 * commit). `churn` (v2) is left unset. An empty commit list yields
 * zeroed metrics with empty date strings.
 *
 * @param commits - One author's commits, typically newest first.
 * @returns The per-user metrics matching `DeterministicMetrics`.
 */
export function userMetrics(commits: Commit[]): DeterministicMetrics {
  if (commits.length === 0) {
    return zeroMetrics();
  }
  const totals = changeTotals(commits);
  const dates = dateTotals(commits);
  return {
    commits: commits.length,
    nonMergeCommits: totals.nonMergeCommits,
    mergeCommits: commits.length - totals.nonMergeCommits,
    linesAdded: totals.linesAdded,
    linesRemoved: totals.linesRemoved,
    netLines: totals.linesAdded - totals.linesRemoved,
    filesTouched: totals.filesTouched,
    uniqueFilesTouched: totals.uniqueFilesTouched,
    activeDays: dates.activeDays,
    firstCommitAt: dates.firstAt.toISOString(),
    lastCommitAt: dates.lastAt.toISOString(),
    avgCommitSize: totals.nonMergeCommits === 0 ? 0 : totals.nonMergeSize / totals.nonMergeCommits,
    languages: countLanguageContributions(commits),
  };
}

/**
 * Zeroed metrics for an empty commit list (design §5.2): every count
 * is zero and the date fields are empty strings.
 *
 * @returns The zeroed metrics.
 */
function zeroMetrics(): DeterministicMetrics {
  return {
    commits: 0,
    nonMergeCommits: 0,
    mergeCommits: 0,
    linesAdded: 0,
    linesRemoved: 0,
    netLines: 0,
    filesTouched: 0,
    uniqueFilesTouched: 0,
    activeDays: 0,
    firstCommitAt: '',
    lastCommitAt: '',
    avgCommitSize: 0,
    languages: {},
  };
}

/**
 * Sums lines and files over one author's commits (design §5.2). Merge
 * commits contribute nothing to `nonMergeCommits` / `nonMergeSize` —
 * merge diffs are not attributed, so they carry no rows of their own.
 *
 * @param commits - One author's commits; non-empty.
 * @returns The change totals.
 */
function changeTotals(commits: Commit[]): ChangeTotals {
  let linesAdded = 0;
  let linesRemoved = 0;
  let filesTouched = 0;
  let nonMergeCommits = 0;
  let nonMergeSize = 0;
  const uniqueFiles = new Set<string>();
  for (const commit of commits) {
    if (commit.isMerge) {
      continue;
    }
    nonMergeCommits += 1;
    let commitSize = 0;
    for (const file of commit.files) {
      const added = file.added ?? 0;
      const deleted = file.deleted ?? 0;
      linesAdded += added;
      linesRemoved += deleted;
      filesTouched += 1;
      commitSize += added + deleted;
      uniqueFiles.add(file.path);
    }
    nonMergeSize += commitSize;
  }
  return {
    linesAdded,
    linesRemoved,
    filesTouched,
    uniqueFilesTouched: uniqueFiles.size,
    nonMergeCommits,
    nonMergeSize,
  };
}

/**
 * Computes the date-derived per-user values (design §5.2): the
 * earliest and latest author-date instants, and the distinct author
 * dates counted in UTC (a commit at 23:30-05:00 belongs to the next
 * UTC day).
 *
 * @param commits - One author's commits; non-empty.
 * @returns The date totals.
 */
function dateTotals(commits: Commit[]): DateTotals {
  let firstAt = Number.POSITIVE_INFINITY;
  let lastAt = 0;
  const activeDays = new Set<string>();
  for (const commit of commits) {
    const dateEpoch = Date.parse(commit.authorDate);
    firstAt = Math.min(firstAt, dateEpoch);
    lastAt = Math.max(lastAt, dateEpoch);
    activeDays.add(new Date(dateEpoch).toISOString().slice(0, 10));
  }
  return { firstAt: new Date(firstAt), lastAt: new Date(lastAt), activeDays: activeDays.size };
}

/**
 * Computes the repository-level statistics (design §5.2): total
 * commits and users in the range, and the top languages by lines
 * added, best first. Ties break by language name (ascending); the
 * list is capped at `TOP_LANGUAGES_LIMIT` entries.
 *
 * @param groups - The author groups of the range, one per user.
 * @returns The repository statistics matching `RepositoryStats`.
 */
export function repoStats(groups: AuthorGroup[]): RepositoryStats {
  let totalCommits = 0;
  const linesByLanguage = new Map<string, number>();
  for (const group of groups) {
    totalCommits += group.commits.length;
    for (const [language, contribution] of Object.entries(
      countLanguageContributions(group.commits),
    )) {
      linesByLanguage.set(language, (linesByLanguage.get(language) ?? 0) + contribution.linesAdded);
    }
  }
  const topLanguages = [...linesByLanguage.entries()]
    .map(([language, linesAdded]) => ({ language, linesAdded }))
    .sort((a, b) => b.linesAdded - a.linesAdded || compareLanguageNames(a.language, b.language))
    .slice(0, TOP_LANGUAGES_LIMIT);
  return { totalCommits, totalUsers: groups.length, topLanguages };
}

/**
 * Plain lexicographic comparison for deterministic tie-breaking of
 * language names (no locale-dependent ordering).
 *
 * @param a - First language name.
 * @param b - Second language name.
 * @returns Negative, zero, or positive as `a` orders before, equal
 * to, or after `b`.
 */
function compareLanguageNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
