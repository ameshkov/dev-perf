/**
 * Tests for the chart data extraction against the shared demo report:
 * two monthly periods, two repositories, two users with controlled
 * numbers, so every aggregate can be asserted exactly.
 */
import { describe, expect, it } from 'vitest';
import { buildDemoReport } from '../../test/report-builder.js';
import { buildChartData } from './index.js';

const data = buildChartData(buildDemoReport());

describe('parameters and periods', () => {
  it('maps the report parameters, including llmEnabled and model', () => {
    expect(data.parameters).toEqual({
      repos: [{ repo: 'git@github.com:acme/api.git' }, { repo: 'https://github.com/acme/web.git' }],
      since: '2026-01-01T00:00:00.000Z',
      until: '2026-02-28T23:59:59.999Z',
      unit: 'month',
      llmEnabled: true,
      model: 'test-model',
      generatedAt: '2026-03-01T00:00:00.000Z',
    });
  });

  it('labels the periods by their unit', () => {
    expect(data.periods.map((period) => period.label)).toEqual(['2026-01', '2026-02']);
    expect(data.periods[0].since).toBe('2026-01-01T00:00:00.000Z');
    expect(data.periods[1].until).toBe('2026-02-28T23:59:59.999Z');
  });
});

describe('team points', () => {
  it('sums each period with cumulative carry-over', () => {
    expect(data.team[0]).toEqual({
      commits: 13,
      cumulativeCommits: 13,
      linesAdded: 180,
      linesRemoved: 35,
      activeUsers: 2,
      contributions: 2,
      cumulativeContributions: 2,
      weightedPoints: 5,
      sizes: { xs: 0, s: 1, m: 1, l: 0, xl: 0 },
      complexity: { medium: 1, low: 1 },
      workTypes: { feature: 1, bugfix: 1, test: 1 },
      languages: { TypeScript: 100, Python: 50, CSS: 30 },
    });
    expect(data.team[1]).toEqual({
      commits: 10,
      cumulativeCommits: 23,
      linesAdded: 145,
      linesRemoved: 77,
      activeUsers: 2,
      contributions: 1,
      cumulativeContributions: 3,
      weightedPoints: 8,
      sizes: { xs: 0, s: 0, m: 0, l: 0, xl: 1 },
      complexity: { high: 1 },
      workTypes: { feature: 1, security: 1 },
      languages: { TypeScript: 40, Python: 70, CSS: 10, Go: 25 },
    });
  });
});

describe('pies and tallies', () => {
  it('counts work types once per occurrence, sorted by count then key', () => {
    expect(data.pies.workTypes).toEqual([
      { key: 'feature', value: 2 },
      { key: 'bugfix', value: 1 },
      { key: 'security', value: 1 },
      { key: 'test', value: 1 },
    ]);
  });

  it('counts sizes and complexity levels exactly', () => {
    expect(data.pies.sizes).toEqual([
      { key: 'm', value: 1 },
      { key: 's', value: 1 },
      { key: 'xl', value: 1 },
    ]);
    expect(data.pies.complexity).toEqual([
      { key: 'high', value: 1 },
      { key: 'low', value: 1 },
      { key: 'medium', value: 1 },
    ]);
  });

  it('tallies signals once per contribution carrying them', () => {
    expect(data.tallies.quality).toEqual([
      { key: 'tests-added', value: 2 },
      { key: 'docs-added', value: 1 },
      { key: 'security-hardened', value: 1 },
    ]);
    expect(data.tallies.risk).toEqual([
      { key: 'no-tests', value: 2 },
      { key: 'large-diff', value: 1 },
    ]);
  });

  it('aligns the per-period signal tallies with the periods', () => {
    expect(data.signals.quality).toEqual([
      [
        { key: 'tests-added', value: 2 },
        { key: 'docs-added', value: 1 },
      ],
      [{ key: 'security-hardened', value: 1 }],
    ]);
    expect(data.signals.risk).toEqual([
      [{ key: 'no-tests', value: 1 }],
      [
        { key: 'large-diff', value: 1 },
        { key: 'no-tests', value: 1 },
      ],
    ]);
  });
});

describe('languages, repos and users', () => {
  it('orders top languages by total lines added', () => {
    expect(data.topLanguages).toEqual(['TypeScript', 'Python', 'CSS', 'Go']);
  });

  it('summarizes repositories sorted by contributions', () => {
    expect(data.repos[0]).toEqual({
      repo: 'git@github.com:acme/api.git',
      commits: 17,
      users: 2,
      contributions: 2,
      points: 11,
      topLanguages: [
        { language: 'TypeScript', linesAdded: 140 },
        { language: 'Python', linesAdded: 120 },
      ],
      perPeriodCommits: [10, 7],
    });
    expect(data.repos[1]).toEqual({
      repo: 'https://github.com/acme/web.git',
      commits: 6,
      users: 2,
      contributions: 1,
      points: 2,
      topLanguages: [
        { language: 'CSS', linesAdded: 40 },
        { language: 'Go', linesAdded: 25 },
      ],
      perPeriodCommits: [3, 3],
    });
  });

  it('orders master users by contributions and aligns their per-period points', () => {
    expect(data.users.map((series) => series.user.name)).toEqual(['Alice Nguyen', 'Bob Fisher']);
    const [alice, bob] = data.users;
    expect(alice.points.map((point) => point.commits)).toEqual([9, 3]);
    expect(alice.points.map((point) => point.cumulativeCommits)).toEqual([9, 12]);
    expect(alice.points.map((point) => point.weightedPoints)).toEqual([5, 0]);
    expect(alice.periodLlm.map((llm) => llm.status)).toEqual(['completed', 'skipped']);
    expect(alice.repos).toEqual([
      { repo: 'git@github.com:acme/api.git', commits: 8 },
      { repo: 'https://github.com/acme/web.git', commits: 4 },
    ]);
    expect(bob.points.map((point) => point.commits)).toEqual([4, 7]);
    expect(bob.periodLlm.map((llm) => llm.status)).toEqual(['skipped', 'completed']);
    expect(bob.repos).toEqual([
      { repo: 'git@github.com:acme/api.git', commits: 9 },
      { repo: 'https://github.com/acme/web.git', commits: 2 },
    ]);
  });

  it('joins the per-period LLM overviews of a merged user', () => {
    const aliceJanuary = data.users[0].periodLlm[0];
    expect(aliceJanuary.status).toBe('completed');
    expect(aliceJanuary.overview).toBe('Shipped the payments API.');
    expect(aliceJanuary.contributions).toHaveLength(2);
  });
});

describe('totals and bus factor', () => {
  it('sums the team totals', () => {
    expect(data.totals).toEqual({
      commits: 23,
      contributions: 3,
      weightedPoints: 13,
      linesAdded: 325,
      linesRemoved: 112,
      netLines: 213,
      filesTouched: 11,
      activeUsers: 2,
    });
  });

  it('computes the bus factor from the master users', () => {
    expect(data.busFactor).toEqual({ users: ['Alice Nguyen'], commitShare: 12 / 23 });
  });
});

describe('a deterministic-only report', () => {
  const deterministic = buildChartData(buildDemoReport({ llmEnabled: false, model: undefined }));

  it('drops the model and carries llmEnabled false', () => {
    expect(deterministic.parameters.llmEnabled).toBe(false);
    expect('model' in deterministic.parameters).toBe(false);
  });

  it('leaves the LLM frames empty while the git metrics survive', () => {
    expect(deterministic.pies).toEqual({ workTypes: [], sizes: [], complexity: [] });
    expect(deterministic.tallies).toEqual({ quality: [], risk: [] });
    expect(deterministic.signals).toEqual({ quality: [[], []], risk: [[], []] });
    expect(deterministic.team.map((point) => point.contributions)).toEqual([0, 0]);
    expect(deterministic.totals.contributions).toBe(0);
    expect(deterministic.totals.commits).toBe(23);
    expect(deterministic.busFactor).toEqual({ users: ['Alice Nguyen'], commitShare: 12 / 23 });
  });
});
