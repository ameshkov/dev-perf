/**
 * Tests for the per-repository analysis entry: repositories are cloned
 * in full, so the analysis runs fully offline — a stale partial clone
 * (`blob:none`, created before dev-perf switched to full clones) is
 * re-cloned as a full clone by `ensureClone` before the commit read,
 * and parallel specs that share one cache entry analyze safely under
 * the per-entry lock.
 */
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFixtureRepo, removeFixtureRepo } from '../test/fixtures/repo-builder.js';
import type { ReportOptions } from './config.js';
import { cacheEntryDir, writeCloneInfo } from './repo/cache.js';
import { runGit } from './repo/git.js';
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
 * Seeds a cache entry with a stale partial clone — a `blob:none` clone
 * (with `remote.origin.promisor` = `true`) of the kind dev-perf created
 * before switching to full clones — plus its `clone.json`, so the
 * analysis re-clones it as a full clone instead of reusing it.
 */
async function seedStalePartialClone(
  fixture: Awaited<ReturnType<typeof buildFixture>>,
  cacheDir: string,
): Promise<string> {
  const entryDir = cacheEntryDir(cacheDir, fixture.url);
  await mkdir(entryDir, { recursive: true });
  await runGit(entryDir, ['clone', '--filter=blob:none', fixture.url, 'repo'], {
    env: { GIT_PROTOCOL: 'version=2' },
  });
  const repoDir = path.join(entryDir, 'repo');
  const branch = (await runGit(repoDir, ['branch', '--show-current'])).trim();
  const head = (await runGit(repoDir, ['rev-parse', 'HEAD'])).trim();
  await writeCloneInfo(entryDir, {
    url: fixture.url,
    clonedAt: new Date().toISOString(),
    branch,
    head,
  });
  return repoDir;
}

/** The analyzed range of the tests: January 2026. */
const RANGE = { since: '2026-01-01T00:00:00.000Z', until: '2026-01-31T23:59:59.000Z' };

describe('analyzeRepository', () => {
  it('analyzes a repository offline with a full clone', async () => {
    const fixture = await buildFixture();
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-reclone-cache-'));
    try {
      const result = await analyzeRepository(
        { repo: fixture.url },
        options(cacheDir),
        RANGE,
        [RANGE],
        createScopedLog('reclone'),
        {},
        createLimit(1),
        {},
      );

      expect(result.repositories).toHaveLength(1);
      expect(result.repositories[0].users).toHaveLength(1);
      expect(result.repositories[0].users[0].name).toBe('Alice');
      expect(result.repositories[0].users[0].deterministic.commits).toBe(2);

      // The full clone carries no partial-clone filter — the read never
      // depends on a remote.
      const config = await readFile(
        path.join(cacheEntryDir(cacheDir, fixture.url), 'repo', '.git', 'config'),
        'utf8',
      );
      expect(config).not.toContain('partialclonefilter');
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(fixture);
    }
  });

  it('re-clones a stale partial clone cache entry before analyzing', async () => {
    const fixture = await buildFixture();
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-reclone-cache-'));
    try {
      const seeded = await seedStalePartialClone(fixture, cacheDir);
      const seededConfig = await readFile(path.join(seeded, '.git', 'config'), 'utf8');
      expect(seededConfig).toContain('partialclonefilter');

      const result = await analyzeRepository(
        { repo: fixture.url },
        options(cacheDir),
        RANGE,
        [RANGE],
        createScopedLog('reclone'),
        {},
        createLimit(1),
        {},
      );

      // The analysis ran offline on the re-cloned full clone.
      expect(result.repositories[0].users[0].deterministic.commits).toBe(2);
      const config = await readFile(
        path.join(cacheEntryDir(cacheDir, fixture.url), 'repo', '.git', 'config'),
        'utf8',
      );
      expect(config).not.toContain('partialclonefilter');
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(fixture);
    }
  });

  it('analyzes parallel specs sharing one cache entry safely under the per-entry lock', async () => {
    const fixture = await buildFixture();
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-reclone-cache-'));
    try {
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
            {},
          ),
        ),
      );

      // Both analyses read the one shared full clone without racing: the
      // per-entry lock serialized them, so each reports the full commit
      // list and nothing was re-cloned under the other's read.
      for (const result of analyzed) {
        expect(result.repositories[0].users[0].name).toBe('Alice');
        expect(result.repositories[0].users[0].deterministic.commits).toBe(2);
      }
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(fixture);
    }
  });
});
