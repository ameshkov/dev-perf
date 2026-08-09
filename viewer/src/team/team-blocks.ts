/**
 * The deterministic team chart blocks, authored per chart group: the
 * activity blocks (commits with the cumulative line, lines added vs
 * removed, active users, and the per-repository commit comparison,
 * multi-repo reports only) and the nature-of-work blocks (top
 * languages per period, tag-selectable). Mirrors the deterministic
 * half of the parent CLI's compile inventory.
 */
import type { ChartData, CountRow } from '../data/index.js';
import { formatInt, repoName } from '../data/index.js';
import type { ChartBlockDescriptor } from '../components/index.js';
import {
  ADDED_COLOR,
  CATEGORY_PALETTE,
  COMMITS_COLOR,
  CUMULATIVE_COLOR,
  REMOVED_COLOR,
  barLineOption,
  cycleColor,
  linesOption,
  stackedBarOption,
} from '../charts/index.js';

/**
 * All languages of the report with their total lines added, sorted
 * best first — the tag list of the languages block.
 *
 * @param data - The chart data.
 * @returns The counted languages.
 */
function allLanguages(data: ChartData): CountRow[] {
  const totals = new Map<string, number>();
  for (const point of data.team) {
    for (const [language, linesAdded] of Object.entries(point.languages)) {
      totals.set(language, (totals.get(language) ?? 0) + linesAdded);
    }
  }
  return [...totals.entries()]
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
}

/**
 * The commits block: commits per period with the cumulative line.
 *
 * @param data - The chart data.
 * @param labels - The period labels.
 * @returns The descriptor.
 */
function commitsBlock(data: ChartData, labels: string[]): ChartBlockDescriptor {
  return {
    id: 'team-commits',
    title: 'Commits per period',
    description:
      'Commits per period (bars) and the cumulative commit count over the range (dashed line), counted straight from git history.',
    optionOf: () =>
      barLineOption(
        labels,
        {
          name: 'Commits',
          data: data.team.map((point) => point.commits),
          color: COMMITS_COLOR,
        },
        {
          name: 'Cumulative',
          data: data.team.map((point) => point.cumulativeCommits),
          color: CUMULATIVE_COLOR,
        },
        formatInt,
      ),
  };
}

/**
 * The lines block: lines added vs removed per period.
 *
 * @param data - The chart data.
 * @param labels - The period labels.
 * @returns The descriptor.
 */
function linesBlock(data: ChartData, labels: string[]): ChartBlockDescriptor {
  return {
    id: 'team-lines',
    title: 'Lines added vs removed',
    description: 'Lines added and lines removed per period, summed over all contributors.',
    optionOf: () =>
      linesOption(
        labels,
        [
          { name: 'Added', data: data.team.map((point) => point.linesAdded), color: ADDED_COLOR },
          {
            name: 'Removed',
            data: data.team.map((point) => point.linesRemoved),
            color: REMOVED_COLOR,
          },
        ],
        formatInt,
      ),
  };
}

/**
 * The active-users block: users with at least one commit per period.
 *
 * @param data - The chart data.
 * @param labels - The period labels.
 * @returns The descriptor.
 */
function activeUsersBlock(data: ChartData, labels: string[]): ChartBlockDescriptor {
  return {
    id: 'team-active-users',
    title: 'Active users per period',
    description: 'Users with at least one commit in each period.',
    optionOf: () =>
      linesOption(
        labels,
        [{ name: 'Users', data: data.team.map((point) => point.activeUsers) }],
        formatInt,
      ),
  };
}

/**
 * The languages block: lines added per period stacked by language,
 * tag-selectable.
 *
 * @param data - The chart data.
 * @param labels - The period labels.
 * @returns The descriptor.
 */
function languagesBlock(data: ChartData, labels: string[]): ChartBlockDescriptor {
  const languages = allLanguages(data);
  return {
    id: 'team-languages',
    title: 'Top languages per period',
    description:
      'Lines added per period, stacked by language. Pick the languages you want to compare with the tag selector.',
    tags: languages,
    optionOf: (selected) =>
      stackedBarOption(
        labels,
        languages
          .filter((row) => selected === undefined || selected.has(row.key))
          .map((row) => ({
            name: row.key,
            data: data.team.map((point) => point.languages[row.key] ?? 0),
            color: cycleColor(CATEGORY_PALETTE, languages.indexOf(row)),
          })),
        formatInt,
      ),
  };
}

/**
 * The repository comparison block: commits per period, one line per
 * repository, tag-selectable.
 *
 * @param data - The chart data.
 * @param labels - The period labels.
 * @returns The descriptor.
 */
function repoComparisonBlock(data: ChartData, labels: string[]): ChartBlockDescriptor {
  return {
    id: 'team-repos',
    title: 'Commits per repository',
    description:
      'Commits per period, one line per repository. Pick the repositories you want to compare with the tag selector.',
    tags: data.repos.map((repo) => ({ key: repo.repo, value: repo.commits })),
    optionOf: (selected) => {
      const repos = data.repos.filter((repo) => selected === undefined || selected.has(repo.repo));
      return linesOption(
        labels,
        repos.map((repo, index) => ({
          name: repoName(repo.repo),
          data: repo.perPeriodCommits,
          color: cycleColor(CATEGORY_PALETTE, index),
        })),
        formatInt,
      );
    },
  };
}

/**
 * The deterministic activity blocks: commits with the cumulative
 * line, lines added vs removed, active users, and the
 * per-repository commit comparison for multi-repo reports.
 *
 * @param data - The chart data.
 * @param labels - The period labels.
 * @returns The descriptors.
 */
export function buildTeamActivityBlocks(data: ChartData, labels: string[]): ChartBlockDescriptor[] {
  const blocks: ChartBlockDescriptor[] = [
    commitsBlock(data, labels),
    linesBlock(data, labels),
    activeUsersBlock(data, labels),
  ];
  if (data.repos.length > 1) {
    blocks.push(repoComparisonBlock(data, labels));
  }
  return blocks;
}

/**
 * The deterministic nature-of-work blocks: top languages per period,
 * tag-selectable.
 *
 * @param data - The chart data.
 * @param labels - The period labels.
 * @returns The descriptors.
 */
export function buildTeamWorkBlocks(data: ChartData, labels: string[]): ChartBlockDescriptor[] {
  return [languagesBlock(data, labels)];
}
