/**
 * Tests for the per-repository branch selection of the pipeline: a
 * `repo#branch` repository spec analyzes only that branch's history,
 * records the branch in the report entry, and caches the clone in a
 * branch-scoped entry.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFixtureRepo, removeFixtureRepo } from '../test/fixtures/repo-builder.js';
import type { ReportOptions } from './config.js';
import { runPipeline } from './pipeline.js';
import { entryHash } from './repo/cache.js';
import { gitRevParse, runGit } from './repo/git.js';

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

describe('runPipeline branch selection', () => {
  it('analyzes a requested branch per repository via the repo#branch spec', async () => {
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
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-pipeline-cache-'));
    try {
      const range = { since: '2026-01-01T00:00:00Z', until: '2026-01-31T23:59:59Z' };
      const main = await runPipeline(options({ repos: [`${repo.url}#main`], cacheDir, ...range }));
      const dev = await runPipeline(options({ repos: [`${repo.url}#dev`], cacheDir, ...range }));

      // The report entry carries the bare repo and the analyzed branch,
      // and only that branch's history is counted.
      const mainEntry = main.periods[0].repositories[0];
      expect(mainEntry).toMatchObject({ repo: repo.url, branch: 'main', head: mainHead });
      expect(mainEntry.stats.totalCommits).toBe(2);

      const devEntry = dev.periods[0].repositories[0];
      expect(devEntry).toMatchObject({ repo: repo.url, branch: 'dev', head: devHead });
      expect(devEntry.stats.totalCommits).toBe(3);

      // Branch analyses land in distinct cache entries: the branch is
      // part of the entry key.
      const mainCache = path.join(cacheDir, entryHash(repo.url, 'main'));
      const devCache = path.join(cacheDir, entryHash(repo.url, 'dev'));
      expect(devEntry.clonePath).toBe(path.join(devCache, 'repo'));
      expect(mainEntry.clonePath).toBe(path.join(mainCache, 'repo'));
      expect(devCache).not.toBe(mainCache);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });
});
