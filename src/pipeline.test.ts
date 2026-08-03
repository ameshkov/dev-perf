/**
 * Tests for the pipeline orchestration (plan step 5): end-to-end
 * deterministic analysis against fixture repos — report shape, range
 * resolution, output-file writing, and empty repositories.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFixtureRepo, removeFixtureRepo } from '../test/fixtures/repo-builder.js';
import type { CliOptions } from './config.js';
import { runPipeline } from './pipeline.js';
import { entryHash } from './repo/cache.js';
import { gitRevParse } from './repo/git.js';
import { reportSchema } from './report/schema.js';

/** Defaults for a deterministic-only pipeline run. */
function options(overrides: Partial<CliOptions> = {}): CliOptions {
  return {
    repos: [],
    llm: false,
    limitContext: 262144,
    limitOutput: 65536,
    ...overrides,
  };
}

describe('runPipeline', () => {
  it('assembles an exact report for a fixture repo', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'feat: add app',
        files: [
          { path: 'src/app.ts', content: 'line1\nline2\n' },
          { path: 'README.md', content: 'hello\n' },
        ],
      },
      {
        author: { name: 'Bob', email: 'bob@example.com' },
        date: '2026-01-02T11:00:00Z',
        message: 'docs: extend readme',
        files: [{ path: 'README.md', content: 'hello\nworld\n' }],
      },
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-03T09:00:00Z',
        message: 'chore: add binary asset',
        files: [{ path: 'assets/logo.bin', content: '\u0000\u0001\u0002' }],
      },
    ]);
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-pipeline-cache-'));
    try {
      const report = await runPipeline(
        options({
          repos: [repo.url],
          cacheDir,
          since: '2026-01-01T00:00:00Z',
          until: '2026-01-31T23:59:59Z',
        }),
      );

      const head = await gitRevParse(repo.dir, ['HEAD']);
      expect(report).toStrictEqual({
        schemaVersion: 1,
        generatedAt: expect.any(String),
        parameters: {
          repos: [repo.url],
          since: '2026-01-01T00:00:00.000Z',
          until: '2026-01-31T23:59:59.000Z',
          llmEnabled: false,
        },
        repositories: [
          {
            repo: repo.url,
            clonePath: path.join(cacheDir, entryHash(repo.url), 'repo'),
            branch: 'main',
            head,
            range: {
              since: '2026-01-01T00:00:00.000Z',
              until: '2026-01-31T23:59:59.000Z',
            },
            stats: {
              totalCommits: 3,
              totalUsers: 2,
              topLanguages: [
                { language: 'Markdown', linesAdded: 2 },
                { language: 'TypeScript', linesAdded: 2 },
                { language: 'Unknown', linesAdded: 0 },
              ],
            },
            users: [
              {
                name: 'Alice',
                emails: ['alice@example.com'],
                isBot: false,
                deterministic: {
                  commits: 2,
                  nonMergeCommits: 2,
                  mergeCommits: 0,
                  linesAdded: 3,
                  linesRemoved: 0,
                  netLines: 3,
                  filesTouched: 3,
                  uniqueFilesTouched: 3,
                  activeDays: 2,
                  firstCommitAt: '2026-01-01T10:00:00.000Z',
                  lastCommitAt: '2026-01-03T09:00:00.000Z',
                  avgCommitSize: 1.5,
                  languages: {
                    TypeScript: { linesAdded: 2, linesRemoved: 0, filesTouched: 1 },
                    Markdown: { linesAdded: 1, linesRemoved: 0, filesTouched: 1 },
                    Unknown: { linesAdded: 0, linesRemoved: 0, filesTouched: 1 },
                  },
                },
                llm: { status: 'skipped', contributions: [] },
              },
              {
                name: 'Bob',
                emails: ['bob@example.com'],
                isBot: false,
                deterministic: {
                  commits: 1,
                  nonMergeCommits: 1,
                  mergeCommits: 0,
                  linesAdded: 1,
                  linesRemoved: 0,
                  netLines: 1,
                  filesTouched: 1,
                  uniqueFilesTouched: 1,
                  activeDays: 1,
                  firstCommitAt: '2026-01-02T11:00:00.000Z',
                  lastCommitAt: '2026-01-02T11:00:00.000Z',
                  avgCommitSize: 1,
                  languages: {
                    Markdown: { linesAdded: 1, linesRemoved: 0, filesTouched: 1 },
                  },
                },
                llm: { status: 'skipped', contributions: [] },
              },
            ],
          },
        ],
      });
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('writes the report to the --output file', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'init',
        files: [{ path: 'a.txt', content: 'a\n' }],
      },
    ]);
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-pipeline-cache-'));
    const outFile = path.join(cacheDir, 'report.json');
    try {
      const report = await runPipeline(options({ repos: [repo.url], cacheDir, output: outFile }));
      const written = JSON.parse(await readFile(outFile, 'utf8')) as unknown;
      expect(reportSchema.safeParse(written).success).toBe(true);
      expect(written).toStrictEqual(report);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('resolves explicit bounds to UTC instants and defaults the until bound to now', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'init',
        files: [{ path: 'a.txt', content: 'a\n' }],
      },
    ]);
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-pipeline-cache-'));
    try {
      const report = await runPipeline(
        options({ repos: [repo.url], cacheDir, since: '2026-01-01T00:00:00Z' }),
      );
      expect(report.parameters.since).toBe('2026-01-01T00:00:00.000Z');
      expect(report.parameters.until).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      // The default `--until` bound resolves to "today": roughly now.
      expect(Date.parse(report.parameters.until)).toBeGreaterThan(Date.now() - 60_000);
      expect(Date.parse(report.parameters.until)).toBeLessThan(Date.now() + 60_000);
      expect(report.repositories[0].range).toEqual({
        since: report.parameters.since,
        until: report.parameters.until,
      });
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('reports an empty user list for a repository without commits', async () => {
    const repo = await buildFixtureRepo([]);
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-pipeline-cache-'));
    try {
      const report = await runPipeline(
        options({ repos: [repo.url], cacheDir, since: '2026-01-01T00:00:00Z' }),
      );
      expect(report.repositories[0].users).toEqual([]);
      expect(report.repositories[0].head).toBe('');
      expect(report.repositories[0].stats).toEqual({
        totalCommits: 0,
        totalUsers: 0,
        topLanguages: [],
      });
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });
});
