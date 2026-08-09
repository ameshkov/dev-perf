/**
 * Tests for the report scope filtering: repository and user
 * narrowing, statistics recomputation, the option collectors, and the
 * selection toggle normalization.
 */
import { describe, expect, it } from 'vitest';
import { buildDemoReport } from '../../test/report-builder.js';
import {
  collectRepoOptions,
  collectUserOptions,
  filterReport,
  toggleScopedValue,
} from './filter.js';

const API = 'git@github.com:acme/api.git';
const WEB = 'https://github.com/acme/web.git';

describe('filterReport', () => {
  it('returns the same document without a selection', () => {
    const report = buildDemoReport();
    expect(filterReport(report, {})).toBe(report);
    expect(filterReport(report, { repos: undefined, users: undefined })).toBe(report);
  });

  it('returns the same document when the selection keeps everything', () => {
    const report = buildDemoReport();
    const filtered = filterReport(report, {
      repos: new Set([API, WEB]),
      users: new Set(['Alice Nguyen', 'Bob Fisher']),
    });
    expect(filtered).toBe(report);
  });

  it('keeps only the selected repositories in every period', () => {
    const report = buildDemoReport();
    const filtered = filterReport(report, { repos: new Set([API]) });
    expect(filtered).not.toBe(report);
    expect(filtered.periods).toHaveLength(2);
    for (const period of filtered.periods) {
      expect(period.repositories.map((repository) => repository.repo)).toEqual([API]);
    }
    expect(filtered.parameters.repos.map((spec) => spec.repo)).toEqual([API]);
  });

  it('keeps only the selected users and recomputes repository statistics', () => {
    const report = buildDemoReport();
    const filtered = filterReport(report, { users: new Set(['Alice Nguyen']) });
    expect(filtered).not.toBe(report);

    const january = filtered.periods[0];
    const api = january.repositories.find((repository) => repository.repo === API);
    expect(api?.users.map((user) => user.name)).toEqual(['Alice Nguyen']);
    expect(api?.stats.totalCommits).toBe(6);
    expect(api?.stats.totalUsers).toBe(1);
    // Repository-level languages stay untouched by the user filter.
    expect(api?.stats.topLanguages).toEqual([{ language: 'TypeScript', linesAdded: 100 }]);

    // A repository whose users all stay selected is kept as-is.
    const web = january.repositories.find((repository) => repository.repo === WEB);
    expect(web).toBe(report.periods[0].repositories[1]);

    const februaryWeb = filtered.periods[1].repositories.find(
      (repository) => repository.repo === WEB,
    );
    expect(februaryWeb?.stats.totalCommits).toBe(1);
    expect(februaryWeb?.stats.totalUsers).toBe(1);
  });

  it('combines both selections', () => {
    const report = buildDemoReport();
    const filtered = filterReport(report, {
      repos: new Set([WEB]),
      users: new Set(['Bob Fisher']),
    });
    expect(filtered.parameters.repos.map((spec) => spec.repo)).toEqual([WEB]);
    expect(filtered.periods).toHaveLength(2);
    const february = filtered.periods[1];
    expect(february.repositories).toHaveLength(1);
    expect(february.repositories[0].users.map((user) => user.name)).toEqual(['Bob Fisher']);
    expect(february.repositories[0].stats.totalCommits).toBe(2);
    // The selected user has no entry in the January web repository.
    expect(filtered.periods[0].repositories[0].users).toEqual([]);
    expect(filtered.periods[0].repositories[0].stats.totalCommits).toBe(0);
    expect(filtered.periods[0].repositories[0].stats.totalUsers).toBe(0);
  });

  it('keeps period bounds and report metadata intact', () => {
    const report = buildDemoReport();
    const filtered = filterReport(report, { repos: new Set([API]) });
    expect(filtered.schemaVersion).toBe(3);
    expect(filtered.generatedAt).toBe(report.generatedAt);
    expect(filtered.periods.map((period) => [period.since, period.until])).toEqual(
      report.periods.map((period) => [period.since, period.until]),
    );
  });
});

describe('collectRepoOptions', () => {
  it('sums commits per repository across all periods, most first', () => {
    const options = collectRepoOptions(buildDemoReport());
    expect(options).toEqual([
      { key: API, value: 17 },
      { key: WEB, value: 6 },
    ]);
  });

  it('honors a narrowed report', () => {
    const report = filterReport(buildDemoReport(), { users: new Set(['Alice Nguyen']) });
    const options = collectRepoOptions(report);
    expect(options).toEqual([
      { key: API, value: 8 },
      { key: WEB, value: 4 },
    ]);
  });
});

describe('collectUserOptions', () => {
  it('sums commits per user across repositories and periods, most first', () => {
    const options = collectUserOptions(buildDemoReport());
    expect(options).toEqual([
      { key: 'Alice Nguyen', value: 12 },
      { key: 'Bob Fisher', value: 11 },
    ]);
  });

  it('honors a narrowed report', () => {
    const report = filterReport(buildDemoReport(), { repos: new Set([WEB]) });
    const options = collectUserOptions(report);
    expect(options).toEqual([
      { key: 'Alice Nguyen', value: 4 },
      { key: 'Bob Fisher', value: 2 },
    ]);
  });
});

describe('toggleScopedValue', () => {
  const options = [
    { key: 'a', value: 1 },
    { key: 'b', value: 2 },
    { key: 'c', value: 3 },
  ];

  it('toggles one option out of an unset (all) selection', () => {
    const next = toggleScopedValue(options, undefined, 'b');
    expect(next).toEqual(new Set(['a', 'c']));
  });

  it('toggles an option back in, normalizing a full selection to undefined', () => {
    const next = toggleScopedValue(options, new Set(['a', 'c']), 'b');
    expect(next).toBeUndefined();
  });

  it('toggles an option into an explicit selection', () => {
    const next = toggleScopedValue(options, new Set(['a']), 'c');
    expect(next).toEqual(new Set(['a', 'c']));
  });

  it('normalizes to undefined when the last option is toggled in', () => {
    const next = toggleScopedValue(options, new Set(['a', 'b']), 'c');
    expect(next).toBeUndefined();
  });
});
