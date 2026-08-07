import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cacheEntryDir,
  cloneInfoSchema,
  cloneJsonPath,
  entryHash,
  llmDir,
  piDir,
  piHomeDir,
  readCloneInfo,
  repoDir,
  resolveCacheDir,
  writeCloneInfo,
} from './cache.js';

const URL = 'https://github.com/org/repo.git';

/** Expected entry hash: sha256(url) hex, first 16 characters. */
function expectedHash(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 16);
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-cache-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('entryHash', () => {
  it('returns the first 16 hex characters of the URL sha256', () => {
    expect(entryHash(URL)).toBe(expectedHash(URL));
  });

  it('is stable for the same URL and distinct for different URLs', () => {
    const other = 'https://github.com/other/repo.git';
    expect(entryHash(URL)).toBe(entryHash(URL));
    expect(entryHash(URL)).not.toBe(entryHash(other));
  });

  it('isolates branches: a branch changes the hash, and no branch keeps the plain URL hash', () => {
    // The no-branch hash stays the plain URL hash, so caches written
    // before branch selection was supported remain reusable.
    expect(entryHash(URL, '')).toBe(entryHash(URL));
    expect(entryHash(URL, undefined)).toBe(entryHash(URL));

    const branchKey = `${URL}\x00dev`;
    expect(entryHash(URL, 'dev')).toBe(expectedHash(branchKey));
    expect(entryHash(URL, 'dev')).not.toBe(entryHash(URL));
    expect(entryHash(URL, 'dev')).not.toBe(entryHash(URL, 'main'));
  });
});

describe('cacheEntryDir', () => {
  it('joins the cache root and the entry hash', () => {
    expect(cacheEntryDir('/cache', URL)).toBe(path.join('/cache', expectedHash(URL)));
  });

  it('keys branch-specific entries under their own directory', () => {
    expect(cacheEntryDir('/cache', URL, 'dev')).toBe(
      path.join('/cache', expectedHash(`${URL}\x00dev`)),
    );
    expect(cacheEntryDir('/cache', URL, 'dev')).not.toBe(cacheEntryDir('/cache', URL));
  });
});

describe('layout path builders', () => {
  it('builds the cache entry layout paths', () => {
    const entry = cacheEntryDir('/cache', URL);
    expect(repoDir(entry)).toBe(path.join(entry, 'repo'));
    expect(cloneJsonPath(entry)).toBe(path.join(entry, 'clone.json'));
    expect(llmDir(entry)).toBe(path.join(entry, 'llm'));
    expect(piDir(entry)).toBe(path.join(entry, 'pi'));
    expect(piHomeDir(entry)).toBe(path.join(entry, 'pi', 'home'));
  });
});

describe('resolveCacheDir', () => {
  it('defaults to .dev-cache under the OS temp directory', () => {
    expect(resolveCacheDir()).toBe(path.join(os.tmpdir(), '.dev-cache'));
  });

  it('resolves a custom cache dir under the working directory', () => {
    expect(resolveCacheDir('custom/cache')).toBe(path.resolve(process.cwd(), 'custom', 'cache'));
    expect(resolveCacheDir('/abs/cache')).toBe('/abs/cache');
  });
});

describe('clone.json', () => {
  it('roundtrips through writeCloneInfo and readCloneInfo', async () => {
    const entry = path.join(tmpDir, 'entry');
    const info = {
      url: URL,
      clonedAt: '2026-01-15T10:30:00.000Z',
      branch: 'main',
      head: 'e3efcc479e02edb6471a7af022e64bf2adc64b11',
    };

    await writeCloneInfo(entry, info);

    const read = await readCloneInfo(entry);
    expect(read).toEqual(info);
    // The file is pretty JSON with a trailing newline.
    const text = await readFile(cloneJsonPath(entry), 'utf8');
    expect(text).toBe(`${JSON.stringify(info, null, 2)}\n`);
  });

  it('returns undefined when clone.json is missing', async () => {
    expect(await readCloneInfo(path.join(tmpDir, 'missing'))).toBeUndefined();
  });

  it('returns undefined when clone.json is not valid JSON', async () => {
    const entry = path.join(tmpDir, 'entry');
    await mkdir(entry, { recursive: true });
    await writeFile(cloneJsonPath(entry), 'not json', 'utf8');
    expect(await readCloneInfo(entry)).toBeUndefined();
  });

  it('returns undefined when clone.json fails validation', async () => {
    const entry = path.join(tmpDir, 'entry');
    await mkdir(entry, { recursive: true });
    await writeFile(cloneJsonPath(entry), JSON.stringify({ url: URL }), 'utf8');
    expect(await readCloneInfo(entry)).toBeUndefined();
  });

  it('rejects a wrong cloneInfo shape', () => {
    expect(cloneInfoSchema.safeParse({ url: URL }).success).toBe(false);
    expect(
      cloneInfoSchema.safeParse({ url: URL, clonedAt: 1, branch: 'main', head: 'abc' }).success,
    ).toBe(false);
  });
});
