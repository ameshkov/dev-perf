/**
 * Shared list handling for option values: the `report` and `compile`
 * commands both accept environment variables whose values are
 * comma-separated lists (e.g. `DEV_PERF_MAP`), repeatable commander
 * options may carry the same comma-separated form, and repeatable
 * options collect their occurrences through a shared commander
 * collector.
 */

/**
 * Parses a comma-separated list, trimming each entry and dropping empty
 * ones.
 *
 * @param value - The raw list text.
 * @returns The list entries.
 */
export function splitList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/**
 * Collector for repeatable commander options: commander calls the
 * collector with the previous list, so each occurrence appends.
 *
 * @param value - The option value of this occurrence.
 * @param previous - The values collected so far.
 * @returns The extended list.
 */
export function collectOptionValues(value: string, previous: string[]): string[] {
  return [...previous, value];
}
