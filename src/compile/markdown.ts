/**
 * Markdown assembly of the compiled report — the team half: the title
 * and context, the executive summary with key facts and totals, the
 * team dynamics charts, the per-repository table and comparison chart,
 * and the contributor ranking table. The individual dynamics, LLM
 * summary and appendix live in `markdown-individual.ts`.
 */
import type { ChartAsset } from './chart-util.js';
import type { ChartData } from './chart-data.js';
import { bullets, chartAsset, chartBlock, formatInt, formatUsd, table } from './markdown-util.js';

/** Chart files embedded in the team dynamics section. */
const TEAM_CHARTS = [
  'team-contributions-by-size.svg',
  'team-contributions-and-points.svg',
  'team-commits-per-period.svg',
  'team-lines-per-period.svg',
  'team-active-users.svg',
  'team-languages-per-period.svg',
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
 * The top language of a user by lines added, or `-`.
 *
 * @param user - The user entry.
 * @returns The language name.
 */
function topLanguageOf(user: ChartData['users'][number]['user']): string {
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
 * The busiest period by commits: its label and commit count.
 *
 * @param data - The chart data.
 * @returns The facts text, or `undefined` when there are no commits.
 */
function busiestPeriod(data: ChartData): string | undefined {
  let bestIndex = -1;
  for (let index = 0; index < data.team.length; index += 1) {
    if (bestIndex === -1 || data.team[index].commits > data.team[bestIndex].commits) {
      bestIndex = index;
    }
  }
  if (bestIndex === -1 || data.team[bestIndex].commits === 0) {
    return undefined;
  }
  return `Busiest period: ${data.periods[bestIndex].label} (${formatInt(data.team[bestIndex].commits)} commits)`;
}

/**
 * The key-facts bullets of the executive summary.
 *
 * @param data - The chart data.
 * @returns The bullets.
 */
function keyFacts(data: ChartData): string[] {
  const facts: string[] = [];
  const busiest = busiestPeriod(data);
  if (busiest !== undefined) {
    facts.push(busiest);
  }
  const topContributor = data.users.find((series) => series.user.deterministic.commits > 0);
  if (topContributor !== undefined) {
    facts.push(
      `Top contributor: ${topContributor.user.name} (${formatInt(topContributor.user.deterministic.commits)} commits)`,
    );
  }
  if (data.parameters.llmEnabled && data.tallies.risk.length > 0) {
    const top = data.tallies.risk[0];
    facts.push(
      `Most common risk flag: ${top.key} (${formatInt(top.value)} ${top.value === 1 ? 'contribution' : 'contributions'})`,
    );
  }
  if (data.parameters.llmEnabled && data.totals.costUsd > 0) {
    facts.push(`LLM analysis cost: ${formatUsd(data.totals.costUsd)}`);
  }
  return facts;
}

/**
 * The totals table of the executive summary.
 *
 * @param data - The chart data.
 * @returns The markdown table.
 */
function totalsTable(data: ChartData): string {
  const totals = data.totals;
  const rows: string[][] = [
    ['Commits', formatInt(totals.commits)],
    ['Lines added', formatInt(totals.linesAdded)],
    ['Lines removed', formatInt(totals.linesRemoved)],
    ['Net lines', formatInt(totals.netLines)],
    ['Files touched', formatInt(totals.filesTouched)],
    ['Active users', formatInt(totals.activeUsers)],
  ];
  if (data.parameters.llmEnabled) {
    rows.splice(1, 0, ['Contributions (LLM)', formatInt(totals.contributions)]);
    rows.splice(2, 0, ['Weighted points (LLM)', formatInt(totals.weightedPoints)]);
    rows.push(['LLM cost', formatUsd(totals.costUsd)]);
  }
  rows.push([
    'Bus factor',
    data.busFactor === undefined
      ? '-'
      : `${data.busFactor.users.join(', ')} (${Math.round(data.busFactor.commitShare * 100)}%)`,
  ]);
  rows.push(['Languages', data.topLanguages.length > 0 ? data.topLanguages.join(', ') : '-']);
  return table(['Metric', 'Value'], rows);
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
 * chart. Omitted entirely for a single repository.
 *
 * @param data - The chart data.
 * @param assets - The chart assets by file name.
 * @returns The markdown section.
 */
function repositoriesSection(data: ChartData, assets: ReadonlyMap<string, ChartAsset>): string {
  if (data.repos.length < 2) {
    return '';
  }
  const sections = [
    '## Repositories',
    table(
      ['Repository', 'Commits', 'Users', 'Top languages'],
      data.repos.map((repo) => [
        repo.repo,
        formatInt(repo.commits),
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
 * The contributor ranking table: per-user totals sorted by the master
 * user order (LLM contributions, then commits). The LLM columns are
 * included only when the report has LLM analysis.
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
        'LLM',
      ]
    : ['User', 'Commits', '+Lines', '−Lines', 'Files', 'Active days', 'Top language'];
  const rows = data.users.map((series) => {
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
    if (!llm) {
      return base;
    }
    return [
      user.name,
      formatInt(user.llm.contributions.length),
      formatInt(series.points.reduce((sum, point) => sum + point.weightedPoints, 0)),
      ...base.slice(1),
      user.llm.status,
    ];
  });
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
