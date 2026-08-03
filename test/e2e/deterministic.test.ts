/**
 * End-to-end tests for the deterministic analysis path (design §9,
 * plan step 5): the compiled CLI runs with `--no-llm` against a
 * fixture repo as a child process, and the emitted JSON is validated
 * against the report schema and checked exactly.
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
import { reportSchema } from '../../src/report/schema.js';

/** Compiled CLI entry point; the suite runs it as a child process. */
const BUILD_ENTRY = path.resolve(process.cwd(), 'build', 'index.js');

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

describe.skipIf(!existsSync(BUILD_ENTRY))('e2e: deterministic analysis', () => {
  it('prints the exact expected report to stdout', async () => {
    const repo = await buildFixture();
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-e2e-cache-'));
    try {
      const { stdout } = await execa('node', [
        BUILD_ENTRY,
        '--no-llm',
        '--since',
        '2026-01-01T00:00:00Z',
        '--until',
        '2026-01-31T23:59:59Z',
        '--cache-dir',
        cacheDir,
        repo.url,
      ]);

      const head = await gitRevParse(repo.dir, ['HEAD']);
      expect(reportSchema.safeParse(JSON.parse(stdout)).success).toBe(true);
      expect(JSON.parse(stdout)).toStrictEqual({
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

  it('writes the same report to the --output file', async () => {
    const repo = await buildFixture();
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-e2e-cache-'));
    const outFile = path.join(cacheDir, 'report.json');
    try {
      await execa('node', [
        BUILD_ENTRY,
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
      ]);

      const written = JSON.parse(await readFile(outFile, 'utf8')) as {
        schemaVersion: number;
        parameters: { repos: string[]; llmEnabled: boolean };
        repositories: Array<{ users: unknown[] }>;
      };
      expect(reportSchema.safeParse(written).success).toBe(true);
      expect(written.schemaVersion).toBe(1);
      expect(written.parameters).toMatchObject({ repos: [repo.url], llmEnabled: false });
      expect(written.repositories[0].users).toHaveLength(2);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });
});
