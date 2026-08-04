/**
 * Short period labels for chart axes and tables: day and week become
 * `Jan 5`, month `2026-01`, quarter `Q1 2026`, year `2026`. Extracted
 * from `chart-data.ts` so the data extraction stays within the file
 * size limit.
 */
import type { PeriodUnit } from '../report/index.js';

/** Short month names for axis labels. */
const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Formats a period start as a short axis label for the unit: day and
 * week become `Jan 5`, month `2026-01`, quarter `Q1 2026`, year `2026`.
 *
 * @param since - Period start (ISO 8601, UTC).
 * @param unit - The period unit.
 * @returns The label.
 */
export function periodLabel(since: string, unit: PeriodUnit | undefined): string {
  const date = new Date(since);
  const year = date.getUTCFullYear();
  const month = MONTH_NAMES[date.getUTCMonth()];
  const day = date.getUTCDate();
  if (unit === 'month') {
    return `${year}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  if (unit === 'quarter') {
    return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${year}`;
  }
  if (unit === 'year') {
    return String(year);
  }
  return `${month} ${day}`;
}
