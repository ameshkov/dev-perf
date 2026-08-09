/**
 * Human-facing number and date formatting for the viewer UI: integer
 * grouping, compact notation for large counts, and short UTC date
 * labels for report ranges and generation timestamps.
 */

/** Shared integer formatter with digit grouping (`12,345`). */
const INT_FORMAT = new Intl.NumberFormat('en-US');

/** Shared compact formatter for large values (`1.2M`). */
const COMPACT_FORMAT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/**
 * Formats an integer with digit grouping: `12345` becomes `12,345`.
 *
 * @param value - The number to format.
 * @returns The grouped decimal string.
 */
export function formatInt(value: number): string {
  return INT_FORMAT.format(value);
}

/**
 * Formats a possibly large number in compact notation: `1234` stays
 * `1.2K`-style, small values keep up to one decimal.
 *
 * @param value - The number to format.
 * @returns The compact string.
 */
export function formatCompact(value: number): string {
  if (Math.abs(value) < 1000) {
    return formatNumber(value);
  }
  return COMPACT_FORMAT.format(value);
}

/**
 * Formats a number with up to two decimals, trimming trailing zeros:
 * `1.50` becomes `1.5`, whole numbers carry no decimals.
 *
 * @param value - The number to format.
 * @returns The decimal string.
 */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

/** Weekday, month and day of a UTC instant, e.g. `Jan 5, 2026`. */
const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

/** Month, day, time and time zone of a UTC instant. */
const DATE_TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short',
});

/**
 * Formats an ISO 8601 timestamp as a short UTC date, e.g.
 * `2026-01-05T00:00:00.000Z` becomes `Jan 5, 2026`.
 *
 * @param iso - The ISO 8601 timestamp.
 * @returns The date string.
 *
 * @internal Exported for tests only; used within the module by
 * `formatRange`. Not part of the public module API.
 */
export function formatDate(iso: string): string {
  return DATE_FORMAT.format(new Date(iso));
}

/**
 * Formats an ISO 8601 timestamp as date and time with the time zone,
 * e.g. `Mar 1, 2026, 12:00 AM UTC`.
 *
 * @param iso - The ISO 8601 timestamp.
 * @returns The date-time string.
 */
export function formatDateTime(iso: string): string {
  return DATE_TIME_FORMAT.format(new Date(iso));
}

/**
 * Formats an analyzed range as `Jan 1, 2026 → Jun 30, 2026`.
 *
 * @param since - Start of the range (ISO 8601, UTC).
 * @param until - End of the range (ISO 8601, UTC).
 * @returns The range string.
 */
export function formatRange(since: string, until: string): string {
  return `${formatDate(since)} → ${formatDate(until)}`;
}
