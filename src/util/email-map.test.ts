/**
 * Tests for the shared email mapping helpers used by both the `report`
 * and `compile` commands: `parseEmailMapEntry` parses one `email=name`
 * mapping and `loadEmailMap` merges the `--maps-file` entries with the
 * `--map` entries, the flags winning over the file.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadEmailMap, parseEmailMapEntry } from './email-map.js';

describe('parseEmailMapEntry', () => {
  it('parses an email=name pair, lowercasing and trimming the email', () => {
    expect(parseEmailMapEntry('  Alice@Example.com = Alice Smith ', '--map')).toEqual({
      email: 'alice@example.com',
      name: 'Alice Smith',
    });
  });

  it('rejects an entry without a separator, naming the source', () => {
    expect(() => parseEmailMapEntry('no-equals-sign', '--map')).toThrow(
      /--map: expected 'email=name'/,
    );
  });

  it('rejects an entry with an empty email or name', () => {
    expect(() => parseEmailMapEntry('=Alice', '--map')).toThrow(/--map: expected 'email=name'/);
    expect(() => parseEmailMapEntry('alice@example.com=', '--map')).toThrow(
      /--map: expected 'email=name'/,
    );
  });
});

describe('loadEmailMap', () => {
  let dir: string;

  afterEach(async () => {
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns an empty map without a file or entries', async () => {
    await expect(loadEmailMap(undefined)).resolves.toEqual({});
  });

  it('treats a blank maps-file path as not provided', async () => {
    await expect(loadEmailMap('   ')).resolves.toEqual({});
  });

  it('lowercases and trims the file keys and values', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-email-map-'));
    const mapsFile = path.join(dir, 'maps.json');
    await writeFile(mapsFile, JSON.stringify({ '  Alice@Example.com  ': '  Alice  ' }));

    await expect(loadEmailMap(mapsFile)).resolves.toEqual({ 'alice@example.com': 'Alice' });
  });

  it('lets the --map entries win on conflict', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-email-map-'));
    const mapsFile = path.join(dir, 'maps.json');
    await writeFile(
      mapsFile,
      JSON.stringify({ 'Alice@Example.com': 'Alice', 'b@example.com': 'B' }),
    );

    await expect(
      loadEmailMap(mapsFile, [
        { email: 'alice@example.com', name: 'Alice Smith' },
        { email: 'c@example.com', name: 'Carol' },
      ]),
    ).resolves.toEqual({
      'alice@example.com': 'Alice Smith',
      'b@example.com': 'B',
      'c@example.com': 'Carol',
    });
  });

  it('rejects an empty or whitespace-only name in the file', async () => {
    for (const name of ['', '   ']) {
      dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-email-map-'));
      const mapsFile = path.join(dir, 'maps.json');
      await writeFile(mapsFile, JSON.stringify({ 'a@example.com': name }));

      await expect(loadEmailMap(mapsFile)).rejects.toThrow(
        /Invalid maps file .* "email" and "Name" must be non-empty/,
      );
    }
  });

  it('rejects a blank email key in the file', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-email-map-'));
    const mapsFile = path.join(dir, 'maps.json');
    await writeFile(mapsFile, JSON.stringify({ '   ': 'Alice' }));

    await expect(loadEmailMap(mapsFile)).rejects.toThrow(
      /Invalid maps file .* "email" and "Name" must be non-empty/,
    );
  });

  it('throws a descriptive error for an invalid maps file', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-email-map-'));
    const mapsFile = path.join(dir, 'maps.json');
    await writeFile(mapsFile, JSON.stringify(['not', 'an', 'object']));

    await expect(loadEmailMap(mapsFile)).rejects.toThrow(
      /Invalid maps file .* expected an object of \{ "email": "Name" \} entries/,
    );
  });
});
