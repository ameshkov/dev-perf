/**
 * Tests for the per-repository commit exclusion: matching by full and
 * abbreviated hash (a case-insensitive prefix of the full sha), by
 * case-insensitive message pattern against the commit subject, the
 * whitespace trimming, and the filtering behavior (whole commits
 * dropped, merges included, remaining commits kept in order).
 */
import { describe, expect, it } from 'vitest';
import type { Commit } from './commits.js';
import { filterIgnoredCommits, hasIgnoreCommits } from './commit-ignore.js';

/** A commit with defaults; a sha matching `HASH` and subject `feat: x`. */
const HASH = '0123456789abcdef0123456789abcdef01234567';

/** A commit with the given sha and subject. */
function commit(overrides: Partial<Commit> = {}): Commit {
  return {
    sha: HASH,
    parents: [],
    authorName: 'Alice',
    authorEmail: 'alice@example.com',
    authorDate: '2026-01-01T10:00:00Z',
    subject: 'feat: x',
    files: [],
    isMerge: false,
    ...overrides,
  };
}

describe('hasIgnoreCommits', () => {
  it('is false for undefined and for an effectively-empty spec', () => {
    expect(hasIgnoreCommits(undefined)).toBe(false);
    expect(hasIgnoreCommits({})).toBe(false);
    expect(hasIgnoreCommits({ hashes: [] })).toBe(false);
    expect(hasIgnoreCommits({ messages: [] })).toBe(false);
  });

  it('is true when at least one hash or message pattern is set', () => {
    expect(hasIgnoreCommits({ hashes: ['abc'] })).toBe(true);
    expect(hasIgnoreCommits({ messages: ['^wip'] })).toBe(true);
    expect(hasIgnoreCommits({ hashes: [], messages: ['^wip'] })).toBe(true);
  });
});

describe('filterIgnoredCommits', () => {
  it('keeps the commits unchanged when nothing matches', () => {
    const commits = [commit(), commit({ sha: 'abc' })];
    expect(filterIgnoredCommits(commits, {})).toEqual(commits);
  });

  it('drops a commit by its exact full hash', () => {
    const kept = filterIgnoredCommits([commit(), commit({ sha: 'abc' })], {
      hashes: [HASH],
    });

    expect(kept.map((candidate) => candidate.sha)).toEqual(['abc']);
  });

  it('matches an abbreviated hash as a prefix of the full sha', () => {
    const kept = filterIgnoredCommits([commit(), commit({ sha: 'abc' })], {
      hashes: ['01234567'],
    });

    expect(kept.map((candidate) => candidate.sha)).toEqual(['abc']);
  });

  it('matches a hash case-insensitively', () => {
    const kept = filterIgnoredCommits([commit()], { hashes: [HASH.toUpperCase()] });

    expect(kept).toEqual([]);
  });

  it('does not match a hash that is merely a prefix of the configured value', () => {
    // The configured hash must be a prefix of the commit's sha, never
    // the other way around: a shortened commit sha cannot be extended.
    expect(filterIgnoredCommits([commit({ sha: 'abc' })], { hashes: ['abcdef'] })).toHaveLength(1);
  });

  it('drops a commit whose subject matches a message pattern', () => {
    const kept = filterIgnoredCommits(
      [commit({ subject: 'chore: bump deps' }), commit({ subject: 'feat: x' })],
      { messages: ['^chore'] },
    );

    expect(kept.map((candidate) => candidate.subject)).toEqual(['feat: x']);
  });

  it('matches a message pattern case-insensitively', () => {
    expect(
      filterIgnoredCommits([commit({ subject: 'WIP: scratch' })], { messages: ['^wip'] }),
    ).toEqual([]);
  });

  it('drops a commit matched by hash or by message, merges included', () => {
    const merge = commit({
      sha: 'aaa',
      parents: ['x', 'y'],
      isMerge: true,
      subject: 'Merge branch',
    });
    const kept = filterIgnoredCommits([merge, commit({ sha: 'bbb', subject: 'feat: ok' })], {
      hashes: ['aaa'],
      messages: ['^merge'],
    });

    expect(kept.map((candidate) => candidate.sha)).toEqual(['bbb']);
  });

  it('trims whitespace around hashes and patterns before matching', () => {
    const kept = filterIgnoredCommits(
      [commit({ sha: 'abcdef' }), commit({ subject: 'chore: x' })],
      { hashes: ['  ABCDEF  '], messages: ['  ^chore  '] },
    );

    expect(kept).toEqual([]);
  });

  it('keeps the remaining commits in their original order', () => {
    const commits = [commit({ sha: '111' }), commit({ sha: '222' }), commit({ sha: '333' })];
    const kept = filterIgnoredCommits(commits, { hashes: ['222'] });

    expect(kept.map((candidate) => candidate.sha)).toEqual(['111', '333']);
  });
});
