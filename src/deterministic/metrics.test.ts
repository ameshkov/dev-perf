/**
 * Tests for deterministic metrics aggregation: per-user
 * metrics from parsed commits, repo-level statistics, and exact
 * hand-computed values against fixture repos.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFixtureRepo, removeFixtureRepo } from '../../test/fixtures/repo-builder.js';
import { runGit } from '../repo/git.js';
import type { Commit } from './commits.js';
import { readCommits } from './commits.js';
import { groupByAuthor } from './identity.js';
import { repoStats, userMetrics } from './metrics.js';

/** A commit with defaults, for unit tests that override only what matters. */
function commit(overrides: Partial<Commit> = {}): Commit {
  return {
    sha: 'abc',
    parents: [],
    authorName: 'Alice',
    authorEmail: 'alice@example.com',
    authorDate: '2026-01-01T10:00:00Z',
    subject: 'work',
    files: [],
    isMerge: false,
    ...overrides,
  };
}

describe('userMetrics', () => {
  it('aggregates counts, lines, and languages exactly', () => {
    const metrics = userMetrics([
      commit({
        sha: '1',
        files: [{ path: 'src/a.ts', added: 2, deleted: 0 }],
      }),
      commit({
        sha: '2',
        authorDate: '2026-01-02T11:00:00Z',
        files: [
          { path: 'src/a.ts', added: 0, deleted: 1 },
          { path: 'src/b.ts', added: 3, deleted: 0 },
        ],
      }),
      commit({
        sha: '3',
        authorDate: '2026-01-03T12:00:00Z',
        parents: ['p1', 'p2'],
        isMerge: true,
      }),
    ]);
    expect(metrics).toStrictEqual({
      commits: 3,
      nonMergeCommits: 2,
      mergeCommits: 1,
      linesAdded: 5,
      linesRemoved: 1,
      netLines: 4,
      filesTouched: 3,
      uniqueFilesTouched: 2,
      activeDays: 3,
      firstCommitAt: '2026-01-01T10:00:00.000Z',
      lastCommitAt: '2026-01-03T12:00:00.000Z',
      avgCommitSize: 3,
      languages: {
        TypeScript: { linesAdded: 5, linesRemoved: 1, filesTouched: 3 },
      },
    });
  });

  it('computes active days and first/last dates in UTC from offset dates', () => {
    const metrics = userMetrics([
      commit({ authorDate: '2026-01-15T23:30:00-05:00' }),
      commit({ authorDate: '2026-01-16T02:00:00+05:00' }),
    ]);
    // 23:30-05:00 is 04:30Z on Jan 16; 02:00+05:00 is 21:00Z on Jan 15.
    expect(metrics.activeDays).toBe(2);
    expect(metrics.firstCommitAt).toBe('2026-01-15T21:00:00.000Z');
    expect(metrics.lastCommitAt).toBe('2026-01-16T04:30:00.000Z');
  });

  it('returns zeroed metrics for no commits', () => {
    expect(userMetrics([])).toStrictEqual({
      commits: 0,
      nonMergeCommits: 0,
      mergeCommits: 0,
      linesAdded: 0,
      linesRemoved: 0,
      netLines: 0,
      filesTouched: 0,
      uniqueFilesTouched: 0,
      activeDays: 0,
      firstCommitAt: '',
      lastCommitAt: '',
      avgCommitSize: 0,
      languages: {},
    });
  });

  it('sizes commits by added and removed lines, per non-merge commit', () => {
    const metrics = userMetrics([
      commit({ files: [{ path: 'a.ts', added: 1, deleted: 1 }] }),
      commit({
        sha: '2',
        authorDate: '2026-01-02T10:00:00Z',
        files: [{ path: 'b.ts', added: 8, deleted: 0 }],
      }),
      commit({
        sha: '3',
        authorDate: '2026-01-03T10:00:00Z',
        parents: ['p1', 'p2'],
        isMerge: true,
      }),
    ]);
    expect(metrics.nonMergeCommits).toBe(2);
    expect(metrics.avgCommitSize).toBe(5); // (2 + 8) / 2
  });

  it('keeps avgCommitSize zero when every commit is a merge', () => {
    const metrics = userMetrics([commit({ parents: ['p1', 'p2'], isMerge: true })]);
    expect(metrics.mergeCommits).toBe(1);
    expect(metrics.nonMergeCommits).toBe(0);
    expect(metrics.avgCommitSize).toBe(0);
  });

  it('records binary files as touched with no lines', () => {
    const metrics = userMetrics([
      commit({ files: [{ path: 'data.bin', added: undefined, deleted: undefined }] }),
    ]);
    expect(metrics.linesAdded).toBe(0);
    expect(metrics.filesTouched).toBe(1);
    expect(metrics.uniqueFilesTouched).toBe(1);
    expect(metrics.languages).toStrictEqual({
      Binary: { linesAdded: 0, linesRemoved: 0, filesTouched: 1 },
    });
  });
});

describe('repoStats', () => {
  it('aggregates commits, users, and top languages across groups', () => {
    const groups = groupByAuthor([
      commit({
        sha: '1',
        files: [{ path: 'src/a.ts', added: 5, deleted: 0 }],
      }),
      commit({
        sha: '2',
        authorDate: '2026-01-02T10:00:00Z',
        files: [{ path: 'README.md', added: 1, deleted: 0 }],
      }),
      commit({
        sha: '3',
        authorName: 'Bob',
        authorEmail: 'bob@example.com',
        authorDate: '2026-01-03T10:00:00Z',
        files: [
          { path: 'src/a.ts', added: 2, deleted: 0 },
          { path: 'lib/b.py', added: 3, deleted: 0 },
        ],
      }),
    ]);
    expect(repoStats(groups)).toStrictEqual({
      totalCommits: 3,
      totalUsers: 2,
      topLanguages: [
        { language: 'TypeScript', linesAdded: 7 },
        { language: 'Python', linesAdded: 3 },
        { language: 'Markdown', linesAdded: 1 },
      ],
    });
  });

  it('breaks ties by language name, ascending', () => {
    const groups = groupByAuthor([
      commit({ sha: '1', files: [{ path: 'a.ts', added: 3, deleted: 0 }] }),
      commit({
        sha: '2',
        authorName: 'Bob',
        authorEmail: 'bob@example.com',
        authorDate: '2026-01-02T10:00:00Z',
        files: [{ path: 'b.py', added: 3, deleted: 0 }],
      }),
      commit({
        sha: '3',
        authorName: 'Carol',
        authorEmail: 'carol@example.com',
        authorDate: '2026-01-03T10:00:00Z',
        files: [{ path: 'c.md', added: 1, deleted: 0 }],
      }),
    ]);
    expect(repoStats(groups).topLanguages).toStrictEqual([
      { language: 'Python', linesAdded: 3 },
      { language: 'TypeScript', linesAdded: 3 },
      { language: 'Markdown', linesAdded: 1 },
    ]);
  });

  it('caps the top-languages list', () => {
    const files = [
      'a.ts',
      'b.py',
      'c.go',
      'd.rs',
      'e.java',
      'f.c',
      'g.cpp',
      'h.sh',
      'i.html',
      'j.css',
      'k.md',
    ].map((filePath, index) => ({ path: filePath, added: index + 1, deleted: 0 }));
    const stats = repoStats(groupByAuthor([commit({ files })]));
    expect(stats.topLanguages).toHaveLength(10);
    expect(stats.topLanguages[0].language).toBe('Markdown');
    expect(stats.topLanguages[0].linesAdded).toBe(11);
  });

  it('returns zero stats for no groups', () => {
    expect(repoStats([])).toStrictEqual({ totalCommits: 0, totalUsers: 0, topLanguages: [] });
  });
});

describe('fixture integration', () => {
  it('computes hand-computed metrics for a fixture repo exactly', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'feat: add app',
        files: [
          { path: 'src/app.ts', content: 'line1\nline2\n' },
          { path: 'src/util.ts', content: 'u1\nu2\nu3\n' },
          { path: 'README.md', content: 'hello\n' },
        ],
      },
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-02T11:00:00Z',
        message: 'feat: extend app',
        files: [{ path: 'src/app.ts', content: 'line1\nline2\nline3\nline4\nline5\n' }],
      },
      {
        author: { name: 'Bob', email: 'bob@example.com' },
        date: '2026-01-03T12:00:00Z',
        message: 'test: cover app',
        files: [
          { path: 'test/app.test.ts', content: 'expect(1)\nexpect(2)\n' },
          { path: 'src/app.ts', content: 'line1\nline2\n' },
        ],
      },
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-04T09:00:00Z',
        message: 'chore: add binary asset',
        files: [{ path: 'assets/logo.bin', content: '\u0000\u0001\u0002' }],
      },
    ]);
    try {
      // Feature branch work by Bob, then a merge by Alice.
      await runGit(repo.dir, ['checkout', '-b', 'feature']);
      await runGit(repo.dir, ['config', 'user.name', 'Bob']);
      await runGit(repo.dir, ['config', 'user.email', 'bob@example.com']);
      await mkdir(path.join(repo.dir, 'src'), { recursive: true });
      await writeFile(path.join(repo.dir, 'src/feature.ts'), 'f1\n', 'utf8');
      await runGit(repo.dir, ['add', '-A']);
      await runGit(
        repo.dir,
        [
          'commit',
          '--author',
          'Bob <bob@example.com>',
          '--date',
          '2026-01-06T09:00:00Z',
          '-m',
          'feat: feature branch work',
        ],
        { env: { GIT_COMMITTER_DATE: '2026-01-06T09:00:00Z' } },
      );
      await runGit(repo.dir, ['checkout', 'main']);
      await runGit(repo.dir, ['merge', '--no-ff', '-m', 'merge feature', 'feature'], {
        env: {
          GIT_AUTHOR_NAME: 'Alice',
          GIT_AUTHOR_EMAIL: 'alice@example.com',
          GIT_AUTHOR_DATE: '2026-01-07T10:00:00Z',
          GIT_COMMITTER_DATE: '2026-01-07T10:00:00Z',
        },
      });

      const groups = groupByAuthor(await readCommits(repo.dir));
      const byEmail = new Map(groups.map((group) => [group.email, group]));
      const alice = userMetrics(byEmail.get('alice@example.com')!.commits);
      const bob = userMetrics(byEmail.get('bob@example.com')!.commits);

      // Alice: A (+2 app.ts, +3 util.ts, +1 README), B (+3 app.ts),
      // D (binary), E (merge). 9 added lines over 3 non-merge commits;
      // 4 active days (Jan 1, 2, 4, 7); TypeScript is 3 commit-file
      // pairs (app.ts in A and B, util.ts in A).
      expect(alice).toStrictEqual({
        commits: 4,
        nonMergeCommits: 3,
        mergeCommits: 1,
        linesAdded: 9,
        linesRemoved: 0,
        netLines: 9,
        filesTouched: 5,
        uniqueFilesTouched: 4,
        activeDays: 4,
        firstCommitAt: '2026-01-01T10:00:00.000Z',
        lastCommitAt: '2026-01-07T10:00:00.000Z',
        avgCommitSize: 3,
        languages: {
          TypeScript: { linesAdded: 8, linesRemoved: 0, filesTouched: 3 },
          Markdown: { linesAdded: 1, linesRemoved: 0, filesTouched: 1 },
          Binary: { linesAdded: 0, linesRemoved: 0, filesTouched: 1 },
        },
      });

      // Bob: C (+2 test, -3 app.ts), F (+1 feature.ts).
      // 3 added, 3 removed over 2 non-merge commits.
      expect(bob).toStrictEqual({
        commits: 2,
        nonMergeCommits: 2,
        mergeCommits: 0,
        linesAdded: 3,
        linesRemoved: 3,
        netLines: 0,
        filesTouched: 3,
        uniqueFilesTouched: 3,
        activeDays: 2,
        firstCommitAt: '2026-01-03T12:00:00.000Z',
        lastCommitAt: '2026-01-06T09:00:00.000Z',
        avgCommitSize: 3,
        languages: {
          TypeScript: { linesAdded: 3, linesRemoved: 3, filesTouched: 3 },
        },
      });

      expect(repoStats(groups)).toStrictEqual({
        totalCommits: 6,
        totalUsers: 2,
        topLanguages: [
          { language: 'TypeScript', linesAdded: 11 },
          { language: 'Markdown', linesAdded: 1 },
          { language: 'Binary', linesAdded: 0 },
        ],
      });
    } finally {
      await removeFixtureRepo(repo);
    }
  });
});
