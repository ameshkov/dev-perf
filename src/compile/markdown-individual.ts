/**
 * Markdown assembly of the compiled report — the individual half: the
 * per-user dynamics sections (summary, statistics, two charts, and a
 * link to the full per-person report), the LLM analysis summary
 * (pies, quality and risk tallies, cost), and the appendix
 * (parameters, applied filters, email mapping, size weights,
 * methodology). The team half lives in `markdown.ts`; the per-person
 * reports in `markdown-person.ts`.
 */
import type { ChartAsset } from './chart-util.js';
import { userSlug } from './chart-util.js';
import type { ChartData, CountRow, UserSeries } from './chart-data.js';
import { SIZE_ORDER, SIZE_WEIGHTS } from './chart-data.js';
import type { EmailMap } from './filter.js';
import { bullets, chartAsset, chartBlock, formatInt, formatUsd, table } from './markdown-util.js';
import { statisticsTable, userSummaryLine } from './markdown-user.js';
import type { CompileOptions } from './options.js';

/** Pie chart files of the LLM summary section, in order. */
const PIE_FILES = [
  'work-types.svg',
  'size-distribution.svg',
  'complexity-distribution.svg',
  'risk-distribution.svg',
  'quality-distribution.svg',
];

/**
 * The per-user charts of the individual section: contributions per
 * period and sizes with LLM analysis, commits and lines without —
 * the two most informative charts, the full set lives in the
 * per-person report.
 *
 * @param series - The user's series.
 * @param data - The chart data.
 * @param assets - The chart assets by file name.
 * @returns The chart blocks.
 */
function userCharts(
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
        blocks.push(chartBlock(perPeriod));
      }
    }
    const sizes = chartAsset(assets, `${slug}-contributions-by-size.svg`);
    if (sizes !== undefined) {
      blocks.push(chartBlock(sizes));
    }
  } else if (multiPeriod) {
    const commits = chartAsset(assets, `${slug}-commits-per-period.svg`);
    if (commits !== undefined) {
      blocks.push(chartBlock(commits));
    }
    const lines = chartAsset(assets, `${slug}-lines-per-period.svg`);
    if (lines !== undefined) {
      blocks.push(chartBlock(lines));
    }
  }
  return blocks;
}

/**
 * The individual dynamics section: one subsection per user, sorted by
 * the master user order, with the summary line, the statistics table,
 * the two main charts, and a link to the full per-person report
 * (which carries the LLM overview, contributions table and risk
 * callout).
 *
 * @param data - The chart data.
 * @param assets - The chart assets by file name.
 * @returns The markdown section.
 */
function individualSections(data: ChartData, assets: ReadonlyMap<string, ChartAsset>): string {
  const sections = ['## Individual dynamics'];
  for (const series of data.users) {
    const user = series.user;
    const slug = userSlug(series.user.name);
    const parts = [
      `### ${user.name}${user.isBot ? ' (bot)' : ''}`,
      `*${userSummaryLine(series)}*`,
      statisticsTable(series, data),
      ...userCharts(series, data, assets),
      `[Full individual report →](people/${slug}.md)`,
    ];
    sections.push(parts.join('\n\n'));
  }
  return sections.join('\n\n');
}

/**
 * A counted-value table, e.g. quality signals or risk flags.
 *
 * @param title - The table heading.
 * @param rows - The counted rows.
 * @returns The markdown section, or `undefined` when there are no rows.
 */
function tallyTable(title: string, rows: CountRow[]): string | undefined {
  if (rows.length === 0) {
    return undefined;
  }
  return `### ${title}\n\n${table(
    ['Key', 'Count'],
    rows.map((row) => [row.key, formatInt(row.value)]),
  )}`;
}

/**
 * The LLM analysis summary section: distribution pies, quality and
 * risk tallies, and the per-user cost table. Omitted entirely when the
 * report has no LLM analysis.
 *
 * @param data - The chart data.
 * @param assets - The chart assets by file name.
 * @returns The markdown section, or `''` when LLM is disabled.
 */
function llmSummarySection(data: ChartData, assets: ReadonlyMap<string, ChartAsset>): string {
  if (!data.parameters.llmEnabled) {
    return '';
  }
  const sections = ['## LLM analysis summary'];
  for (const file of PIE_FILES) {
    const asset = chartAsset(assets, file);
    if (asset !== undefined) {
      sections.push(chartBlock(asset));
    }
  }
  const quality = tallyTable('Quality signals', data.tallies.quality);
  if (quality !== undefined) {
    sections.push(quality);
  }
  const risk = tallyTable('Risk flags', data.tallies.risk);
  if (risk !== undefined) {
    sections.push(risk);
  }
  if (data.cost.length > 0) {
    const total = data.cost.reduce((sum, row) => sum + row.costUsd, 0);
    sections.push(
      `### Cost\n\n${table(
        ['User', 'Input tokens', 'Cached in', 'Output tokens', 'Cost'],
        [
          ...data.cost.map((row) => [
            row.name,
            formatInt(row.inputTokens),
            formatInt(row.cacheReadTokens),
            formatInt(row.outputTokens),
            formatUsd(row.costUsd),
          ]),
          [
            'Total',
            formatInt(data.cost.reduce((sum, row) => sum + row.inputTokens, 0)),
            formatInt(data.cost.reduce((sum, row) => sum + row.cacheReadTokens, 0)),
            formatInt(data.cost.reduce((sum, row) => sum + row.outputTokens, 0)),
            formatUsd(total),
          ],
        ],
      )}`,
    );
  }
  return sections.join('\n\n');
}

/**
 * The applied-filter bullets of the appendix: repo and user
 * selections that changed the compiled view.
 *
 * @param options - The compile options.
 * @returns The bullets, or `undefined` when no filters were applied.
 */
function filterBullets(options: CompileOptions): string[] | undefined {
  const entries: string[] = [];
  if (options.repos.length > 0) {
    entries.push(`Repositories: only ${options.repos.join(', ')}`);
  }
  if (options.excludeRepos.length > 0) {
    entries.push(`Repositories excluded: ${options.excludeRepos.join(', ')}`);
  }
  if (options.includeUsers.length > 0) {
    entries.push(`Users: only ${options.includeUsers.join(', ')}`);
  }
  if (options.excludeUsers.length > 0) {
    entries.push(`Users excluded: ${options.excludeUsers.join(', ')}`);
  }
  return entries.length > 0 ? entries : undefined;
}

/**
 * The appendix: parameters, applied filters, email mappings, size
 * weights, and methodology notes.
 *
 * @param data - The chart data.
 * @param options - The compile options.
 * @param emailMap - The applied email mappings.
 * @returns The markdown section.
 */
function appendixSection(data: ChartData, options: CompileOptions, emailMap: EmailMap): string {
  const sections = ['## Appendix'];
  sections.push(
    `### Parameters\n\n${table(
      ['Parameter', 'Value'],
      [
        ['Repositories', data.parameters.repos.join(', ')],
        ['Range', `${data.parameters.since} → ${data.parameters.until}`],
        ['Period unit', data.parameters.unit ?? '-'],
        ['Model', data.parameters.model ?? '-'],
        ['LLM analysis', data.parameters.llmEnabled ? 'Enabled' : 'Disabled'],
        ['Generated', data.parameters.generatedAt],
      ],
    )}`,
  );
  const filters = filterBullets(options);
  if (filters !== undefined) {
    sections.push(`### Filters applied\n\n${bullets(filters)}`);
  }
  const mappings = Object.entries(emailMap).sort(([aEmail], [bEmail]) =>
    aEmail.localeCompare(bEmail),
  );
  if (mappings.length > 0) {
    sections.push(
      `### Email mapping\n\n${table(
        ['Email', 'Mapped to'],
        mappings.map(([email, name]) => [email, name]),
      )}\n\nMerged users: deterministic metrics are summed (active days take the max of the merged entries — the report carries no per-day data), LLM contributions are concatenated.`,
    );
  }
  sections.push(
    `### Size weights\n\n${table(
      ['Size', 'Weight'],
      SIZE_ORDER.map((size) => [size, formatInt(SIZE_WEIGHTS[size])]),
    )}\n\nWeighted points sum contributions scaled by their size weight.`,
  );
  sections.push(
    `### Methodology\n\n${bullets([
      'Deterministic metrics (commits, lines, files, languages) are counted straight from git history.',
      'Contributions, sizes, complexity and quality/risk signals are LLM-assessed and model-dependent.',
      'Periods without commits are kept with zeroed metrics — flat sections of a chart are real dips, not missing data.',
      'A contribution describes one period of work; a feature spanning periods appears once per period.',
      'Repository stats are recomputed after filtering and identity merging.',
    ])}`,
  );
  return sections.join('\n\n');
}

/**
 * Assembles the individual half of the compiled report: per-user
 * dynamics, the LLM analysis summary, and the appendix.
 *
 * @param data - The chart data.
 * @param assets - The chart assets by file name.
 * @param options - The compile options.
 * @param emailMap - The applied email mappings.
 * @returns The markdown sections.
 */
export function assembleIndividualMarkdown(
  data: ChartData,
  assets: ReadonlyMap<string, ChartAsset>,
  options: CompileOptions,
  emailMap: EmailMap,
): string {
  const sections = [
    individualSections(data, assets),
    llmSummarySection(data, assets),
    appendixSection(data, options, emailMap),
  ].filter((section) => section !== '');
  return sections.join('\n\n');
}
