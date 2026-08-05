/**
 * The executive-summary leader facts of the `compile` command: the
 * busiest periods and the top contributors by commits, and by LLM
 * contributions and points when the report has LLM analysis. The
 * best-of helpers the fact builders share live here too; the rest of
 * the executive summary lives in `markdown.ts`.
 */
import type { ChartData, TeamPoint, UserSeries } from './chart-data.js';
import { formatInt } from './markdown-util.js';

/**
 * The top user by one numeric metric: the user with the highest
 * positive value, master user order winning ties. Returns `undefined`
 * when no user has a positive value, so the fact is omitted for empty
 * metrics.
 *
 * @param data - The chart data.
 * @param metric - The per-user metric.
 * @returns The top user's name and value, or `undefined`.
 */
function topUserBy(
  data: ChartData,
  metric: (series: UserSeries) => number,
): { name: string; value: number } | undefined {
  let best: { name: string; value: number } | undefined;
  for (const series of data.users) {
    const value = metric(series);
    if (value > 0 && (best === undefined || value > best.value)) {
      best = { name: series.user.name, value };
    }
  }
  return best;
}

/**
 * The busiest period by one numeric metric: the period with the
 * highest positive value, the oldest period winning ties. Returns
 * `undefined` when no period has a positive value, so the fact is
 * omitted for empty metrics.
 *
 * @param data - The chart data.
 * @param metric - The per-period metric.
 * @returns The busiest period's label and value, or `undefined`.
 */
function busiestPeriodBy(
  data: ChartData,
  metric: (point: TeamPoint) => number,
): { name: string; value: number } | undefined {
  let best: { name: string; value: number } | undefined;
  for (let index = 0; index < data.team.length; index += 1) {
    const value = metric(data.team[index]);
    if (value > 0 && (best === undefined || value > best.value)) {
      best = { name: data.periods[index].label, value };
    }
  }
  return best;
}

/**
 * Appends one leader fact when the best user or period has a positive
 * value: `Name: best (value unit)`.
 *
 * @param facts - The facts list to append to.
 * @param name - The fact name, e.g. `Busiest period by commits`.
 * @param unit - The metric unit, e.g. `commits`.
 * @param best - The best user or period, or `undefined`.
 */
function pushFact(
  facts: string[],
  name: string,
  unit: string,
  best: { name: string; value: number } | undefined,
): void {
  if (best !== undefined) {
    facts.push(`${name}: ${best.name} (${formatInt(best.value)} ${unit})`);
  }
}

/**
 * The busiest-period facts: by commits, and by LLM contributions and
 * points when the report has LLM analysis.
 *
 * @param data - The chart data.
 * @param facts - The facts list to append to.
 */
export function busiestFacts(data: ChartData, facts: string[]): void {
  pushFact(
    facts,
    'Busiest period by commits',
    'commits',
    busiestPeriodBy(data, (point) => point.commits),
  );
  if (!data.parameters.llmEnabled) {
    return;
  }
  pushFact(
    facts,
    'Busiest period by contributions',
    'contributions',
    busiestPeriodBy(data, (point) => point.contributions),
  );
  pushFact(
    facts,
    'Busiest period by points',
    'points',
    busiestPeriodBy(data, (point) => point.weightedPoints),
  );
}

/**
 * The top-contributor facts: by commits, and by LLM contributions and
 * points when the report has LLM analysis.
 *
 * @param data - The chart data.
 * @param facts - The facts list to append to.
 */
export function topContributorFacts(data: ChartData, facts: string[]): void {
  pushFact(
    facts,
    'Top contributor by commits',
    'commits',
    topUserBy(data, (series) => series.user.deterministic.commits),
  );
  if (!data.parameters.llmEnabled) {
    return;
  }
  pushFact(
    facts,
    'Top contributor by contributions',
    'contributions',
    topUserBy(data, (series) => series.user.llm.contributions.length),
  );
  pushFact(
    facts,
    'Top contributor by points',
    'points',
    topUserBy(data, (series) =>
      series.points.reduce((sum, point) => sum + point.weightedPoints, 0),
    ),
  );
}
