/**
 * Tests for time-based period splitting: UTC-anchored period bounds
 * per unit (day/week/month/quarter/year), trimming of the first and
 * last periods, a boundary-midnight `until` closing the split at the
 * previous period, empty-period inclusion, fallbacks for
 * unbounded/inverted ranges, and per-period commit filtering that
 * preserves the master user list.
 */
import { describe, expect, it } from 'vitest';
import type { Commit } from '../deterministic/commits.js';
import { groupByAuthor } from '../deterministic/identity.js';
import type { AnalyzedRange } from '../report/index.js';
import { filterGroupsForPeriod, splitPeriods } from './periods.js';

/** One commit with defaults, for tests that override only what matters. */
function commit(overrides: Partial<Commit> = {}): Commit {
  return {
    sha: 'abc',
    parents: [],
    authorName: 'Alice',
    authorEmail: 'alice@example.com',
    authorDate: '2026-01-15T10:00:00Z',
    subject: 'work',
    files: [],
    isMerge: false,
    ...overrides,
  };
}

describe('splitPeriods', () => {
  it('splits a range into whole days, anchored at UTC midnight', () => {
    // An `until` exactly on a unit boundary (the start of Jan 3) ends
    // the split at the previous day: no zero-length boundary period.
    const periods = splitPeriods(
      { since: '2026-01-01T00:00:00.000Z', until: '2026-01-03T00:00:00.000Z' },
      'day',
    );

    expect(periods).toEqual([
      { since: '2026-01-01T00:00:00.000Z', until: '2026-01-01T23:59:59.999Z' },
      { since: '2026-01-02T00:00:00.000Z', until: '2026-01-02T23:59:59.999Z' },
    ]);
  });

  it('anchors weeks at Monday and trims the first and last periods to the range', () => {
    // 2026-01-14 is a Wednesday; the Monday of its week is 2026-01-12.
    const periods = splitPeriods(
      { since: '2026-01-14T00:00:00.000Z', until: '2026-01-25T23:59:59.000Z' },
      'week',
    );

    expect(periods).toEqual([
      { since: '2026-01-14T00:00:00.000Z', until: '2026-01-18T23:59:59.999Z' },
      { since: '2026-01-19T00:00:00.000Z', until: '2026-01-25T23:59:59.000Z' },
    ]);
  });

  it('splits a range into months anchored at the 1st, including empty periods', () => {
    const periods = splitPeriods(
      { since: '2026-01-15T00:00:00.000Z', until: '2026-03-20T23:59:59.000Z' },
      'month',
    );

    // February has no commits of its own in the fixture range, but the
    // period is still reported.
    expect(periods).toEqual([
      { since: '2026-01-15T00:00:00.000Z', until: '2026-01-31T23:59:59.999Z' },
      { since: '2026-02-01T00:00:00.000Z', until: '2026-02-28T23:59:59.999Z' },
      { since: '2026-03-01T00:00:00.000Z', until: '2026-03-20T23:59:59.000Z' },
    ]);
  });

  it('splits a range into quarters anchored at Jan/Apr/Jul/Oct', () => {
    // An `until` at the start of Q4 closes the split after Q3.
    const periods = splitPeriods(
      { since: '2026-01-01T00:00:00.000Z', until: '2026-10-01T00:00:00.000Z' },
      'quarter',
    );

    expect(periods).toEqual([
      { since: '2026-01-01T00:00:00.000Z', until: '2026-03-31T23:59:59.999Z' },
      { since: '2026-04-01T00:00:00.000Z', until: '2026-06-30T23:59:59.999Z' },
      { since: '2026-07-01T00:00:00.000Z', until: '2026-09-30T23:59:59.999Z' },
    ]);
  });

  it('splits a range into years anchored at January 1, trimming the last', () => {
    const periods = splitPeriods(
      { since: '2026-06-15T00:00:00.000Z', until: '2028-06-01T00:00:00.000Z' },
      'year',
    );

    expect(periods).toEqual([
      { since: '2026-06-15T00:00:00.000Z', until: '2026-12-31T23:59:59.999Z' },
      { since: '2027-01-01T00:00:00.000Z', until: '2027-12-31T23:59:59.999Z' },
      { since: '2028-01-01T00:00:00.000Z', until: '2028-06-01T00:00:00.000Z' },
    ]);
  });

  it('anchors a mid-unit since bound at midnight of the same unit boundary', () => {
    const periods = splitPeriods(
      { since: '2026-01-01T10:30:00.000Z', until: '2026-01-02T10:30:00.000Z' },
      'day',
    );

    expect(periods[0]).toEqual({
      since: '2026-01-01T10:30:00.000Z',
      until: '2026-01-01T23:59:59.999Z',
    });
    expect(periods[1]).toEqual({
      since: '2026-01-02T00:00:00.000Z',
      until: '2026-01-02T10:30:00.000Z',
    });
  });

  it('returns a single whole-range period without a unit', () => {
    const range: AnalyzedRange = {
      since: '2026-01-01T00:00:00.000Z',
      until: '2026-03-31T23:59:59.000Z',
    };

    expect(splitPeriods(range, undefined)).toEqual([range]);
  });

  it('falls back to a single whole-range period when until is before since', () => {
    const range: AnalyzedRange = {
      since: '2026-03-01T00:00:00.000Z',
      until: '2026-01-01T00:00:00.000Z',
    };

    expect(splitPeriods(range, 'month')).toEqual([range]);
  });

  it('falls back to a single whole-range period when a bound is unbounded', () => {
    const range: AnalyzedRange = { since: '', until: '2026-01-31T23:59:59.000Z' };

    expect(splitPeriods(range, 'month')).toEqual([range]);
  });

  it('yields a single zero-length period when since equals until', () => {
    const instant = '2026-01-15T00:00:00.000Z';

    expect(splitPeriods({ since: instant, until: instant }, 'day')).toEqual([
      { since: instant, until: instant },
    ]);
  });
});

describe('filterGroupsForPeriod', () => {
  /** Groups fixture: Alice (Jan, Feb, Mar), Bob (Jan only). */
  const groups = groupByAuthor([
    commit({ sha: 'a', authorEmail: 'alice@example.com', authorDate: '2026-03-05T10:00:00Z' }),
    commit({
      sha: 'b',
      authorEmail: 'bob@example.com',
      authorName: 'Bob',
      authorDate: '2026-01-20T10:00:00Z',
    }),
    commit({ sha: 'c', authorEmail: 'alice@example.com', authorDate: '2026-02-10T10:00:00Z' }),
    commit({ sha: 'd', authorEmail: 'alice@example.com', authorDate: '2026-01-15T10:00:00Z' }),
  ]);

  it("keeps only the period's commits and preserves the master group order", () => {
    const february: AnalyzedRange = {
      since: '2026-02-01T00:00:00.000Z',
      until: '2026-02-28T23:59:59.999Z',
    };

    const filtered = filterGroupsForPeriod(groups, february);

    expect(filtered.map((group) => group.email)).toEqual(['alice@example.com', 'bob@example.com']);
    expect(filtered[0].commits.map((c) => c.sha)).toEqual(['c']);
    // Bob has no commits in February; his group stays with an empty
    // commit list so the report shows him with zeroed metrics.
    expect(filtered[1].commits).toEqual([]);
  });

  it('does not mutate the master groups', () => {
    const january: AnalyzedRange = {
      since: '2026-01-01T00:00:00.000Z',
      until: '2026-01-31T23:59:59.999Z',
    };

    filterGroupsForPeriod(groups, january);

    expect(groups[0].commits).toHaveLength(3);
    expect(groups[1].commits).toHaveLength(1);
  });

  it('treats both bounds as inclusive at the period edges', () => {
    const january: AnalyzedRange = {
      since: '2026-01-01T00:00:00.000Z',
      until: '2026-01-31T23:59:59.999Z',
    };
    const edgeCommits = groupByAuthor([
      // Last second of January: inside the January period, outside February.
      commit({ sha: 'jan-last', authorDate: '2026-01-31T23:59:59Z' }),
      // First second of February: inside February, outside January.
      commit({ sha: 'feb-first', authorDate: '2026-02-01T00:00:00Z' }),
    ]);

    const januaryFiltered = filterGroupsForPeriod(edgeCommits, january);
    expect(januaryFiltered[0].commits.map((c) => c.sha)).toEqual(['jan-last']);

    const february: AnalyzedRange = {
      since: '2026-02-01T00:00:00.000Z',
      until: '2026-02-28T23:59:59.999Z',
    };
    const februaryFiltered = filterGroupsForPeriod(edgeCommits, february);
    expect(februaryFiltered[0].commits.map((c) => c.sha)).toEqual(['feb-first']);
  });

  it('keeps every commit for an unbounded period', () => {
    const filtered = filterGroupsForPeriod(groups, { since: '', until: '' });

    expect(filtered[0].commits).toHaveLength(3);
    expect(filtered[1].commits).toHaveLength(1);
  });
});
