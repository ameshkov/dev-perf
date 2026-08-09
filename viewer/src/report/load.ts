/**
 * Report loading for the viewer: parses the raw JSON text of an
 * uploaded file, validates it against the trend report schema (v3) or
 * the legacy v1 report schema, and normalizes the legacy shape into a
 * single-period trend report. Errors carry the file name and the first
 * schema issues so the upload panel can show them verbatim.
 */
import { z } from 'zod';
import type { TrendReport } from './schema-report.js';
import { legacyReportSchema, trendReportSchema, v1ToTrendReport } from './schema-report.js';

/** The maximum number of schema issues listed in one error message. */
const MAX_ISSUES = 5;

/**
 * Renders the first issues of a zod error as `path: message` lines,
 * one per line, so an invalid report explains itself.
 *
 * @param error - The zod validation error.
 * @returns The issue lines joined by newlines.
 */
function issueLines(error: z.ZodError): string {
  return error.issues
    .slice(0, MAX_ISSUES)
    .map((issue) => `${issue.path.join('.') || 'report'}: ${issue.message}`)
    .join('\n');
}

/**
 * Parses the raw text of a report file into a trend report document.
 * Both schema v3 (the current trend report) and the legacy v1 report
 * are accepted; a v1 document is wrapped into a single-period trend
 * report.
 *
 * @param text - The raw JSON text of the uploaded report file.
 * @param fileName - The file name, used in error messages.
 * @returns The validated trend report.
 * @throws {Error} When the text is not valid JSON; the message names
 * the file and carries the parse error as its cause.
 * @throws {Error} When the document matches neither report schema; the
 * message names the file and lists the first schema issues.
 */
export function parseReportText(text: string, fileName: string): TrendReport {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`"${fileName}" is not valid JSON: ${String(error)}`, { cause: error });
  }
  const trend = trendReportSchema.safeParse(raw);
  if (trend.success) {
    return trend.data;
  }
  const legacy = legacyReportSchema.safeParse(raw);
  if (legacy.success) {
    return v1ToTrendReport(legacy.data);
  }
  throw new Error(`"${fileName}" is not a dev-perf report:\n${issueLines(trend.error)}`);
}

/**
 * Reads a report File (as picked from a file input or dropped onto the
 * upload zone) and parses it into a trend report document.
 *
 * @param file - The report file.
 * @returns The validated trend report.
 * @throws {Error} When the file cannot be read or does not parse as a
 * dev-perf report; the message names the file.
 *
 * @internal Exported for tests only; the app module consumes
 * `parseReportText`. Not part of the public module API.
 */
export async function loadReportFile(file: File): Promise<TrendReport> {
  let text: string;
  try {
    text = await file.text();
  } catch (error) {
    throw new Error(`could not read "${file.name}": ${String(error)}`, { cause: error });
  }
  return parseReportText(text, file.name);
}
