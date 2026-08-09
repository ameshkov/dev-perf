/**
 * Markdown assembly of the per-person reports of the `compile`
 * command: one full report per user — title and summary line, the
 * statistics table, the complete chart set, one LLM section per date
 * unit (its own overview, contributions table and risk callout), the
 * per-repository commit counts, and a back-link to the main report.
 * Written to `<output>/people/<slug>.md` by `compile.ts`.
 */
import type { ChartAsset } from './chart-util.js';
import { userSlug } from './chart-util.js';
import type { ChartData, UserSeries } from './chart-data.js';
import { bullets, chartAsset, chartBlock, formatInt } from './markdown-util.js';
import {
  contributionsTable,
  riskCallout,
  statisticsTable,
  userSummaryLine,
} from './markdown-user.js';

/** The chart path prefix of the per-person reports, one level deep. */
const CHART_PREFIX = '../assets/';

/**
 * The chart blocks of one user for a list of chart file names, in the
 * given order.
 *
 * @param assets - The chart assets by file name.
 * @param slug - The user's file-name slug.
 * @param names - The chart names.
 * @returns The chart blocks.
 */
function chartBlocks(
  assets: ReadonlyMap<string, ChartAsset>,
  slug: string,
  names: string[],
): string[] {
  const blocks: string[] = [];
  for (const name of names) {
    const asset = chartAsset(assets, `${slug}-${name}.svg`);
    if (asset !== undefined) {
      blocks.push(chartBlock(asset, CHART_PREFIX));
    }
  }
  return blocks;
}

/**
 * The complete chart set of one user: every team-dynamics chart as its
 * per-user counterpart — points per period, contributions per period
 * stacked by size, complexity and work type, contributions with the
 * cumulative line, the whole-range size and complexity distributions
 * and the work-type share, the deterministic per-period charts, and
 * the per-period risk-flag and quality-signal charts. The team-level
 * active-users chart has no per-user counterpart and is skipped.
 *
 * @param series - The user's series.
 * @param data - The chart data.
 * @param assets - The chart assets by file name.
 * @returns The chart blocks.
 */
function allUserCharts(
  series: UserSeries,
  data: ChartData,
  assets: ReadonlyMap<string, ChartAsset>,
): string[] {
  const blocks: string[] = [];
  const slug = userSlug(series.user.name);
  const multiPeriod = data.periods.length > 1;
  if (data.parameters.llmEnabled) {
    if (multiPeriod) {
      blocks.push(
        ...chartBlocks(assets, slug, [
          'points-per-period',
          'contributions-per-period',
          'contributions-by-complexity-per-period',
          'work-types-per-period',
          'contributions-and-cumulative-per-period',
        ]),
      );
    }
    blocks.push(
      ...chartBlocks(assets, slug, [
        'contributions-by-size',
        'contributions-by-complexity',
        'work-types',
      ]),
    );
  }
  if (multiPeriod) {
    blocks.push(
      ...chartBlocks(assets, slug, [
        'commits-per-period',
        'lines-per-period',
        'languages-per-period',
      ]),
    );
    if (data.parameters.llmEnabled) {
      blocks.push(
        ...chartBlocks(assets, slug, [
          'risk-per-period',
          'quality-per-period',
          'risk-per-contribution',
          'quality-per-contribution',
        ]),
      );
    }
  }
  return blocks;
}

/**
 * The per-repository commit counts of one user, as a bullet list.
 *
 * @param series - The user's series.
 * @returns The bullets, or `undefined` when the user has no commits.
 */
function repoBullets(series: UserSeries): string | undefined {
  if (series.repos.length === 0) {
    return undefined;
  }
  return `**Repositories:**\n\n${bullets(
    series.repos.map(
      (repo) =>
        `${repo.repo}: ${formatInt(repo.commits)} ${repo.commits === 1 ? 'commit' : 'commits'}`,
    ),
  )}`;
}

/**
 * The per-period LLM sections of one user, one section per date unit
 * with content: each carries the period heading, whose own overview,
 * contributions table and risk callout. Periods without an overview or
 * any contributions are skipped.
 *
 * @param series - The user's series.
 * @param data - The chart data, for the period labels.
 * @returns The sections.
 */
function llmPeriodSections(series: UserSeries, data: ChartData): string[] {
  const sections: string[] = [];
  for (let index = 0; index < data.periods.length; index += 1) {
    const analysis = series.periodLlm[index];
    if (analysis.overview === undefined && analysis.contributions.length === 0) {
      continue;
    }
    const parts = [`## ${data.periods[index].label}`];
    if (analysis.overview !== undefined) {
      parts.push(`**Overview:** ${analysis.overview}`);
    }
    const contributions = contributionsTable(analysis.contributions);
    if (contributions !== undefined) {
      parts.push(contributions);
    }
    const risks = riskCallout(analysis.contributions);
    if (risks !== undefined) {
      parts.push(risks);
    }
    sections.push(parts.join('\n\n'));
  }
  return sections;
}

/**
 * Assembles the per-person report of one user: title and summary
 * line, statistics table, the complete chart set, one LLM section per
 * period (its own overview, contributions table and risk callout),
 * the per-repository commit counts, and a back-link to the main
 * report.
 *
 * @param series - The user's series.
 * @param data - The chart data.
 * @param assets - The chart assets by file name.
 * @returns The markdown report.
 */
export function assemblePersonMarkdown(
  series: UserSeries,
  data: ChartData,
  assets: ReadonlyMap<string, ChartAsset>,
): string {
  const user = series.user;
  const parts = [
    `# ${user.name}${user.isBot ? ' (bot)' : ''} — Individual report`,
    `*${userSummaryLine(series)}*`,
    statisticsTable(series, data),
    ...allUserCharts(series, data, assets),
  ];
  if (data.parameters.llmEnabled) {
    parts.push(...llmPeriodSections(series, data));
  }
  const repos = repoBullets(series);
  if (repos !== undefined) {
    parts.push(repos);
  }
  parts.push('[Back to report](../report.md)');
  return parts.join('\n\n');
}
