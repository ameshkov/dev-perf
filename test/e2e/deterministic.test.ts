/**
 * End-to-end tests for the deterministic analysis path: the compiled
 * CLI runs with `--no-llm` against a fixture repo as a child process,
 * and the emitted output is validated against the report schema and
 * checked exactly. stdout carries the report JSON only; stderr carries
 * the startup block — the application version and the per-line run
 * configuration — on every run, plus the verbose progress lines when
 * `--verbose` is passed.
 *
 * The suite needs `pnpm build` to have produced `build/index.js`; it
 * is skipped when the build is missing so a plain `pnpm test` stays
 * green (the full gate `pnpm check` always builds first).
 */
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';
import type { FixtureRepo } from '../fixtures/repo-builder.js';
import { buildFixtureRepo, removeFixtureRepo } from '../fixtures/repo-builder.js';
import { entryHash } from '../../src/repo/cache.js';
import { gitRevParse } from '../../src/repo/git.js';
import { trendReportSchema } from '../../src/report/schema.js';
import { appVersion } from '../../src/version.js';

/** Compiled CLI entry point; the suite runs it as a child process. */
const BUILD_ENTRY = path.resolve(process.cwd(), 'build', 'index.js');

/**
 * The parent environment without `DEV_PERF_*` variables, so settings a
 * developer shell exports (e.g. `DEV_PERF_VERBOSE`) cannot leak into
 * the child runs and break the expected outputs.
 */
function cleanEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('DEV_PERF_')),
  );
}

/**
 * The directory the child CLI runs in: the test's own temp cache dir,
 * which never contains a `.env` — the CLI auto-loads `.env` from its
 * working directory via dotenv, so running from the repo root would
 * re-inject the developer's `DEV_PERF_*` variables (e.g.
 * `DEV_PERF_OUTPUT`) that `cleanEnv` already strips from the
 * inherited environment. Every argument passed to the child is an
 * absolute path, so the changed cwd cannot affect anything else.
 *
 * @param cacheDir - The temp cache directory of the current test.
 * @returns The spawn options for the child CLI.
 */
function spawnOptions(cacheDir: string): {
  env: NodeJS.ProcessEnv;
  cwd: string;
  stripFinalNewline: false;
} {
  // `stripFinalNewline: false` keeps the captured stdout faithful: the
  // report parsing expects the exact pretty-printed JSON, which execa's
  // default newline stripping would disturb.
  return { env: cleanEnv(), cwd: cacheDir, stripFinalNewline: false };
}

/**
 * Builds the fixture repo both e2e cases analyze: two authors, a
 * TypeScript file, a Markdown file, and a binary asset, all inside an
 * explicit author-date range so the report is stable.
 */
async function buildFixture(): Promise<FixtureRepo> {
  return buildFixtureRepo([
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
}

/**
 * The exact report the fixture produces with the fixed
 * `--since`/`--until` range, used by every e2e case.
 *
 * @param repo - The fixture repo (for its URL).
 * @param cacheDir - The cache directory passed to the CLI.
 * @returns The expected report document.
 */
async function expectedReport(repo: FixtureRepo, cacheDir: string): Promise<unknown> {
  const head = await gitRevParse(repo.dir, ['HEAD']);
  return {
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
  };
}

describe.skipIf(!existsSync(BUILD_ENTRY))('e2e: deterministic analysis', () => {
  it('prints the exact expected report to stdout with the configuration on stderr', async () => {
    const repo = await buildFixture();
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-e2e-cache-'));
    try {
      const { stdout, stderr } = await execa(
        'node',
        [
          BUILD_ENTRY,
          'report',
          '--no-llm',
          '--since',
          '2026-01-01T00:00:00Z',
          '--until',
          '2026-01-31T23:59:59Z',
          '--cache-dir',
          cacheDir,
          repo.url,
        ],
        { ...spawnOptions(cacheDir) },
      );

      // stdout carries the report JSON alone — parseable without any
      // splitting.
      expect(trendReportSchema.safeParse(JSON.parse(stdout)).success).toBe(true);
      expect(JSON.parse(stdout)).toStrictEqual(await expectedReport(repo, cacheDir));

      // stderr carries the startup block: the application version,
      // then the resolved configuration as one indented line per
      // field.
      expect(stderr).toContain(`dev-perf ${appVersion}`);
      expect(stderr).toContain('configuration:');
      expect(stderr).toContain(`    - ${repo.url}`);
      expect(stderr).toContain('  since: 2026-01-01T00:00:00Z');
      expect(stderr).toContain('  until: 2026-01-31T23:59:59Z');
      expect(stderr).toContain(`  cacheDir: ${cacheDir}`);
      expect(stderr).toContain('  refresh: false');
      expect(stderr).toContain('  llm: false');
      expect(stderr).toContain('  verbose: false');
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('with --verbose logs the startup block and progress to stderr while stdout stays pure report JSON', async () => {
    const repo = await buildFixture();
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-e2e-cache-'));
    try {
      const { stdout, stderr } = await execa(
        'node',
        [
          BUILD_ENTRY,
          'report',
          '--no-llm',
          '--verbose',
          '--since',
          '2026-01-01T00:00:00Z',
          '--until',
          '2026-01-31T23:59:59Z',
          '--cache-dir',
          cacheDir,
          repo.url,
        ],
        { ...spawnOptions(cacheDir) },
      );

      // stdout carries the same pure report JSON as a quiet run.
      expect(JSON.parse(stdout)).toStrictEqual(await expectedReport(repo, cacheDir));
      // stderr carries the startup block plus the progress lines:
      // fresh clone (with duration), the resolved range, and per-repo
      // commit counts.
      expect(stderr).toContain(`dev-perf ${appVersion}`);
      expect(stderr).toContain('configuration:');
      expect(stderr).toMatch(/cloned .* in \d+ ms/);
      expect(stderr).toContain('range: 2026-01-01T00:00:00.000Z to 2026-01-31T23:59:59.000Z');
      expect(stderr).toContain('3 commits from 2 authors');
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('a default run prints only the startup block on stderr, with no progress lines', async () => {
    const repo = await buildFixture();
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-e2e-cache-'));
    try {
      const { stdout, stderr } = await execa(
        'node',
        [
          BUILD_ENTRY,
          'report',
          '--no-llm',
          '--since',
          '2026-01-01T00:00:00Z',
          '--until',
          '2026-01-31T23:59:59Z',
          '--cache-dir',
          cacheDir,
          repo.url,
        ],
        { ...spawnOptions(cacheDir) },
      );

      expect(JSON.parse(stdout)).toStrictEqual(await expectedReport(repo, cacheDir));
      // The startup block is always printed, even without --verbose…
      expect(stderr).toContain(`dev-perf ${appVersion}`);
      expect(stderr).toContain('configuration:');
      expect(stderr).toContain('  verbose: false');
      // …but nothing else: progress lines stay hidden in quiet mode.
      expect(stderr).not.toMatch(/cloned|range:|commit/);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('writes the same report to the --output file', async () => {
    const repo = await buildFixture();
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-e2e-cache-'));
    const outFile = path.join(cacheDir, 'report.json');
    try {
      const { stdout, stderr } = await execa(
        'node',
        [
          BUILD_ENTRY,
          'report',
          '--no-llm',
          '--since',
          '2026-01-01T00:00:00Z',
          '--until',
          '2026-01-31T23:59:59Z',
          '--cache-dir',
          cacheDir,
          '--output',
          outFile,
          repo.url,
        ],
        { ...spawnOptions(cacheDir) },
      );

      // With --output, stdout carries nothing — the report goes to the
      // file and the configuration to stderr.
      expect(stdout).toBe('');
      expect(stderr).toContain(`  output: ${outFile}`);
      expect(stderr).toContain(`  cacheDir: ${cacheDir}`);

      const written = JSON.parse(await readFile(outFile, 'utf8')) as {
        schemaVersion: number;
        parameters: { repos: string[]; llmEnabled: boolean };
        periods: Array<{ repositories: Array<{ users: unknown[] }> }>;
      };
      expect(trendReportSchema.safeParse(written).success).toBe(true);
      expect(written.schemaVersion).toBe(2);
      expect(written.parameters).toMatchObject({ repos: [repo.url], llmEnabled: false });
      expect(written.periods[0].repositories[0].users).toHaveLength(2);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('runs from environment variables alone with the flag-equivalent report', async () => {
    const repo = await buildFixture();
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-e2e-cache-'));
    const outFile = path.join(cacheDir, 'report.json');
    try {
      await execa(
        'node',
        [BUILD_ENTRY, 'report'],
        // The isolated cwd (spawnOptions) keeps the developer's own
        // `.env` out: dotenv would otherwise inject extra DEV_PERF_*
        // variables that are not part of this test's env surface.
        {
          ...spawnOptions(cacheDir),
          env: {
            ...cleanEnv(),
            DEV_PERF_REPOS: repo.url,
            DEV_PERF_NO_LLM: 'true',
            DEV_PERF_SINCE: '2026-01-01T00:00:00Z',
            DEV_PERF_UNTIL: '2026-01-31T23:59:59Z',
            DEV_PERF_CACHE_DIR: cacheDir,
            DEV_PERF_OUTPUT: outFile,
          },
        },
      );

      const written = JSON.parse(await readFile(outFile, 'utf8')) as unknown;
      expect(trendReportSchema.safeParse(written).success).toBe(true);
      expect(written).toStrictEqual(await expectedReport(repo, cacheDir));
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('with --unit month reports one period per month, zeroing empty periods', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-15T10:00:00Z',
        message: 'feat: january',
        files: [{ path: 'src/app.ts', content: 'line1\nline2\n' }],
      },
      {
        author: { name: 'Bob', email: 'bob@example.com' },
        date: '2026-03-10T11:00:00Z',
        message: 'docs: march',
        files: [{ path: 'README.md', content: 'hello\n' }],
      },
    ]);
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-e2e-cache-'));
    try {
      const { stdout } = await execa(
        'node',
        [
          BUILD_ENTRY,
          'report',
          '--no-llm',
          '--unit',
          'month',
          '--since',
          '2026-01-01T00:00:00Z',
          '--until',
          '2026-03-31T23:59:59Z',
          '--cache-dir',
          cacheDir,
          repo.url,
        ],
        { ...spawnOptions(cacheDir) },
      );

      const report = JSON.parse(stdout) as {
        parameters: { unit?: string };
        periods: Array<{
          since: string;
          until: string;
          repositories: Array<{
            stats: { totalCommits: number };
            users: Array<{ name: string }>;
          }>;
        }>;
      };
      expect(trendReportSchema.safeParse(report).success).toBe(true);
      expect(report.parameters.unit).toBe('month');
      expect(report.periods).toHaveLength(3);
      expect(report.periods[0]).toMatchObject({
        since: '2026-01-01T00:00:00.000Z',
        until: '2026-01-31T23:59:59.999Z',
      });
      expect(report.periods[0].repositories[0].stats.totalCommits).toBe(1);
      // February: an empty period, still reported with both users
      // zeroed (group order follows the newest-first commit list).
      expect(report.periods[1]).toMatchObject({
        since: '2026-02-01T00:00:00.000Z',
        until: '2026-02-28T23:59:59.999Z',
      });
      expect(report.periods[1].repositories[0].stats.totalCommits).toBe(0);
      expect(report.periods[1].repositories[0].users.map((user) => user.name)).toEqual([
        'Bob',
        'Alice',
      ]);
      expect(report.periods[2]).toMatchObject({
        since: '2026-03-01T00:00:00.000Z',
        until: '2026-03-31T23:59:59.000Z',
      });
      expect(report.periods[2].repositories[0].stats.totalCommits).toBe(1);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('prints the application version for --version and the version command', async () => {
    // The version commands need no repository; a bare temp cwd keeps
    // the developer's .env out.
    const versionFlag = await execa('node', [BUILD_ENTRY, '--version'], {
      ...spawnOptions(os.tmpdir()),
    });
    expect(versionFlag.stdout).toBe(`${appVersion}\n`);

    const versionCommand = await execa('node', [BUILD_ENTRY, 'version'], {
      ...spawnOptions(os.tmpdir()),
    });
    expect(versionCommand.stdout).toBe(`${appVersion}\n`);
  });
});
