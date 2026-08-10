/**
 * Tests for the aggregation helpers: categorical counting, weighted
 * points, the per-period team point, contribution collection, and the
 * bus factor.
 */
import { describe, expect, it } from 'vitest';
import {
  buildContribution,
  buildDeterministic,
  buildLlm,
  buildUser,
} from '../../test/report-builder.js';
import { countByKey, countContributionsByKey, weightedPointsOf } from './index.js';
import { allContributions, computeBusFactor, teamPoint } from './aggregate.js';

describe('countByKey', () => {
  it('counts every occurrence, sorted by count descending then key ascending', () => {
    const contributions = [
      buildContribution({ types: ['feature', 'test'] }),
      buildContribution({ types: ['feature'] }),
      buildContribution({ types: ['bugfix'] }),
      buildContribution({ types: [] }),
    ];
    expect(countByKey((contribution) => contribution.types, contributions)).toEqual([
      { key: 'feature', value: 2 },
      { key: 'bugfix', value: 1 },
      { key: 'test', value: 1 },
    ]);
  });

  it('counts duplicated values inside one contribution separately', () => {
    const contributions = [buildContribution({ qualitySignals: ['docs-added', 'docs-added'] })];
    expect(countByKey((contribution) => contribution.qualitySignals, contributions)).toEqual([
      { key: 'docs-added', value: 2 },
    ]);
  });
});

describe('countContributionsByKey', () => {
  it('counts each value once per contribution carrying it', () => {
    const contributions = [
      buildContribution({ qualitySignals: ['tests-added', 'tests-added'] }),
      buildContribution({ qualitySignals: ['tests-added'] }),
      buildContribution({ qualitySignals: ['docs-added'] }),
    ];
    expect(
      countContributionsByKey((contribution) => contribution.qualitySignals, contributions),
    ).toEqual([
      { key: 'tests-added', value: 2 },
      { key: 'docs-added', value: 1 },
    ]);
  });

  it('breaks ties by key ascending and handles empty input', () => {
    const contributions = [
      buildContribution({ riskFlags: ['todo-left-behind'] }),
      buildContribution({ riskFlags: ['large-diff'] }),
    ];
    expect(
      countContributionsByKey((contribution) => contribution.riskFlags, contributions),
    ).toEqual([
      { key: 'large-diff', value: 1 },
      { key: 'todo-left-behind', value: 1 },
    ]);
    expect(countContributionsByKey((contribution) => contribution.riskFlags, [])).toEqual([]);
  });
});

describe('weightedPointsOf', () => {
  it('weights sizes xs=1 s=2 m=3 l=5 xl=8, scaled by the medium complexity multiplier (1.5)', () => {
    const contributions = (['xs', 's', 'm', 'l', 'xl'] as const).map((size) =>
      buildContribution({ size }),
    );
    // 19 size points × medium complexity 1.5.
    expect(weightedPointsOf(contributions)).toBe(28.5);
  });

  it('returns zero for no contributions', () => {
    expect(weightedPointsOf([])).toBe(0);
  });
});

describe('allContributions', () => {
  it('concatenates the contributions of all users in order', () => {
    const first = buildContribution({ title: 'First' });
    const second = buildContribution({ title: 'Second' });
    const third = buildContribution({ title: 'Third' });
    const users = [
      buildUser({ llm: buildLlm({ contributions: [first, second] }) }),
      buildUser({ llm: buildLlm({ contributions: [third] }) }),
      buildUser(),
    ];
    expect(allContributions(users)).toEqual([first, second, third]);
  });
});

describe('teamPoint', () => {
  it('sums per-period metrics and carries the cumulative counters over', () => {
    const active = buildUser({
      name: 'Active',
      deterministic: buildDeterministic({
        commits: 5,
        linesAdded: 100,
        linesRemoved: 30,
        netLines: 70,
        languages: {
          TypeScript: { linesAdded: 80, linesRemoved: 30, filesTouched: 2 },
          Go: { linesAdded: 20, linesRemoved: 0, filesTouched: 1 },
        },
      }),
      llm: buildLlm({
        status: 'completed',
        contributions: [
          buildContribution({ size: 'l', types: ['feature'] }),
          buildContribution({ size: 's', types: ['feature', 'test'] }),
        ],
      }),
    });
    const idle = buildUser({
      name: 'Idle',
      deterministic: buildDeterministic({
        commits: 0,
        nonMergeCommits: 0,
        linesAdded: 0,
        linesRemoved: 0,
        netLines: 0,
        filesTouched: 0,
        uniqueFilesTouched: 0,
        activeDays: [],
        languages: {},
      }),
    });

    expect(teamPoint([active, idle], { commits: 9, contributions: 3 })).toEqual({
      commits: 5,
      cumulativeCommits: 14,
      linesAdded: 100,
      linesRemoved: 30,
      activeUsers: 1,
      contributions: 2,
      cumulativeContributions: 5,
      weightedPoints: 10.5,
      sizes: { xs: 0, s: 1, m: 0, l: 1, xl: 0 },
      complexity: { medium: 2 },
      workTypes: { feature: 2, test: 1 },
      languages: { TypeScript: 80, Go: 20 },
    });
  });
});

describe('computeBusFactor', () => {
  it('picks the fewest users covering at least half of the commits', () => {
    const users = [
      buildUser({ name: 'Top', deterministic: buildDeterministic({ commits: 10 }) }),
      buildUser({ name: 'Mid', deterministic: buildDeterministic({ commits: 5 }) }),
      buildUser({ name: 'Low', deterministic: buildDeterministic({ commits: 5 }) }),
    ];
    expect(computeBusFactor(users)).toEqual({ users: ['Top'], commitShare: 0.5 });
  });

  it('keeps adding users while the covered half is not reached', () => {
    const users = [
      buildUser({ name: 'Second', deterministic: buildDeterministic({ commits: 4 }) }),
      buildUser({ name: 'First', deterministic: buildDeterministic({ commits: 4 }) }),
      buildUser({ name: 'Third', deterministic: buildDeterministic({ commits: 2 }) }),
    ];
    expect(computeBusFactor(users)).toEqual({
      users: ['Second', 'First'],
      commitShare: 0.8,
    });
  });

  it('keeps the input order for tied commit counts', () => {
    const users = [
      buildUser({ name: 'Bravo', deterministic: buildDeterministic({ commits: 6 }) }),
      buildUser({ name: 'Alpha', deterministic: buildDeterministic({ commits: 6 }) }),
      buildUser({ name: 'Rest', deterministic: buildDeterministic({ commits: 1 }) }),
    ];
    expect(computeBusFactor(users)?.users).toEqual(['Bravo', 'Alpha']);
  });

  it('returns undefined when there are no commits', () => {
    expect(
      computeBusFactor([buildUser({ deterministic: buildDeterministic({ commits: 0 }) })]),
    ).toBeUndefined();
    expect(computeBusFactor([])).toBeUndefined();
  });
});
