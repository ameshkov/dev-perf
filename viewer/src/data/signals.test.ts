/**
 * Tests for the per-period signal series: share-of-contributions
 * values and the per-contribution flag rate.
 */
import { describe, expect, it } from 'vitest';
import type { CountRow } from './index.js';
import { flagsPerContribution, signalShareValues } from './index.js';

describe('signalShareValues', () => {
  const labels = ['P1', 'P2', 'P3'];
  const tallies: CountRow[][] = [
    [
      { key: 'tests-added', value: 2 },
      { key: 'docs-added', value: 1 },
    ],
    [{ key: 'security-hardened', value: 1 }],
    [],
  ];

  it("returns the share of each period's contributions carrying each key", () => {
    expect(signalShareValues(labels, ['tests-added', 'docs-added'], tallies, [2, 1, 0])).toEqual([
      { key: 'tests-added', values: [100, 0, 0] },
      { key: 'docs-added', values: [50, 0, 0] },
    ]);
  });

  it('zeroes periods without contributions and keys without tallies', () => {
    expect(signalShareValues(labels, ['no-tests'], tallies, [2, 1, 0])).toEqual([
      { key: 'no-tests', values: [0, 0, 0] },
    ]);
  });
});

describe('flagsPerContribution', () => {
  it('divides the total flags by the contributions, rounded to two decimals', () => {
    const rows: CountRow[] = [
      { key: 'no-tests', value: 2 },
      { key: 'large-diff', value: 1 },
    ];
    expect(flagsPerContribution(rows, 2)).toBe(1.5);
    expect(
      flagsPerContribution(
        [
          { key: 'a', value: 1 },
          { key: 'b', value: 2 },
        ],
        4,
      ),
    ).toBe(0.75);
  });

  it('returns zero when the period has no contributions', () => {
    expect(flagsPerContribution([{ key: 'no-tests', value: 3 }], 0)).toBe(0);
  });
});
