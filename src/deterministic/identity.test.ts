/**
 * Tests for author identity resolution: email grouping
 * with case folding, display-name selection by frequency, and the
 * heuristic bot flag that never filters.
 */
import { describe, expect, it } from 'vitest';
import type { Commit } from './commits.js';
import { groupByAuthor, isBotAuthor } from './identity.js';

/** A commit with defaults, for identity tests that ignore other fields. */
function commit(authorName: string, authorEmail: string, subject = 'work'): Commit {
  return {
    sha: 'abc',
    parents: [],
    authorName,
    authorEmail,
    authorDate: '2026-01-01T10:00:00Z',
    subject,
    files: [],
    isMerge: false,
  };
}

describe('groupByAuthor', () => {
  it('groups commits by lowercased email and keeps every commit', () => {
    const groups = groupByAuthor([
      commit('Alice', 'Alice@Example.com', 'upper'),
      commit('Alice', 'alice@example.com', 'lower'),
      commit('Bob', 'bob@example.com', 'bob'),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].email).toBe('alice@example.com');
    expect(groups[0].commits.map((item) => item.subject)).toEqual(['upper', 'lower']);
    expect(groups[1].email).toBe('bob@example.com');
    expect(groups[1].commits).toHaveLength(1);
  });

  it('returns an empty list for no commits', () => {
    expect(groupByAuthor([])).toEqual([]);
  });

  it('keeps distinct emails in separate groups (no merging)', () => {
    const groups = groupByAuthor([
      commit('Alice', 'alice@example.com'),
      commit('Alice', 'alice@work.com'),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.email)).toEqual(['alice@example.com', 'alice@work.com']);
  });

  it('merges emails mapping to the same name into one identity', () => {
    const groups = groupByAuthor(
      [
        commit('Alice', 'alice@example.com'),
        commit('Alice', 'alice@work.com'),
        commit('Alice', 'alice@example.com'),
      ],
      { 'alice@example.com': 'Alice Smith', 'alice@work.com': 'Alice Smith' },
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].email).toBe('alice@example.com');
    expect(groups[0].emails).toEqual(['alice@example.com', 'alice@work.com']);
    expect(groups[0].name).toBe('Alice Smith');
    expect(groups[0].commits).toHaveLength(3);
  });

  it('keeps emails mapping to different names in separate groups', () => {
    const groups = groupByAuthor(
      [commit('Alice', 'alice@example.com'), commit('Alice', 'alice@work.com')],
      { 'alice@example.com': 'Alice', 'alice@work.com': 'Bob' },
    );

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.name)).toEqual(['Alice', 'Bob']);
    expect(groups.map((group) => group.emails)).toEqual([
      ['alice@example.com'],
      ['alice@work.com'],
    ]);
  });

  it('sorts the merged email list while keeping the first-seen primary email', () => {
    const groups = groupByAuthor(
      [commit('Alice', 'alice@work.com'), commit('Alice', 'alice@example.com')],
      { 'alice@example.com': 'Alice', 'alice@work.com': 'Alice' },
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].email).toBe('alice@work.com');
    expect(groups[0].emails).toEqual(['alice@example.com', 'alice@work.com']);
  });

  it('keeps a mapped identity separate from an emailed author whose email is the mapped name', () => {
    // The mapped-name and emailed-author key spaces are disjoint: an
    // email mapped to the string "bob@example.com" must not merge with
    // the author bob@example.com.
    const groups = groupByAuthor(
      [commit('Alice', 'alice@example.com'), commit('Bob', 'bob@example.com')],
      { 'alice@example.com': 'bob@example.com' },
    );

    expect(groups).toHaveLength(2);
    expect(groups[0].name).toBe('bob@example.com');
    expect(groups[0].emails).toEqual(['alice@example.com']);
    expect(groups[1].name).toBe('Bob');
    expect(groups[1].emails).toEqual(['bob@example.com']);
  });

  it('treats mapped names case-sensitively, matching the compile layer', () => {
    // Mapped names are used verbatim as identity keys, so "Alice" and
    // "alice" stay separate identities — deliberate, matching how the
    // `compile` command merges through the same mapping table.
    const groups = groupByAuthor(
      [commit('Alice', 'alice@example.com'), commit('Alice', 'alice@work.com')],
      { 'alice@example.com': 'Alice', 'alice@work.com': 'alice' },
    );

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.emails)).toEqual([
      ['alice@example.com'],
      ['alice@work.com'],
    ]);
  });

  it('falls back to the most frequent name when a mapped name is blank', () => {
    // The loaders reject blank mapped names; this guards against a
    // directly-constructed map with an empty value.
    const groups = groupByAuthor(
      [commit('Alice', 'alice@example.com'), commit('Alice', 'alice@work.com')],
      { 'alice@example.com': '', 'alice@work.com': '' },
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].emails).toEqual(['alice@example.com', 'alice@work.com']);
    expect(groups[0].name).toBe('Alice');
  });

  it('backs off an inherited Object.prototype member as an email mapping', () => {
    // `toString` is not an own property of a plain `{}` map, so an
    // author email that happens to be such a name must not be read as a
    // mapped name or merged into a bogus identity.
    const groups = groupByAuthor(
      [commit('Alice', 'toString'), commit('Bob', 'bob@example.com')],
      {},
    );

    expect(groups).toHaveLength(2);
    expect(groups[0].email).toBe('tostring');
    expect(groups[0].name).toBe('Alice');
    expect(groups[1].email).toBe('bob@example.com');
  });

  it('picks the most frequent author name as the display name', () => {
    const groups = groupByAuthor([
      commit('Alice Smith', 'alice@example.com'),
      commit('Alice', 'alice@example.com'),
      commit('Alice', 'alice@example.com'),
    ]);
    expect(groups[0].name).toBe('Alice');
  });

  it('breaks name ties by first-seen order in the commit list', () => {
    const groups = groupByAuthor([
      commit('Alice', 'alice@example.com'),
      commit('Bob', 'alice@example.com'),
      commit('Alice', 'alice@example.com'),
      commit('Bob', 'alice@example.com'),
    ]);
    expect(groups[0].name).toBe('Alice');
  });

  it('flags bots but counts them like everyone else', () => {
    const groups = groupByAuthor([
      commit('dependabot[bot]', 'dependabot[bot]@users.noreply.github.com'),
      commit('Alice', 'alice@example.com'),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].isBot).toBe(true);
    expect(groups[0].commits).toHaveLength(1);
    expect(groups[1].isBot).toBe(false);
  });

  it('flags a group when any of its commits looks like a bot', () => {
    const groups = groupByAuthor([
      commit('Alice', 'alice@example.com'),
      commit('Alice', 'alice@example.com'),
      commit('Renovate[bot]', 'alice@example.com', 'bot work'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].isBot).toBe(true);
    expect(groups[0].commits).toHaveLength(3);
  });
});

describe('isBotAuthor', () => {
  it('detects the [bot] marker in the name or email', () => {
    expect(isBotAuthor('dependabot[bot]', 'dependabot@users.noreply.github.com')).toBe(true);
    expect(isBotAuthor('Alice', 'alice[bot]@example.com')).toBe(true);
    expect(isBotAuthor('github-actions[bot]', 'actions@github.com')).toBe(true);
  });

  it('detects the dependabot and renovate emails', () => {
    expect(isBotAuthor('Dependabot', 'dependabot@example.com')).toBe(true);
    expect(isBotAuthor('Renovate', 'renovate@example.com')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isBotAuthor('ALICE', 'ALICE@EXAMPLE.COM')).toBe(false);
    expect(isBotAuthor('Dependabot', 'DEPENDABOT@EXAMPLE.COM')).toBe(true);
  });

  it('does not flag regular authors', () => {
    expect(isBotAuthor('Alice', 'alice@example.com')).toBe(false);
    expect(isBotAuthor('Alice Smith', 'alice@example.com')).toBe(false);
  });
});
