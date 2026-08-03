/**
 * Tests for commit extraction (design §5.1): golden parsing of the
 * `%x1f`/`%x1e` `git log --numstat` format, and integration against
 * fixture repos for date ranges, merge commits, binary files, and
 * empty repositories (§5.4).
 */
import { describe, expect, it } from 'vitest';
import { buildFixtureRepo, removeFixtureRepo } from '../../test/fixtures/repo-builder.js';
import { gitLog, runGit } from '../repo/git.js';
import { parseCommitLog, readCommits } from './commits.js';

/** Known shas used in the golden parse tests (any 40-hex values). */
const SHA1 = '1111111111111111111111111111111111111111';
const SHA2 = '2222222222222222222222222222222222222222';
const PARENT1 = '3333333333333333333333333333333333333333';
const PARENT2 = '4444444444444444444444444444444444444444';

/** A full commit record, as `git log --numstat` would print it. */
function record(fields: string, rows: string[]): string {
  return [`${fields}\x1e`, ...rows, ''].join('\n');
}

describe('parseCommitLog', () => {
  it('parses headers, parents, and numstat rows; binaries have no counts', () => {
    const output = [
      record(
        `${SHA1}\x1f${PARENT1} ${PARENT2}\x1fAlice\x1falice@example.com\x1f2026-01-15T10:30:00+00:00\x1fmerge work`,
        ['3\t1\ta.txt', '-\t-\tdata.bin'],
      ),
      record(`${SHA2}\x1f\x1fBob\x1fbob@example.com\x1f2026-01-01T10:00:00Z\x1froot commit`, [
        '2\t0\tsub/dir/b.txt',
      ]),
    ].join('\n');

    const commits = parseCommitLog(output);
    expect(commits).toHaveLength(2);

    expect(commits[0]).toStrictEqual({
      sha: SHA1,
      parents: [PARENT1, PARENT2],
      authorName: 'Alice',
      authorEmail: 'alice@example.com',
      authorDate: '2026-01-15T10:30:00+00:00',
      subject: 'merge work',
      files: [
        { path: 'a.txt', added: 3, deleted: 1 },
        { path: 'data.bin', added: undefined, deleted: undefined },
      ],
      isMerge: true,
    });

    expect(commits[1]).toStrictEqual({
      sha: SHA2,
      parents: [],
      authorName: 'Bob',
      authorEmail: 'bob@example.com',
      authorDate: '2026-01-01T10:00:00Z',
      subject: 'root commit',
      files: [{ path: 'sub/dir/b.txt', added: 2, deleted: 0 }],
      isMerge: false,
    });
  });

  it('parses a merge commit header followed directly by the next header', () => {
    // Merge commits have no numstat rows of their own, so their header
    // is followed immediately by the blank line.
    const output = [
      record(
        `${SHA1}\x1f${PARENT1} ${PARENT2}\x1fAlice\x1falice@example.com\x1f2026-01-15T10:30:00Z\x1fmerge`,
        [],
      ),
      record(`${SHA2}\x1f${PARENT1}\x1fBob\x1fbob@example.com\x1f2026-01-01T10:00:00Z\x1fbase`, [
        '1\t0\tx.txt',
      ]),
    ].join('\n');

    const commits = parseCommitLog(output);
    expect(commits[0].isMerge).toBe(true);
    expect(commits[0].files).toEqual([]);
    expect(commits[1].isMerge).toBe(false);
    expect(commits[1].files).toHaveLength(1);
  });

  it('returns an empty list for empty output', () => {
    expect(parseCommitLog('')).toEqual([]);
    expect(parseCommitLog('\n\n')).toEqual([]);
  });
});

describe('readCommits', () => {
  it('reads commits with shas, dates, and numstat matching the fixture exactly', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'first commit',
        files: [{ path: 'a.txt', content: 'one\ntwo\nthree\n' }],
      },
      {
        author: { name: 'Bob', email: 'bob@example.com' },
        date: '2026-01-02T11:00:00Z',
        message: 'second commit',
        files: [
          { path: 'a.txt', content: 'two\nthree\n' },
          { path: 'b.txt', content: 'one\ntwo\n' },
        ],
      },
    ]);
    try {
      const commits = await readCommits(repo.dir);
      expect(commits).toHaveLength(2);

      // Newest first, shas identical to what git itself reports.
      expect(commits.map((commit) => commit.sha)).toEqual(
        (await gitLog(repo.dir, ['--format=%H'])).split('\n'),
      );

      expect(commits[0].subject).toBe('second commit');
      expect(commits[0].authorName).toBe('Bob');
      expect(commits[0].authorDate).toBe('2026-01-02T11:00:00Z');
      expect(commits[0].parents).toHaveLength(1);
      expect(commits[0].isMerge).toBe(false);
      // a.txt: one line removed; b.txt: two lines added.
      expect(commits[0].files).toStrictEqual([
        { path: 'a.txt', added: 0, deleted: 1 },
        { path: 'b.txt', added: 2, deleted: 0 },
      ]);

      expect(commits[1].subject).toBe('first commit');
      expect(commits[1].authorEmail).toBe('alice@example.com');
      expect(commits[1].parents).toEqual([]);
      expect(commits[1].files).toStrictEqual([{ path: 'a.txt', added: 3, deleted: 0 }]);
    } finally {
      await removeFixtureRepo(repo);
    }
  });

  it('filters by author date with inclusive since/until bounds', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'jan 1',
        files: [{ path: 'a.txt', content: 'a\n' }],
      },
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-15T10:30:00Z',
        message: 'jan 15',
        files: [{ path: 'b.txt', content: 'b\n' }],
      },
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-02-01T12:00:00Z',
        message: 'feb 1',
        files: [{ path: 'c.txt', content: 'c\n' }],
      },
    ]);
    try {
      const range = (since: string, until: string) => ({ since, until });
      const subjects = (commits: { subject: string }[]) => commits.map((commit) => commit.subject);

      expect(
        subjects(await readCommits(repo.dir, range('2026-01-10 00:00:00', '2026-01-31 23:59:59'))),
      ).toEqual(['jan 15']);

      // The bound itself is inclusive: a commit dated exactly at it stays.
      expect(subjects(await readCommits(repo.dir, { since: '2026-01-15 10:30:00' }))).toEqual([
        'feb 1',
        'jan 15',
      ]);

      // Open-ended ranges.
      expect(subjects(await readCommits(repo.dir, { since: '2026-01-10 00:00:00' }))).toEqual([
        'feb 1',
        'jan 15',
      ]);
      expect(subjects(await readCommits(repo.dir, { until: '2026-01-31 23:59:59' }))).toEqual([
        'jan 15',
        'jan 1',
      ]);

      // No range: the full history.
      expect(subjects(await readCommits(repo.dir))).toEqual(['feb 1', 'jan 15', 'jan 1']);
    } finally {
      await removeFixtureRepo(repo);
    }
  });

  it('compares author dates as instants, not strings', async () => {
    // 2026-01-15T10:30:00+05:00 is 05:30Z — the raw string compares
    // after the Z form, but the instant does not.
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-15T10:30:00+05:00',
        message: 'offset date',
        files: [{ path: 'a.txt', content: 'a\n' }],
      },
    ]);
    try {
      const commits = await readCommits(repo.dir, { since: '2026-01-15T00:00:00Z' });
      expect(commits.map((commit) => commit.subject)).toEqual(['offset date']);
      expect(commits[0].authorDate).toBe('2026-01-15T10:30:00+05:00');
    } finally {
      await removeFixtureRepo(repo);
    }
  });

  it('applies the author-date range in code, not the commit-date bound (§5.4)', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-15T10:00:00Z',
        message: 'in range',
        files: [{ path: 'a.txt', content: 'a\n' }],
      },
    ]);
    try {
      // A rebased commit: authored Feb 1 (outside the author-date range)
      // but committed Jan 20 (inside the commit-date scan bound).
      await runGit(repo.dir, ['config', 'user.name', 'Alice']);
      await runGit(repo.dir, ['config', 'user.email', 'alice@example.com']);
      await runGit(
        repo.dir,
        ['commit', '--allow-empty', '--date=2026-02-01T00:00:00Z', '-m', 'rebased out of range'],
        { env: { GIT_COMMITTER_DATE: '2026-01-20T00:00:00Z' } },
      );

      const commits = await readCommits(repo.dir, {
        since: '2026-01-01T00:00:00Z',
        until: '2026-01-31 23:59:59',
      });
      expect(commits.map((commit) => commit.subject)).toEqual(['in range']);
    } finally {
      await removeFixtureRepo(repo);
    }
  });

  it('bounds the scan by commit date, dropping commits committed outside it', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-15T10:00:00Z',
        message: 'in range',
        files: [{ path: 'a.txt', content: 'a\n' }],
      },
    ]);
    try {
      // Authored Jan 15 (inside the author-date range) but committed Feb
      // 10: the `--until` scan bound by commit date drops it first.
      await runGit(repo.dir, ['config', 'user.name', 'Alice']);
      await runGit(repo.dir, ['config', 'user.email', 'alice@example.com']);
      await runGit(
        repo.dir,
        ['commit', '--allow-empty', '--date=2026-01-15T10:00:00Z', '-m', 'committed late'],
        { env: { GIT_COMMITTER_DATE: '2026-02-10T00:00:00Z' } },
      );

      const commits = await readCommits(repo.dir, { until: '2026-01-31 23:59:59' });
      expect(commits.map((commit) => commit.subject)).toEqual(['in range']);
    } finally {
      await removeFixtureRepo(repo);
    }
  });

  it('detects merge commits with two parents and no numstat rows', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'base',
        files: [{ path: 'base.txt', content: 'base\n' }],
      },
    ]);
    try {
      await runGit(repo.dir, ['checkout', '-b', 'feature']);
      await runGit(repo.dir, ['config', 'user.name', 'Bob']);
      await runGit(repo.dir, ['config', 'user.email', 'bob@example.com']);
      await runGit(
        repo.dir,
        ['commit', '--allow-empty', '--date=2026-01-02T10:00:00Z', '-m', 'feature work'],
        { env: { GIT_COMMITTER_DATE: '2026-01-02T10:00:00Z' } },
      );
      await runGit(repo.dir, ['checkout', 'main']);
      // Author identity is pinned via environment variables, not config:
      // git exports GIT_AUTHOR_* into hook environments (e.g. the husky
      // pre-commit hook that runs `pnpm check`), and env vars take
      // precedence over `-c`/config for the merge commit's author.
      await runGit(repo.dir, ['merge', '--no-ff', '-m', 'merge feature', 'feature'], {
        env: {
          GIT_AUTHOR_NAME: 'Alice',
          GIT_AUTHOR_EMAIL: 'alice@example.com',
          GIT_AUTHOR_DATE: '2026-01-03T10:00:00Z',
          GIT_COMMITTER_DATE: '2026-01-03T10:00:00Z',
        },
      });

      const commits = await readCommits(repo.dir);
      expect(commits).toHaveLength(3);

      expect(commits[0]).toMatchObject({
        subject: 'merge feature',
        authorName: 'Alice',
        authorEmail: 'alice@example.com',
        authorDate: '2026-01-03T10:00:00Z',
        isMerge: true,
      });
      expect(commits[0].parents).toHaveLength(2);
      // Merge diffs are not attributed: no numstat rows.
      expect(commits[0].files).toEqual([]);

      expect(commits[1].subject).toBe('feature work');
      expect(commits[1].isMerge).toBe(false);
      expect(commits[2].subject).toBe('base');
      expect(commits[2].isMerge).toBe(false);
    } finally {
      await removeFixtureRepo(repo);
    }
  });

  it('records binary files without line counts', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'binary file',
        files: [{ path: 'data.bin', content: '\u0000\u0001\u0002' }],
      },
    ]);
    try {
      const commits = await readCommits(repo.dir);
      expect(commits).toHaveLength(1);
      expect(commits[0].files).toStrictEqual([
        { path: 'data.bin', added: undefined, deleted: undefined },
      ]);
    } finally {
      await removeFixtureRepo(repo);
    }
  });

  it('returns an empty list for a repository without commits', async () => {
    const repo = await buildFixtureRepo([]);
    try {
      expect(await readCommits(repo.dir)).toEqual([]);
      expect(await readCommits(repo.dir, { since: '2026-01-01T00:00:00Z' })).toEqual([]);
    } finally {
      await removeFixtureRepo(repo);
    }
  });
});
