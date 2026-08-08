/**
 * Tests for the branch-delta base resolution: the default candidates
 * (`main` → `master`, preferring the repository's own default branch
 * resolved from `origin/HEAD`), the explicit-base expansion (`<base>`
 * then `origin/<base>`), the first-resolving-wins ordering, and the
 * full-history opt-out (`''`).
 */
import { describe, expect, it, vi } from 'vitest';
import { buildFixtureRepo, removeFixtureRepo } from '../../test/fixtures/repo-builder.js';
import { resolveBaseSha } from './base.js';
import { GitError, gitRevParse } from '../repo/git.js';
import * as git from '../repo/git.js';

/** A fixture repo with a single `main` branch and no `master`. */
async function singleBranchRepo() {
  return buildFixtureRepo([
    {
      author: { name: 'Alice', email: 'alice@example.com' },
      date: '2026-01-01T10:00:00Z',
      message: 'base',
      files: [{ path: 'a.txt', content: 'a\n' }],
    },
  ]);
}

describe('resolveBaseSha', () => {
  it('resolves the default base to the single default branch (main)', async () => {
    const repo = await singleBranchRepo();
    try {
      const expected = await gitRevParse(repo.dir, ['HEAD']);
      await expect(resolveBaseSha(repo.dir)).resolves.toEqual({ base: 'main', sha: expected });
    } finally {
      await removeFixtureRepo(repo);
    }
  });

  it('prefers main over a leftover master when both exist (candidate order)', async () => {
    const repo = await singleBranchRepo();
    try {
      // `git branch master` copies the current main head, so both refs
      // resolve; `main` is the first default candidate and wins, so a
      // stale `master` left over from a migration never over-credits.
      await git.runGit(repo.dir, ['branch', 'master']);
      const expected = await gitRevParse(repo.dir, ['HEAD']);
      await expect(resolveBaseSha(repo.dir)).resolves.toEqual({ base: 'main', sha: expected });
    } finally {
      await removeFixtureRepo(repo);
    }
  });

  it('falls back to master when no main branch exists', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'base',
        files: [{ path: 'a.txt', content: 'a\n' }],
      },
    ]);
    try {
      await git.runGit(repo.dir, ['branch', '-M', 'master']);
      const expected = await gitRevParse(repo.dir, ['HEAD']);
      await expect(resolveBaseSha(repo.dir)).resolves.toEqual({ base: 'master', sha: expected });
    } finally {
      await removeFixtureRepo(repo);
    }
  });

  it('prefers the repository default branch (origin/HEAD) over main and master', async () => {
    // The remote's canonical default (`refs/remotes/origin/HEAD`) wins
    // even over the static `main` candidate: a repository whose remote
    // default is, say, `trunk` is scoped against `origin/trunk`, not a
    // stale local `main`.
    const repo = await singleBranchRepo();
    try {
      const head = await gitRevParse(repo.dir, ['HEAD']);
      // Simulate a remote default branch pointing at a non-main ref.
      await git.runGit(repo.dir, [
        'symbolic-ref',
        'refs/remotes/origin/HEAD',
        'refs/remotes/origin/trunk',
      ]);
      await git.runGit(repo.dir, ['update-ref', 'refs/remotes/origin/trunk', head]);
      await expect(resolveBaseSha(repo.dir)).resolves.toEqual({
        base: 'origin/trunk',
        sha: head,
      });
    } finally {
      await removeFixtureRepo(repo);
    }
  });

  it('resolves an explicit base when it exists, without the default fallback', async () => {
    const repo = await singleBranchRepo();
    try {
      const expected = await gitRevParse(repo.dir, ['HEAD']);
      await expect(resolveBaseSha(repo.dir, 'main')).resolves.toEqual({
        base: 'main',
        sha: expected,
      });
    } finally {
      await removeFixtureRepo(repo);
    }
  });

  it('returns undefined for an explicit base that resolves nowhere', async () => {
    const repo = await singleBranchRepo();
    try {
      // The explicit base `prod` exists neither locally nor upstream.
      await expect(resolveBaseSha(repo.dir, 'prod')).resolves.toBeUndefined();
    } finally {
      await removeFixtureRepo(repo);
    }
  });

  it('treats the empty-string base as the full-history opt-out', async () => {
    const repo = await singleBranchRepo();
    try {
      await expect(resolveBaseSha(repo.dir, '')).resolves.toBeUndefined();
    } finally {
      await removeFixtureRepo(repo);
    }
  });

  it('propagates a genuine git failure instead of degrading to full history', async () => {
    // A missing ref (`rev-parse --verify` exit 1) is the documented
    // fall-through; every other failure (a corrupt clone, a missing git
    // binary) must surface with its cause, never silently return
    // `undefined` and analyze the full history.
    const repo = await singleBranchRepo();
    const spy = vi.spyOn(git, 'runGit').mockRejectedValue(
      new GitError(['rev-parse', '--verify', '--quiet', '--end-of-options', 'main'], {
        cwd: repo.dir,
        exitCode: 128,
        stderr: 'fatal: not a git repository',
      }),
    );
    try {
      await expect(resolveBaseSha(repo.dir)).rejects.toThrow(GitError);
    } finally {
      spy.mockRestore();
      await removeFixtureRepo(repo);
    }
  });

  it('treats only the missing-ref exit code 1 as the fall-through', async () => {
    const repo = await singleBranchRepo();
    const spy = vi.spyOn(git, 'runGit').mockRejectedValue(
      new GitError(['rev-parse', '--verify', '--quiet', '--end-of-options', 'origin/main'], {
        cwd: repo.dir,
        exitCode: 1,
        stderr: '',
      }),
    );
    try {
      await expect(resolveBaseSha(repo.dir)).resolves.toBeUndefined();
    } finally {
      spy.mockRestore();
      await removeFixtureRepo(repo);
    }
  });

  it('treats a missing origin/HEAD as a fall-through to the static candidates', async () => {
    // A fixture repo has no remote, so `symbolic-ref refs/remotes/origin/HEAD`
    // fails with exit 1 — the normal fall-through. The static candidates
    // (`main` before `master`) still resolve.
    const repo = await singleBranchRepo();
    try {
      const expected = await gitRevParse(repo.dir, ['HEAD']);
      await expect(resolveBaseSha(repo.dir)).resolves.toEqual({ base: 'main', sha: expected });
    } finally {
      await removeFixtureRepo(repo);
    }
  });
});
