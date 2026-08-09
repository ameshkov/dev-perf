/**
 * Tests for the report-level schema: legacy spec normalization, period
 * units, and the v1-to-trend-report wrapping.
 */
import { describe, expect, it } from 'vitest';
import { buildLegacyV1Report, buildRepository, buildUser } from '../../test/report-builder.js';
import {
  legacyReportSchema,
  periodUnitSchema,
  repoSpecSchema,
  v1ToTrendReport,
} from './schema-report.js';

describe('repoSpecSchema', () => {
  it('normalizes a legacy plain string into a spec with that repo', () => {
    expect(repoSpecSchema.parse('git@github.com:acme/app.git')).toEqual({
      repo: 'git@github.com:acme/app.git',
    });
  });

  it('passes a full spec object through', () => {
    const spec = {
      repo: 'https://github.com/acme/app.git',
      branch: 'main',
      base: 'master',
      ignore: ['generated'],
    };
    expect(repoSpecSchema.parse(spec)).toEqual(spec);
  });

  it('rejects an empty repo string', () => {
    expect(repoSpecSchema.safeParse({ repo: '' }).success).toBe(false);
  });
});

describe('periodUnitSchema', () => {
  it('accepts the five documented units', () => {
    for (const unit of ['day', 'week', 'month', 'quarter', 'year']) {
      expect(periodUnitSchema.parse(unit)).toBe(unit);
    }
  });

  it('rejects unknown units', () => {
    expect(periodUnitSchema.safeParse('hour').success).toBe(false);
    expect(periodUnitSchema.safeParse('months').success).toBe(false);
  });
});

describe('v1ToTrendReport', () => {
  it('wraps the legacy document: schema v3, one period spanning the range, parameters preserved', () => {
    const repositories = [
      buildRepository({ repo: 'git@github.com:acme/legacy.git', users: [buildUser()] }),
    ];
    const legacy = legacyReportSchema.parse(
      buildLegacyV1Report({
        repos: ['git@github.com:acme/legacy.git'],
        llmEnabled: true,
        model: 'm',
        repositories,
      }),
    );

    const trend = v1ToTrendReport(legacy);

    expect(trend.schemaVersion).toBe(3);
    expect(trend.generatedAt).toBe(legacy.generatedAt);
    expect(trend.parameters).toEqual(legacy.parameters);
    expect(trend.parameters.unit).toBeUndefined();
    expect(trend.periods).toEqual([
      { since: legacy.parameters.since, until: legacy.parameters.until, repositories },
    ]);
    // The period reuses the (parsed) repository array as-is.
    expect(trend.periods[0].repositories).toBe(legacy.repositories);
    expect(trend.periods[0].repositories[0].repo).toBe('git@github.com:acme/legacy.git');
  });
});
