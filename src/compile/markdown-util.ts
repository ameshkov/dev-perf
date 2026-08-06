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
 * Formats a token count in compact human-readable form: plain numbers
 * below 1k, `1.2k` in the thousands, `5M` in the millions.
 *
 * @param value - The token count.
 * @returns The formatted text, e.g. `1.2k`.
 */
function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    return `${formatCompact(value / 1_000_000)}M`;
  }
  if (value >= 1_000) {
    return `${formatCompact(value / 1_000)}k`;
  }
  return String(value);
}

/**
 * Renders a scaled token count without a trailing zero fraction:
 * `5` not `5.0`.
 *
 * @param value - The scaled count.
 * @returns The formatted text.
 */
function formatCompact(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Formats the LLM usage summary line: the non-cached input, cached
 * input and output token counts, e.g.
 * `1.2k in / 5M cached in / 1M out`.
 *
 * @param inputTokens - Non-cached input tokens.
 * @param cacheReadTokens - Input tokens read from the prompt cache.
 * @param outputTokens - Output tokens.
 * @returns The summary text.
 */
export function formatLlmUsage(
  inputTokens: number,
  cacheReadTokens: number,
  outputTokens: number,
): string {
  return `${formatTokens(inputTokens)} in / ${formatTokens(cacheReadTokens)} cached in / ${formatTokens(outputTokens)} out`;
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
 * @param prefix - The path prefix of the chart file, `assets/` by
 * default; per-person reports pass `../assets/`.
 * @returns The markdown block.
 */
export function chartBlock(asset: ChartAsset, prefix = 'assets/'): string {
  return `![${asset.caption}](${prefix}${asset.file})\n\n*${asset.caption}*`;
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
