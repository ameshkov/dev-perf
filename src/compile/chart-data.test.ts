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
                  activeDays: ['2026-01-02', '2026-01-05', '2026-01-10'],
                  languages: {
                    TypeScript: { linesAdded: 30, linesRemoved: 4, filesTouched: 4 },
                    Markdown: { linesAdded: 10, linesRemoved: 0, filesTouched: 2 },
                  },
                },
                llm: {
                  contributions: [
                    fixtureContribution({
                      title: 'A1',
                      size: 'l',
                      types: ['feature'],
                      complexity: 'high',
                    }),
                    fixtureContribution({
                      title: 'A2',
                      size: 'xs',
                      types: ['bugfix'],
                      complexity: 'low',
                      riskFlags: ['no-tests'],
                    }),
                    fixtureContribution({
                      title: 'A3',
                      size: 'm',
                      types: ['feature', 'test'],
                      // The duplicated signal counts once per contribution.
                      qualitySignals: ['tests-added', 'tests-added'],
                    }),
                  ],
                },
              },
              {
                name: 'Bob',
                emails: ['bob@example.com'],
                deterministic: {
                  commits: 2,
                  linesAdded: 20,
                  activeDays: ['2026-01-03', '2026-01-08'],
                },
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
                deterministic: {
                  commits: 3,
                  linesAdded: 15,
                  activeDays: ['2026-02-04'],
                },
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
    expect(data.team.map((point) => point.cumulativeContributions)).toEqual([3, 4]);
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
    // A3 carries `tests-added` twice, but a contribution counts once.
    expect(data.tallies.quality).toEqual([{ key: 'tests-added', value: 1 }]);
    expect(data.tallies.risk).toEqual([{ key: 'no-tests', value: 1 }]);
  });

  it('counts complexity levels per period', () => {
    const data = fixtureData();
    // January: A1 high, A2 low, A3 medium; February: A4 medium.
    expect(data.team.map((point) => point.complexity)).toEqual([
      { high: 1, low: 1, medium: 1 },
      { medium: 1 },
    ]);
  });

  it('counts work types per period, multi-type contributions in each', () => {
    const data = fixtureData();
    // January: A1 feature, A2 bugfix, A3 feature+test; February: A4 docs.
    expect(data.team.map((point) => point.workTypes)).toEqual([
      { feature: 2, bugfix: 1, test: 1 },
      { docs: 1 },
    ]);
    const alice = data.users.find((series) => series.user.name === 'Alice');
    expect(alice?.points.map((point) => point.workTypes)).toEqual([
      { feature: 2, bugfix: 1, test: 1 },
      { docs: 1 },
    ]);
  });

  it('tallies quality signals and risk flags per period', () => {
    const data = fixtureData();
    // A3 carries `tests-added` (January), A2 carries `no-tests` (January).
    expect(data.signals.quality).toEqual([[{ key: 'tests-added', value: 1 }], []]);
    expect(data.signals.risk).toEqual([[{ key: 'no-tests', value: 1 }], []]);
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
    const bob = data.users.find((series) => series.user.name === 'Bob');

    expect(alice?.points.map((point) => point.commits)).toEqual([4, 1]);
    expect(alice?.points.map((point) => point.cumulativeCommits)).toEqual([4, 5]);
    expect(alice?.points.map((point) => point.contributions)).toEqual([3, 1]);
    expect(alice?.points.map((point) => point.cumulativeContributions)).toEqual([3, 4]);
    expect(alice?.points[0].sizes).toMatchObject({ l: 1, xs: 1, m: 1, s: 0, xl: 0 });
    expect(alice?.points[0].complexity).toMatchObject({ high: 1, low: 1, medium: 1 });
    expect(alice?.points[1].complexity).toMatchObject({ medium: 1 });
    // Bob's cumulative lines run independently of Alice.
    expect(bob?.points.map((point) => point.cumulativeCommits)).toEqual([2, 5]);
    expect(bob?.points.map((point) => point.cumulativeContributions)).toEqual([0, 0]);
  });

  it('tallies per-user quality signals and risk flags per period', () => {
    const data = fixtureData();
    const alice = data.users.find((series) => series.user.name === 'Alice');
    const bob = data.users.find((series) => series.user.name === 'Bob');

    // A2 carries `no-tests` (January); A3 carries `tests-added` twice,
    // but a contribution counts once (January). February has A4 only.
    expect(alice?.signals.quality).toEqual([[{ key: 'tests-added', value: 1 }], []]);
    expect(alice?.signals.risk).toEqual([[{ key: 'no-tests', value: 1 }], []]);
    // Bob has no LLM contributions in either period.
    expect(bob?.signals.quality).toEqual([[], []]);
    expect(bob?.signals.risk).toEqual([[], []]);
  });

  it('counts the per-repository commits of each user', () => {
    const data = fixtureData();
    const alice = data.users.find((series) => series.user.name === 'Alice');
    const bob = data.users.find((series) => series.user.name === 'Bob');

    expect(alice?.repos).toEqual([{ repo: 'repo-a', commits: 5 }]);
    expect(bob?.repos).toEqual([{ repo: 'repo-a', commits: 5 }]);
  });

  it('computes totals, usage rows and the bus factor', () => {
    const data = fixtureData();

    expect(data.totals.commits).toBe(10);
    expect(data.totals.contributions).toBe(4);
    expect(data.totals.weightedPoints).toBe(17);
    expect(data.totals.netLines).toBe(70);
    expect(data.totals.activeUsers).toBe(2);
    expect(data.totals.inputTokens).toBe(200);
    expect(data.totals.cacheReadTokens).toBe(100);
    expect(data.totals.outputTokens).toBe(40);
    // Alice has 5 commits of 10 → 50% bus factor, single user.
    expect(data.busFactor).toEqual({ users: ['Alice'], commitShare: 0.5 });
    // Bob was skipped, so only Alice has a usage row; her usage is the
    // fixture default (100 in / 50 cached in / 20 out) per period.
    expect(data.usage).toEqual([
      {
        name: 'Alice',
        inputTokens: 200,
        cacheReadTokens: 100,
        outputTokens: 40,
      },
    ]);
  });

  it('summarizes repositories across periods', () => {
    const data = fixtureData();
    expect(data.repos).toHaveLength(1);
    expect(data.repos[0]).toMatchObject({ repo: 'repo-a', commits: 10, users: 2 });
    expect(data.repos[0].perPeriodCommits).toEqual([6, 4]);
    expect(data.repos[0].topLanguages[0]).toEqual({ language: 'TypeScript', linesAdded: 70 });
  });

  it('sorts repositories by contributions, not commits', () => {
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
                  deterministic: { commits: 10, linesAdded: 100 },
                },
              ],
            },
            {
              repo: 'repo-b',
              users: [
                {
                  name: 'Bob',
                  emails: ['bob@example.com'],
                  deterministic: { commits: 1, linesAdded: 10 },
                  llm: {
                    contributions: [
                      fixtureContribution({ title: 'B1' }),
                      fixtureContribution({ title: 'B2' }),
                      fixtureContribution({ title: 'B3' }),
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    const data = buildChartData(filterReport(report, { emailMap: {} }));

    // repo-b has fewer commits but more contributions, so it leads.
    expect(data.repos.map((repo) => [repo.repo, repo.commits, repo.contributions])).toEqual([
      ['repo-b', 1, 3],
      ['repo-a', 10, 1],
    ]);
  });
});
