import { describe, expect, it } from 'vitest';
import { buildTrendReport, fixtureContribution } from '../../test/fixtures/trend-report-builder.js';
import { combinePeriodUsers, filterReport, mappedName, mergeUsers } from './filter.js';
import type { FilterOptions } from './filter.js';

/** A two-period fixture report with two users and two repositories. */
function fixtureReport() {
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
                    fixtureContribution({ title: 'A1', size: 'l' }),
                    fixtureContribution({ title: 'A2', size: 'xs' }),
                  ],
                  tokenUsage: { input: 50, cacheRead: 20, output: 10 },
                  estimatedCostUsd: 0.005,
                },
              },
              {
                name: 'Bob',
                emails: ['bob@example.com'],
                deterministic: { commits: 2, linesAdded: 20, activeDays: 2 },
              },
            ],
          },
          {
            repo: 'repo-b',
            users: [
              {
                name: 'Alice',
                emails: ['alice@example.com'],
                deterministic: { commits: 1, linesAdded: 5 },
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
                deterministic: { commits: 0, linesAdded: 0, activeDays: 0 },
                llm: { status: 'skipped', contributions: [] },
              },
              {
                name: 'Bob',
                emails: ['bob@example.com'],
                deterministic: { commits: 3, linesAdded: 15, activeDays: 1 },
              },
            ],
          },
          {
            repo: 'repo-b',
            users: [
              {
                name: 'Alice',
                emails: ['alice@example.com'],
                deterministic: { commits: 0, linesAdded: 0 },
                llm: { status: 'skipped', contributions: [] },
              },
            ],
          },
        ],
      },
    ],
  });
}

/** The default filter options: no selection, no mappings. */
function noFilters(): FilterOptions {
  return { emailMap: {} };
}

describe('mappedName', () => {
  it('maps the first mapped email and falls back to the report name', () => {
    const user = fixtureReport().periods[0].repositories[0].users[0];
    const map = { 'alice@example.com': 'Alice Smith' };
    expect(mappedName(user, map)).toBe('Alice Smith');
    expect(mappedName(user, {})).toBe('Alice');
  });
});

describe('mergeUsers', () => {
  it('sums metrics, merges languages and concatenates contributions', () => {
    const a = buildTrendReport({
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
                    activeDays: 3,
                    languages: { TypeScript: { linesAdded: 40, linesRemoved: 4, filesTouched: 4 } },
                  },
                  llm: { contributions: [fixtureContribution({ title: 'A1' })] },
                },
              ],
            },
          ],
        },
      ],
    });
    const b = buildTrendReport({
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
                    commits: 2,
                    linesAdded: 10,
                    linesRemoved: 1,
                    activeDays: 4,
                    languages: { TypeScript: { linesAdded: 10, linesRemoved: 1, filesTouched: 2 } },
                  },
                  llm: { contributions: [fixtureContribution({ title: 'A2' })] },
                },
              ],
            },
          ],
        },
      ],
    });
    const merged = mergeUsers(
      [a.periods[0].repositories[0].users[0], b.periods[0].repositories[0].users[0]],
      'Alice',
    );

    expect(merged.deterministic.commits).toBe(6);
    expect(merged.deterministic.linesAdded).toBe(50);
    expect(merged.deterministic.linesRemoved).toBe(5);
    expect(merged.deterministic.activeDays).toBe(4);
    expect(merged.deterministic.languages.TypeScript.linesAdded).toBe(50);
    expect(merged.llm.contributions.map((contribution) => contribution.title)).toEqual([
      'A1',
      'A2',
    ]);
    expect(merged.llm.tokenUsage).toEqual({ input: 200, cacheRead: 100, output: 40 });
    expect(merged.llm.estimatedCostUsd).toBeCloseTo(0.02);
    expect(merged.emails).toEqual(['alice@example.com']);
  });

  it('recomputes avgCommitSize and spans the commit timestamps', () => {
    const a = buildTrendReport({
      periods: [
        {
          since: '2026-01-05T00:00:00.000Z',
          until: '2026-01-31T23:59:59.999Z',
          repositories: [
            {
              repo: 'repo-a',
              users: [
                {
                  name: 'Alice',
                  emails: ['alice@example.com'],
                  deterministic: {
                    commits: 1,
                    nonMergeCommits: 1,
                    linesAdded: 10,
                    linesRemoved: 2,
                    firstCommitAt: '2026-01-05T00:00:00.000Z',
                    lastCommitAt: '2026-01-05T00:00:00.000Z',
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    const b = buildTrendReport({
      periods: [
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
                  deterministic: {
                    commits: 2,
                    nonMergeCommits: 2,
                    linesAdded: 30,
                    linesRemoved: 6,
                    firstCommitAt: '2026-02-10T00:00:00.000Z',
                    lastCommitAt: '2026-02-20T00:00:00.000Z',
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    const merged = mergeUsers(
      [a.periods[0].repositories[0].users[0], b.periods[0].repositories[0].users[0]],
      'Alice',
    );

    expect(merged.deterministic.avgCommitSize).toBe(16);
    expect(merged.deterministic.firstCommitAt).toBe('2026-01-05T00:00:00.000Z');
    expect(merged.deterministic.lastCommitAt).toBe('2026-02-20T00:00:00.000Z');
  });
});

describe('filterReport', () => {
  it('merges identities through the email map across repos and periods', () => {
    const filtered = filterReport(fixtureReport(), {
      emailMap: { 'alice@example.com': 'Alice Smith' },
    });

    const alice = filtered.users.find((user) => user.name === 'Alice Smith');
    expect(alice).toBeDefined();
    expect(alice?.emails).toEqual(['alice@example.com']);
    // Alice: 4+1 commits in January (repo-a + repo-b), 0 in February.
    expect(alice?.deterministic.commits).toBe(5);
    // Bob: 2 in January, 3 in February.
    const bob = filtered.users.find((user) => user.name === 'Bob');
    expect(bob?.deterministic.commits).toBe(5);
    // LLM contributions concatenated across periods.
    expect(alice?.llm.contributions.map((contribution) => contribution.title)).toEqual([
      'A1',
      'A2',
    ]);
  });

  it('applies the user selection by name or email, case-insensitively', () => {
    const include = filterReport(fixtureReport(), {
      emailMap: {},
      includeUsers: ['BOB@example.com'],
    });
    expect(include.users.map((user) => user.name)).toEqual(['Bob']);
    expect(include.report.periods[0].repositories[0].users.map((user) => user.name)).toEqual([
      'Bob',
    ]);

    const exclude = filterReport(fixtureReport(), {
      emailMap: {},
      excludeUsers: ['alice'],
    });
    expect(exclude.users.map((user) => user.name)).toEqual(['Bob']);
  });

  it('narrows repositories by selection', () => {
    const include = filterReport(fixtureReport(), { emailMap: {}, repos: ['repo-b'] });
    expect(include.report.periods[0].repositories.map((repo) => repo.repo)).toEqual(['repo-b']);
    expect(include.report.periods[1].repositories.map((repo) => repo.repo)).toEqual(['repo-b']);

    const exclude = filterReport(fixtureReport(), { emailMap: {}, excludeRepos: ['repo-b'] });
    expect(exclude.report.periods[0].repositories.map((repo) => repo.repo)).toEqual(['repo-a']);
  });

  it('recomputes repository stats after filtering', () => {
    const filtered = filterReport(fixtureReport(), {
      emailMap: {},
      includeUsers: ['Bob'],
    });
    const stats = filtered.report.periods[0].repositories[0].stats;
    expect(stats.totalCommits).toBe(2);
    expect(stats.totalUsers).toBe(1);
    expect(stats.topLanguages[0].language).toBe('TypeScript');
  });

  it('sorts the master list by contributions, then commits, then name', () => {
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
                  deterministic: { commits: 5 },
                  llm: {
                    contributions: [
                      fixtureContribution({ title: 'A1' }),
                      fixtureContribution({ title: 'A2' }),
                    ],
                  },
                },
                {
                  name: 'Bob',
                  emails: ['bob@example.com'],
                  deterministic: { commits: 9 },
                  llm: { contributions: [fixtureContribution({ title: 'B1' })] },
                },
                {
                  name: 'Zed',
                  emails: ['zed@example.com'],
                  deterministic: { commits: 2 },
                },
              ],
            },
          ],
        },
      ],
    });
    const filtered = filterReport(report, noFilters());

    // Alice leads on contributions despite fewer commits; Zed has none.
    expect(filtered.users.map((user) => user.name)).toEqual(['Alice', 'Bob', 'Zed']);
  });
});

describe('combinePeriodUsers', () => {
  it('keeps the master order and zeroes inactive users', () => {
    const filtered = filterReport(fixtureReport(), noFilters());
    const february = filtered.report.periods[1];
    const combined = combinePeriodUsers(february, filtered.users);

    expect(combined.map((user) => user.name)).toEqual(filtered.users.map((user) => user.name));
    const alice = combined.find((user) => user.name === 'Alice');
    expect(alice?.deterministic.commits).toBe(0);
    // The LLM analysis of an inactive period stays skipped.
    expect(alice?.llm.status).toBe('skipped');
    const bob = combined.find((user) => user.name === 'Bob');
    expect(bob?.deterministic.commits).toBe(3);
  });
});
