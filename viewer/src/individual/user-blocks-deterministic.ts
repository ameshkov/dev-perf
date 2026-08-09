/**
 * The deterministic per-period chart blocks of one user, authored per
 * chart group: the activity blocks (commits with the cumulative line
 * and added vs removed lines) and the nature-of-work blocks (lines
 * added per language, tag-selectable).
 */
import type { CountRow, UserSeries } from '../data/index.js';
import { formatInt } from '../data/index.js';
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
 * All languages of the user with their total lines added, sorted best
 * first — the tag list of the languages block.
 *
 * @param series - The user's series.
 * @returns The counted languages.
 */
function userLanguages(series: UserSeries): CountRow[] {
  const totals = new Map<string, number>();
  for (const point of series.points) {
    for (const [language, linesAdded] of Object.entries(point.languages)) {
      totals.set(language, (totals.get(language) ?? 0) + linesAdded);
    }
  }
  return [...totals.entries()]
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
}

/**
 * The commits block of one user: commits per period with the
 * cumulative line.
 *
 * @param series - The user's series.
 * @param labels - The period labels.
 * @returns The descriptor.
 */
function userCommitsBlock(series: UserSeries, labels: string[]): ChartBlockDescriptor {
  return {
    id: 'user-commits',
    title: 'Commits per period',
    description: 'Commits per period (bars) and the cumulative commit count (dashed line).',
    optionOf: () =>
      barLineOption(
        labels,
        {
          name: 'Commits',
          data: series.points.map((point) => point.commits),
          color: COMMITS_COLOR,
        },
        {
          name: 'Cumulative',
          data: series.points.map((point) => point.cumulativeCommits),
          color: CUMULATIVE_COLOR,
        },
        formatInt,
      ),
  };
}

/**
 * The lines block of one user: lines added vs removed per period.
 *
 * @param series - The user's series.
 * @param labels - The period labels.
 * @returns The descriptor.
 */
function userLinesBlock(series: UserSeries, labels: string[]): ChartBlockDescriptor {
  return {
    id: 'user-lines',
    title: 'Lines added vs removed',
    description: 'Lines added and lines removed per period.',
    optionOf: () =>
      linesOption(
        labels,
        [
          {
            name: 'Added',
            data: series.points.map((point) => point.linesAdded),
            color: ADDED_COLOR,
          },
          {
            name: 'Removed',
            data: series.points.map((point) => point.linesRemoved),
            color: REMOVED_COLOR,
          },
        ],
        formatInt,
      ),
  };
}

/**
 * The languages block of one user: lines added per period stacked by
 * language, tag-selectable.
 *
 * @param series - The user's series.
 * @param labels - The period labels.
 * @returns The descriptor.
 */
function userLanguagesBlock(series: UserSeries, labels: string[]): ChartBlockDescriptor {
  const languages = userLanguages(series);
  return {
    id: 'user-languages',
    title: 'Languages per period',
    description:
      'Lines added per period, stacked by language — pick the languages you want to see with the tag selector.',
    tags: languages,
    optionOf: (selected) =>
      stackedBarOption(
        labels,
        languages
          .filter((row) => selected === undefined || selected.has(row.key))
          .map((row) => ({
            name: row.key,
            data: series.points.map((point) => point.languages[row.key] ?? 0),
            color: cycleColor(CATEGORY_PALETTE, languages.indexOf(row)),
          })),
        formatInt,
      ),
  };
}

/**
 * The deterministic per-period activity blocks of one user: commits
 * with the cumulative line and added vs removed lines.
 *
 * @param series - The user's series.
 * @param labels - The period labels.
 * @returns The descriptors.
 */
export function buildDeterministicActivityBlocks(
  series: UserSeries,
  labels: string[],
): ChartBlockDescriptor[] {
  return [userCommitsBlock(series, labels), userLinesBlock(series, labels)];
}

/**
 * The deterministic per-period nature-of-work blocks of one user:
 * lines added per language, tag-selectable.
 *
 * @param series - The user's series.
 * @param labels - The period labels.
 * @returns The descriptors.
 */
export function buildDeterministicWorkBlocks(
  series: UserSeries,
  labels: string[],
): ChartBlockDescriptor[] {
  return [userLanguagesBlock(series, labels)];
}
