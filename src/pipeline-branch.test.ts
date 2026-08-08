/**
 * Tests for the per-repository branch selection and branch-delta
 * scoping of the pipeline: a structured `{ repo, branch?, base? }` entry
 * analyzes that branch's history, a non-default branch is scoped to its delta
 * vs the base (main/master) by default, the empty-string base restores
 * full history, the report entry records the analyzed branch and the
 * resolved base, and each branch is cached in a branch-scoped cache
 * entry.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildFixtureRepo, removeFixtureRepo } from '../test/fixtures/repo-builder.js';
import type { ReportOptions } from './config.js';
import { runPipeline } from './pipeline.js';
import { entryHash } from './repo/cache.js';
import { gitRevParse, runGit } from './repo/git.js';
import { parseRepoConfigItem, parseRepoSpec } from './repo/repo-spec.js';
import type { RepoSpec } from './repo/repo-spec.js';

/** Defaults for a deterministic-only pipeline run. */
function options(overrides: Partial<ReportOptions> = {}): ReportOptions {
  return {
    repos: [],
    llm: false,
    limitContext: 262144,
    limitOutput: 65536,
    llmRetries: 2,
    parallel: 1,
    ...overrides,
  };
}

/** The analyzed range covering all fixture commits. */
const RANGE = { since: '2026-01-01T00:00:00Z', until: '2026-01-31T23:59:59Z' };

/** A repo with two main commits and a dev branch adding one more. */
async function repoWithBranch() {
  const repo = await buildFixtureRepo([
    {
      author: { name: 'Alice', email: 'alice@example.com' },
      date: '2026-01-01T10:00:00Z',
      message: 'feat: base',
      files: [{ path: 'a.txt', content: 'a\n' }],
    },
    {
      author: { name: 'Alice', email: 'alice@example.com' },
      date: '2026-01-02T11:00:00Z',
      message: 'feat: second',
      files: [{ path: 'b.txt', content: 'b\n' }],
    },
  ]);
  // dev branches from main and adds one commit; main stays behind.
  await runGit(repo.dir, ['checkout', '-b', 'dev']);
  await writeFile(path.join(repo.dir, 'dot-dev.txt'), 'dev\n');
  await runGit(repo.dir, ['add', '-A']);
  await runGit(
    repo.dir,
    [
      'commit',
      '--author',
      'Alice <alice@example.com>',
      '--date',
      '2026-01-03T12:00:00Z',
      '-m',
      'feat: dev only',
    ],
    { env: { GIT_COMMITTER_DATE: '2026-01-03T12:00:00Z' } },
  );
  const devHead = await gitRevParse(repo.dir, ['HEAD']);
  await runGit(repo.dir, ['checkout', 'main']);
  const mainHead = await gitRevParse(repo.dir, ['HEAD']);
  return { repo, devHead, mainHead };
}

/** Runs one pipeline call and returns the single repository entry. */
async function singleEntry(spec: RepoSpec, cacheDir: string) {
  const report = await runPipeline(options({ repos: [spec], cacheDir, ...RANGE }));
  return report.periods[0].repositories[0];
}

describe('runPipeline branch selection and branch-delta', () => {
  it('keeps the default branch full-history and scopes a non-default branch to its delta vs the base', async () => {
    const { repo, devHead, mainHead } = await repoWithBranch();
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-pipeline-cache-'));
    try {
      // The bare entry analyzes the default branch (main): the base
      // (main, via the default main/master candidates) is its own head,
      // so no delta applies and main keeps its full history.
      const mainEntry = await singleEntry(parseRepoSpec(repo.url), cacheDir);
      expect(mainEntry).toMatchObject({ repo: repo.url, branch: 'main', head: mainHead });
      expect(mainEntry.stats.totalCommits).toBe(2);
      expect(mainEntry.baseBranch).toBeUndefined();

      // `dev` is a non-default branch (structured entry): the base
      // resolves to origin/main (only origin/main exists in the dev
      // clone), and the delta vs it is exactly the dev-only commit.
      const devEntry = await singleEntry(
        parseRepoConfigItem({ repo: repo.url, branch: 'dev' }),
        cacheDir,
      );
      expect(devEntry).toMatchObject({
        repo: repo.url,
        branch: 'dev',
        head: devHead,
        baseBranch: 'origin/main',
      });
      expect(devEntry.stats.totalCommits).toBe(1);

      // Branch analyses land in distinct cache entries: the branch is
      // part of the entry key (main, analyzed bare, uses the unkeyed
      // entry; dev its own branch-keyed one).
      const mainCache = path.join(cacheDir, entryHash(repo.url));
      const devCache = path.join(cacheDir, entryHash(repo.url, 'dev'));
      expect(mainEntry.clonePath).toBe(path.join(mainCache, 'repo'));
      expect(devEntry.clonePath).toBe(path.join(devCache, 'repo'));
      expect(devCache).not.toBe(mainCache);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('restores the full history of a branch with the empty-string base opt-out', async () => {
    const { repo, devHead } = await repoWithBranch();
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-pipeline-cache-'));
    try {
      const dev = parseRepoConfigItem({
        repo: repo.url,
        branch: 'dev',
        base: '',
      });
      const devEntry = await singleEntry(dev, cacheDir);
      expect(devEntry).toMatchObject({ repo: repo.url, branch: 'dev', head: devHead });
      expect(devEntry.stats.totalCommits).toBe(3);
      expect(devEntry.baseBranch).toBeUndefined();
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('scopes to an explicit base-branch when it resolves', async () => {
    const { repo, devHead } = await repoWithBranch();
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-pipeline-cache-'));
    try {
      // In the dev clone the base `main` exists only as origin/main;
      // the explicit base resolves there and the delta is the dev-only
      // commit, recorded as origin/main.
      const dev = parseRepoConfigItem({
        repo: repo.url,
        branch: 'dev',
        base: 'main',
      });
      const devEntry = await singleEntry(dev, cacheDir);
      expect(devEntry).toMatchObject({
        repo: repo.url,
        branch: 'dev',
        head: devHead,
        baseBranch: 'origin/main',
      });
      expect(devEntry.stats.totalCommits).toBe(1);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('keeps two entries for the same branch with different base scoping', async () => {
    // Dedupe keys on the base too: a branch analyzed as a delta vs one
    // base and as its full history (empty-string base) are distinct
    // specs — never silently merged.
    const { repo } = await repoWithBranch();
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-pipeline-cache-'));
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const report = await runPipeline(
        options({
          repos: [
            { repo: repo.url, branch: 'dev', base: 'main' },
            { repo: repo.url, branch: 'dev', base: '' },
          ],
          cacheDir,
          ...RANGE,
        }),
      );

      // Both entries survive dedupe: the delta-scoped one records its
      // base and one commit, the full-history one neither.
      const entries = report.periods[0].repositories;
      expect(entries.map((entry) => entry.baseBranch)).toEqual(['origin/main', undefined]);
      expect(entries.map((entry) => entry.stats.totalCommits)).toEqual([1, 3]);
      const stderr = stderrWrite.mock.calls.map((call) => String(call[0])).join('');
      expect(stderr).not.toContain('duplicate repository skipped');
    } finally {
      vi.restoreAllMocks();
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('keeps two entries for the same branch with default and explicit full-history base', async () => {
    // `base: undefined` (the default main/master delta) and `base: ''`
    // (the full-history opt-out) are distinct analyses, so both survive
    // dedupe instead of one being misreported as a duplicate.
    const { repo } = await repoWithBranch();
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-pipeline-cache-'));
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const report = await runPipeline(
        options({
          repos: [
            { repo: repo.url, branch: 'dev' },
            { repo: repo.url, branch: 'dev', base: '' },
          ],
          cacheDir,
          ...RANGE,
        }),
      );

      const entries = report.periods[0].repositories;
      expect(entries).toHaveLength(2);
      // The default-base entry scopes to the delta vs origin/main (1
      // commit); the explicit opt-out analyzes the full history (3).
      expect(entries.map((entry) => entry.stats.totalCommits)).toEqual([1, 3]);
      const stderr = stderrWrite.mock.calls.map((call) => String(call[0])).join('');
      expect(stderr).not.toContain('duplicate repository skipped');
    } finally {
      vi.restoreAllMocks();
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });
});
