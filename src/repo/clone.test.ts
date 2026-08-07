import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildFixtureRepo,
  removeFixtureRepo,
  type FixtureRepo,
} from '../../test/fixtures/repo-builder.js';
import { setVerbose } from '../util/log.js';
import { cacheEntryDir, entryHash, readCloneInfo } from './cache.js';
import { cloneTarget, ensureClone, isRemoteUrl } from './clone.js';
import { gitRevParse, runGit } from './git.js';

/** A fixture with two commits by one author. */
async function buildFixture(): Promise<FixtureRepo> {
  return buildFixtureRepo([
    {
      author: { name: 'Alice', email: 'alice@example.com' },
      date: '2026-01-01T10:00:00Z',
      message: 'first commit',
      files: [{ path: 'a.txt', content: 'alpha\n' }],
    },
    {
      author: { name: 'Alice', email: 'alice@example.com' },
      date: '2026-01-02T11:00:00Z',
      message: 'second commit',
      files: [{ path: 'b.txt', content: 'beta\n' }],
    },
  ]);
}

/** Fresh cache dir inside a unique temp dir. */
async function tempCacheDir(): Promise<string> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-clone-test-'));
  return path.join(tmp, 'cache');
}

/**
 * Writes a fake git executable that fails on `--filter=blob:none` (like
 * a hosting that rejects partial clones) and delegates everything else
 * to the real git. The marker file is written when the filter attempt
 * happens, so tests can assert the fallback really ran.
 */
async function writeFilterRejectingGit(dir: string): Promise<{ shim: string; marker: string }> {
  const shim = path.join(dir, 'fake-git');
  const marker = path.join(dir, 'partial-attempted');
  const script = `#!/bin/sh
for arg in "$@"; do
  if [ "$arg" = "--filter=blob:none" ]; then
    echo attempted > "${marker}"
    echo "fatal: remote error: filter 'blob:none' not supported" >&2
    exit 1
  fi
done
exec git "$@"
`;
  await writeFile(shim, script);
  await chmod(shim, 0o755);
  return { shim, marker };
}

/** Adds one commit to a fixture repo. */
async function addCommit(fixture: FixtureRepo, message: string, date: string): Promise<void> {
  await writeFile(path.join(fixture.dir, `${message}.txt`), 'content\n');
  await runGit(fixture.dir, ['add', '-A']);
  await runGit(
    fixture.dir,
    ['commit', '--author', 'Alice <alice@example.com>', '--date', date, '-m', message],
    { env: { GIT_COMMITTER_DATE: date } },
  );
}

/**
 * Creates a branch in a fixture repo and commits to it, leaving the
 * working tree on that branch.
 */
async function addBranchCommit(
  fixture: FixtureRepo,
  branch: string,
  message: string,
  date: string,
): Promise<void> {
  await runGit(fixture.dir, ['checkout', '-b', branch]);
  await addCommit(fixture, message, date);
}

describe('isRemoteUrl', () => {
  it('recognizes remote URLs and local paths', () => {
    expect(isRemoteUrl('https://github.com/org/repo.git')).toBe(true);
    expect(isRemoteUrl('ssh://git@example.com/org/repo.git')).toBe(true);
    expect(isRemoteUrl('git@github.com:org/repo.git')).toBe(true);
    expect(isRemoteUrl('/abs/path/repo')).toBe(false);
    expect(isRemoteUrl('relative/path/repo')).toBe(false);
  });
});

describe('cloneTarget', () => {
  it('passes remote URLs through and converts local paths to file://', async () => {
    const fixture = await buildFixture();
    try {
      expect(cloneTarget('https://github.com/org/repo.git')).toBe(
        'https://github.com/org/repo.git',
      );
      expect(cloneTarget(fixture.dir)).toBe(fixture.url);
      expect(cloneTarget('relative/path/repo')).toBe(
        pathToFileURL(path.resolve('relative/path/repo')).href,
      );
    } finally {
      await removeFixtureRepo(fixture);
    }
  });
});

describe('ensureClone', () => {
  it('clones a local path with a partial clone and writes clone.json', async () => {
    const fixture = await buildFixture();
    const cacheDir = await tempCacheDir();
    try {
      const result = await ensureClone(fixture.dir, { cacheDir });

      expect(result.reused).toBe(false);
      expect(result.branch).toBe('main');
      expect(result.head).toBe(await gitRevParse(fixture.dir, ['HEAD']));
      expect(result.repoDir).toBe(path.join(cacheDir, entryHash(fixture.dir), 'repo'));

      // The file:// form makes the partial clone apply for local paths.
      const config = await readFile(path.join(result.repoDir, '.git', 'config'), 'utf8');
      expect(config).toContain('partialclonefilter = blob:none');

      const info = await readCloneInfo(cacheEntryDir(cacheDir, fixture.dir));
      expect(info).toEqual({
        url: fixture.dir,
        clonedAt: result.clonedAt,
        branch: 'main',
        head: result.head,
      });
    } finally {
      await removeFixtureRepo(fixture);
      await rm(path.dirname(cacheDir), { recursive: true, force: true });
    }
  });

  it('reuses the cached clone on the second run', async () => {
    const fixture = await buildFixture();
    const cacheDir = await tempCacheDir();
    try {
      const first = await ensureClone(fixture.dir, { cacheDir });
      const second = await ensureClone(fixture.dir, { cacheDir });

      expect(second.reused).toBe(true);
      expect(second.repoDir).toBe(first.repoDir);
      expect(second.head).toBe(first.head);
      expect(second.clonedAt).toBe(first.clonedAt);
    } finally {
      await removeFixtureRepo(fixture);
      await rm(path.dirname(cacheDir), { recursive: true, force: true });
    }
  });

  it('re-clones with --refresh and picks up new commits', async () => {
    const fixture = await buildFixture();
    const cacheDir = await tempCacheDir();
    try {
      const first = await ensureClone(fixture.dir, { cacheDir });
      await addCommit(fixture, 'third', '2026-01-03T12:00:00Z');

      const stale = await ensureClone(fixture.dir, { cacheDir });
      expect(stale.reused).toBe(true);
      expect(stale.head).toBe(first.head);

      const fresh = await ensureClone(fixture.dir, { cacheDir, refresh: true });
      expect(fresh.reused).toBe(false);
      expect(fresh.head).toBe(await gitRevParse(fixture.dir, ['HEAD']));
      expect(fresh.clonedAt).not.toBe(first.clonedAt);
    } finally {
      await removeFixtureRepo(fixture);
      await rm(path.dirname(cacheDir), { recursive: true, force: true });
    }
  });

  it('accepts file:// URLs and stores them in clone.json', async () => {
    const fixture = await buildFixture();
    const cacheDir = await tempCacheDir();
    try {
      const result = await ensureClone(fixture.url, { cacheDir });

      expect(result.head).toBe(await gitRevParse(fixture.dir, ['HEAD']));
      const info = await readCloneInfo(cacheEntryDir(cacheDir, fixture.url));
      expect(info?.url).toBe(fixture.url);
    } finally {
      await removeFixtureRepo(fixture);
      await rm(path.dirname(cacheDir), { recursive: true, force: true });
    }
  });

  it('falls back to a full clone when the hosting rejects partial clones', async () => {
    const fixture = await buildFixture();
    const cacheDir = await tempCacheDir();
    const tmp = path.dirname(cacheDir);
    try {
      const { shim, marker } = await writeFilterRejectingGit(tmp);

      const result = await ensureClone(fixture.dir, { cacheDir, gitBinary: shim });

      // The partial-clone attempt happened and failed; the fallback
      // produced a working full clone.
      expect(await readFile(marker, 'utf8')).toBe('attempted\n');
      expect(result.reused).toBe(false);
      expect(result.branch).toBe('main');
      expect(result.head).toBe(await gitRevParse(fixture.dir, ['HEAD']));
    } finally {
      await removeFixtureRepo(fixture);
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('clones an empty repository with an empty head', async () => {
    const fixture = await buildFixtureRepo([]);
    const cacheDir = await tempCacheDir();
    try {
      const result = await ensureClone(fixture.dir, { cacheDir });

      expect(result.reused).toBe(false);
      expect(result.branch).toBe('main');
      expect(result.head).toBe('');

      const info = await readCloneInfo(cacheEntryDir(cacheDir, fixture.dir));
      expect(info?.head).toBe('');
    } finally {
      await removeFixtureRepo(fixture);
      await rm(path.dirname(cacheDir), { recursive: true, force: true });
    }
  });

  it('rethrows when the clone fails for an unrelated reason', async () => {
    const cacheDir = await tempCacheDir();
    try {
      await expect(ensureClone('/nonexistent/repo/path', { cacheDir })).rejects.toThrow(
        /git clone/,
      );
    } finally {
      await rm(path.dirname(cacheDir), { recursive: true, force: true });
    }
  });

  it('clones the requested branch and records it in clone.json', async () => {
    const fixture = await buildFixture();
    // main has two commits; dev branches from main with one extra commit.
    await addBranchCommit(fixture, 'dev', 'dev commit', '2026-01-03T12:00:00Z');
    const devHead = await gitRevParse(fixture.dir, ['HEAD']);
    await runGit(fixture.dir, ['checkout', 'main']);
    const mainHead = await gitRevParse(fixture.dir, ['HEAD']);
    const cacheDir = await tempCacheDir();
    try {
      const dev = await ensureClone(fixture.dir, { cacheDir, branch: 'dev' });
      expect(dev.reused).toBe(false);
      expect(dev.branch).toBe('dev');
      expect(dev.head).toBe(devHead);
      expect(dev.head).not.toBe(mainHead);

      const info = await readCloneInfo(dev.entryDir);
      expect(info?.branch).toBe('dev');
      expect(info?.head).toBe(devHead);
    } finally {
      await removeFixtureRepo(fixture);
      await rm(path.dirname(cacheDir), { recursive: true, force: true });
    }
  });

  it('caches each branch in its own entry, so switching branches never reuses the wrong clone', async () => {
    const fixture = await buildFixture();
    await addBranchCommit(fixture, 'dev', 'dev commit', '2026-01-03T12:00:00Z');
    const devHead = await gitRevParse(fixture.dir, ['HEAD']);
    await runGit(fixture.dir, ['checkout', 'main']);
    const cacheDir = await tempCacheDir();
    try {
      // Two clones of the same URL: the branches land in different
      // cache entries with distinct heads.
      const dev = await ensureClone(fixture.dir, { cacheDir, branch: 'dev' });
      expect(dev.reused).toBe(false);
      expect(dev.head).toBe(devHead);
      const main = await ensureClone(fixture.dir, { cacheDir, branch: 'main' });
      expect(main.reused).toBe(false);
      expect(main.branch).toBe('main');
      expect(main.head).not.toBe(devHead);
      expect(dev.entryDir).not.toBe(main.entryDir);
      // A default (no-branch) run does not collide with the branch
      // entries either and reuses the default-branch clone.
      const prefixed = await ensureClone(fixture.dir, { cacheDir });
      expect(prefixed.reused).toBe(false);
      expect(prefixed.branch).toBe('main');
      const defaultAgain = await ensureClone(fixture.dir, { cacheDir });
      expect(defaultAgain.reused).toBe(true);
      expect(defaultAgain.head).toBe(prefixed.head);
      // The branch clone reuses its own entry on the next run.
      const devAgain = await ensureClone(fixture.dir, { cacheDir, branch: 'dev' });
      expect(devAgain.reused).toBe(true);
      expect(devAgain.head).toBe(devHead);
    } finally {
      await removeFixtureRepo(fixture);
      await rm(path.dirname(cacheDir), { recursive: true, force: true });
    }
  });

  it('keeps the requested branch when falling back to a full clone', async () => {
    const fixture = await buildFixture();
    await addBranchCommit(fixture, 'dev', 'dev commit', '2026-01-03T12:00:00Z');
    const devHead = await gitRevParse(fixture.dir, ['HEAD']);
    const cacheDir = await tempCacheDir();
    const tmp = path.dirname(cacheDir);
    try {
      const { shim, marker } = await writeFilterRejectingGit(tmp);

      const result = await ensureClone(fixture.dir, { cacheDir, branch: 'dev', gitBinary: shim });

      // The partial-clone attempt happened and failed; the full-clone
      // fallback still checked out the requested branch.
      expect(await readFile(marker, 'utf8')).toBe('attempted\n');
      expect(result.branch).toBe('dev');
      expect(result.head).toBe(devHead);
    } finally {
      await removeFixtureRepo(fixture);
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('ensureClone logging', () => {
  afterEach(() => {
    setVerbose(false);
    vi.restoreAllMocks();
  });

  it('logs the clone start line in verbose mode', async () => {
    const fixture = await buildFixture();
    const cacheDir = await tempCacheDir();
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    setVerbose(true);
    try {
      await ensureClone(fixture.dir, { cacheDir });

      const stderr = stderrWrite.mock.calls.map((call) => String(call[0])).join('');
      expect(stderr).toContain(`cloning "${fixture.dir}"`);
      // The cache entry directory (with its hash) is named so a
      // repository can be matched to its cache entry from the log.
      expect(stderr).toContain(`(cache "${path.join(cacheDir, entryHash(fixture.dir))}")`);
    } finally {
      await removeFixtureRepo(fixture);
      await rm(path.dirname(cacheDir), { recursive: true, force: true });
    }
  });

  it('does not log a clone start when the cached clone is reused', async () => {
    const fixture = await buildFixture();
    const cacheDir = await tempCacheDir();
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    setVerbose(true);
    try {
      const first = await ensureClone(fixture.dir, { cacheDir });
      stderrWrite.mockClear();

      const second = await ensureClone(fixture.dir, { cacheDir });
      expect(second.reused).toBe(true);
      expect(second.clonedAt).toBe(first.clonedAt);
      expect(stderrWrite).not.toHaveBeenCalledWith(expect.stringMatching(/cloning "/));
    } finally {
      await removeFixtureRepo(fixture);
      await rm(path.dirname(cacheDir), { recursive: true, force: true });
    }
  });

  it('hides the clone start line in quiet mode', async () => {
    const fixture = await buildFixture();
    const cacheDir = await tempCacheDir();
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await ensureClone(fixture.dir, { cacheDir });

      const stderr = stderrWrite.mock.calls.map((call) => String(call[0])).join('');
      expect(stderr).not.toContain('cloning "');
    } finally {
      await removeFixtureRepo(fixture);
      await rm(path.dirname(cacheDir), { recursive: true, force: true });
    }
  });
});
