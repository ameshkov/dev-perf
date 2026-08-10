import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildFixtureRepo,
  removeFixtureRepo,
  type FixtureRepo,
} from '../../test/fixtures/repo-builder.js';
import { jitteredDelay, isPromisorFetchFailure, shouldRetryGitError } from './git-retry.js';
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

/**
 * Writes a fake git executable that fails the first `failures`
 * invocations with the given stderr text and then delegates to the
 * real git. Each invocation appends a line to the marker file, so tests
 * can count attempts and drive the failure count.
 */
async function writeFlakyGit(
  dir: string,
  markerFile: string,
  failures: number,
  stderrText: string,
): Promise<string> {
  const shim = path.join(dir, 'flaky-git');
  const script = `#!/bin/sh
echo attempt >> "${markerFile}"
if [ "$(wc -l < "${markerFile}")" -le ${failures} ]; then
  echo "${stderrText}" >&2
  exit 1
fi
exec git "$@"
`;
  await writeFile(shim, script);
  await chmod(shim, 0o755);
  return shim;
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
      // An ordinary failure is not a hang: no timeout is recorded.
      expect(error.isTimeout).toBe(false);
      expect(error.timeoutMs).toBeUndefined();
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

  it('passes extra environment variables to the git process', async () => {
    const repo = await buildFixtureRepo([]);
    try {
      await runGit(repo.dir, ['config', 'user.name', 'Env']);
      await runGit(repo.dir, ['config', 'user.email', 'env@example.com']);
      await runGit(repo.dir, ['commit', '--allow-empty', '-m', 'env commit'], {
        env: {
          GIT_AUTHOR_DATE: '2026-01-15T10:00:00Z',
          GIT_COMMITTER_DATE: '2026-01-15T10:00:00Z',
        },
      });
      const stamp = await gitLog(repo.dir, ['-1', '--format=%aI %cI']);
      expect(stamp).toBe('2026-01-15T10:00:00Z 2026-01-15T10:00:00Z');
    } finally {
      await removeFixtureRepo(repo);
    }
  });
});

describe('runGit retry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries a transient failure and succeeds on a later attempt', async () => {
    const repo = await buildTwoAuthorRepo();
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-git-retry-'));
    const marker = path.join(tmp, 'attempts');
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const shim = await writeFlakyGit(
        tmp,
        marker,
        2,
        'ssh: connect to host github.com port 22: Connection refused',
      );

      const stdout = await runGit(repo.dir, ['log', '--format=%an'], {
        gitBinary: shim,
        retryDelays: [0, 0],
      });

      expect(stdout).toContain('Alice');
      expect(stdout).toContain('Bob');
      // Two transient failures, then a successful third attempt.
      expect(await readFile(marker, 'utf8').then((text) => text.trim().split('\n'))).toHaveLength(
        3,
      );
      // Each retry is printed with the attempt, the delay, and the cause.
      const stderr = stderrWrite.mock.calls.map((call) => String(call[0])).join('');
      expect(stderr).toMatch(
        /git "log" failed \(attempt \d\/\d; retrying in 0\.0 s\): Connection refused/,
      );
      expect(stderr.match(/retrying in/g)).toHaveLength(2);
    } finally {
      await removeFixtureRepo(repo);
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('gives up after the retries are exhausted and throws the last error', async () => {
    const repo = await buildTwoAuthorRepo();
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-git-retry-'));
    const marker = path.join(tmp, 'attempts');
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const shim = await writeFlakyGit(
        tmp,
        marker,
        1000,
        'ssh: connect to host github.com port 22: Connection refused',
      );

      const caught = await runGit(repo.dir, ['log', '--format=%an'], {
        gitBinary: shim,
        retryDelays: [0, 0],
      }).then(
        () => null,
        (error) => error,
      );

      expect(caught).toBeInstanceOf(GitError);
      expect((caught as GitError).stderr).toContain('Connection refused');
      // Two retry delays ([0, 0]) mean three total attempts before giving up.
      expect(await readFile(marker, 'utf8').then((text) => text.trim().split('\n'))).toHaveLength(
        3,
      );
      const stderr = stderrWrite.mock.calls.map((call) => String(call[0])).join('');
      expect(stderr.match(/retrying in/g)).toHaveLength(2);
    } finally {
      await removeFixtureRepo(repo);
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('does not retry a permanent failure', async () => {
    const repo = await buildTwoAuthorRepo();
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-git-retry-'));
    const marker = path.join(tmp, 'attempts');
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const shim = await writeFlakyGit(tmp, marker, 1000, "fatal: repository 'x' not found");

      const caught = await runGit(repo.dir, ['log', '--format=%an'], {
        gitBinary: shim,
        retryDelays: [0, 0],
      }).then(
        () => null,
        (error) => error,
      );

      expect(caught).toBeInstanceOf(GitError);
      expect((caught as GitError).message).toContain('repository');
      // Permanent failures fail immediately: one attempt, no retry log.
      expect(await readFile(marker, 'utf8').then((text) => text.trim().split('\n'))).toHaveLength(
        1,
      );
      expect(stderrWrite).not.toHaveBeenCalledWith(expect.stringMatching(/retrying in/));
    } finally {
      await removeFixtureRepo(repo);
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('kills a command that exceeds the timeout and fails without retrying', async () => {
    const repo = await buildTwoAuthorRepo();
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-git-timeout-'));
    const marker = path.join(tmp, 'attempts');
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      // A fake git that hangs forever (a long sleep); `exec` replaces
      // the shell so one process covers the whole hang.
      const shim = path.join(tmp, 'hanging-git');
      const script = `#!/bin/sh
echo attempt >> "${marker}"
exec /bin/sleep 30
`;
      await writeFile(shim, script);
      await chmod(shim, 0o755);

      const startedAt = Date.now();
      const caught = await runGit(repo.dir, ['log', '--format=%an'], {
        gitBinary: shim,
        timeoutMs: 500,
        retryDelays: [0, 0],
      }).then(
        () => null,
        (error) => error,
      );

      expect(caught).toBeInstanceOf(GitError);
      const gitError = caught as GitError;
      expect(gitError.isTimeout).toBe(true);
      expect(gitError.timeoutMs).toBe(500);
      expect(gitError.cwd).toBe(repo.dir);
      expect(gitError.message).toContain('git log --format=%an timed out after 0.5 s');
      // The timeout bound the command: it did not wait out the sleep.
      expect(Date.now() - startedAt).toBeLessThan(10000);
      // A timeout is a permanent failure: one attempt, no retry log.
      expect(await readFile(marker, 'utf8').then((text) => text.trim().split('\n'))).toHaveLength(
        1,
      );
      expect(stderrWrite).not.toHaveBeenCalledWith(expect.stringMatching(/retrying in/));
    } finally {
      await removeFixtureRepo(repo);
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('shouldRetryGitError', () => {
  /** A typed git error with the given stderr, for classification. */
  const at = (stderr: string): GitError =>
    new GitError(['clone', 'url', 'repo'], { cwd: '/cache/entry', stderr });

  it('classifies transient network failures as retriable', () => {
    expect(
      shouldRetryGitError(at('ssh: connect to host github.com port 22: Connection refused')),
    ).toBe(true);
    expect(
      shouldRetryGitError(
        at('fatal: could not fetch 3d611319a2681ac07ddf29117a544a6175160527 from promisor remote'),
      ),
    ).toBe(true);
    expect(
      shouldRetryGitError(
        at(
          "fatal: unable to access 'https://host/repo': Failed to connect to host: Operation timed out",
        ),
      ),
    ).toBe(true);
    expect(shouldRetryGitError(at('fatal: The remote end hung up unexpectedly'))).toBe(true);
  });

  it('does not retry permanent failures', () => {
    expect(shouldRetryGitError(at("fatal: repository 'x' not found"))).toBe(false);
    expect(shouldRetryGitError(at('fatal: Authentication failed'))).toBe(false);
    expect(shouldRetryGitError(at("fatal: remote error: filter 'blob:none' not supported"))).toBe(
      false,
    );
    expect(
      shouldRetryGitError(at("fatal: your current branch 'main' does not have any commits yet")),
    ).toBe(false);
  });

  it('does not retry a command that timed out, even when its text says "timed out"', () => {
    // A timed-out command is a stuck operation: retrying it would just
    // wait out another timeout window. The timeout message must not be
    // misclassified as a transient "timed out" network failure. Without
    // a timeoutMs the error renders the built-in default (5 minutes).
    const timedOut = new GitError(['log', '--numstat'], {
      cwd: '/cache/entry/repo',
      stderr: '',
      isTimeout: true,
    });
    expect(timedOut.message).toContain('git log --numstat timed out after 300 s');
    expect(shouldRetryGitError(timedOut)).toBe(false);
  });
});

describe('isPromisorFetchFailure', () => {
  /** A typed git error with the given stderr, for classification. */
  const at = (stderr: string): GitError =>
    new GitError(['log', '--numstat'], { cwd: '/cache/entry/repo', stderr });

  it('detects the on-demand blob fetch of a partial clone failing', () => {
    expect(
      isPromisorFetchFailure(
        at(
          'fatal: could not fetch 8fc64aaae33316fb07dfdff1c09e17cd42bb40f4 from promisor remote: Command failed with exit code 128',
        ),
      ),
    ).toBe(true);
    expect(
      isPromisorFetchFailure(
        at(
          'ssh: connect to host github.com port 22: Connection refused\n' +
            'fatal: could not fetch 8fc64aaae33316fb07dfdff1c09e17cd42bb40f4 from promisor remote',
        ),
      ),
    ).toBe(true);
  });

  it('does not treat other git failures as a promisor fetch', () => {
    expect(
      isPromisorFetchFailure(at('ssh: connect to host github.com port 22: Connection refused')),
    ).toBe(false);
    expect(isPromisorFetchFailure(at('fatal: Authentication failed'))).toBe(false);
    expect(isPromisorFetchFailure(at("fatal: repository 'x' not found"))).toBe(false);
    expect(
      isPromisorFetchFailure(at("fatal: remote error: filter 'blob:none' not supported")),
    ).toBe(false);
  });
});

describe('jitteredDelay', () => {
  it('adds up to ±20% jitter around the nominal delay', () => {
    expect(jitteredDelay(1000, () => 0)).toBe(800);
    expect(jitteredDelay(1000, () => 0.5)).toBe(1000);
    expect(jitteredDelay(1000, () => 1)).toBe(1200);
    expect(jitteredDelay(30000, () => 1)).toBe(36000);
  });
});
