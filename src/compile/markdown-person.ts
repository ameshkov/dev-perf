/**
 * Markdown assembly of the per-person reports of the `compile`
 * command: one full report per user — title and summary line, the
 * statistics table, the complete chart set, the LLM overview, the
 * contributions table and risk callout, the per-repository commit
 * counts, and a back-link to the main report. Written to
 * `<output>/people/<slug>.md` by `compile.ts`.
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
 * The complete chart set of one user: the LLM charts (when the report
 * has LLM analysis) followed by the deterministic per-period charts.
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
      const perPeriod = chartAsset(assets, `${slug}-contributions-per-period.svg`);
      if (perPeriod !== undefined) {
        blocks.push(chartBlock(perPeriod, CHART_PREFIX));
      }
    }
    for (const name of ['contributions-by-size', 'contributions-by-complexity']) {
      const asset = chartAsset(assets, `${slug}-${name}.svg`);
      if (asset !== undefined) {
        blocks.push(chartBlock(asset, CHART_PREFIX));
      }
    }
  }
  if (multiPeriod) {
    for (const name of ['commits-per-period', 'lines-per-period', 'languages-per-period']) {
      const asset = chartAsset(assets, `${slug}-${name}.svg`);
      if (asset !== undefined) {
        blocks.push(chartBlock(asset, CHART_PREFIX));
      }
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
 * Assembles the per-person report of one user: title and summary
 * line, statistics table, the complete chart set, the LLM overview,
 * the contributions table and the risk callout, the per-repository
 * commit counts, and a back-link to the main report.
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
    if (user.llm.overview !== undefined) {
      parts.push(`**Overview:** ${user.llm.overview}`);
    }
    const contributions = contributionsTable(series);
    if (contributions !== undefined) {
      parts.push(contributions);
    }
    const risks = riskCallout(series);
    if (risks !== undefined) {
      parts.push(risks);
    }
  }
  const repos = repoBullets(series);
  if (repos !== undefined) {
    parts.push(repos);
  }
  parts.push('[Back to report](../report.md)');
  return parts.join('\n\n');
}
