/**
 * Filtering and identity merging for the `compile` command: the input
 * report's periods and repositories are narrowed to the selected repos,
 * author identities are merged through the `users-map` email mappings,
 * and users are kept or dropped through the `include-users` /
 * `exclude-users` config selections. Merging sums deterministic metrics
 * (languages included) and concatenates LLM contributions; `activeDays`
 * is approximated as the max of the merged users' values (the report
 * does not carry per-day data), and `avgCommitSize` is recomputed from
 * the merged totals. Repository stats are recomputed from the merged
 * users, since the report's own stats are stale after filtering.
 */
import type {
  DeterministicMetrics,
  LanguageContribution,
  LlmAnalysis,
  Repository,
  TokenUsage,
  TrendReport,
  User,
} from '../report/index.js';
import type { EmailMap } from '../util/email-map.js';

/** The user selection of a compile run. */
export interface FilterOptions {
  /** Keep only these repositories (as given on the command line). */
  repos?: string[];
  /** Drop these repositories (as given on the command line). */
  excludeRepos?: string[];
  /** Keep only users matching one of these names or emails. */
  includeUsers?: string[];
  /** Drop users matching one of these names or emails. */
  excludeUsers?: string[];
  /** Email-to-name mappings; merged identities replace the originals. */
  emailMap: EmailMap;
}

/** The report after filtering and identity merging. */
export interface FilteredReport {
  /** The input report with periods, repositories and users filtered. */
  report: TrendReport;
  /** Master user list: identities merged across periods and repos,
   * sorted by LLM contribution count, then commits, then name. */
  users: User[];
}

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
  activeDays: 0,
  firstCommitAt: '',
  lastCommitAt: '',
  avgCommitSize: 0,
  languages: {},
};

/** Zeroed LLM analysis for a user without an analysis. */
const ZEROED_LLM: LlmAnalysis = { status: 'skipped', contributions: [] };

/**
 * The display name of an identity after applying the email mappings:
 * the first mapped email wins, otherwise the report's own name.
 *
 * @param user - The user entry.
 * @param emailMap - Compiled email mappings.
 * @returns The display name to merge under.
 *
 * @internal Exported for tests only (`src/compile/filter.test.ts`); the
 * merge helpers are exercised directly there. Not part of the public
 * module API.
 */
export function mappedName(user: User, emailMap: EmailMap): string {
  for (const email of user.emails) {
    const mapped = emailMap[email.toLowerCase()];
    if (mapped !== undefined) {
      return mapped;
    }
  }
  return user.name;
}

/**
 * Merges several user entries of the same identity into one: emails
 * are unioned, deterministic metrics are summed (`activeDays` takes
 * the max, `avgCommitSize` is recomputed), languages are summed per
 * language, and LLM contributions are concatenated with summed usage.
 * An empty list yields a zeroed user.
 *
 * @param users - Entries of the same identity (may be empty).
 * @param name - The display name of the merged identity.
 * @returns The merged user entry.
 *
 * @internal Exported for tests only (`src/compile/filter.test.ts`); the
 * merge helpers are exercised directly there. Not part of the public
 * module API.
 */
export function mergeUsers(users: User[], name: string): User {
  const deterministic = mergeDeterministic(users.map((user) => user.deterministic));
  const merged: User = {
    name,
    emails: [
      ...new Set(users.flatMap((user) => user.emails.map((email) => email.toLowerCase()))),
    ].sort(),
    isBot: users.some((user) => user.isBot),
    deterministic,
    llm: mergeLlm(users.map((user) => user.llm)),
  };
  return merged;
}

/**
 * Merges deterministic metrics: counts, lines and files are summed,
 * `activeDays` takes the maximum (the report carries no per-day data,
 * so the union cannot be recomputed exactly), `firstCommitAt` /
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
      acc.activeDays = Math.max(acc.activeDays, entry.activeDays);
      return acc;
    },
    { ...ZEROED_DETERMINISTIC },
  );
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
 * Whether a user matches a selection entry: the entry matches the
 * display name or any of the user's emails, case-insensitively.
 *
 * @param user - The user entry.
 * @param selection - The selection entries.
 * @returns True when the user matches the selection.
 */
function matchesSelection(user: User, selection: string[]): boolean {
  const needle = selection.map((entry) => entry.toLowerCase());
  return needle.some(
    (entry) => user.name.toLowerCase() === entry || user.emails.some((email) => email === entry),
  );
}

/**
 * Applies the user selection to a user list: `includeUsers` keeps
 * only matches, `excludeUsers` drops matches; with neither, all users
 * are kept.
 *
 * @param users - The users to filter.
 * @param options - The filter options.
 * @returns The filtered users.
 */
function filterUsers(users: User[], options: FilterOptions): User[] {
  if (options.includeUsers !== undefined && options.includeUsers.length > 0) {
    return users.filter((user) => matchesSelection(user, options.includeUsers ?? []));
  }
  if (options.excludeUsers !== undefined && options.excludeUsers.length > 0) {
    return users.filter((user) => !matchesSelection(user, options.excludeUsers ?? []));
  }
  return users;
}

/**
 * Whether a repository is kept by the repo selection: `repos` keeps
 * only listed repositories, `excludeRepos` drops listed ones.
 *
 * @param repo - The repository as given on the command line.
 * @param options - The filter options.
 * @returns True when the repository is kept.
 */
function keepRepo(repo: string, options: FilterOptions): boolean {
  if (options.repos !== undefined && options.repos.length > 0) {
    return options.repos.includes(repo);
  }
  if (options.excludeRepos !== undefined && options.excludeRepos.length > 0) {
    return !options.excludeRepos.includes(repo);
  }
  return true;
}

/**
 * Recomputes the repository stats of a filtered repository entry: the
 * report's own stats describe the pre-filter users and are stale.
 *
 * @param users - The filtered users of the repository.
 * @returns The recomputed stats.
 */
function recomputeStats(users: User[]): Repository['stats'] {
  const languages: Record<string, number> = {};
  let commits = 0;
  for (const user of users) {
    commits += user.deterministic.commits;
    for (const [language, contribution] of Object.entries(user.deterministic.languages)) {
      languages[language] = (languages[language] ?? 0) + contribution.linesAdded;
    }
  }
  const topLanguages = Object.entries(languages)
    .sort(([aName, aLines], [bName, bLines]) => bLines - aLines || aName.localeCompare(bName))
    .slice(0, 10)
    .map(([language, linesAdded]) => ({ language, linesAdded }));
  return { totalCommits: commits, totalUsers: users.length, topLanguages };
}

/**
 * Merges the users of one repository entry by mapped identity and
 * applies the user selection: entries whose emails map to the same
 * display name are merged into one, and the selection runs on the
 * merged entries.
 *
 * @param repository - The repository entry.
 * @param options - The filter options.
 * @returns The merged and filtered users, in first-encounter order.
 */
function mergeRepositoryUsers(repository: Repository, options: FilterOptions): User[] {
  const groups = new Map<string, User[]>();
  for (const user of repository.users) {
    const name = mappedName(user, options.emailMap);
    let group = groups.get(name);
    if (group === undefined) {
      group = [];
      groups.set(name, group);
    }
    group.push(user);
  }
  const merged = [...groups.entries()].map(([name, users]) => mergeUsers(users, name));
  return filterUsers(merged, options);
}

/**
 * Builds the master user list of the filtered report: identities are
 * merged across every period and repository, then sorted by LLM
 * contribution count, then commits, then name.
 *
 * @param entries - The filtered repository entries of every period.
 * @param options - The filter options.
 * @returns The master user list.
 */
function buildMasterUsers(entries: Repository[], options: FilterOptions): User[] {
  const groups = new Map<string, User[]>();
  for (const repository of entries) {
    for (const user of mergeRepositoryUsers(repository, options)) {
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
 * Filters and identity-merges the report: repositories outside the
 * repo selection are dropped from every period, users are merged
 * through the email mappings and narrowed by the user selection,
 * repository stats are recomputed, and the master user list is built.
 * Periods are kept even when they end up with no repositories, so the
 * timeline stays intact.
 *
 * @param report - The input report (schema v2).
 * @param options - The filter options.
 * @returns The filtered report and its master user list.
 */
export function filterReport(report: TrendReport, options: FilterOptions): FilteredReport {
  const filtered: TrendReport = {
    ...report,
    periods: report.periods.map((period) => ({
      ...period,
      repositories: period.repositories
        .filter((repository) => keepRepo(repository.repo, options))
        .map((repository) => {
          const users = mergeRepositoryUsers(repository, options);
          return { ...repository, users, stats: recomputeStats(users) };
        }),
    })),
  };
  const entries = filtered.periods.flatMap((period) => period.repositories);
  return { report: filtered, users: buildMasterUsers(entries, options) };
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
  period: { since: string; until: string; repositories: Repository[] },
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
