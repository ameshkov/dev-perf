/**
 * Tests for author identity resolution (design §5.3): email grouping
 * with case folding, display-name selection by frequency, and the
 * heuristic bot flag that never filters (§5.4).
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

  it('flags bots but counts them like everyone else (§5.4)', () => {
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
