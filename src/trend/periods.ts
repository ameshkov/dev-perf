/**
 * Time-based period splitting: divides the analyzed author-date range
 * into consecutive UTC-aligned periods (day, week, month, quarter, or
 * year) and filters author groups' commits down to one period. The
 * master user list is preserved — zero-commit groups stay, so every
 * period reports the same users with zeroed metrics when they were
 * inactive. A range whose `until` falls exactly on a unit boundary
 * (UTC midnight) ends the split at the previous period, so a date-only
 * `until` like `2026-03-01` yields February as the last period — not a
 * zero-length boundary period.
 */
import type { AuthorGroup } from '../deterministic/identity.js';
import type { AnalyzedRange, PeriodUnit } from '../report/index.js';

/**
 * The start of the next unit boundary strictly after the given UTC
 * instant: midnight for a day, the following Monday for a week, the
 * first of the next month, the first month of the next quarter
 * (Jan/Apr/Jul/Oct), or January 1 of the next year. `Date.UTC`
 * normalizes overflow (December + 1 month wraps to January).
 *
 * @param instant - UTC instant in milliseconds.
 * @param unit - The period unit.
 * @returns The next boundary instant in milliseconds.
 */
function nextUnitStart(instant: number, unit: PeriodUnit): number {
  const date = new Date(instant);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  switch (unit) {
    case 'day':
      return Date.UTC(year, month, date.getUTCDate() + 1);
    case 'week':
      // Monday of the current week (getUTCDay: 0 = Sunday), plus 7
      // days to reach the following Monday.
      return Date.UTC(year, month, date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + 7);
    case 'month':
      return Date.UTC(year, month + 1, 1);
    case 'quarter':
      return Date.UTC(year, Math.floor(month / 3) * 3 + 3, 1);
    case 'year':
      return Date.UTC(year + 1, 0, 1);
  }
}

/**
 * Parses one range bound to epoch milliseconds; an empty string (an
 * unbounded side) or an unparsable value yields `undefined`.
 *
 * @param bound - The bound as a UTC instant, or `''`.
 * @returns The epoch milliseconds, or `undefined`.
 */
function parseBound(bound: string): number | undefined {
  if (bound === '') {
    return undefined;
  }
  const instant = Date.parse(bound);
  return Number.isFinite(instant) ? instant : undefined;
}

/**
 * Splits a resolved author-date range into consecutive periods of the
 * given unit. Period bounds are UTC instants: midnight for days,
 * Mondays for weeks, the 1st for months, the quarter's first month
 * (Jan/Apr/Jul/Oct) for quarters, and January 1 for years. The first
 * and last periods are trimmed to the range bounds; every period's
 * `until` is inclusive (the next boundary minus one millisecond).
 * A range whose `until` falls exactly on a unit boundary is closed at
 * the previous period — no zero-length boundary period is emitted,
 * unless the range is a single instant, which yields that one
 * zero-length period. Periods with no commits are kept — the caller
 * reports them with zeroed metrics. Without `--unit`, or for an
 * unbounded or inverted range (until before since), a single
 * whole-range period is returned.
 *
 * @param range - The resolved range to split (UTC instants).
 * @param unit - The period unit, or `undefined` for no splitting.
 * @returns One period per unit interval inside the range, oldest
 * first; at least one period.
 */
export function splitPeriods(range: AnalyzedRange, unit: PeriodUnit | undefined): AnalyzedRange[] {
  if (unit === undefined) {
    return [range];
  }
  const since = parseBound(range.since);
  const until = parseBound(range.until);
  if (since === undefined || until === undefined || until < since) {
    return [range];
  }
  const periods: AnalyzedRange[] = [];
  let start = since;
  while (start <= until) {
    const end = Math.min(nextUnitStart(start, unit) - 1, until);
    // A zero-length period at the range's `until` boundary covers only
    // the boundary instant; the split ends at the previous period
    // instead (the first period is never dropped, so a single-instant
    // range still yields its one period).
    if (periods.length > 0 && end === start) {
      break;
    }
    periods.push({
      since: new Date(start).toISOString(),
      until: new Date(end).toISOString(),
    });
    if (end === until) {
      break;
    }
    start = nextUnitStart(start, unit);
  }
  return periods;
}

/**
 * Filters each author group's commits down to one period, keeping the
 * master group order and every group — authors without commits in the
 * period stay with an empty commit list, so the per-period report
 * shows the same user list with zeroed metrics. Bounds are inclusive;
 * a commit belongs to the period whose bounds contain its author date
 * (the same instant comparison the commit scan uses).
 *
 * @param groups - The master author groups of the whole range.
 * @param period - The period bounds (UTC instants, inclusive).
 * @returns New group objects with only the period's commits; the input
 * groups are not mutated.
 */
export function filterGroupsForPeriod(groups: AuthorGroup[], period: AnalyzedRange): AuthorGroup[] {
  const since = parseBound(period.since);
  const until = parseBound(period.until);
  return groups.map((group) => ({
    ...group,
    commits: group.commits.filter((commit) => {
      const instant = Date.parse(commit.authorDate);
      return (since === undefined || instant >= since) && (until === undefined || instant <= until);
    }),
  }));
}
