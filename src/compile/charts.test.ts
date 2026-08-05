import { describe, expect, it } from 'vitest';
import { buildTrendReport, fixtureContribution } from '../../test/fixtures/trend-report-builder.js';
import { buildChartData } from './chart-data.js';
import { buildChartAssets } from './charts.js';
import { filterReport } from './filter.js';

/** A two-period, one-user fixture report with LLM analysis. */
function llmReport() {
  return buildTrendReport({
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
                llm: {
                  contributions: [
                    fixtureContribution({ title: 'A1', size: 'l', complexity: 'high' }),
                    fixtureContribution({
                      title: 'A2',
                      size: 'xs',
                      complexity: 'low',
                      riskFlags: ['no-tests'],
                    }),
                  ],
                },
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
                llm: {
                  contributions: [
                    fixtureContribution({
                      title: 'A3',
                      size: 'm',
                      complexity: 'medium',
                      riskFlags: ['no-tests', 'large-diff'],
                      qualitySignals: ['tests-added'],
                    }),
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  });
}

/** The data rows of a chart spec. */
function specRows(spec: object): Array<{ x: string; key: string; value: number }> {
  const data = (spec as { data?: { values?: Array<{ x: string; key: string; value: number }> } })
    .data;
  return data?.values ?? [];
}

/** The mark type of a chart spec, `undefined` for a missing spec. */
function specMark(spec: object | undefined): unknown {
  return (spec as { mark?: unknown } | undefined)?.mark;
}

describe('buildChartAssets', () => {
  it('builds the per-user contributions-per-period chart stacked by complexity', () => {
    const data = buildChartData(filterReport(llmReport(), { emailMap: {} }));
    const assets = buildChartAssets(data);

    const asset = assets.find(
      (chart) => chart.file === 'alice-contributions-by-complexity-per-period.svg',
    );
    expect(asset?.caption).toBe('Contributions per period, stacked by complexity (low–high).');
    // January: A1 high, A2 low; February: A3 medium — the zeroed
    // segments keep every complexity level in place.
    expect(specRows(asset?.spec ?? {})).toEqual([
      { x: '2026-01', key: 'low', value: 1 },
      { x: '2026-01', key: 'medium', value: 0 },
      { x: '2026-01', key: 'high', value: 1 },
      { x: '2026-02', key: 'low', value: 0 },
      { x: '2026-02', key: 'medium', value: 1 },
      { x: '2026-02', key: 'high', value: 0 },
    ]);
  });

  it('builds the per-user risk-flag charts from the user own tallies', () => {
    const data = buildChartData(filterReport(llmReport(), { emailMap: {} }));
    const assets = buildChartAssets(data);

    // Alice's whole-report tallies: no-tests 2, large-diff 1 — both
    // top-5, so the chart has no `other` series.
    const share = assets.find((chart) => chart.file === 'alice-risk-per-period.svg');
    expect(share?.caption).toBe(
      'Risk flags per period — share of contributions (top 5 flags plus other).',
    );
    // January: 1 of 2 contributions carries no-tests → 50%;
    // February: 1 contribution carries both flags → 100% each.
    expect(specRows(share?.spec ?? {})).toEqual([
      { x: '2026-01', key: 'no-tests', value: 50 },
      { x: '2026-01', key: 'large-diff', value: 0 },
      { x: '2026-02', key: 'no-tests', value: 100 },
      { x: '2026-02', key: 'large-diff', value: 100 },
    ]);

    const rate = assets.find((chart) => chart.file === 'alice-risk-per-contribution.svg');
    expect(rate?.caption).toBe('Average risk flags per contribution per period.');
    // The average is a single value per period, so the chart is a bar
    // chart, not a line chart.
    expect(specMark(rate?.spec)).toBe('bar');
    // January: 1 flag over 2 contributions; February: 2 over 1.
    expect(specRows(rate?.spec ?? {})).toEqual([
      { x: '2026-01', key: '2026-01', value: 0.5 },
      { x: '2026-02', key: '2026-02', value: 2 },
    ]);
  });

  it('builds the team signal-rate charts as bar charts', () => {
    const data = buildChartData(filterReport(llmReport(), { emailMap: {} }));
    const assets = buildChartAssets(data);

    const risk = assets.find((chart) => chart.file === 'team-risk-flags-per-contribution.svg');
    expect(risk?.caption).toBe('Average risk flags per contribution per period.');
    expect(specMark(risk?.spec)).toBe('bar');
    // January: 1 flag over 2 contributions; February: 2 over 1.
    expect(specRows(risk?.spec ?? {})).toEqual([
      { x: '2026-01', key: '2026-01', value: 0.5 },
      { x: '2026-02', key: '2026-02', value: 2 },
    ]);

    const quality = assets.find(
      (chart) => chart.file === 'team-quality-signals-per-contribution.svg',
    );
    expect(quality?.caption).toBe('Average quality signals per contribution per period.');
    expect(specMark(quality?.spec)).toBe('bar');
    // January: no quality signals; February: A3 carries tests-added.
    expect(specRows(quality?.spec ?? {})).toEqual([
      { x: '2026-01', key: '2026-01', value: 0 },
      { x: '2026-02', key: '2026-02', value: 1 },
    ]);
  });

  it('builds the team contributions chart with the cumulative line before the commits chart', () => {
    const data = buildChartData(filterReport(llmReport(), { emailMap: {} }));
    const assets = buildChartAssets(data);

    const asset = assets.find((chart) => chart.file === 'team-contributions-per-period.svg');
    expect(asset?.caption).toBe(
      'Contributions per period (bars) and cumulative contributions (line).',
    );
    // January: A1, A2; February: A3 — the cumulative line runs across
    // the periods, like the cumulative commits line.
    expect(specRows(asset?.spec ?? {})).toEqual([
      { x: '2026-01', key: 'bars', value: 2 },
      { x: '2026-01', key: 'lines', value: 2 },
      { x: '2026-02', key: 'bars', value: 1 },
      { x: '2026-02', key: 'lines', value: 3 },
    ]);
    const files = assets.map((chart) => chart.file);
    expect(files.indexOf('team-contributions-per-period.svg')).toBeLessThan(
      files.indexOf('team-commits-per-period.svg'),
    );
  });

  it('builds the per-user contributions chart with the cumulative line', () => {
    const data = buildChartData(filterReport(llmReport(), { emailMap: {} }));
    const assets = buildChartAssets(data);

    const asset = assets.find(
      (chart) => chart.file === 'alice-contributions-and-cumulative-per-period.svg',
    );
    expect(asset?.caption).toBe(
      'Contributions per period (bars) and cumulative contributions (line).',
    );
    // Alice: A1 and A2 in January, A3 in February.
    expect(specRows(asset?.spec ?? {})).toEqual([
      { x: '2026-01', key: 'bars', value: 2 },
      { x: '2026-01', key: 'lines', value: 2 },
      { x: '2026-02', key: 'bars', value: 1 },
      { x: '2026-02', key: 'lines', value: 3 },
    ]);
  });

  it('builds the team points chart before the stacked contributions chart', () => {
    const data = buildChartData(filterReport(llmReport(), { emailMap: {} }));
    const assets = buildChartAssets(data);

    const asset = assets.find((chart) => chart.file === 'team-points-per-period.svg');
    expect(asset?.caption).toBe('Points per period (size-weighted).');
    // January: A1 l (5) + A2 xs (1); February: A3 m (3).
    expect(specRows(asset?.spec ?? {})).toEqual([
      { x: '2026-01', key: '2026-01', value: 6 },
      { x: '2026-02', key: '2026-02', value: 3 },
    ]);
    const files = assets.map((chart) => chart.file);
    expect(files.indexOf('team-points-per-period.svg')).toBeLessThan(
      files.indexOf('team-contributions-by-size.svg'),
    );
  });

  it('builds the per-user points chart', () => {
    const data = buildChartData(filterReport(llmReport(), { emailMap: {} }));
    const assets = buildChartAssets(data);

    const asset = assets.find((chart) => chart.file === 'alice-points-per-period.svg');
    expect(asset?.caption).toBe('Points per period (size-weighted).');
    // Alice: A1 l (5) and A2 xs (1) in January, A3 m (3) in February.
    expect(specRows(asset?.spec ?? {})).toEqual([
      { x: '2026-01', key: '2026-01', value: 6 },
      { x: '2026-02', key: '2026-02', value: 3 },
    ]);
  });

  it('builds the stacked team work-type chart in the whole-report order', () => {
    const data = buildChartData(
      filterReport(
        buildTrendReport({
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
                      llm: {
                        contributions: [
                          fixtureContribution({ title: 'A1', types: ['feature', 'test'] }),
                          fixtureContribution({ title: 'A2', types: ['bugfix'] }),
                        ],
                      },
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
                      llm: {
                        contributions: [fixtureContribution({ title: 'A3', types: ['docs'] })],
                      },
                    },
                  ],
                },
              ],
            },
          ],
        }),
        { emailMap: {} },
      ),
    );
    const assets = buildChartAssets(data);

    const asset = assets.find((chart) => chart.file === 'team-work-types-per-period.svg');
    expect(asset?.caption).toBe(
      'Contributions per period, stacked by work type (a contribution may mix types).',
    );
    // All types occur once across the report, so the segment order is
    // alphabetical; A1 mixes feature and test, counting in both.
    expect(specRows(asset?.spec ?? {})).toEqual([
      { x: '2026-01', key: 'bugfix', value: 1 },
      { x: '2026-01', key: 'docs', value: 0 },
      { x: '2026-01', key: 'feature', value: 1 },
      { x: '2026-01', key: 'test', value: 1 },
      { x: '2026-02', key: 'bugfix', value: 0 },
      { x: '2026-02', key: 'docs', value: 1 },
      { x: '2026-02', key: 'feature', value: 0 },
      { x: '2026-02', key: 'test', value: 0 },
    ]);
  });

  it('builds the per-user work-type charts from the user own tallies', () => {
    const data = buildChartData(
      filterReport(
        buildTrendReport({
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
                      llm: {
                        contributions: [
                          fixtureContribution({ title: 'A1', types: ['feature', 'test'] }),
                          fixtureContribution({ title: 'A2', types: ['bugfix'] }),
                        ],
                      },
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
                      llm: {
                        contributions: [fixtureContribution({ title: 'A3', types: ['docs'] })],
                      },
                    },
                  ],
                },
              ],
            },
          ],
        }),
        { emailMap: {} },
      ),
    );
    const assets = buildChartAssets(data);

    // Alice's own order (bugfix, docs, feature, test — one of each),
    // so January shows a zeroed docs segment and February only docs.
    const stacked = assets.find((chart) => chart.file === 'alice-work-types-per-period.svg');
    expect(stacked?.caption).toBe(
      'Contributions per period, stacked by work type (a contribution may mix types).',
    );
    expect(specRows(stacked?.spec ?? {})).toEqual([
      { x: '2026-01', key: 'bugfix', value: 1 },
      { x: '2026-01', key: 'docs', value: 0 },
      { x: '2026-01', key: 'feature', value: 1 },
      { x: '2026-01', key: 'test', value: 1 },
      { x: '2026-02', key: 'bugfix', value: 0 },
      { x: '2026-02', key: 'docs', value: 1 },
      { x: '2026-02', key: 'feature', value: 0 },
      { x: '2026-02', key: 'test', value: 0 },
    ]);

    const pie = assets.find((chart) => chart.file === 'alice-work-types.svg');
    expect(pie?.caption).toBe(
      'Share of contributions by work type (a contribution may mix types).',
    );
    expect(specRows(pie?.spec ?? {})).toEqual([
      { x: 'bugfix', key: 'bugfix', value: 1 },
      { x: 'docs', key: 'docs', value: 1 },
      { x: 'feature', key: 'feature', value: 1 },
      { x: 'test', key: 'test', value: 1 },
    ]);
  });

  it('uses short repo labels in the per-repository comparison legend', () => {
    const report = buildTrendReport({
      periods: [
        {
          since: '2026-01-01T00:00:00.000Z',
          until: '2026-01-31T23:59:59.999Z',
          repositories: [
            {
              repo: 'git@github.com:acme/app.git',
              users: [{ name: 'Alice', emails: ['alice@example.com'] }],
            },
            {
              repo: 'https://gitlab.com/team/tools.git',
              users: [{ name: 'Bob', emails: ['bob@example.com'] }],
            },
          ],
        },
        {
          since: '2026-02-01T00:00:00.000Z',
          until: '2026-02-28T23:59:59.999Z',
          repositories: [
            {
              repo: 'git@github.com:acme/app.git',
              users: [{ name: 'Alice', emails: ['alice@example.com'] }],
            },
            {
              repo: 'https://gitlab.com/team/tools.git',
              users: [{ name: 'Bob', emails: ['bob@example.com'] }],
            },
          ],
        },
      ],
    });
    const data = buildChartData(filterReport(report, { emailMap: {} }));
    const assets = buildChartAssets(data);

    const asset = assets.find((chart) => chart.file === 'repos-commits-per-period.svg');
    expect(asset).toBeDefined();
    const spec = JSON.parse(JSON.stringify(asset?.spec)) as {
      encoding?: { color?: { scale?: { domain?: string[] } } };
      data?: { values?: Array<{ key: string }> };
    };
    // The legend domain and the series keys carry just the repository
    // names, never the host/org or the raw URLs.
    expect(spec.encoding?.color?.scale?.domain).toEqual(['app', 'tools']);
    expect([...new Set(spec.data?.values?.map((row) => row.key))]).toEqual(['app', 'tools']);
    expect(JSON.stringify(spec)).not.toContain('github.com');
    expect(JSON.stringify(spec)).not.toContain('gitlab.com');
    expect(JSON.stringify(spec)).not.toContain('git@github.com');
    expect(JSON.stringify(spec)).not.toContain('https://gitlab.com');
  });
});
