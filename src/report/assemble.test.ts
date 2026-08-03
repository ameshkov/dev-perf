/**
 * Tests for report assembly (design §7): repository entries with
 * deterministic metrics and skipped LLM analysis, the report document
 * with defaults applied, and validation of the assembled output.
 */
import { describe, expect, it } from 'vitest';
import type { Commit } from '../deterministic/commits.js';
import { groupByAuthor } from '../deterministic/identity.js';
import { assembleReport, assembleRepository } from './assemble.js';
import type { AnalyzedRange } from './assemble.js';
import { reportSchema } from './schema.js';

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

  it('records empty users and zeroed stats for no groups', () => {
    const repository = assembleRepository(repoInput({ groups: [] }));
    expect(repository.users).toEqual([]);
    expect(repository.stats).toEqual({ totalCommits: 0, totalUsers: 0, topLanguages: [] });
  });
});

describe('assembleReport', () => {
  it('builds a validated report document with schema defaults applied', () => {
    const report = assembleReport({
      repos: ['https://github.com/org/repo.git'],
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
      repos: ['https://github.com/org/repo.git'],
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
      repos: ['https://github.com/org/repo.git'],
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
