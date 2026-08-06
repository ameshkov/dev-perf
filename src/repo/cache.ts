/**
 * Cache layout for cloned repositories: cache root
 * resolution, the per-repository entry hash, path builders for the
 * layout, and zod-validated `clone.json` read/write.
 *
 * Layout:
 *
 * ```text
 * <cacheDir>/
 * └── <sha256(url).slice(0, 16)>/
 *     ├── repo/        # the git clone
 *     ├── clone.json   # { url, clonedAt, branch, head }
 *     ├── llm/         # cached LLM analysis results
 *     └── opencode/    # generated opencode config, tool, and agent
 *         └── home/    # the spawned server's isolated home (state, logs)
 * ```
 */
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { readJsonFile, writeJsonFile } from '../util/json.js';

/** Default cache directory name, inside the OS temp directory. */
const DEFAULT_CACHE_DIR = '.dev-cache';

/** Length of the per-repository entry hash. */
const ENTRY_HASH_LENGTH = 16;

/**
 * Resolves the cache root: the `--cache-dir` option if given, otherwise
 * `.dev-cache` under the OS temp directory.
 *
 * @param cacheDir - Cache directory as given on the command line.
 * @returns The absolute cache root path.
 */
export function resolveCacheDir(cacheDir?: string): string {
  if (cacheDir === undefined) {
    return path.join(os.tmpdir(), DEFAULT_CACHE_DIR);
  }
  return path.resolve(process.cwd(), cacheDir);
}

/**
 * Computes the cache entry hash for a repository URL: the first 16 hex
 * characters of the URL's SHA-256.
 *
 * @param url - Repository URL or local path as given on the command line.
 * @returns The 16-character entry hash.
 *
 * @internal Exported for tests only (`cache.test.ts`); used by
 * `cacheEntryDir` within the module. Not part of the public module
 * API.
 */
export function entryHash(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, ENTRY_HASH_LENGTH);
}

/**
 * Returns the cache entry directory for a repository URL.
 *
 * @param cacheDir - Resolved cache root.
 * @param url - Repository URL or local path as given on the command line.
 * @returns Absolute path of the entry directory.
 */
export function cacheEntryDir(cacheDir: string, url: string): string {
  return path.join(cacheDir, entryHash(url));
}

/**
 * Returns the clone path inside a cache entry (`repo/`).
 *
 * @param entryDir - The cache entry directory.
 * @returns The clone's working tree path.
 */
export function repoDir(entryDir: string): string {
  return path.join(entryDir, 'repo');
}

/**
 * Returns the `clone.json` path inside a cache entry.
 *
 * @param entryDir - The cache entry directory.
 * @returns The clone.json file path.
 *
 * @internal Exported for tests only; used by `readCloneInfo` and
 * `writeCloneInfo` within the module. Not part of the public module
 * API.
 */
export function cloneJsonPath(entryDir: string): string {
  return path.join(entryDir, 'clone.json');
}

/**
 * Returns the LLM results directory inside a cache entry (`llm/`).
 * Consumed by the LLM layer: the generated
 * `devperf_report` tool writes each session's analysis payload here,
 * and the orchestrator caches and reads the per-user results here.
 *
 * @param entryDir - The cache entry directory.
 * @returns The llm directory path.
 */
export function llmDir(entryDir: string): string {
  return path.join(entryDir, 'llm');
}

/**
 * Returns the generated opencode directory inside a cache entry
 * (`opencode/`): the source of the generated
 * `opencode.json` and `.opencode/tools/devperf_report.ts`, which are
 * copied into the clone before the LLM server starts.
 *
 * @param entryDir - The cache entry directory.
 * @returns The opencode directory path.
 */
export function opencodeDir(entryDir: string): string {
  return path.join(entryDir, 'opencode');
}

/**
 * Returns the opencode server home directory inside a cache entry
 * (`opencode/home`): the isolated `HOME`/`XDG_CONFIG_HOME` passed to
 * the spawned opencode server. It is deliberately kept in the cache
 * entry (not removed after the run), so the server's own state and log
 * files persist and can be inspected after an analysis while the
 * user's real home is still never read.
 *
 * @param entryDir - The cache entry directory.
 * @returns The opencode home directory path.
 */
export function opencodeHomeDir(entryDir: string): string {
  return path.join(opencodeDir(entryDir), 'home');
}

/**
 * zod schema for `clone.json`: the URL the clone was made from, when it
 * was cloned (ISO 8601), the checked-out branch, and the head sha.
 *
 * @internal Exported for tests only (`cache.test.ts`); referenced by
 * `readCloneInfo` within the module. Not part of the public module
 * API.
 */
export const cloneInfoSchema = z.object({
  /** Repository URL or local path as given on the command line. */
  url: z.string(),
  /** When the clone was made (ISO 8601, UTC). */
  clonedAt: z.string(),
  /** Branch the clone was checked out on. */
  branch: z.string(),
  /** Head commit sha of the clone. */
  head: z.string(),
});

/**
 * Content of a `clone.json` file.
 */
export type CloneInfo = z.infer<typeof cloneInfoSchema>;

/**
 * Reads and validates a cache entry's `clone.json`.
 *
 * @param entryDir - The cache entry directory.
 * @returns The clone info, or `undefined` when the file is missing,
 * malformed, or does not validate — treated as a cache miss.
 */
export async function readCloneInfo(entryDir: string): Promise<CloneInfo | undefined> {
  try {
    const value = await readJsonFile(cloneJsonPath(entryDir));
    const result = cloneInfoSchema.safeParse(value);
    return result.success ? result.data : undefined;
  } catch {
    // Missing or malformed clone.json is a cache miss, not an error.
    return undefined;
  }
}

/**
 * Writes a cache entry's `clone.json`, creating the entry directory as
 * needed.
 *
 * @param entryDir - The cache entry directory.
 * @param info - Clone info to persist.
 */
export async function writeCloneInfo(entryDir: string, info: CloneInfo): Promise<void> {
  await writeJsonFile(cloneJsonPath(entryDir), info);
}
