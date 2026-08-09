/**
 * Small chart helpers shared by the block builders: palette color
 * cycling for tag-indexed colors, and the percent value formatter of
 * the signal-share charts.
 */
import { formatNumber } from '../data/index.js';

/**
 * The palette color of a tag by its index in the full tag list,
 * cycling the palette when there are more tags than colors. Colors
 * stay stable for a tag no matter which subset is selected.
 *
 * @param palette - The palette to cycle.
 * @param index - The tag's index in the full tag list.
 * @returns The color.
 */
export function cycleColor(palette: string[], index: number): string {
  return palette[index % palette.length];
}

/**
 * Formats a percentage value with up to two decimals and a `%` sign,
 * e.g. `12.5` becomes `12.5%`.
 *
 * @param value - The percentage value.
 * @returns The formatted string.
 */
export function percentFormat(value: number): string {
  return `${formatNumber(value)}%`;
}
