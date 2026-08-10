/**
 * Aggregation helpers of the viewer's data layer: per-period team
 * points, categorical tallies, and the bus factor. Pure computation
 * over user entries; the extraction (`chart-data.ts`) composes them.
 * Mirrors `src/compile/aggregate.ts` of the parent CLI.
 */
import type { Contribution, ContributionSize, User } from '../report/index.js';
import type { TeamPoint } from './types.js';
import { COMPLEXITY_WEIGHTS, SIZE_WEIGHTS } from './constants.js';

/**
 * Extracts the contribution counts of one user entry.
 *
 * @param user - The user entry.
 * @returns The counts per size, complexity and work type, and the
 * weighted total.
 */
function contributionCounts(user: User): {
  sizes: Record<ContributionSize, number>;
  complexity: Record<string, number>;
  workTypes: Record<string, number>;
  weightedPoints: number;
} {
  const sizes: Record<ContributionSize, number> = { xs: 0, s: 0, m: 0, l: 0, xl: 0 };
  const complexity: Record<string, number> = {};
  const workTypes: Record<string, number> = {};
  let weightedPoints = 0;
  for (const contribution of user.llm.contributions) {
    sizes[contribution.size] += 1;
    complexity[contribution.complexity] = (complexity[contribution.complexity] ?? 0) + 1;
    weightedPoints += SIZE_WEIGHTS[contribution.size] * COMPLEXITY_WEIGHTS[contribution.complexity];
    for (const type of contribution.types) {
      workTypes[type] = (workTypes[type] ?? 0) + 1;
    }
  }
  return { sizes, complexity, workTypes, weightedPoints };
}

/**
 * The cumulative counters carried over from the previous period.
 */
interface CumulativeCounters {
  /** Cumulative commits up to the previous period. */
  commits: number;
  /** Cumulative contributions up to the previous period. */
  contributions: number;
}

/**
 * Builds one team point from the merged users of a period.
 *
 * @param users - The period's merged users.
 * @param previous - The previous period's cumulative counters.
 * @returns The team point.
 */
export function teamPoint(users: User[], previous: CumulativeCounters): TeamPoint {
  let commits = 0;
  let linesAdded = 0;
  let linesRemoved = 0;
  let activeUsers = 0;
  let contributions = 0;
  let weightedPoints = 0;
  const sizes: Record<ContributionSize, number> = { xs: 0, s: 0, m: 0, l: 0, xl: 0 };
  const complexity: Record<string, number> = {};
  const workTypes: Record<string, number> = {};
  const languages: Record<string, number> = {};
  for (const user of users) {
    commits += user.deterministic.commits;
    linesAdded += user.deterministic.linesAdded;
    linesRemoved += user.deterministic.linesRemoved;
    if (user.deterministic.commits > 0) {
      activeUsers += 1;
    }
    const counts = contributionCounts(user);
    contributions += user.llm.contributions.length;
    weightedPoints += counts.weightedPoints;
    for (const size of Object.keys(sizes) as ContributionSize[]) {
      sizes[size] += counts.sizes[size];
    }
    for (const [level, count] of Object.entries(counts.complexity)) {
      complexity[level] = (complexity[level] ?? 0) + count;
    }
    for (const [type, count] of Object.entries(counts.workTypes)) {
      workTypes[type] = (workTypes[type] ?? 0) + count;
    }
    for (const [language, contribution] of Object.entries(user.deterministic.languages)) {
      languages[language] = (languages[language] ?? 0) + contribution.linesAdded;
    }
  }
  return {
    commits,
    cumulativeCommits: previous.commits + commits,
    linesAdded,
    linesRemoved,
    activeUsers,
    contributions,
    cumulativeContributions: previous.contributions + contributions,
    weightedPoints,
    sizes,
    complexity,
    workTypes,
    languages,
  };
}

/**
 * Builds one row per occurrence of a categorical value across
 * contributions, sorted by count descending, then key ascending.
 * Multi-valued extractors count each occurrence separately.
 *
 * @param extract - The categorical values of a contribution.
 * @param contributions - The contributions to count.
 * @returns The counted rows.
 */
export function countByKey(
  extract: (contribution: Contribution) => string[],
  contributions: Contribution[],
): Array<{ key: string; value: number }> {
  const counts = new Map<string, number>();
  for (const contribution of contributions) {
    for (const key of extract(contribution)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
}

/**
 * Builds one row per categorical value across contributions, counting
 * each contribution at most once per value, so a duplicated value
 * inside one contribution does not inflate the count.
 *
 * @param extract - The categorical values of a contribution.
 * @param contributions - The contributions to count.
 * @returns The counted rows.
 */
export function countContributionsByKey(
  extract: (contribution: Contribution) => string[],
  contributions: Contribution[],
): Array<{ key: string; value: number }> {
  const counts = new Map<string, number>();
  for (const contribution of contributions) {
    const seen = new Set<string>();
    for (const key of extract(contribution)) {
      if (!seen.has(key)) {
        seen.add(key);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
}

/**
 * All LLM contributions of the given users.
 *
 * @param users - The users.
 * @returns The concatenated contributions.
 */
export function allContributions(users: User[]): Contribution[] {
  return users.flatMap((user) => user.llm.contributions);
}

/**
 * The complexity- and size-weighted points of LLM contributions: the
 * sum of each contribution's size weight (xs=1, s=2, m=3, l=5, xl=8)
 * scaled by its complexity multiplier (low=1, medium=1.5, high=2).
 *
 * @param contributions - The contributions.
 * @returns The weighted points.
 */
export function weightedPointsOf(contributions: Contribution[]): number {
  return contributions.reduce(
    (sum, contribution) =>
      sum + SIZE_WEIGHTS[contribution.size] * COMPLEXITY_WEIGHTS[contribution.complexity],
    0,
  );
}

/**
 * Builds the bus factor: the fewest users whose commits cover at
 * least half of the total, and their combined share.
 *
 * @param users - The master users, any order.
 * @returns The bus factor, or `undefined` when there are no commits.
 */
export function computeBusFactor(
  users: User[],
): { users: string[]; commitShare: number } | undefined {
  const ranked = [...users].sort((a, b) => b.deterministic.commits - a.deterministic.commits);
  const total = ranked.reduce((sum, user) => sum + user.deterministic.commits, 0);
  if (total === 0) {
    return undefined;
  }
  const covered: string[] = [];
  let sum = 0;
  for (const user of ranked) {
    if (sum * 2 >= total) {
      break;
    }
    covered.push(user.name);
    sum += user.deterministic.commits;
  }
  if (covered.length === 0) {
    covered.push(ranked[0].name);
    sum = ranked[0].deterministic.commits;
  }
  return { users: covered, commitShare: sum / total };
}
