/**
 * Shared compile-test infrastructure: a temp-directory helper that the
 * `runCompile` tests of `src/compile/` use. Test support code — not a
 * test file.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Runs `fn` with a fresh temp directory, removed afterwards.
 *
 * @param fn - The test body.
 * @returns The promise of the body.
 */
export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-compile-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
