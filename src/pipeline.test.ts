/**
 * Tests for the pipeline orchestration: end-to-end
 * deterministic analysis against fixture repos — report shape, range
 * resolution, output-file writing, and empty repositories.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildFixtureRepo, removeFixtureRepo } from '../test/fixtures/repo-builder.js';
import type { ReportOptions } from './config.js';
import { runPipeline } from './pipeline.js';
import { entryHash } from './repo/cache.js';
import { gitRevParse } from './repo/git.js';
import { trendReportSchema } from './report/schema.js';

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
        schemaVersion: 2,
        generatedAt: expect.any(String),
        parameters: {
          repos: [repo.url],
          since: '2026-01-01T00:00:00.000Z',
          until: '2026-01-31T23:59:59.000Z',
          llmEnabled: false,
        },
        periods: [
          {
            since: '2026-01-01T00:00:00.000Z',
            until: '2026-01-31T23:59:59.000Z',
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
                    { language: 'Binary', linesAdded: 0 },
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
                        Binary: { linesAdded: 0, linesRemoved: 0, filesTouched: 1 },
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
      expect(trendReportSchema.safeParse(written).success).toBe(true);
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
      expect(report.periods[0].repositories[0].range).toEqual({
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
      expect(report.periods[0].repositories[0].users).toEqual([]);
      expect(report.periods[0].repositories[0].head).toBe('');
      expect(report.periods[0].repositories[0].stats).toEqual({
        totalCommits: 0,
        totalUsers: 0,
        topLanguages: [],
      });
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('with --unit month reports one period per month, zeroing inactive users', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-15T10:00:00Z',
        message: 'feat: january',
        files: [{ path: 'src/a.ts', content: 'a\n' }],
      },
      {
        author: { name: 'Bob', email: 'bob@example.com' },
        date: '2026-03-10T11:00:00Z',
        message: 'docs: march',
        files: [{ path: 'README.md', content: 'hi\n' }],
      },
    ]);
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-pipeline-cache-'));
    try {
      const report = await runPipeline(
        options({
          repos: [repo.url],
          cacheDir,
          unit: 'month',
          since: '2026-01-01T00:00:00Z',
          until: '2026-03-31T23:59:59Z',
        }),
      );

      // The run parameters record the unit; the repository entries are
      // nested one level deeper, per period.
      expect(report.parameters.unit).toBe('month');
      expect(report.parameters.since).toBe('2026-01-01T00:00:00.000Z');
      expect(report.periods).toHaveLength(3);

      // January and March carry their commits; February is empty but
      // still reported, with both users zeroed. Group order follows
      // the newest-first commit list: Bob (Mar) before Alice (Jan).
      expect(report.periods[0]).toMatchObject({
        since: '2026-01-01T00:00:00.000Z',
        until: '2026-01-31T23:59:59.999Z',
      });
      expect(report.periods[0].repositories[0].stats.totalCommits).toBe(1);
      expect(report.periods[0].repositories[0].users.map((user) => user.name)).toEqual([
        'Bob',
        'Alice',
      ]);
      expect(report.periods[0].repositories[0].users[0].deterministic.commits).toBe(0);
      expect(report.periods[0].repositories[0].users[1].deterministic.commits).toBe(1);

      expect(report.periods[1]).toMatchObject({
        since: '2026-02-01T00:00:00.000Z',
        until: '2026-02-28T23:59:59.999Z',
      });
      expect(report.periods[1].repositories[0].stats).toEqual({
        totalCommits: 0,
        totalUsers: 2,
        topLanguages: [],
      });
      // The same user list as every other period, with zeroed metrics.
      expect(report.periods[1].repositories[0].users.map((user) => user.name)).toEqual([
        'Bob',
        'Alice',
      ]);
      for (const user of report.periods[1].repositories[0].users) {
        expect(user.deterministic).toMatchObject({
          commits: 0,
          nonMergeCommits: 0,
          linesAdded: 0,
          linesRemoved: 0,
          filesTouched: 0,
          uniqueFilesTouched: 0,
          activeDays: 0,
          firstCommitAt: '',
          lastCommitAt: '',
          avgCommitSize: 0,
          languages: {},
        });
      }

      expect(report.periods[2]).toMatchObject({
        since: '2026-03-01T00:00:00.000Z',
        until: '2026-03-31T23:59:59.000Z',
      });
      expect(report.periods[2].repositories[0].stats.totalCommits).toBe(1);
      expect(report.periods[2].repositories[0].users.map((user) => user.name)).toEqual([
        'Bob',
        'Alice',
      ]);
      expect(report.periods[2].repositories[0].users[0].deterministic.commits).toBe(1);
      expect(report.periods[2].repositories[0].users[1].deterministic.commits).toBe(0);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('covers exactly two months for a date-only since/until range', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-15T10:00:00Z',
        message: 'feat: january',
        files: [{ path: 'a.txt', content: 'a\n' }],
      },
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-02-10T10:00:00Z',
        message: 'feat: february',
        files: [{ path: 'b.txt', content: 'b\n' }],
      },
      {
        // Authored on March 1: outside a range ending 2026-03-01.
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-03-01T09:00:00Z',
        message: 'feat: march 1',
        files: [{ path: 'c.txt', content: 'c\n' }],
      },
    ]);
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-pipeline-cache-'));
    try {
      const report = await runPipeline(
        options({ repos: [repo.url], cacheDir, since: '2026-01-01', until: '2026-03-01' }),
      );

      // The date-only `until` resolves to the start of its day, so the
      // range covers January and February exactly — not March 1 too.
      expect(report.parameters.since).toBe('2026-01-01T00:00:00.000Z');
      expect(report.parameters.until).toBe('2026-03-01T00:00:00.000Z');
      expect(report.periods[0].repositories[0].stats.totalCommits).toBe(2);
      expect(report.periods[0].repositories[0].users[0].deterministic.firstCommitAt).toBe(
        '2026-01-15T10:00:00.000Z',
      );
      expect(report.periods[0].repositories[0].users[0].deterministic.lastCommitAt).toBe(
        '2026-02-10T10:00:00.000Z',
      );

      // With --unit month the boundary-midnight until ends the split
      // after February: exactly two periods, no zero-length third one.
      const monthly = await runPipeline(
        options({
          repos: [repo.url],
          cacheDir,
          unit: 'month',
          since: '2026-01-01',
          until: '2026-03-01',
        }),
      );
      expect(monthly.periods).toHaveLength(2);
      expect(monthly.periods[0]).toMatchObject({
        since: '2026-01-01T00:00:00.000Z',
        until: '2026-01-31T23:59:59.999Z',
      });
      expect(monthly.periods[1]).toMatchObject({
        since: '2026-02-01T00:00:00.000Z',
        until: '2026-02-28T23:59:59.999Z',
      });
      expect(monthly.periods.map((period) => period.repositories[0].stats.totalCommits)).toEqual([
        1, 1,
      ]);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('with --parallel 2 analyzes all repos and produces the same report as --parallel 1', async () => {
    const first = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'feat: app',
        files: [{ path: 'src/app.ts', content: 'line1\nline2\n' }],
      },
    ]);
    const second = await buildFixtureRepo([
      {
        author: { name: 'Bob', email: 'bob@example.com' },
        date: '2026-01-02T11:00:00Z',
        message: 'docs: readme',
        files: [{ path: 'README.md', content: 'hello\n' }],
      },
    ]);
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-pipeline-cache-'));
    try {
      const repos = [first.url, second.url];
      // Explicit bounds keep the two runs' resolved ranges identical:
      // the default `until: today` resolves to the current wall-clock
      // instant, so back-to-back runs could disagree by a second and
      // spuriously fail the comparison.
      const range = { since: '2026-01-01T00:00:00Z', until: '2026-01-31T23:59:59Z' };
      const serial = await runPipeline(options({ repos, cacheDir, parallel: 1, ...range }));
      const parallel = await runPipeline(options({ repos, cacheDir, parallel: 2, ...range }));

      expect(parallel.parameters.repos).toEqual(repos);
      expect(parallel.periods).toHaveLength(1);
      expect(parallel.periods[0].repositories.map((entry) => entry.repo)).toEqual(repos);
      // The two runs differ only in the generation timestamp.
      expect({ ...parallel, generatedAt: '' }).toStrictEqual({ ...serial, generatedAt: '' });
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(first);
      await removeFixtureRepo(second);
    }
  });

  it('analyzes a duplicate repository once and warns about the dropped copy', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'init',
        files: [{ path: 'a.txt', content: 'a\n' }],
      },
    ]);
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-pipeline-cache-'));
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const report = await runPipeline(options({ repos: [repo.url, repo.url], cacheDir }));

      // One entry, listed once in the parameters — not two identical
      // copies.
      expect(report.parameters.repos).toEqual([repo.url]);
      expect(report.periods[0].repositories).toHaveLength(1);
      const stderr = stderrWrite.mock.calls.map((call) => String(call[0])).join('');
      expect(stderr).toContain(`duplicate repository skipped: "${repo.url}"`);
    } finally {
      vi.restoreAllMocks();
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });
});
