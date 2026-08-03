import { describe, expect, it } from 'vitest';
import { reportSchema } from './schema.js';

/**
 * Builds a full, valid sample report exercising every
 * schema: parameters, repository entry, deterministic metrics with
 * languages and churn, and a completed LLM analysis with one
 * contribution.
 */
function validReport(): unknown {
  return {
    schemaVersion: 1,
    generatedAt: '2026-08-03T12:00:00.000Z',
    parameters: {
      repos: ['https://github.com/org/repo.git'],
      since: '2026-01-01',
      until: '2026-06-30',
      model: 'gpt-4.1',
      llmEnabled: true,
    },
    repositories: [
      {
        repo: 'https://github.com/org/repo.git',
        clonePath: '.dev-perf/cache/0123456789abcdef/repo',
        branch: 'main',
        head: '0123456789abcdef0123456789abcdef01234567',
        range: { since: '2026-01-01', until: '2026-06-30' },
        stats: {
          totalCommits: 12,
          totalUsers: 2,
          topLanguages: [{ language: 'TypeScript', linesAdded: 500 }],
        },
        users: [
          {
            name: 'Ada Lovelace',
            emails: ['ada@example.com'],
            isBot: false,
            deterministic: {
              commits: 8,
              nonMergeCommits: 7,
              mergeCommits: 1,
              linesAdded: 320,
              linesRemoved: 40,
              netLines: 280,
              filesTouched: 15,
              uniqueFilesTouched: 9,
              activeDays: 4,
              firstCommitAt: '2026-01-12T10:00:00.000Z',
              lastCommitAt: '2026-06-28T16:30:00.000Z',
              avgCommitSize: 45.7,
              languages: {
                TypeScript: { linesAdded: 300, linesRemoved: 30, filesTouched: 8 },
                JSON: { linesAdded: 20, linesRemoved: 10, filesTouched: 7 },
              },
              churn: { 'src/cli.ts': 12 },
            },
            llm: {
              status: 'completed',
              overview: 'Shipped the CLI surface and option validation.',
              contributions: [
                {
                  title: 'CLI limit options',
                  summary: 'Added --limit-context and --limit-output to the CLI surface.',
                  types: ['feature', 'tooling'],
                  complexity: 'low',
                  complexityReasoning: 'Small, self-contained option additions.',
                  areas: ['src'],
                  commits: ['0123456789abcdef0123456789abcdef01234567'],
                  qualitySignals: ['tests added'],
                  riskFlags: [],
                },
              ],
              tokenUsage: { input: 12000, output: 3400 },
              estimatedCostUsd: 0.05,
            },
          },
        ],
      },
    ],
  };
}

describe('reportSchema', () => {
  it('validates a full sample report', () => {
    const result = reportSchema.safeParse(validReport());
    expect(result.success).toBe(true);
  });

  it('defaults llm.status to "skipped" and llm.contributions to []', () => {
    const report = validReport() as {
      repositories: Array<{ users: Array<{ llm: Record<string, unknown> }> }>;
    };
    report.repositories[0].users[0].llm = {};

    const result = reportSchema.safeParse(report);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.repositories[0].users[0].llm).toEqual({
        status: 'skipped',
        contributions: [],
      });
    }
  });

  it('accepts a report without churn (v2 metric, reserved)', () => {
    const report = validReport() as {
      repositories: Array<{ users: Array<{ deterministic: Record<string, unknown> }> }>;
    };
    delete report.repositories[0].users[0].deterministic.churn;

    const result = reportSchema.safeParse(report);

    expect(result.success).toBe(true);
  });

  it('rejects each invalid field with the failing path', () => {
    const mutations: Array<{ path: string; mutate: (report: any) => void }> = [
      {
        path: 'schemaVersion',
        mutate: (report) => {
          report.schemaVersion = 2;
        },
      },
      {
        path: 'generatedAt',
        mutate: (report) => {
          delete report.generatedAt;
        },
      },
      {
        path: 'parameters.repos',
        mutate: (report) => {
          report.parameters.repos = [];
        },
      },
      {
        path: 'parameters.since',
        mutate: (report) => {
          delete report.parameters.since;
        },
      },
      {
        path: 'parameters.model',
        mutate: (report) => {
          report.parameters.model = 42;
        },
      },
      {
        path: 'parameters.llmEnabled',
        mutate: (report) => {
          report.parameters.llmEnabled = 'yes';
        },
      },
      {
        path: 'repositories',
        mutate: (report) => {
          report.repositories = 'none';
        },
      },
      {
        path: 'repositories.0.repo',
        mutate: (report) => {
          delete report.repositories[0].repo;
        },
      },
      {
        path: 'repositories.0.head',
        mutate: (report) => {
          report.repositories[0].head = 42;
        },
      },
      {
        path: 'repositories.0.stats.totalCommits',
        mutate: (report) => {
          report.repositories[0].stats.totalCommits = -1;
        },
      },
      {
        path: 'repositories.0.stats.topLanguages',
        mutate: (report) => {
          report.repositories[0].stats.topLanguages = 'TypeScript';
        },
      },
      {
        path: 'repositories.0.stats.topLanguages.0.linesAdded',
        mutate: (report) => {
          report.repositories[0].stats.topLanguages[0].linesAdded = -5;
        },
      },
      {
        path: 'repositories.0.users.0.emails',
        mutate: (report) => {
          report.repositories[0].users[0].emails = [];
        },
      },
      {
        path: 'repositories.0.users.0.isBot',
        mutate: (report) => {
          report.repositories[0].users[0].isBot = 'no';
        },
      },
      {
        path: 'repositories.0.users.0.deterministic.commits',
        mutate: (report) => {
          report.repositories[0].users[0].deterministic.commits = 1.5;
        },
      },
      {
        path: 'repositories.0.users.0.deterministic.languages.TypeScript.linesAdded',
        mutate: (report) => {
          report.repositories[0].users[0].deterministic.languages.TypeScript.linesAdded = -1;
        },
      },
      {
        path: 'repositories.0.users.0.llm.status',
        mutate: (report) => {
          report.repositories[0].users[0].llm.status = 'pending';
        },
      },
      {
        path: 'repositories.0.users.0.llm.estimatedCostUsd',
        mutate: (report) => {
          report.repositories[0].users[0].llm.estimatedCostUsd = -0.1;
        },
      },
      {
        path: 'repositories.0.users.0.llm.contributions.0.types.1',
        mutate: (report) => {
          report.repositories[0].users[0].llm.contributions[0].types = ['feature', 'weird'];
        },
      },
      {
        path: 'repositories.0.users.0.llm.contributions.0.complexity',
        mutate: (report) => {
          report.repositories[0].users[0].llm.contributions[0].complexity = 'extreme';
        },
      },
      {
        path: 'repositories.0.users.0.llm.contributions.0.commits.1',
        mutate: (report) => {
          report.repositories[0].users[0].llm.contributions[0].commits = [
            '0123456789abcdef0123456789abcdef01234567',
            42,
          ];
        },
      },
    ];

    for (const { path, mutate } of mutations) {
      const report = validReport();
      mutate(report);
      const result = reportSchema.safeParse(report);

      expect(result.success, `expected mutation at ${path} to be rejected`).toBe(false);
      if (result.success) {
        continue;
      }
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain(path);
    }
  });
});
