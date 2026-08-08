/**
 * Tests for report assembly: repository entries with
 * deterministic metrics and skipped LLM analysis, the report document
 * with defaults applied, and validation of the assembled output.
 */
import { describe, expect, it } from 'vitest';
import type { Commit } from '../deterministic/commits.js';
import { groupByAuthor } from '../deterministic/identity.js';
import { assembleReport, assembleRepository, assembleTrendReport } from './assemble.js';
import type { AnalyzedRange } from './assemble.js';
import { reportSchema, trendReportSchema } from './schema.js';
import type { LlmAnalysis } from './schema.js';

/** A commit with defaults, for tests that override only what matters. */
function commit(overrides: Partial<Commit> = {}): Commit {
  return {
    sha: 'abc',
    parents: [],
    authorName: 'Alice',
    authorEmail: 'alice@example.com',
    authorDate: '2026-01-01T10:00:00Z',
    subject: 'work',
    files: [],
    isMerge: false,
    ...overrides,
  };
}

/** A range fixture with both bounds resolved. */
const RANGE: AnalyzedRange = {
  since: '2026-01-01T00:00:00.000Z',
  until: '2026-06-30T00:00:00.000Z',
};

/** Repository input fixture: one repository with two authors. */
function repoInput(overrides: Partial<Parameters<typeof assembleRepository>[0]> = {}) {
  return {
    repo: 'https://github.com/org/repo.git',
    clonePath: '/cache/0123456789abcdef/repo',
    branch: 'main',
    head: '0123456789abcdef0123456789abcdef01234567',
    range: RANGE,
    groups: groupByAuthor([
      commit({
        sha: '1',
        files: [{ path: 'src/a.ts', added: 2, deleted: 0 }],
      }),
      commit({
        sha: '2',
        authorName: 'Bob',
        authorEmail: 'bob@example.com',
        authorDate: '2026-01-02T11:00:00Z',
        files: [{ path: 'src/b.ts', added: 1, deleted: 0 }],
      }),
    ]),
    ...overrides,
  };
}

describe('assembleRepository', () => {
  it('builds users with deterministic metrics and a skipped LLM analysis', () => {
    const repository = assembleRepository(repoInput());

    expect(repository).toMatchObject({
      repo: 'https://github.com/org/repo.git',
      clonePath: '/cache/0123456789abcdef/repo',
      branch: 'main',
      head: '0123456789abcdef0123456789abcdef01234567',
      range: RANGE,
      stats: {
        totalCommits: 2,
        totalUsers: 2,
        topLanguages: [{ language: 'TypeScript', linesAdded: 3 }],
      },
    });
    expect(repository.users).toHaveLength(2);
    // First-encounter order of the newest-first commit list: Alice, Bob.
    expect(repository.users[0]).toMatchObject({
      name: 'Alice',
      emails: ['alice@example.com'],
      isBot: false,
      llm: { status: 'skipped' },
    });
    expect(repository.users[0].deterministic).toMatchObject({
      commits: 1,
      linesAdded: 2,
      avgCommitSize: 2,
    });
    expect(repository.users[1].llm).toEqual({ status: 'skipped', contributions: [] });
  });

  it('records the ignored paths on the repository entry when configured', () => {
    const repository = assembleRepository(repoInput({ ignoredPaths: ['docs/', 'vendor/'] }));

    expect(repository.ignoredPaths).toEqual(['docs/', 'vendor/']);
  });

  it('omits the ignored paths key when none are configured', () => {
    expect('ignoredPaths' in assembleRepository(repoInput())).toBe(false);
  });

  it('records the base branch on the repository entry when scoped', () => {
    const repository = assembleRepository(repoInput({ baseBranch: 'origin/main' }));
    expect(repository.baseBranch).toBe('origin/main');
  });

  it('omits the baseBranch key when no branch-delta is in effect', () => {
    expect('baseBranch' in assembleRepository(repoInput())).toBe(false);
  });

  it('emits every email of an identity merged through the email map', () => {
    const repository = assembleRepository(
      repoInput({
        groups: groupByAuthor(
          [
            commit({ sha: '1' }),
            commit({
              sha: '2',
              authorName: 'Alice Smith',
              authorEmail: 'alice@work.com',
            }),
          ],
          { 'alice@example.com': 'Alice Smith', 'alice@work.com': 'Alice Smith' },
        ),
      }),
    );

    expect(repository.users).toHaveLength(1);
    expect(repository.users[0].name).toBe('Alice Smith');
    expect(repository.users[0].emails).toEqual(['alice@example.com', 'alice@work.com']);
    expect(repository.users[0].deterministic.commits).toBe(2);
    expect(repository.stats.totalUsers).toBe(1);
  });

  it('records empty users and zeroed stats for no groups', () => {
    const repository = assembleRepository(repoInput({ groups: [] }));
    expect(repository.users).toEqual([]);
    expect(repository.stats).toEqual({ totalCommits: 0, totalUsers: 0, topLanguages: [] });
  });
});

describe('assembleRepository with LLM results', () => {
  /** A completed LLM analysis fixture. */
  const COMPLETED: LlmAnalysis = {
    status: 'completed',
    overview: 'Shipped the pipeline.',
    contributions: [
      {
        title: 'Add pipeline',
        summary: 'Wired clone to report assembly.',
        types: ['feature'],
        complexity: 'medium',
        complexityReasoning: 'Several modules touched.',
        size: 'l',
        sizeReasoning: 'Spans the whole pipeline.',
        areas: ['src'],
        commits: ['abc1234d'],
        qualitySignals: ['tests-added'],
        riskFlags: [],
      },
    ],
    tokenUsage: { input: 10, cacheRead: 0, output: 5 },
  };

  it('maps completed analyses onto the matching users and skips the rest', () => {
    const repository = assembleRepository(
      repoInput({ llmResults: new Map([['alice@example.com', COMPLETED]]) }),
    );

    expect(repository.users[0].llm).toEqual(COMPLETED);
    expect(repository.users[1].llm).toEqual({ status: 'skipped', contributions: [] });
  });

  it('maps a failed analysis with its error message into the report', () => {
    const repository = assembleRepository(
      repoInput({
        llmResults: new Map([
          ['alice@example.com', { status: 'failed', contributions: [], error: 'boom' }],
        ]),
      }),
    );

    expect(repository.users[0].llm).toEqual({
      status: 'failed',
      contributions: [],
      error: 'boom',
    });
    expect(repository.users[1].llm).toEqual({ status: 'skipped', contributions: [] });
  });

  it('keeps a skipped analysis for every user when no LLM results are given', () => {
    const repository = assembleRepository(repoInput());
    expect(repository.users[0].llm).toEqual({ status: 'skipped', contributions: [] });
    expect(repository.users[1].llm).toEqual({ status: 'skipped', contributions: [] });
  });
});

describe('assembleReport', () => {
  it('builds a validated report document with schema defaults applied', () => {
    const report = assembleReport({
      repos: [{ repo: 'https://github.com/org/repo.git' }],
      range: RANGE,
      llmEnabled: false,
      generatedAt: '2026-08-03T12:00:00.000Z',
      repositories: [assembleRepository(repoInput())],
    });

    // `reportSchema` applies defaults: `llm.contributions` is `[]`.
    expect(report.repositories[0].users[0].llm).toEqual({
      status: 'skipped',
      contributions: [],
    });
    expect(report.parameters).toEqual({
      repos: [{ repo: 'https://github.com/org/repo.git' }],
      since: '2026-01-01T00:00:00.000Z',
      until: '2026-06-30T00:00:00.000Z',
      llmEnabled: false,
    });
    expect(report.schemaVersion).toBe(1);
    expect(report.generatedAt).toBe('2026-08-03T12:00:00.000Z');
    // The assembled document round-trips through the schema.
    expect(reportSchema.safeParse(report).success).toBe(true);
  });

  it('omits the model from parameters when LLM analysis is disabled', () => {
    const report = assembleReport({
      repos: [{ repo: 'https://github.com/org/repo.git' }],
      range: RANGE,
      llmEnabled: false,
      generatedAt: '2026-08-03T12:00:00.000Z',
      repositories: [],
    });
    expect('model' in report.parameters).toBe(false);
  });

  it('rejects an invalid assembled document', () => {
    expect(() =>
      assembleReport({
        repos: [],
        range: RANGE,
        llmEnabled: false,
        generatedAt: '2026-08-03T12:00:00.000Z',
        repositories: [],
      }),
    ).toThrow();
  });
});

describe('assembleTrendReport', () => {
  it('builds a validated trend report with one period per period input', () => {
    const january = assembleRepository(repoInput());
    const report = assembleTrendReport({
      repos: [{ repo: 'https://github.com/org/repo.git' }],
      range: RANGE,
      unit: 'month',
      llmEnabled: false,
      generatedAt: '2026-08-03T12:00:00.000Z',
      periods: [
        {
          range: { since: '2026-01-01T00:00:00.000Z', until: '2026-01-31T23:59:59.999Z' },
          repositories: [january],
        },
        {
          range: { since: '2026-02-01T00:00:00.000Z', until: '2026-02-28T23:59:59.999Z' },
          repositories: [],
        },
      ],
    });

    expect(report.schemaVersion).toBe(3);
    expect(report.generatedAt).toBe('2026-08-03T12:00:00.000Z');
    expect(report.parameters).toEqual({
      repos: [{ repo: 'https://github.com/org/repo.git' }],
      since: '2026-01-01T00:00:00.000Z',
      until: '2026-06-30T00:00:00.000Z',
      unit: 'month',
      llmEnabled: false,
    });
    expect(report.periods).toEqual([
      {
        since: '2026-01-01T00:00:00.000Z',
        until: '2026-01-31T23:59:59.999Z',
        repositories: [january],
      },
      {
        since: '2026-02-01T00:00:00.000Z',
        until: '2026-02-28T23:59:59.999Z',
        repositories: [],
      },
    ]);
    // The assembled document round-trips through the schema.
    expect(trendReportSchema.safeParse(report).success).toBe(true);
  });

  it('omits the unit and model keys from parameters without --unit', () => {
    const report = assembleTrendReport({
      repos: [{ repo: 'https://github.com/org/repo.git' }],
      range: RANGE,
      llmEnabled: false,
      generatedAt: '2026-08-03T12:00:00.000Z',
      periods: [{ range: RANGE, repositories: [] }],
    });

    expect('unit' in report.parameters).toBe(false);
    expect('model' in report.parameters).toBe(false);
    expect(report.periods).toEqual([{ since: RANGE.since, until: RANGE.until, repositories: [] }]);
  });

  it('rejects an assembled document without periods', () => {
    expect(() =>
      assembleTrendReport({
        repos: [{ repo: 'https://github.com/org/repo.git' }],
        range: RANGE,
        llmEnabled: false,
        generatedAt: '2026-08-03T12:00:00.000Z',
        periods: [],
      }),
    ).toThrow();
  });
});
