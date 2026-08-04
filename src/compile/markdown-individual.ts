/**
 * Markdown assembly of the compiled report — the individual half: the
 * per-user dynamics sections (charts, LLM overview, contributions
 * table, risk callout), the LLM analysis summary (pies, quality and
 * risk tallies, cost), and the appendix (parameters, applied filters,
 * email mapping, size weights, methodology). The team half lives in
 * `markdown.ts`.
 */
import type { ChartAsset } from './chart-util.js';
import { userSlug } from './chart-util.js';
import type { ChartData, CountRow, UserSeries } from './chart-data.js';
import { SIZE_ORDER, SIZE_WEIGHTS } from './chart-data.js';
import type { EmailMap } from './filter.js';
import { bullets, chartAsset, chartBlock, formatInt, formatUsd, table } from './markdown-util.js';
import type { CompileOptions } from './options.js';

/** Pie chart files of the LLM summary section, in order. */
const PIE_FILES = ['work-types.svg', 'size-distribution.svg', 'complexity-distribution.svg'];

/**
 * The top language of a user by lines added, or `-`.
 *
 * @param user - The user entry.
 * @returns The language name.
 */
function topLanguageOf(user: UserSeries['user']): string {
  let best = '';
  let bestLines = 0;
  for (const [language, contribution] of Object.entries(user.deterministic.languages)) {
    if (contribution.linesAdded > bestLines) {
      best = language;
      bestLines = contribution.linesAdded;
    }
  }
  return best === '' ? '-' : best;
}

/**
 * The one-line summary of a user: emails, commits, lines, files,
 * active days, and the top language.
 *
 * @param series - The user's series.
 * @returns The summary line.
 */
function userSummaryLine(series: UserSeries): string {
  const user = series.user;
  return [
    user.emails.join(', '),
    `${formatInt(user.deterministic.commits)} commits`,
    `+${formatInt(user.deterministic.linesAdded)} / −${formatInt(user.deterministic.linesRemoved)} lines`,
    `${formatInt(user.deterministic.filesTouched)} files`,
    `${formatInt(user.deterministic.activeDays)} active days`,
    topLanguageOf(user),
  ].join(' · ');
}

/**
 * The risk-flags callout of one user: aggregated counts per flag,
 * most frequent first.
 *
 * @param series - The user's series.
 * @returns The callout, or `undefined` when the user has no risk flags.
 */
function riskCallout(series: UserSeries): string | undefined {
  const counts = new Map<string, number>();
  for (const contribution of series.user.llm.contributions) {
    for (const flag of contribution.riskFlags) {
      counts.set(flag, (counts.get(flag) ?? 0) + 1);
    }
  }
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (entries.length === 0) {
    return undefined;
  }
  return `**Risk flags:**\n\n${bullets(
    entries.map(
      ([flag, count]) =>
        `${flag} (${formatInt(count)} ${count === 1 ? 'contribution' : 'contributions'})`,
    ),
  )}`;
}

/**
 * The contributions table of one user: the LLM's structured
 * assessment, one row per contribution.
 *
 * @param series - The user's series.
 * @returns The markdown table, or `undefined` when the user has no
 * contributions.
 */
function contributionsTable(series: UserSeries): string | undefined {
  const contributions = series.user.llm.contributions;
  if (contributions.length === 0) {
    return undefined;
  }
  return table(
    ['Title', 'Types', 'Complexity', 'Size', 'Areas', 'Quality signals', 'Risk flags'],
    contributions.map((contribution) => [
      contribution.title,
      contribution.types.join(', '),
      contribution.complexity,
      contribution.size,
      contribution.areas.join(', ') || '-',
      contribution.qualitySignals.join(', ') || '-',
      contribution.riskFlags.join(', ') || '-',
    ]),
  );
}

/**
 * The per-user charts of the individual section: sizes and per-period
 * contributions with LLM analysis, commits and lines without.
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
    const sizes = chartAsset(assets, `${slug}-contributions-by-size.svg`);
    if (sizes !== undefined) {
      blocks.push(chartBlock(sizes));
    }
    if (multiPeriod) {
      const perPeriod = chartAsset(assets, `${slug}-contributions-per-period.svg`);
      if (perPeriod !== undefined) {
        blocks.push(chartBlock(perPeriod));
      }
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
 * the master user order, with charts, the LLM overview, the
 * contributions table and the risk-flags callout.
 *
 * @param data - The chart data.
 * @param assets - The chart assets by file name.
 * @returns The markdown section.
 */
function individualSections(data: ChartData, assets: ReadonlyMap<string, ChartAsset>): string {
  const sections = ['## Individual dynamics'];
  for (const series of data.users) {
    const user = series.user;
    const parts = [
      `### ${user.name}${user.isBot ? ' (bot)' : ''}`,
      `*${userSummaryLine(series)}*`,
      ...userCharts(series, data, assets),
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
        ['User', 'Input tokens', 'Output tokens', 'Cost'],
        [
          ...data.cost.map((row) => [
            row.name,
            formatInt(row.inputTokens),
            formatInt(row.outputTokens),
            formatUsd(row.costUsd),
          ]),
          [
            'Total',
            formatInt(data.cost.reduce((sum, row) => sum + row.inputTokens, 0)),
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
