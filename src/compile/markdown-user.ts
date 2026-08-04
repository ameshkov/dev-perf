/**
 * Shared per-user markdown pieces of the `compile` command: the
 * top-language lookup, the one-line user summary, the statistics
 * table, and the LLM contributions table and risk callout. Used by
 * the individual dynamics of the main report
 * (`markdown-individual.ts`) and the per-person reports
 * (`markdown-person.ts`).
 */
import type { ChartData, UserSeries } from './chart-data.js';
import { bullets, formatInt, table } from './markdown-util.js';

/**
 * The top language of a user by lines added, or `-`.
 *
 * @param user - The user entry.
 * @returns The language name.
 */
export function topLanguageOf(user: UserSeries['user']): string {
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
export function userSummaryLine(series: UserSeries): string {
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
 * The statistics table of one user, mirroring the contributor row of
 * the main report: commits, lines, files, active days and the top
 * language, plus the LLM contribution count, weighted points and
 * analysis status when the report has LLM analysis.
 *
 * @param series - The user's series.
 * @param data - The chart data, for the LLM flag.
 * @returns The markdown table.
 */
export function statisticsTable(series: UserSeries, data: ChartData): string {
  const user = series.user;
  const rows: string[][] = [
    ['Commits', formatInt(user.deterministic.commits)],
    ['Lines added', formatInt(user.deterministic.linesAdded)],
    ['Lines removed', formatInt(user.deterministic.linesRemoved)],
    ['Files touched', formatInt(user.deterministic.filesTouched)],
    ['Active days', formatInt(user.deterministic.activeDays)],
    ['Top language', topLanguageOf(user)],
  ];
  if (data.parameters.llmEnabled) {
    rows.push(
      ['Contributions (LLM)', formatInt(user.llm.contributions.length)],
      [
        'Weighted points (LLM)',
        formatInt(series.points.reduce((sum, point) => sum + point.weightedPoints, 0)),
      ],
      ['LLM analysis', user.llm.status],
    );
  }
  return table(['Metric', 'Value'], rows);
}

/**
 * The risk-flags callout of one user: aggregated counts per flag,
 * most frequent first.
 *
 * @param series - The user's series.
 * @returns The callout, or `undefined` when the user has no risk flags.
 */
export function riskCallout(series: UserSeries): string | undefined {
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
export function contributionsTable(series: UserSeries): string | undefined {
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
