/**
 * Tests for the per-repository ignore paths of the pipeline: the
 * structured `repos` entry (`{ repo, branch?, ignore? }`) drops
 * ignored-only commits and files from the deterministic metrics, keeps
 * the non-ignored files of a mixed commit, records the configured
 * `ignoredPaths` and the branch on the report entry, and lists the
 * repo URL in the parameters.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildFixtureRepo, removeFixtureRepo } from '../test/fixtures/repo-builder.js';
import type { ReportOptions } from './config.js';
import { runPipeline } from './pipeline.js';
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

describe('runPipeline ignore paths', () => {
  it('applies the ignored paths to the metrics and records them on the entry', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'docs: ignored only',
        files: [{ path: 'docs/guide.md', content: 'guide\n' }],
      },
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-02T11:00:00Z',
        message: 'feat: mixed commit',
        files: [
          { path: 'src/app.ts', content: 'line1\nline2\n' },
          { path: 'docs/changelog.md', content: 'changelog\n' },
        ],
      },
      {
        author: { name: 'Bob', email: 'bob@example.com' },
        date: '2026-01-03T09:00:00Z',
        message: 'feat: util',
        files: [{ path: 'src/util.ts', content: 'u\n' }],
      },
    ]);
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-ignore-cache-'));
    try {
      const range = { since: '2026-01-01T00:00:00Z', until: '2026-01-31T23:59:59Z' };
      const spec: RepoSpec = {
        repo: repo.url,
        branch: 'main',
        ignore: ['docs/'],
      };
      const report = await runPipeline(options({ repos: [spec], cacheDir, ...range }));

      const entry = report.periods[0].repositories[0];
      // The docs-only commit is dropped, the mixed commit keeps only
      // its non-ignored file, and the branch/ignored paths are recorded.
      expect(entry).toMatchObject({ repo: repo.url, branch: 'main', ignoredPaths: ['docs/'] });
      expect(entry.stats.totalCommits).toBe(2);
      expect(report.parameters.repos).toEqual([spec]);

      const alice = entry.users.find((user) => user.name === 'Alice');
      expect(alice?.deterministic).toMatchObject({
        commits: 1,
        nonMergeCommits: 1,
        linesAdded: 2,
        linesRemoved: 0,
        filesTouched: 1,
        uniqueFilesTouched: 1,
      });

      const bob = entry.users.find((user) => user.name === 'Bob');
      expect(bob?.deterministic).toMatchObject({ commits: 1, linesAdded: 1, filesTouched: 1 });
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('keeps a plain string repos entry backward compatible (no ignoredPaths key)', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'feat: base',
        files: [{ path: 'a.txt', content: 'a\n' }],
      },
    ]);
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-ignore-cache-'));
    try {
      const range = { since: '2026-01-01T00:00:00Z', until: '2026-01-31T23:59:59Z' };
      const spec: RepoSpec = { repo: repo.url };
      const report = await runPipeline(options({ repos: [spec], cacheDir, ...range }));

      const entry = report.periods[0].repositories[0];
      expect(entry).toMatchObject({ repo: repo.url, branch: 'main' });
      expect('ignoredPaths' in entry).toBe(false);
      expect(report.parameters.repos).toEqual([{ repo: repo.url }]);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('dedupes ignore lists listed in a different order as the same spec', async () => {
    // The dedupe key sorts the ignore patterns, so two entries listing
    // the same patterns in a different order are one spec — otherwise
    // they would race on the same cache entry.
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'init',
        files: [{ path: 'src/a.txt', content: 'a\n' }],
      },
    ]);
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-ignore-cache-'));
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const range = { since: '2026-01-01T00:00:00Z', until: '2026-01-31T23:59:59Z' };
      const report = await runPipeline(
        options({
          repos: [
            { repo: repo.url, branch: 'main', ignore: ['docs/', 'vendor/'] },
            { repo: repo.url, branch: 'main', ignore: ['vendor/', 'docs/'] },
          ],
          cacheDir,
          ...range,
        }),
      );

      expect(report.periods[0].repositories).toHaveLength(1);
      expect(report.parameters.repos).toEqual([
        { repo: repo.url, branch: 'main', ignore: ['docs/', 'vendor/'] },
      ]);
      const stderr = stderrWrite.mock.calls.map((call) => String(call[0])).join('');
      expect(stderr).toContain(`duplicate repository skipped: "${repo.url}"`);
    } finally {
      vi.restoreAllMocks();
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });
});
