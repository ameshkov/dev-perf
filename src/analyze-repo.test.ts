/**
 * Tests for the per-repository analysis entry: the full-clone fallback
 * that saves an analysis when a partial clone's on-demand blob fetch
 * fails. A repository is analyzed through `analyzeRepository` with a
 * fake git executable that simulates a partial clone whose promisor
 * remote is unreachable: `git log` fails on a `blob:none` clone (like
 * a dead remote during the lazy blob fetch) and succeeds once the
 * entry has been re-cloned as a full clone — verifying the analysis
 * recovers instead of aborting the whole report, and that only the
 * missing-blob failure triggers the fallback.
 */
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildFixtureRepo, removeFixtureRepo } from '../test/fixtures/repo-builder.js';
import type { ReportOptions } from './config.js';
import { cacheEntryDir } from './repo/cache.js';
import { createScopedLog } from './util/log.js';
import { createLimit } from './util/pool.js';
import { analyzeRepository } from './analyze-repo.js';

/** A fixture with two commits by one author. */
async function buildFixture() {
  return buildFixtureRepo([
    {
      author: { name: 'Alice', email: 'alice@example.com' },
      date: '2026-01-01T10:00:00Z',
      message: 'first commit',
      files: [{ path: 'a.txt', content: 'alpha\n' }],
    },
    {
      author: { name: 'Alice', email: 'alice@example.com' },
      date: '2026-01-02T11:00:00Z',
      message: 'second commit',
      files: [{ path: 'b.txt', content: 'beta\n' }],
    },
  ]);
}

/**
 * A minimal deterministic-only report options set, with the cache dir
 * and range the test controls.
 */
function options(cacheDir: string): ReportOptions {
  return {
    repos: [],
    llm: false,
    limitContext: 262144,
    limitOutput: 65536,
    llmRetries: 2,
    parallel: 1,
    cacheDir,
    since: '2026-01-01T00:00:00Z',
    until: '2026-01-31T23:59:59Z',
  };
}

/**
 * Writes a fake git executable that fails `git log` on a partial
 * (`blob:none`) clone with the given stderr text — simulating a
 * promisor remote that cannot serve the on-demand blob fetch — and
 * clears the marker on a full (no-filter) clone so `git log` works
 * again. Everything else delegates to the real git.
 *
 * @param dir - Directory to write the shim and its marker into.
 * @param stderrText - The stderr the fake `git log` failure carries.
 * @returns The shim path and its marker file path.
 */
async function writePartialLogFailingGit(
  dir: string,
  stderrText: string,
): Promise<{ shim: string; marker: string }> {
  const shim = path.join(dir, 'fake-git');
  const marker = path.join(dir, 'partial');
  const script = `#!/bin/sh
partial=0
for arg in "$@"; do
  if [ "$arg" = "--filter=blob:none" ]; then partial=1; fi
done
if [ "$1" = "clone" ]; then
  if [ "$partial" = "1" ]; then
    printf x > "${marker}"
  else
    rm -f "${marker}"
  fi
fi
if [ -f "${marker}" ] && [ "$1" = "log" ]; then
  echo "${stderrText}" >&2
  exit 128
fi
exec git "$@"
`;
  await writeFile(shim, script);
  await chmod(shim, 0o755);
  return { shim, marker };
}

/** The analyzed range of the tests: January 2026. */
const RANGE = { since: '2026-01-01T00:00:00.000Z', until: '2026-01-31T23:59:59.000Z' };

describe('analyzeRepository full-clone fallback', () => {
  it('re-clones as a full clone and recovers when a partial clone blob fetch fails', async () => {
    const fixture = await buildFixture();
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-reclone-cache-'));
    const tmp = path.dirname(cacheDir);
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const { shim, marker } = await writePartialLogFailingGit(
        tmp,
        'ssh: connect to host github.com port 22: Connection refused\n' +
          'fatal: could not fetch 8fc64aaae33316fb07dfdff1c09e17cd42bb40f4 from promisor remote',
      );

      const result = await analyzeRepository(
        { repo: fixture.url },
        options(cacheDir),
        RANGE,
        [RANGE],
        createScopedLog('reclone'),
        {},
        createLimit(1),
        // `retryDelays: []` skips the transient-failure backoff so the
        // test does not wait out the 1s/5s/30s retries of the dead
        // promisor remote.
        { gitBinary: shim, retryDelays: [] },
      );

      // The analysis recovered after the fallback: both commits were
      // read and grouped for Alice, so the report is not lost.
      expect(result.repositories).toHaveLength(1);
      expect(result.repositories[0].users).toHaveLength(1);
      expect(result.repositories[0].users[0].name).toBe('Alice');
      expect(result.repositories[0].users[0].deterministic.commits).toBe(2);

      // The entry was re-cloned as a full clone: `git log` no longer
      // fails (the marker the partial clone wrote is gone) and the
      // cache config carries no partial-clone filter.
      await expect(readFile(marker, 'utf8')).rejects.toThrow();
      const config = await readFile(
        path.join(cacheEntryDir(cacheDir, fixture.url), 'repo', '.git', 'config'),
        'utf8',
      );
      expect(config).not.toContain('partialclonefilter');

      // The fallback reason is surfaced as a warning on stderr.
      const stderr = stderrWrite.mock.calls.map((call) => String(call[0])).join('');
      expect(stderr).toContain(
        `on-demand blob fetch failed on the partial clone of "${fixture.url}"`,
      );
      expect(stderr).toContain('re-cloning as a full clone');
    } finally {
      vi.restoreAllMocks();
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(fixture);
    }
  });

  it('does not fall back when git log fails for a non-promisor reason', async () => {
    const fixture = await buildFixture();
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-reclone-cache-'));
    const tmp = path.dirname(cacheDir);
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const { shim } = await writePartialLogFailingGit(tmp, 'fatal: Authentication failed');

      await expect(
        analyzeRepository(
          { repo: fixture.url },
          options(cacheDir),
          RANGE,
          [RANGE],
          createScopedLog('reclone'),
          {},
          createLimit(1),
          { gitBinary: shim, retryDelays: [] },
        ),
      ).rejects.toThrow(/from promisor remote|Authentication failed/);

      // The failure propagated without entering the full-clone fallback.
      const stderr = stderrWrite.mock.calls.map((call) => String(call[0])).join('');
      expect(stderr).not.toContain('re-cloning as a full clone');
    } finally {
      vi.restoreAllMocks();
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(fixture);
    }
  });

  it('analyzes parallel specs sharing one cache entry safely under the per-entry lock', async () => {
    const fixture = await buildFixture();
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-reclone-cache-'));
    const tmp = path.dirname(cacheDir);
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const { shim } = await writePartialLogFailingGit(
        tmp,
        'fatal: could not fetch 8fc64aaae33316fb07dfdff1c09e17cd42bb40f4 from promisor remote',
      );
      // Two specs on the same URL+branch — differing only in ignored
      // paths, so neither is deduplicated — land on the same cache
      // entry and analyze concurrently.
      const specs = [
        { repo: fixture.url, ignore: ['docs/'] },
        { repo: fixture.url, ignore: ['src/'] },
      ];

      const analyzed = await Promise.all(
        specs.map((spec) =>
          analyzeRepository(
            spec,
            options(cacheDir),
            RANGE,
            [RANGE],
            createScopedLog('reclone'),
            {},
            createLimit(1),
            { gitBinary: shim, retryDelays: [] },
          ),
        ),
      );

      // Both analyses recovered after the fallback with their full
      // commit list — the per-entry lock serialized them so the second
      // read the re-cloned full clone instead of a directory the first
      // was re-cloning under it.
      for (const result of analyzed) {
        expect(result.repositories[0].users[0].name).toBe('Alice');
        expect(result.repositories[0].users[0].deterministic.commits).toBe(2);
      }

      // Exactly one fallback ran — the lock made the second analysis a
      // cache hit on the full clone, so it never failed and never
      // re-cloned a second time.
      const stderr = stderrWrite.mock.calls.map((call) => String(call[0])).join('');
      expect(stderr.match(/re-cloning as a full clone/g)).toHaveLength(1);
    } finally {
      vi.restoreAllMocks();
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(fixture);
    }
  });
});
