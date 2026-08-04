import { describe, expect, it } from 'vitest';
import { buildTrendReport, fixtureContribution } from '../../test/fixtures/trend-report-builder.js';
import { buildChartData } from './chart-data.js';
import { filterReport } from './filter.js';

/** A two-period report: Alice with LLM contributions, Bob deterministic. */
function fixtureData() {
  const report = buildTrendReport({
    periods: [
      {
        since: '2026-01-01T00:00:00.000Z',
        until: '2026-01-31T23:59:59.999Z',
        repositories: [
          {
            repo: 'repo-a',
            users: [
              {
                name: 'Alice',
                emails: ['alice@example.com'],
                deterministic: {
                  commits: 4,
                  linesAdded: 40,
                  linesRemoved: 4,
                  filesTouched: 6,
                  activeDays: 3,
                  languages: {
                    TypeScript: { linesAdded: 30, linesRemoved: 4, filesTouched: 4 },
                    Markdown: { linesAdded: 10, linesRemoved: 0, filesTouched: 2 },
                  },
                },
                llm: {
                  contributions: [
                    fixtureContribution({ title: 'A1', size: 'l', types: ['feature'] }),
                    fixtureContribution({
                      title: 'A2',
                      size: 'xs',
                      types: ['bugfix'],
                      riskFlags: ['no-tests'],
                    }),
                    fixtureContribution({
                      title: 'A3',
                      size: 'm',
                      types: ['feature', 'test'],
                      qualitySignals: ['tests-added'],
                    }),
                  ],
                },
              },
              {
                name: 'Bob',
                emails: ['bob@example.com'],
                deterministic: { commits: 2, linesAdded: 20, activeDays: 2 },
                llm: { status: 'skipped', contributions: [] },
              },
            ],
          },
        ],
      },
      {
        since: '2026-02-01T00:00:00.000Z',
        until: '2026-02-28T23:59:59.999Z',
        repositories: [
          {
            repo: 'repo-a',
            users: [
              {
                name: 'Alice',
                emails: ['alice@example.com'],
                deterministic: { commits: 1, linesAdded: 5 },
                llm: {
                  contributions: [
                    fixtureContribution({ title: 'A4', size: 'xl', types: ['docs'] }),
                  ],
                },
              },
              {
                name: 'Bob',
                emails: ['bob@example.com'],
                deterministic: { commits: 3, linesAdded: 15, activeDays: 1 },
                llm: { status: 'skipped', contributions: [] },
              },
            ],
          },
        ],
      },
    ],
  });
  return buildChartData(filterReport(report, { emailMap: {} }));
}

describe('buildChartData', () => {
  it('extracts period labels and team series', () => {
    const data = fixtureData();

    expect(data.periods.map((period) => period.label)).toEqual(['2026-01', '2026-02']);
    expect(data.team.map((point) => point.commits)).toEqual([6, 4]);
    expect(data.team.map((point) => point.cumulativeCommits)).toEqual([6, 10]);
    expect(data.team.map((point) => point.activeUsers)).toEqual([2, 2]);
    expect(data.team.map((point) => point.linesAdded)).toEqual([60, 20]);
    // Alice: 3 contributions in January, 1 in February.
    expect(data.team.map((point) => point.contributions)).toEqual([3, 1]);
    // l=5, xs=1, m=3 → 9; xl=8 → 8.
    expect(data.team.map((point) => point.weightedPoints)).toEqual([9, 8]);
  });

  it('counts contributions per size across the range', () => {
    const data = fixtureData();
    expect(data.pies.sizes).toEqual([
      { key: 'l', value: 1 },
      { key: 'm', value: 1 },
      { key: 'xl', value: 1 },
      { key: 'xs', value: 1 },
    ]);
  });

  it('counts multi-type contributions in each work type', () => {
    const data = fixtureData();
    expect(data.pies.workTypes).toEqual([
      { key: 'feature', value: 2 },
      { key: 'bugfix', value: 1 },
      { key: 'docs', value: 1 },
      { key: 'test', value: 1 },
    ]);
  });

  it('tallies quality signals and risk flags separately', () => {
    const data = fixtureData();
    expect(data.tallies.quality).toEqual([{ key: 'tests-added', value: 1 }]);
    expect(data.tallies.risk).toEqual([{ key: 'no-tests', value: 1 }]);
  });

  it('ranks the top languages by total lines added', () => {
    const data = fixtureData();
    expect(data.topLanguages).toEqual(['TypeScript', 'Markdown']);
    // January: Alice TS 30 + Markdown 10, Bob TS 20 (synced with his lines).
    expect(data.team[0].languages).toEqual({ TypeScript: 50, Markdown: 10 });
    // February: Alice TS 5, Bob TS 15 (both synced with their lines).
    expect(data.team[1].languages).toEqual({ TypeScript: 20 });
  });

  it('computes per-user series aligned with the periods', () => {
    const data = fixtureData();
    const alice = data.users.find((series) => series.user.name === 'Alice');

    expect(alice?.points.map((point) => point.commits)).toEqual([4, 1]);
    expect(alice?.points.map((point) => point.contributions)).toEqual([3, 1]);
    expect(alice?.points[0].sizes).toMatchObject({ l: 1, xs: 1, m: 1, s: 0, xl: 0 });
  });

  it('computes totals, cost rows and the bus factor', () => {
    const data = fixtureData();

    expect(data.totals.commits).toBe(10);
    expect(data.totals.contributions).toBe(4);
    expect(data.totals.weightedPoints).toBe(17);
    expect(data.totals.netLines).toBe(70);
    expect(data.totals.activeUsers).toBe(2);
    expect(data.totals.costUsd).toBeCloseTo(0.02);
    // Alice has 5 commits of 10 → 50% bus factor, single user.
    expect(data.busFactor).toEqual({ users: ['Alice'], commitShare: 0.5 });
    // Bob was skipped, so only Alice has LLM cost.
    expect(data.cost.map((row) => row.name)).toEqual(['Alice']);
  });

  it('summarizes repositories across periods', () => {
    const data = fixtureData();
    expect(data.repos).toHaveLength(1);
    expect(data.repos[0]).toMatchObject({ repo: 'repo-a', commits: 10, users: 2 });
    expect(data.repos[0].perPeriodCommits).toEqual([6, 4]);
    expect(data.repos[0].topLanguages[0]).toEqual({ language: 'TypeScript', linesAdded: 70 });
  });
});
