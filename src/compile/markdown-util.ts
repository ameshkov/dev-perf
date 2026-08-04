/**
 * Markdown helpers for the `compile` command: cell-safe tables, number
 * formatting, and chart embedding. Shared by the report assembly
 * (`markdown.ts`) and the per-user / LLM sections
 * (`markdown-individual.ts`).
 */
import type { ChartAsset } from './chart-util.js';

/**
 * Formats an integer with thousands separators.
 *
 * @param value - The value to format.
 * @returns The formatted text.
 */
export function formatInt(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * Formats a USD amount with four decimals.
 *
 * @param value - The amount in USD.
 * @returns The formatted text, e.g. `$0.0123`.
 */
export function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

/**
 * Escapes a markdown table cell: pipes are backslash-escaped and
 * line breaks become spaces.
 *
 * @param cell - The cell text.
 * @returns The escaped text.
 */
function escapeCell(cell: string): string {
  return cell.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/**
 * Renders a markdown table with a header row and a dashed separator.
 *
 * @param headers - The column headers.
 * @param rows - The cell rows.
 * @returns The markdown table.
 */
export function table(headers: string[], rows: string[][]): string {
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`),
  ];
  return lines.join('\n');
}

/**
 * Renders an embedded chart: the image with the caption as alt text,
 * followed by the caption as an italic line.
 *
 * @param asset - The chart asset.
 * @returns The markdown block.
 */
export function chartBlock(asset: ChartAsset): string {
  return `![${asset.caption}](assets/${asset.file})\n\n*${asset.caption}*`;
}

/**
 * Looks up a chart asset by file name.
 *
 * @param assets - The chart assets by file name.
 * @param file - The file name, e.g. `team-commits-per-period.svg`.
 * @returns The asset, or `undefined`.
 */
export function chartAsset(
  assets: ReadonlyMap<string, ChartAsset>,
  file: string,
): ChartAsset | undefined {
  return assets.get(file);
}

/**
 * Renders a markdown bullet list.
 *
 * @param items - The bullet texts.
 * @returns The markdown list.
 */
export function bullets(items: string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}
