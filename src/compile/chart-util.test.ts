import { describe, expect, it } from 'vitest';
import { flagsPerContribution, signalShareRows, stackedRows, topWithOther } from './chart-util.js';

describe('topWithOther', () => {
  it('returns the rows unchanged when there are at most n of them', () => {
    const rows = [
      { key: 'tests-added', value: 3 },
      { key: 'docs-updated', value: 2 },
    ];
    expect(topWithOther(rows, 5)).toEqual(rows);
  });

  it('collapses everything beyond the top n into one other row', () => {
    const rows = [
      { key: 'tests-added', value: 5 },
      { key: 'docs-updated', value: 3 },
      { key: 'refactored', value: 2 },
      { key: 'reviewed', value: 1 },
    ];
    expect(topWithOther(rows, 3)).toEqual([
      { key: 'tests-added', value: 5 },
      { key: 'docs-updated', value: 3 },
      { key: 'refactored', value: 2 },
      { key: 'other', value: 1 },
    ]);
  });

  it('never emits an empty other bucket', () => {
    expect(topWithOther([{ key: 'only', value: 1 }], 1)).toEqual([{ key: 'only', value: 1 }]);
  });
});

describe('stackedRows', () => {
  it('zeroes missing keys so every segment keeps its place', () => {
    const rows = stackedRows(['Jan', 'Feb'], ['a', 'b'], (key, index) =>
      key === 'a' && index === 0 ? 1 : 0,
    );
    expect(rows).toEqual([
      { x: 'Jan', key: 'a', value: 1 },
      { x: 'Jan', key: 'b', value: 0 },
      { x: 'Feb', key: 'a', value: 0 },
      { x: 'Feb', key: 'b', value: 0 },
    ]);
  });
});

describe('flagsPerContribution', () => {
  it('zeroes when the period has no contributions', () => {
    expect(flagsPerContribution([{ key: 'no-tests', value: 1 }], 0)).toBe(0);
  });

  it('zeroes when the period has no flags', () => {
    expect(flagsPerContribution([], 3)).toBe(0);
  });

  it('averages the total flags over the contributions', () => {
    expect(
      flagsPerContribution(
        [
          { key: 'no-tests', value: 2 },
          { key: 'large-diff', value: 1 },
        ],
        4,
      ),
    ).toBe(0.75);
  });

  it('rounds to two decimals', () => {
    expect(flagsPerContribution([{ key: 'no-tests', value: 1 }], 3)).toBe(0.33);
  });
});

describe('signalShareRows', () => {
  it('normalizes each period to the share of its contributions', () => {
    const rows = signalShareRows(
      ['Jan', 'Feb'],
      ['no-tests', 'other'],
      [
        [
          { key: 'no-tests', value: 1 },
          { key: 'large-diff', value: 1 },
        ],
        [{ key: 'no-tests', value: 2 }],
      ],
      [2, 1],
    );
    // January: no-tests 1 of 2 contributions, the rest collapsed into
    // `other`; February: 2 of 1 → capped by the share formula at 200%
    // (a contribution may carry several flags).
    expect(rows).toEqual([
      { x: 'Jan', key: 'no-tests', value: 50 },
      { x: 'Jan', key: 'other', value: 50 },
      { x: 'Feb', key: 'no-tests', value: 200 },
      { x: 'Feb', key: 'other', value: 0 },
    ]);
  });

  it('zeroes periods without contributions', () => {
    const rows = signalShareRows(
      ['Jan', 'Feb'],
      ['no-tests'],
      [[{ key: 'no-tests', value: 1 }], []],
      [0, 3],
    );
    expect(rows).toEqual([
      { x: 'Jan', key: 'no-tests', value: 0 },
      { x: 'Feb', key: 'no-tests', value: 0 },
    ]);
  });
});
