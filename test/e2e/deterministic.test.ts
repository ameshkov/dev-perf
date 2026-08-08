/**
 * End-to-end tests for the deterministic analysis path: the compiled
 * CLI runs against a fixture repo as a child process with all settings
 * from a YAML config file (autoloaded `config.yaml` or an explicit
 * `--config`), and the emitted output is validated against the report
 * schema and checked exactly. stdout carries the report JSON only;
 * stderr carries the startup block — the application version and the
 * per-line run configuration — on every run, plus the verbose progress
 * lines when `verbose` is set.
 *
 * The suite needs `pnpm build` to have produced `build/index.js`; it
 * is skipped when the build is missing so a plain `pnpm test` stays
 * green (the full gate `pnpm check` always builds first).
 */
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';
import type { FixtureRepo } from '../fixtures/repo-builder.js';
import { buildFixtureRepo, removeFixtureRepo } from '../fixtures/repo-builder.js';
import { entryHash } from '../../src/repo/cache.js';
import { gitRevParse, runGit } from '../../src/repo/git.js';
import { trendReportSchema } from '../../src/report/schema.js';
import { appVersion } from '../../src/version.js';

/** Compiled CLI entry point; the suite runs it as a child process. */
const BUILD_ENTRY = path.resolve(process.cwd(), 'build', 'index.js');

/** The range every config file carries, matching the fixture dates. */
const SINCE = '2026-01-01T00:00:00Z';
const UNTIL = '2026-01-31T23:59:59Z';

/**
 * The range the CLI resolves the `since`/`until` bounds to (UTC
 * instants, millisecond precision) as they appear in the report.
 * `expectedReport` uses these; the config files carry `SINCE`/`UNTIL`.
 */
const SINCE_RESOLVED = '2026-01-01T00:00:00.000Z';
const UNTIL_RESOLVED = '2026-01-31T23:59:59.000Z';

/**
 * The parent environment without `DEV_PERF_*` variables, so settings a
 * developer shell exports (e.g. `DEV_PERF_API_KEY`) cannot leak into the
 * child runs — they are no longer option sources, but they would still
 * resolve `${DEV_PERF_*}` references in a config file and perturb the
 * expected outputs.
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
 * re-inject the developer's env entries — and contains a `config.yaml`
 * only when a test writes one there. Every argument passed to the
 * child is an absolute path, so the changed cwd cannot affect anything
 * else.
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

/** Range overrides for `writeConfig`; default to the shared range. */
interface ConfigOverrides {
  since?: string;
  until?: string;
}

/**
 * Writes a `config.yaml` into the cache dir (auto-loaded from the
 * child's cwd) with the always-present settings: the fixture repo, the
 * fixed range (overridable), `llm: false`, and the test's cache
 * directory. Extra keys are appended on top.
 *
 * @param cacheDir - The temp cache directory of the current test.
 * @param repo - The fixture repo (for its URL).
 * @param extra - Extra config lines, appended after the shared ones.
 * @param overrides - Optional `since` / `until` range overrides.
 * @returns The written config file path.
 */
async function writeConfig(
  cacheDir: string,
  repo: FixtureRepo,
  extra: string[] = [],
  overrides: ConfigOverrides = {},
): Promise<string> {
  const file = path.join(cacheDir, 'config.yaml');
  await writeFile(
    file,
    [
      'repos:',
      `  - ${repo.url}`,
      `since: ${overrides.since ?? SINCE}`,
      `until: ${overrides.until ?? UNTIL}`,
      'llm: false',
      `cache-dir: ${cacheDir}`,
      ...extra,
      '',
    ].join('\n'),
  );
  return file;
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
 * `since`/`until` range, used by every e2e case.
 *
 * @param repo - The fixture repo (for its URL).
 * @param cacheDir - The cache directory passed to the CLI.
 * @returns The expected report document.
 */
async function expectedReport(repo: FixtureRepo, cacheDir: string): Promise<unknown> {
  const head = await gitRevParse(repo.dir, ['HEAD']);
  return {
    schemaVersion: 3,
    generatedAt: expect.any(String),
    parameters: {
      repos: [{ repo: repo.url }],
      since: SINCE_RESOLVED,
      until: UNTIL_RESOLVED,
      llmEnabled: false,
    },
    periods: [
      {
        since: SINCE_RESOLVED,
        until: UNTIL_RESOLVED,
        repositories: [
          {
            repo: repo.url,
            clonePath: path.join(cacheDir, entryHash(repo.url), 'repo'),
            branch: 'main',
            head,
            range: {
              since: SINCE_RESOLVED,
              until: UNTIL_RESOLVED,
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
                  activeDays: ['2026-01-01', '2026-01-03'],
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
                  activeDays: ['2026-01-02'],
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
  it('prints the exact expected report to stdout with the configuration on stderr (explicit --config)', async () => {
    const repo = await buildFixture();
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-e2e-cache-'));
    try {
      const configFile = await writeConfig(cacheDir, repo);
      const { stdout, stderr } = await execa(
        'node',
        [BUILD_ENTRY, 'report', '--config', configFile],
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
      expect(stderr).toContain(`  since: ${SINCE}`);
      expect(stderr).toContain(`  until: ${UNTIL}`);
      expect(stderr).toContain(`  cache-dir: ${cacheDir}`);
      expect(stderr).toContain('  refresh: false');
      expect(stderr).toContain('  llm: false');
      expect(stderr).toContain('  verbose: false');
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('with verbose logs the startup block and progress to stderr while stdout stays pure report JSON', async () => {
    const repo = await buildFixture();
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-e2e-cache-'));
    try {
      await writeConfig(cacheDir, repo, ['verbose: true']);
      const { stdout, stderr } = await execa('node', [BUILD_ENTRY, 'report'], {
        ...spawnOptions(cacheDir),
      });

      // stdout carries the same pure report JSON as a quiet run.
      expect(JSON.parse(stdout)).toStrictEqual(await expectedReport(repo, cacheDir));
      // stderr carries the startup block plus the progress lines:
      // the command start/end pair bracketing the run, the clone start
      // and its completion (with duration), both naming the cache entry
      // directory, the resolved range, the commit read, and per-repo
      // commit counts.
      expect(stderr).toContain(`dev-perf ${appVersion}`);
      expect(stderr).toContain('configuration:');
      expect(stderr).toContain('starting report');
      expect(stderr).toMatch(/finished report in \d+ ms/);
      expect(stderr).toMatch(/cloning ".+" \(cache ".+"\)/);
      expect(stderr).toMatch(/cloned .* in \d+ ms \(cache ".+"\)/);
      expect(stderr).toContain(`range: ${SINCE_RESOLVED} to ${UNTIL_RESOLVED}`);
      expect(stderr).toContain('reading commits');
      expect(stderr).toContain('3 commits from 2 authors');
      // Each repository's analysis is bracketed by its own start/end
      // pair, naming the repo spec and closing with a duration.
      expect(stderr).toContain(`starting analysis of "${repo.url}"`);
      expect(stderr).toMatch(/finished analysis of ".+" in \d+ ms/);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('a default run prints the startup block, command markers, and the coarse analysis stages on stderr', async () => {
    const repo = await buildFixture();
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-e2e-cache-'));
    try {
      await writeConfig(cacheDir, repo);
      const { stdout, stderr } = await execa('node', [BUILD_ENTRY, 'report'], {
        ...spawnOptions(cacheDir),
      });

      expect(JSON.parse(stdout)).toStrictEqual(await expectedReport(repo, cacheDir));
      // The startup block and the command start/end markers are always
      // printed, even without verbose…
      expect(stderr).toContain(`dev-perf ${appVersion}`);
      expect(stderr).toContain('configuration:');
      expect(stderr).toContain('  verbose: false');
      expect(stderr).toContain('starting report');
      expect(stderr).toMatch(/finished report in \d+ ms/);
      // …and so are the coarse analysis-stage markers: the clone starts
      // and completes, the commit scan starts and reports its count, and
      // the repository's analysis is bracketed by its own start/end
      // pair — the current stage stays visible on every run.
      expect(stderr).toMatch(/cloning ".+" \(cache ".+"\)/);
      expect(stderr).toMatch(/cloned .* in \d+ ms \(cache ".+"\)/);
      expect(stderr).toContain('starting analysis of');
      expect(stderr).toContain('reading commits');
      expect(stderr).toContain('3 commits from 2 authors');
      expect(stderr).toMatch(/finished analysis of .+ in \d+ ms/);
      // …while the fine-grained detail stays hidden without `--verbose`:
      // the resolved range and the base-scope outcomes.
      expect(stderr).not.toContain('range:');
      expect(stderr).not.toMatch(/excluding base|is the head of|no base branch/);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('writes the same report to the config output file', async () => {
    const repo = await buildFixture();
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-e2e-cache-'));
    const outFile = path.join(cacheDir, 'report.json');
    try {
      await writeConfig(cacheDir, repo, [`output: ${outFile}`]);
      const { stdout, stderr } = await execa('node', [BUILD_ENTRY, 'report'], {
        ...spawnOptions(cacheDir),
      });

      // With output set, stdout carries nothing — the report goes to the
      // file and the configuration to stderr.
      expect(stdout).toBe('');
      expect(stderr).toContain(`  output: ${outFile}`);
      expect(stderr).toContain(`  cache-dir: ${cacheDir}`);

      const written = JSON.parse(await readFile(outFile, 'utf8')) as {
        schemaVersion: number;
        parameters: { repos: Array<{ repo: string }>; llmEnabled: boolean };
        periods: Array<{ repositories: Array<{ users: unknown[] }> }>;
      };
      expect(trendReportSchema.safeParse(written).success).toBe(true);
      expect(written.schemaVersion).toBe(3);
      expect(written.parameters).toMatchObject({
        repos: [{ repo: repo.url }],
        llmEnabled: false,
      });
      expect(written.periods[0].repositories[0].users).toHaveLength(2);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('runs from a config file alone with the flag-equivalent report', async () => {
    const repo = await buildFixture();
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-e2e-cache-'));
    const outFile = path.join(cacheDir, 'report.json');
    // The config.yaml is auto-loaded from the child's working directory
    // (the isolated cwd keeps the developer's own config out).
    await writeFile(
      path.join(cacheDir, 'config.yaml'),
      [
        'repos:',
        `  - ${repo.url}`,
        `since: ${SINCE}`,
        `until: ${UNTIL}`,
        'llm: false',
        `cache-dir: ${cacheDir}`,
        `output: ${outFile}`,
        '',
      ].join('\n'),
    );
    try {
      const { stderr } = await execa('node', [BUILD_ENTRY, 'report'], {
        ...spawnOptions(cacheDir),
      });

      const written = JSON.parse(await readFile(outFile, 'utf8')) as unknown;
      expect(trendReportSchema.safeParse(written).success).toBe(true);
      expect(written).toStrictEqual(await expectedReport(repo, cacheDir));
      // The startup dump names the config file the run was resolved
      // from (the child's cwd resolves the /var → /private/var symlink).
      const configPath = await realpath(path.join(cacheDir, 'config.yaml'));
      expect(stderr).toContain(`  config-file: ${configPath}`);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('with unit month reports one period per month, zeroing empty periods', async () => {
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
      await writeConfig(cacheDir, repo, ['unit: month'], {
        since: '2026-01-01T00:00:00Z',
        until: '2026-03-31T23:59:59Z',
      });
      const { stdout } = await execa('node', [BUILD_ENTRY, 'report'], {
        ...spawnOptions(cacheDir),
      });

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

  it('merges identities through the config users-map key with an explicit --config', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'feat: add app',
        files: [{ path: 'src/app.ts', content: 'line1\nline2\n' }],
      },
      {
        author: { name: 'Alice Work', email: 'alice@work.com' },
        date: '2026-01-02T11:00:00Z',
        message: 'docs: extend readme',
        files: [{ path: 'README.md', content: 'hello\n' }],
      },
    ]);
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-e2e-cache-'));
    try {
      const configFile = await writeConfig(cacheDir, repo, [
        'users-map:',
        "  'alice@example.com': 'Alice Smith'",
        "  'alice@work.com': 'Alice Smith'",
      ]);
      const { stdout, stderr } = await execa(
        'node',
        [BUILD_ENTRY, 'report', '--config', configFile],
        { ...spawnOptions(cacheDir) },
      );

      // Both emails merge into one identity at the grouping stage.
      const report = JSON.parse(stdout) as {
        periods: Array<{
          repositories: Array<{
            users: Array<{
              name: string;
              emails: string[];
              deterministic: { commits: number };
            }>;
          }>;
        }>;
      };
      expect(trendReportSchema.safeParse(report).success).toBe(true);
      const users = report.periods[0].repositories[0].users;
      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('Alice Smith');
      expect(users[0].emails).toEqual(['alice@example.com', 'alice@work.com']);
      expect(users[0].deterministic.commits).toBe(2);
      // The startup dump lists the applied mappings.
      expect(stderr).toContain('  users-map:');
      expect(stderr).toContain('    - alice@example.com=Alice Smith');
      expect(stderr).toContain('    - alice@work.com=Alice Smith');
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('merges identities through the auto-loaded config users-map key', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'feat: add app',
        files: [{ path: 'src/app.ts', content: 'line1\nline2\n' }],
      },
      {
        author: { name: 'Alice Work', email: 'alice@work.com' },
        date: '2026-01-02T11:00:00Z',
        message: 'docs: extend readme',
        files: [{ path: 'README.md', content: 'hello\n' }],
      },
    ]);
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-e2e-cache-'));
    try {
      await writeConfig(cacheDir, repo, [
        'users-map:',
        "  'alice@example.com': 'Alice Smith'",
        "  'alice@work.com': 'Alice Smith'",
      ]);
      const { stdout, stderr } = await execa('node', [BUILD_ENTRY, 'report'], {
        ...spawnOptions(cacheDir),
      });

      // Both emails merge into one identity at the grouping stage.
      const report = JSON.parse(stdout) as {
        periods: Array<{
          repositories: Array<{
            users: Array<{
              name: string;
              emails: string[];
              deterministic: { commits: number };
            }>;
          }>;
        }>;
      };
      expect(trendReportSchema.safeParse(report).success).toBe(true);
      const users = report.periods[0].repositories[0].users;
      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('Alice Smith');
      expect(users[0].emails).toEqual(['alice@example.com', 'alice@work.com']);
      expect(users[0].deterministic.commits).toBe(2);
      // The startup dump lists the applied mappings.
      expect(stderr).toContain('  users-map:');
      expect(stderr).toContain('    - alice@example.com=Alice Smith');
      expect(stderr).toContain('    - alice@work.com=Alice Smith');
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('analyzes a specific branch via the structured branch key, isolated in its own cache entry', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'feat: base',
        files: [{ path: 'a.txt', content: 'a\n' }],
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
        '2026-01-02T11:00:00Z',
        '-m',
        'feat: dev only',
      ],
      { env: { GIT_COMMITTER_DATE: '2026-01-02T11:00:00Z' } },
    );
    const devHead = await gitRevParse(repo.dir, ['HEAD']);
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-e2e-cache-'));
    try {
      // The config carries the branch-scoped structured entry, so the
      // entry hash and the reported branch follow it.
      await writeFile(
        path.join(cacheDir, 'config.yaml'),
        [
          'repos:',
          `  - repo: ${repo.url}`,
          '    branch: dev',
          `since: ${SINCE}`,
          `until: ${UNTIL}`,
          'llm: false',
          `cache-dir: ${cacheDir}`,
          '',
        ].join('\n'),
      );
      const { stdout, stderr } = await execa('node', [BUILD_ENTRY, 'report'], {
        ...spawnOptions(cacheDir),
      });

      const report = JSON.parse(stdout) as {
        parameters: { repos: Array<{ repo: string; branch?: string }> };
        periods: Array<{
          repositories: Array<{
            repo: string;
            branch: string;
            head: string;
            clonePath: string;
            stats: { totalCommits: number };
          }>;
        }>;
      };
      expect(trendReportSchema.safeParse(report).success).toBe(true);
      const entry = report.periods[0].repositories[0];
      // The non-default `dev` branch is scoped to its delta vs the
      // base (origin/main), so only the dev-only commit is analyzed.
      expect(entry).toMatchObject({
        repo: repo.url,
        branch: 'dev',
        head: devHead,
        baseBranch: 'origin/main',
      });
      expect(entry.stats.totalCommits).toBe(1);
      // The parameters list the full spec as given, branch included.
      expect(report.parameters.repos).toEqual([{ repo: repo.url, branch: 'dev' }]);
      // The branch-scoped cache entry holds the clone.
      expect(entry.clonePath).toBe(path.join(cacheDir, entryHash(repo.url, 'dev'), 'repo'));
      // The startup dump lists the full spec as given, branch included.
      expect(stderr).toContain(`    - ${repo.url} (branch: dev)`);
      // clone.json records the checked-out branch.
      const cloneInfo = await readFile(
        path.join(cacheDir, entryHash(repo.url, 'dev'), 'clone.json'),
        'utf8',
      );
      expect(cloneInfo).toContain('"branch": "dev"');
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('honors a structured repos entry with a branch and ignored paths', async () => {
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
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-e2e-cache-'));
    try {
      // The config carries a structured repos entry: the branch is
      // recorded, and the docs/ paths are excluded from the analysis.
      await writeFile(
        path.join(cacheDir, 'config.yaml'),
        [
          'repos:',
          `  - repo: ${repo.url}`,
          '    branch: main',
          '    ignore:',
          '      - docs/',
          `since: ${SINCE}`,
          `until: ${UNTIL}`,
          'llm: false',
          `cache-dir: ${cacheDir}`,
          'verbose: true',
          '',
        ].join('\n'),
      );
      const { stdout, stderr } = await execa('node', [BUILD_ENTRY, 'report'], {
        ...spawnOptions(cacheDir),
      });

      const report = JSON.parse(stdout) as {
        parameters: {
          repos: Array<{ repo: string; branch?: string; ignore?: string[] }>;
          llmEnabled: boolean;
        };
        periods: Array<{
          repositories: Array<{
            repo: string;
            branch: string;
            ignoredPaths: string[];
            clonePath: string;
            stats: { totalCommits: number };
            users: Array<{ name: string; deterministic: { commits: number; linesAdded: number } }>;
          }>;
        }>;
      };
      expect(trendReportSchema.safeParse(report).success).toBe(true);
      const entry = report.periods[0].repositories[0];
      expect(entry).toMatchObject({
        repo: repo.url,
        branch: 'main',
        ignoredPaths: ['docs/'],
      });
      // The docs-only commit is dropped; the mixed commit keeps only
      // its non-ignored file.
      expect(entry.stats.totalCommits).toBe(2);
      const alice = entry.users.find((user) => user.name === 'Alice');
      expect(alice?.deterministic).toMatchObject({ commits: 1, linesAdded: 2 });
      // The parameters list the full spec — clone target, branch, and
      // the ignored paths.
      expect(report.parameters).toMatchObject({
        repos: [{ repo: repo.url, branch: 'main', ignore: ['docs/'] }],
        llmEnabled: false,
      });
      // The startup dump lists the full spec with its ignored paths,
      // and the verbose ignored-paths line names it and the excluded
      // paths.
      expect(stderr).toContain(`    - ${repo.url} (branch: main, ignore: docs/)`);
      expect(stderr).toContain(`ignored paths for "${repo.url}": "docs/"`);
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
