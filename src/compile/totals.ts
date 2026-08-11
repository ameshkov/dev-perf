/**
 * Team-wide totals and token-usage rows of the `compile` command:
 * aggregate sums across the master users and their per-period team
 * points. Pure computation; `chart-data.ts` wires the results into the
 * chart data frames.
 */
import type { User } from '../report/index.js';
import type { TeamPoint } from './chart-data.js';

/** Token usage of one user across the report. */
export interface UsageRow {
  /** The user's display name. */
  name: string;
  /** Non-cached input tokens across all analyses of the user. */
  inputTokens: number;
  /** Input tokens read from the prompt cache. */
  cacheReadTokens: number;
  /** Output tokens across all analyses of the user. */
  outputTokens: number;
}

/** Team totals of the whole report. */
export interface TeamTotals {
  /** Commits across all users and periods. */
  commits: number;
  /** LLM-assessed contributions across all users. */
  contributions: number;
  /** Size- and complexity-weighted contribution points across all users. */
  weightedPoints: number;
  /** Lines added across all users. */
  linesAdded: number;
  /** Lines removed across all users. */
  linesRemoved: number;
  /** Net lines (added minus removed). */
  netLines: number;
  /** Files touched across all users. */
  filesTouched: number;
  /** Users with at least one commit. */
  activeUsers: number;
  /** Lines added in generated files (lockfiles, snapshots, build
   * output) across all users; excluded from the language stats. */
  generatedLinesAdded: number;
  /** Lines removed in generated files across all users. */
  generatedLinesRemoved: number;
  /** Non-cached input tokens across all LLM analyses. */
  inputTokens: number;
  /** Input tokens read from the prompt cache. */
  cacheReadTokens: number;
  /** Output tokens across all LLM analyses. */
  outputTokens: number;
}

/**
 * Total tokens (input + prompt-cache reads + output) of a usage
 * row, used both to order the usage rows and to accumulate team
 * totals.
 *
 * @param row - The usage row.
 * @returns The row's total token count.
 */
function totalTokens(row: UsageRow): number {
  return row.inputTokens + row.cacheReadTokens + row.outputTokens;
}

/**
 * The per-user usage rows, ordered by total tokens descending (ties
 * broken by name).
 *
 * @param users - The master users.
 * @returns The usage rows.
 */
export function usageRows(users: User[]): UsageRow[] {
  return users
    .filter((user) => user.llm.tokenUsage !== undefined)
    .map((user) => ({
      name: user.name,
      inputTokens: user.llm.tokenUsage?.input ?? 0,
      cacheReadTokens: user.llm.tokenUsage?.cacheRead ?? 0,
      outputTokens: user.llm.tokenUsage?.output ?? 0,
    }))
    .sort((a, b) => totalTokens(b) - totalTokens(a) || a.name.localeCompare(b.name));
}

/**
 * The team totals of the whole report.
 *
 * @param team - The team points.
 * @param users - The master users.
 * @param usage - The usage rows.
 * @returns The totals.
 */
export function teamTotalsOf(team: TeamPoint[], users: User[], usage: UsageRow[]): TeamTotals {
  return {
    commits: team.reduce((sum, point) => sum + point.commits, 0),
    contributions: team.reduce((sum, point) => sum + point.contributions, 0),
    weightedPoints: team.reduce((sum, point) => sum + point.weightedPoints, 0),
    linesAdded: team.reduce((sum, point) => sum + point.linesAdded, 0),
    linesRemoved: team.reduce((sum, point) => sum + point.linesRemoved, 0),
    netLines: team.reduce((sum, point) => sum + point.linesAdded - point.linesRemoved, 0),
    filesTouched: users.reduce((sum, user) => sum + user.deterministic.filesTouched, 0),
    activeUsers: users.filter((user) => user.deterministic.commits > 0).length,
    generatedLinesAdded: users.reduce(
      (sum, user) => sum + (user.deterministic.generated?.linesAdded ?? 0),
      0,
    ),
    generatedLinesRemoved: users.reduce(
      (sum, user) => sum + (user.deterministic.generated?.linesRemoved ?? 0),
      0,
    ),
    inputTokens: usage.reduce((sum, row) => sum + row.inputTokens, 0),
    cacheReadTokens: usage.reduce((sum, row) => sum + row.cacheReadTokens, 0),
    outputTokens: usage.reduce((sum, row) => sum + row.outputTokens, 0),
  };
}
