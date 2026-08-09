/**
 * Identity merging for the viewer: users of the same display name are
 * merged across repositories and periods — deterministic metrics are
 * summed, `activeDays` date lists are unioned, `avgCommitSize` is
 * recomputed, LLM contributions are concatenated, and token usage is
 * summed. Mirrors the merge half of `src/compile/filter.ts` of the
 * parent CLI; the viewer has no config, so email mappings and user
 * selections are not available.
 */
import type {
  DeterministicMetrics,
  LanguageContribution,
  LlmAnalysis,
  Repository,
  TokenUsage,
  User,
} from '../report/index.js';

/** Zeroed deterministic metrics for a user without commits in a period. */
const ZEROED_DETERMINISTIC: DeterministicMetrics = {
  commits: 0,
  nonMergeCommits: 0,
  mergeCommits: 0,
  linesAdded: 0,
  linesRemoved: 0,
  netLines: 0,
  filesTouched: 0,
  uniqueFilesTouched: 0,
  activeDays: [],
  firstCommitAt: '',
  lastCommitAt: '',
  avgCommitSize: 0,
  languages: {},
};

/** Zeroed LLM analysis for a user without an analysis. */
const ZEROED_LLM: LlmAnalysis = { status: 'skipped', contributions: [] };

/**
 * Merges per-language contributions by summing each language's counts.
 *
 * @param entries - The metrics to merge.
 * @returns The merged language map.
 */
function mergeLanguages(entries: DeterministicMetrics[]): Record<string, LanguageContribution> {
  const merged: Record<string, LanguageContribution> = {};
  for (const entry of entries) {
    for (const [language, contribution] of Object.entries(entry.languages)) {
      const target = (merged[language] ??= { linesAdded: 0, linesRemoved: 0, filesTouched: 0 });
      target.linesAdded += contribution.linesAdded;
      target.linesRemoved += contribution.linesRemoved;
      target.filesTouched += contribution.filesTouched;
    }
  }
  return merged;
}

/**
 * Merges deterministic metrics: counts, lines and files are summed,
 * `activeDays` date lists are unioned, `firstCommitAt` /
 * `lastCommitAt` span the merged range, and `avgCommitSize` is
 * recomputed from the merged totals.
 *
 * @param entries - The metrics to merge.
 * @returns The merged metrics.
 */
function mergeDeterministic(entries: DeterministicMetrics[]): DeterministicMetrics {
  const summed = entries.reduce(
    (acc, entry) => {
      acc.commits += entry.commits;
      acc.nonMergeCommits += entry.nonMergeCommits;
      acc.mergeCommits += entry.mergeCommits;
      acc.linesAdded += entry.linesAdded;
      acc.linesRemoved += entry.linesRemoved;
      acc.netLines += entry.netLines;
      acc.filesTouched += entry.filesTouched;
      acc.uniqueFilesTouched += entry.uniqueFilesTouched;
      return acc;
    },
    { ...ZEROED_DETERMINISTIC },
  );
  const activeDays = [...new Set(entries.flatMap((entry) => entry.activeDays))].sort();
  const firstCommits = entries
    .map((entry) => entry.firstCommitAt)
    .filter((value) => value !== '')
    .sort();
  const lastCommits = entries
    .map((entry) => entry.lastCommitAt)
    .filter((value) => value !== '')
    .sort();
  return {
    ...summed,
    activeDays,
    firstCommitAt: firstCommits[0] ?? '',
    lastCommitAt: lastCommits[lastCommits.length - 1] ?? '',
    avgCommitSize:
      summed.nonMergeCommits === 0
        ? 0
        : (summed.linesAdded + summed.linesRemoved) / summed.nonMergeCommits,
    languages: mergeLanguages(entries),
  };
}

/**
 * Merges LLM analyses: `completed` wins over `failed` over `skipped`,
 * overviews are joined, contributions are concatenated, and token
 * usage is summed.
 *
 * @param entries - The analyses to merge.
 * @returns The merged analysis.
 */
function mergeLlm(entries: LlmAnalysis[]): LlmAnalysis {
  const contributions = entries.flatMap((entry) => entry.contributions);
  const overviews = [
    ...new Set(entries.map((entry) => entry.overview).filter((value) => value !== undefined)),
  ];
  const merged: LlmAnalysis = {
    status: entries.some((entry) => entry.status === 'completed')
      ? 'completed'
      : entries.some((entry) => entry.status === 'failed')
        ? 'failed'
        : 'skipped',
    contributions,
    ...(overviews.length > 0 ? { overview: overviews.join('\n\n') } : {}),
  };
  const usage: TokenUsage = { input: 0, cacheRead: 0, output: 0 };
  for (const entry of entries) {
    if (entry.tokenUsage !== undefined) {
      usage.input += entry.tokenUsage.input;
      usage.cacheRead += entry.tokenUsage.cacheRead;
      usage.output += entry.tokenUsage.output;
    }
  }
  if (usage.input > 0 || usage.cacheRead > 0 || usage.output > 0) {
    merged.tokenUsage = usage;
  }
  return merged;
}

/**
 * Merges several user entries of the same identity into one: emails
 * are unioned, deterministic metrics are summed, and LLM analyses are
 * merged. An empty list yields a zeroed user.
 *
 * @param users - Entries of the same identity (may be empty).
 * @param name - The display name of the merged identity.
 * @returns The merged user entry.
 *
 * @internal Exported for tests only; used within the module by the
 * master-user and per-period builders. Not part of the public module
 * API.
 */
export function mergeUsers(users: User[], name: string): User {
  const deterministic = mergeDeterministic(users.map((user) => user.deterministic));
  return {
    name,
    emails: [
      ...new Set(users.flatMap((user) => user.emails.map((email) => email.toLowerCase()))),
    ].sort(),
    isBot: users.some((user) => user.isBot),
    deterministic,
    llm: mergeLlm(users.map((user) => user.llm)),
  };
}

/**
 * Builds the master user list of the report: identities are merged by
 * display name across every period and repository, then sorted by LLM
 * contribution count, then commits, then name.
 *
 * @param entries - The repository entries of every period.
 * @returns The master user list.
 */
export function buildMasterUsers(entries: Repository[]): User[] {
  const groups = new Map<string, User[]>();
  for (const repository of entries) {
    for (const user of repository.users) {
      let group = groups.get(user.name);
      if (group === undefined) {
        group = [];
        groups.set(user.name, group);
      }
      group.push(user);
    }
  }
  const users = [...groups.entries()].map(([name, group]) => mergeUsers(group, name));
  users.sort((a, b) => {
    const aContributions = a.llm.contributions.length;
    const bContributions = b.llm.contributions.length;
    if (aContributions !== bContributions) {
      return bContributions - aContributions;
    }
    if (a.deterministic.commits !== b.deterministic.commits) {
      return b.deterministic.commits - a.deterministic.commits;
    }
    return a.name.localeCompare(b.name);
  });
  return users;
}

/**
 * A zeroed user entry with the identity of a master user: no commits,
 * no languages, LLM skipped. Used for periods where the user is
 * inactive, so every series has a point per period.
 *
 * @param master - The master user identity.
 * @returns The zeroed entry.
 */
function zeroedUser(master: User): User {
  return {
    name: master.name,
    emails: master.emails,
    isBot: master.isBot,
    deterministic: { ...ZEROED_DETERMINISTIC },
    llm: { ...ZEROED_LLM },
  };
}

/**
 * The merged per-user view of one period: for every master user, the
 * merged entry across the period's repositories, zeroed when the user
 * has no entry in the period. The result is aligned with the master
 * user list order, so per-user series stay consistent across periods.
 *
 * @param period - The period's repository entries.
 * @param masterUsers - The master user list.
 * @returns One merged user per master user, in master order.
 */
export function combinePeriodUsers(
  period: { repositories: Repository[] },
  masterUsers: User[],
): User[] {
  return masterUsers.map((master) => {
    const entries: User[] = [];
    for (const repository of period.repositories) {
      const found = repository.users.find((user) => user.name === master.name);
      if (found !== undefined) {
        entries.push(found);
      }
    }
    return entries.length > 0 ? mergeUsers(entries, master.name) : zeroedUser(master);
  });
}
