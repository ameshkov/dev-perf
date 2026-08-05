/**
 * Tiny formatting helpers shared by the pipeline layers: `rangeBound`
 * renders one side of an analyzed range for progress logging and
 * `pluralize` renders a count with a singular/plural unit.
 */

/**
 * Formats one side of the analyzed range for progress logging: an
 * empty string means that side is unbounded.
 *
 * @param bound - The resolved UTC instant, or `''` when unbounded.
 * @returns A human-readable label.
 */
export function rangeBound(bound: string): string {
  return bound === '' ? 'unbounded' : bound;
}

/**
 * Renders a count with its unit, pluralizing the unit unless the count
 * is exactly one.
 *
 * @param count - The number.
 * @param unit - The unit in singular form, e.g. `'commit'`.
 * @returns `"1 commit"` or `"3 commits"` etc.
 */
export function pluralize(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}
