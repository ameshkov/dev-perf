/**
 * JSON helpers: pretty-printing, file read/write, and safe parsing.
 * Used by the repo cache (`clone.json`) now and by the pipeline output
 * in a later step.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Error thrown when text cannot be parsed as JSON or a JSON file cannot
 * be read. Module-private: callers catch it via `readJsonFile`/the
 * `@throws` contract without importing the class.
 */
class JsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonError';
  }
}

/**
 * Serializes a value as pretty JSON (2-space indent) with a trailing
 * newline.
 *
 * @param value - Value to serialize.
 * @returns The pretty JSON text.
 */
export function prettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Parses JSON text without throwing raw `SyntaxError`s. Module-private:
 * `readJsonFile` is the public entry point.
 *
 * @param text - JSON text to parse.
 * @returns The parsed value.
 * @throws {JsonError} When the text is not valid JSON.
 */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new JsonError(`Invalid JSON: ${detail}`);
  }
}

/**
 * Reads and parses a JSON file.
 *
 * @param filePath - Path of the file to read.
 * @returns The parsed value.
 * @throws {JsonError} When the file is missing, unreadable, or not valid
 * JSON; the message includes the file path.
 */
export async function readJsonFile(filePath: string): Promise<unknown> {
  const text = await readFile(filePath, 'utf8');
  try {
    return parseJson(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new JsonError(`${detail} (${filePath})`);
  }
}

/**
 * Writes a value as pretty JSON to a file, creating parent directories
 * as needed.
 *
 * @param filePath - Path of the file to write.
 * @param value - Value to serialize.
 */
export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, prettyJson(value), 'utf8');
}
