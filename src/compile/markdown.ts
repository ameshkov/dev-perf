/**
 * Markdown assembly of the compiled report — the team half: the title
 * and context, the executive summary with key facts and totals, the
 * team dynamics charts, the per-repository table and comparison chart,
 * and the contributor ranking table. The individual dynamics, LLM
 * summary and appendix live in `markdown-individual.ts`.
 */
import type { ChartAsset } from './chart-util.js';
import type { ChartData, UserSeries } from './chart-data.js';
import { busiestFacts, topContributorFacts } from './markdown-facts.js';
import {
  bullets,
  chartAsset,
  chartBlock,
  formatInt,
  formatLlmUsage,
  table,
} from './markdown-util.js';
import { topLanguageOf } from './markdown-user.js';
import { repoLabel } from './repo-label.js';

/** Chart files embedded in the team dynamics section. */
const TEAM_CHARTS = [
  'team-points-per-period.svg',
  'team-contributions-by-size.svg',
  'team-complexity-per-period.svg',
  'team-work-types-per-period.svg',
  'team-contributions-per-period.svg',
  'team-commits-per-period.svg',
  'team-lines-per-period.svg',
  'team-active-users.svg',
  'team-languages-per-period.svg',
  'team-risk-per-period.svg',
  'team-quality-per-period.svg',
  'team-risk-flags-per-contribution.svg',
  'team-quality-signals-per-contribution.svg',
];

/**
 * The context line under the report title: when it was generated, the
 * analyzed range, the period unit, the repository count, and the LLM
 * mode.
 *
 * @param data - The chart data.
 * @returns The context line.
 */
function contextLine(data: ChartData): string {
  const unit = data.parameters.unit === undefined ? '' : ` · ${data.parameters.unit} periods`;
  const repos = `${data.repos.length} ${data.repos.length === 1 ? 'repository' : 'repositories'}`;
  const llm = data.parameters.llmEnabled
    ? `LLM analysis: enabled (${data.parameters.model ?? 'model unknown'})`
    : 'LLM analysis: disabled';
  return `*Generated ${data.parameters.generatedAt} · ${data.parameters.since} → ${data.parameters.until}${unit} · ${repos} · ${llm}*`;
}

/**
 * The repositories fact of the executive summary: one nested bullet
 * per analyzed repository, displayed as `host/org/repo` by
 * `repoLabel`.
 *
 * @param data - The chart data.
 * @returns The fact text.
 */
function repositoriesFact(data: ChartData): string {
  const lines = [`Repositories (${data.repos.length}):`];
  for (const repo of data.repos) {
    lines.push(`    - ${repoLabel(repo.repo)}`);
  }
  return lines.join('\n');
}

/**
 * The people fact of the executive summary: one nested bullet per
 * user included in the report.
 *
 * @param data - The chart data.
 * @returns The fact text, or `''` when the report has no users.
 */
function peopleFact(data: ChartData): string {
  if (data.users.length === 0) {
    return '';
  }
  const lines = [`People (${data.users.length}):`];
  for (const series of data.users) {
    lines.push(`    - ${series.user.name}`);
  }
  return lines.join('\n');
}

/**
 * The key-facts bullets of the executive summary: the analyzed range,
 * the repositories and the people as nested bullet lists, then the
 * busiest periods and the top contributors (by commits, and by LLM
 * contributions and points when the report has LLM analysis), the
 * most common risk flag and the LLM cost when present.
 *
 * @param data - The chart data.
 * @returns The bullets.
 */
function keyFacts(data: ChartData): string[] {
  const facts = [
    `Analysis period: ${data.parameters.since} → ${data.parameters.until}`,
    repositoriesFact(data),
    peopleFact(data),
  ].filter((fact) => fact !== '');
  busiestFacts(data, facts);
  topContributorFacts(data, facts);
  if (data.parameters.llmEnabled && data.tallies.risk.length > 0) {
    const top = data.tallies.risk[0];
    facts.push(
      `Most common risk flag: ${top.key} (${formatInt(top.value)} ${top.value === 1 ? 'contribution' : 'contributions'})`,
    );
  }
  if (data.parameters.llmEnabled && data.totals.costUsd > 0) {
    facts.push(
      `LLM analysis cost: ${formatLlmUsage(
        data.totals.inputTokens,
        data.totals.cacheReadTokens,
        data.totals.outputTokens,
        data.totals.costUsd,
      )}`,
    );
  }
  return facts;
}

/**
 * The totals table of the executive summary, with a one-line meaning
 * per metric.
 *
 * @param data - The chart data.
 * @returns The markdown table.
 */
function totalsTable(data: ChartData): string {
  const totals = data.totals;
  const rows: string[][] = [
    ['Commits', formatInt(totals.commits), 'Total commits in the analyzed range'],
    ['Lines added', formatInt(totals.linesAdded), 'Lines of code added'],
    ['Lines removed', formatInt(totals.linesRemoved), 'Lines of code removed'],
    ['Net lines', formatInt(totals.netLines), 'Added minus removed'],
    ['Files touched', formatInt(totals.filesTouched), 'Distinct files changed'],
    ['Active users', formatInt(totals.activeUsers), 'Users with at least one commit'],
  ];
  if (data.parameters.llmEnabled) {
    rows.splice(1, 0, [
      'Contributions (LLM)',
      formatInt(totals.contributions),
      'LLM-assessed work items',
    ]);
    rows.splice(2, 0, [
      'Weighted points (LLM)',
      formatInt(totals.weightedPoints),
      'Contributions scaled by size weight',
    ]);
    rows.push([
      'LLM cost',
      formatLlmUsage(
        totals.inputTokens,
        totals.cacheReadTokens,
        totals.outputTokens,
        totals.costUsd,
      ),
      'Estimated token usage and cost of the LLM analysis',
    ]);
  }
  rows.push([
    'Bus factor',
    data.busFactor === undefined
      ? '-'
      : `${data.busFactor.users.join(', ')} (${Math.round(data.busFactor.commitShare * 100)}%)`,
    'Fewest users covering half of the commits',
  ]);
  rows.push([
    'Languages',
    data.topLanguages.length > 0 ? data.topLanguages.join(', ') : '-',
    'Top languages by lines added',
  ]);
  return table(['Metric', 'Value', 'Description'], rows);
}

/**
 * The executive summary section.
 *
 * @param data - The chart data.
 * @returns The markdown section.
 */
function executiveSummary(data: ChartData): string {
  const facts = keyFacts(data);
  const sections = ['## Executive summary'];
  if (facts.length > 0) {
    sections.push(bullets(facts));
  }
  sections.push(totalsTable(data));
  return sections.join('\n\n');
}

/**
 * The team dynamics section: one chart per period series, or a note
 * when the report has a single period.
 *
 * @param data - The chart data.
 * @param assets - The chart assets by file name.
 * @returns The markdown section.
 */
function teamDynamics(data: ChartData, assets: ReadonlyMap<string, ChartAsset>): string {
  const sections = ['## Team dynamics'];
  if (data.periods.length === 1) {
    sections.push(
      'Time-based dynamics charts are skipped: the report has a single period. ' +
        'Run `dev-perf report --unit month` (or week/day/quarter/year) for per-period dynamics.',
    );
    return sections.join('\n\n');
  }
  for (const file of TEAM_CHARTS) {
    const asset = chartAsset(assets, file);
    if (asset !== undefined) {
      sections.push(chartBlock(asset));
    }
  }
  return sections.join('\n\n');
}

/**
 * The per-repository section: the summary table and the comparison
 * chart. Repositories are displayed with their short `host/org/repo`
 * label, and the LLM contribution count and points columns appear
 * only when the report has LLM analysis. Omitted entirely for a
 * single repository.
 *
 * @param data - The chart data.
 * @param assets - The chart assets by file name.
 * @returns The markdown section.
 */
function repositoriesSection(data: ChartData, assets: ReadonlyMap<string, ChartAsset>): string {
  if (data.repos.length < 2) {
    return '';
  }
  const llm = data.parameters.llmEnabled;
  const headers = llm
    ? ['Repository', 'Commits', 'Contributions', 'Points', 'Users', 'Top languages']
    : ['Repository', 'Commits', 'Users', 'Top languages'];
  const sections = [
    '## Repositories',
    table(
      headers,
      data.repos.map((repo) => [
        repoLabel(repo.repo),
        formatInt(repo.commits),
        ...(llm ? [formatInt(repo.contributions), formatInt(repo.points)] : []),
        formatInt(repo.users),
        repo.topLanguages
          .map((entry) => `${entry.language} (${formatInt(entry.linesAdded)})`)
          .join(', ') || '-',
      ]),
    ),
  ];
  const asset = chartAsset(assets, 'repos-commits-per-period.svg');
  if (asset !== undefined) {
    sections.push(chartBlock(asset));
  }
  return sections.join('\n\n');
}

/**
 * One row of the contributor ranking table: the user's totals, LLM
 * columns when present, and the per-repository counts.
 *
 * @param series - The user's series.
 * @param llm - Whether the report has LLM analysis.
 * @returns The row cells.
 */
function contributorRow(series: UserSeries, llm: boolean): string[] {
  const user = series.user;
  const base = [
    user.name,
    formatInt(user.deterministic.commits),
    formatInt(user.deterministic.linesAdded),
    formatInt(user.deterministic.linesRemoved),
    formatInt(user.deterministic.filesTouched),
    formatInt(user.deterministic.activeDays),
    topLanguageOf(user),
  ];
  const repos = series.repos;
  const repoCells = [formatInt(repos.length), repos[0]?.repo ?? '-'];
  if (!llm) {
    return [...base, ...repoCells];
  }
  return [
    user.name,
    formatInt(user.llm.contributions.length),
    formatInt(series.points.reduce((sum, point) => sum + point.weightedPoints, 0)),
    ...base.slice(1),
    user.llm.status,
    ...repoCells,
  ];
}

/**
 * The contributor ranking table: per-user totals sorted by the master
 * user order (LLM contributions, then commits), plus the number of
 * repositories the user committed to and the one with the most
 * commits. The LLM columns are included only when the report has LLM
 * analysis.
 *
 * @param data - The chart data.
 * @returns The markdown section.
 */
function contributorsTable(data: ChartData): string {
  const llm = data.parameters.llmEnabled;
  const headers = llm
    ? [
        'User',
        'Contributions',
        'Points',
        'Commits',
        '+Lines',
        '−Lines',
        'Files',
        'Active days',
        'Top language',
        'LLM analysis',
        'Repos',
        'Top repo',
      ]
    : [
        'User',
        'Commits',
        '+Lines',
        '−Lines',
        'Files',
        'Active days',
        'Top language',
        'Repos',
        'Top repo',
      ];
  const rows = data.users.map((series) => contributorRow(series, llm));
  return table(headers, rows);
}

/**
 * Assembles the team half of the compiled report: title, executive
 * summary, team dynamics, repositories, and the contributor table.
 *
 * @param data - The chart data.
 * @param assets - The chart assets by file name.
 * @returns The markdown sections.
 */
export function assembleTeamMarkdown(
  data: ChartData,
  assets: ReadonlyMap<string, ChartAsset>,
): string {
  const sections = [
    '# Dev Performance Report',
    contextLine(data),
    executiveSummary(data),
    teamDynamics(data, assets),
    repositoriesSection(data, assets),
    `## Contributors\n\n${contributorsTable(data)}`,
  ].filter((section) => section !== '');
  return sections.join('\n\n');
}
