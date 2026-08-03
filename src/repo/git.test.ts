import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildFixtureRepo,
  removeFixtureRepo,
  type FixtureRepo,
} from '../../test/fixtures/repo-builder.js';
import { GitError, gitLog, gitRevParse, gitShortlog, gitShow, runGit } from './git.js';

/** A fixture with two authors and one commit per author. */
async function buildTwoAuthorRepo(): Promise<FixtureRepo> {
  return buildFixtureRepo([
    {
      author: { name: 'Alice', email: 'alice@example.com' },
      date: '2026-01-01T10:00:00Z',
      message: 'first commit',
      files: [{ path: 'a.txt', content: 'alpha\n' }],
    },
    {
      author: { name: 'Bob', email: 'bob@example.com' },
      date: '2026-01-02T11:00:00Z',
      message: 'second commit',
      files: [{ path: 'b.txt', content: 'beta\n' }],
    },
  ]);
}

describe('runGit', () => {
  it('returns stdout without the trailing newline', async () => {
    const version = await runGit(process.cwd(), ['--version']);
    expect(version).toMatch(/^git version \d/);
    expect(version).not.toMatch(/\n$/);
  });

  it('throws a typed GitError with details when git fails', async () => {
    const notARepo = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-git-test-'));
    try {
      const error = await runGit(notARepo, ['rev-parse', 'HEAD']).then(
        () => null,
        (caught) => caught,
      );

      expect(error).toBeInstanceOf(GitError);
      expect(error.args).toEqual(['rev-parse', 'HEAD']);
      expect(error.cwd).toBe(notARepo);
      expect(error.exitCode).toBe(128);
      expect(error.stderr).toContain('not a git repository');
      expect(error.message).toContain('git rev-parse HEAD failed with exit 128');
      expect(error.message).toContain('not a git repository');
    } finally {
      await rm(notARepo, { recursive: true, force: true });
    }
  });

  it('throws a typed GitError when the git binary cannot start', async () => {
    const error = await runGit(process.cwd(), ['--version'], {
      gitBinary: '/nonexistent/git',
    }).then(
      () => null,
      (caught) => caught,
    );

    expect(error).toBeInstanceOf(GitError);
    expect(error.exitCode).toBeUndefined();
    expect(error.message).toContain('git --version failed with could not start');
  });
});

describe('git helpers', () => {
  it('gitLog lists commits newest first', async () => {
    const repo = await buildTwoAuthorRepo();
    try {
      const log = await gitLog(repo.dir, ['--format=%an %s']);
      expect(log).toBe('Bob second commit\nAlice first commit');
    } finally {
      await removeFixtureRepo(repo);
    }
  });

  it('gitRevParse resolves HEAD and the branch name', async () => {
    const repo = await buildTwoAuthorRepo();
    try {
      const head = await gitRevParse(repo.dir, ['HEAD']);
      expect(head).toMatch(/^[0-9a-f]{40}$/);
      expect(await gitRevParse(repo.dir, ['--abbrev-ref', 'HEAD'])).toBe('main');
    } finally {
      await removeFixtureRepo(repo);
    }
  });

  it('gitShortlog reports authors with their emails', async () => {
    const repo = await buildTwoAuthorRepo();
    try {
      // An explicit revision range is required: without it, git shortlog
      // reads the log from stdin when stdin is not a terminal.
      const shortlog = await gitShortlog(repo.dir, ['-sne', 'HEAD']);
      expect(shortlog).toContain('Alice <alice@example.com>');
      expect(shortlog).toContain('Bob <bob@example.com>');
    } finally {
      await removeFixtureRepo(repo);
    }
  });

  it('gitShow renders a commit', async () => {
    const repo = await buildTwoAuthorRepo();
    try {
      const show = await gitShow(repo.dir, ['--format=fuller', '--stat', 'HEAD']);
      expect(show).toContain('second commit');
      expect(show).toContain('b.txt');
    } finally {
      await removeFixtureRepo(repo);
    }
  });
});
