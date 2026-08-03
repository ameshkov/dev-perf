import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildFixtureRepo,
  removeFixtureRepo,
  type FixtureRepo,
} from '../../test/fixtures/repo-builder.js';
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
  await runGit(fixture.dir, [
    'commit',
    '--author',
    'Alice <alice@example.com>',
    '--date',
    date,
    '-m',
    message,
  ]);
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
});
