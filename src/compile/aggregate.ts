/**
 * Aggregation helpers of the `compile` command: per-period team
 * points, per-user contribution counts, categorical tallies, and the
 * bus factor. Pure computation over user entries; the data extraction
 * (`chart-data.ts`) composes them.
 */
import type { Contribution, ContributionSize, User } from '../report/index.js';
import type { TeamPoint } from './chart-data.js';
import { SIZE_WEIGHTS } from './chart-data.js';

/**
 * Extracts the contribution counts of one user entry.
 *
 * @param user - The user entry.
 * @returns The counts per size and the weighted total.
 */
function contributionCounts(user: User): {
  sizes: Record<ContributionSize, number>;
  weightedPoints: number;
} {
  const sizes: Record<ContributionSize, number> = { xs: 0, s: 0, m: 0, l: 0, xl: 0 };
  let weightedPoints = 0;
  for (const contribution of user.llm.contributions) {
    sizes[contribution.size] += 1;
    weightedPoints += SIZE_WEIGHTS[contribution.size];
  }
  return { sizes, weightedPoints };
}

/**
 * Builds one team point from the merged users of a period.
 *
 * @param users - The period's merged users (master order).
 * @param previous - The previous period's cumulative commits.
 * @returns The team point.
 */
export function teamPoint(users: User[], previous: number): TeamPoint {
  let commits = 0;
  let linesAdded = 0;
  let linesRemoved = 0;
  let activeUsers = 0;
  let contributions = 0;
  let weightedPoints = 0;
  const sizes: Record<ContributionSize, number> = { xs: 0, s: 0, m: 0, l: 0, xl: 0 };
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
    for (const [language, contribution] of Object.entries(user.deterministic.languages)) {
      languages[language] = (languages[language] ?? 0) + contribution.linesAdded;
    }
  }
  return {
    commits,
    cumulativeCommits: previous + commits,
    linesAdded,
    linesRemoved,
    activeUsers,
    contributions,
    weightedPoints,
    sizes,
    languages,
  };
}

/**
 * Builds one row per occurrence of a categorical value across
 * contributions, sorted by count descending, then key ascending.
 * Multi-valued extractors (work types, quality signals, risk flags)
 * count each occurrence separately.
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
 * All LLM contributions of the master users.
 *
 * @param users - The master users.
 * @returns The concatenated contributions.
 */
export function allContributions(users: User[]): Contribution[] {
  return users.flatMap((user) => user.llm.contributions);
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
