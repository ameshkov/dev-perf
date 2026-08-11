/**
 * Tests for the per-repository commit exclusions of the pipeline: the
 * structured `repos` entry (`{ repo, ignoreCommits? }`) drops commits
 * by hash and by message pattern from the deterministic metrics,
 * records the configured `ignoredCommits` on the report entry, lists
 * the full spec in the parameters, and treats specs that differ only in
 * the commit exclusions as distinct analyses while one is analyzed
 * once.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFixtureRepo, removeFixtureRepo } from '../test/fixtures/repo-builder.js';
import type { ReportOptions } from './config.js';
import { runPipeline } from './pipeline.js';
import { gitRevParse } from './repo/git.js';
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

/** Resolves one commit sha of the fixture repo (e.g. `HEAD`). */
async function shaOf(repoDir: string, ref: string): Promise<string> {
  return (await gitRevParse(repoDir, [ref])).trim();
}

describe('runPipeline commit exclusions', () => {
  it('drops commits by hash and by message pattern and records the exclusions', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'chore: bump lockfile',
        files: [{ path: 'pnpm-lock.yaml', content: 'lock\n' }],
      },
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-02T11:00:00Z',
        message: 'feat: core',
        files: [{ path: 'src/core.ts', content: 'line1\nline2\n' }],
      },
      {
        author: { name: 'Bob', email: 'bob@example.com' },
        date: '2026-01-03T09:00:00Z',
        message: 'feat: util',
        files: [{ path: 'src/util.ts', content: 'u\n' }],
      },
    ]);
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-ignore-commits-cache-'));
    try {
      // Bob's commit (HEAD) is excluded by hash, Alice's chore commit
      // (HEAD~2) by its message pattern — only Alice's `feat: core`
      // survives.
      const bobSha = await shaOf(repo.dir, 'HEAD');
      const range = { since: '2026-01-01T00:00:00Z', until: '2026-01-31T23:59:59Z' };
      const spec: RepoSpec = {
        repo: repo.url,
        branch: 'main',
        ignoreCommits: { hashes: [bobSha], messages: ['^chore'] },
      };
      const report = await runPipeline(options({ repos: [spec], cacheDir, ...range }));

      const entry = report.periods[0].repositories[0];
      expect(entry).toMatchObject({
        repo: repo.url,
        branch: 'main',
        ignoredCommits: { hashes: [bobSha], messages: ['^chore'] },
      });
      expect(entry.stats.totalCommits).toBe(1);
      expect(report.parameters.repos).toEqual([spec]);
      // Bob's only commit is gone, so he is no longer a user; Alice
      // keeps only the non-ignored commit.
      expect(entry.users.map((user) => user.name)).toEqual(['Alice']);
      expect(entry.users[0].deterministic).toMatchObject({
        commits: 1,
        nonMergeCommits: 1,
        linesAdded: 2,
        filesTouched: 1,
      });
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('treats specs that differ only in the commit exclusions as distinct', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'feat: base',
        files: [{ path: 'src/a.ts', content: 'a\n' }],
      },
    ]);
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-ignore-commits-cache-'));
    try {
      const range = { since: '2026-01-01T00:00:00Z', until: '2026-01-31T23:59:59Z' };
      const headSha = await shaOf(repo.dir, 'HEAD');
      const report = await runPipeline(
        options({
          repos: [
            { repo: repo.url, branch: 'main', ignoreCommits: { hashes: [headSha] } },
            {
              repo: repo.url,
              branch: 'main',
              ignoreCommits: { hashes: [headSha], messages: ['^feat'] },
            },
          ],
          cacheDir,
          ...range,
        }),
      );

      // Different commit exclusions are different analyses: neither spec
      // is deduplicated away.
      expect(report.periods[0].repositories).toHaveLength(2);
      expect(report.parameters.repos).toHaveLength(2);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('keeps a plain string repos entry backward compatible (no ignoredCommits key)', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'feat: base',
        files: [{ path: 'a.txt', content: 'a\n' }],
      },
    ]);
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-ignore-commits-cache-'));
    try {
      const range = { since: '2026-01-01T00:00:00Z', until: '2026-01-31T23:59:59Z' };
      const spec: RepoSpec = { repo: repo.url };
      const report = await runPipeline(options({ repos: [spec], cacheDir, ...range }));

      const entry = report.periods[0].repositories[0];
      expect(entry).toMatchObject({ repo: repo.url, branch: 'main' });
      expect('ignoredCommits' in entry).toBe(false);
      expect(report.parameters.repos).toEqual([{ repo: repo.url }]);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });
});
