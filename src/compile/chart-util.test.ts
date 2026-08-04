import { describe, expect, it } from 'vitest';
import { stackedRows, topWithOther } from './chart-util.js';

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
