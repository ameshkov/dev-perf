/**
 * Per-period signal series for the tag-based chart blocks: the share
 * of each period's contributions carrying each selected signal, and
 * the average flags per contribution. Shared by the team blocks and
 * the per-user blocks. Mirrors the signal helpers of the parent CLI's
 * compile layer.
 */
import type { CountRow } from './types.js';

/**
 * The share of each period's contributions carrying each of the given
 * signals, as percentage values aligned with the period labels and
 * normalized so periods with more contributions are not shown with
 * more flags.
 *
 * @param labels - The period labels.
 * @param keys - The signals to include, one series each.
 * @param tallies - The per-period signal tallies, aligned with `labels`.
 * @param contributions - The contributions per period, aligned with
 * `labels`.
 * @returns One values array per key.
 */
export function signalShareValues(
  labels: string[],
  keys: string[],
  tallies: CountRow[][],
  contributions: number[],
): Array<{ key: string; values: number[] }> {
  return keys.map((key) => ({
    key,
    values: labels.map((_label, index) => {
      if (contributions[index] === 0) {
        return 0;
      }
      const count = tallies[index].find((row) => row.key === key)?.value ?? 0;
      return (count / contributions[index]) * 100;
    }),
  }));
}

/**
 * The average number of flags per contribution of one period: the
 * period's total flags divided by its contributions, rounded to two
 * decimals, zeroed when the period has no contributions.
 *
 * @param rows - The period's counted flags.
 * @param contributions - The period's contributions.
 * @returns The average, zeroed when there are no contributions.
 */
export function flagsPerContribution(rows: CountRow[], contributions: number): number {
  if (contributions === 0) {
    return 0;
  }
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return Math.round((total / contributions) * 100) / 100;
}
