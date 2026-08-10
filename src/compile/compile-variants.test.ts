/**
 * `runCompile` behavior tests with custom fixture reports: repository
 * URL shortening, single-period and deterministic-only reports, the
 * top-contributor facts, the repository comparison chart, and invalid
 * report handling. The canonical two-period LLM fixture tests live in
 * `compile.test.ts`.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixtureContribution, trendReportJson } from '../../test/fixtures/trend-report-builder.js';
import { withTempDir } from '../../test/helpers/temp-dir.js';
import { runCompile } from './compile.js';
import { parseCompileOptions } from './options.js';

describe('runCompile', () => {
  it('shortens repository URLs in the executive summary and the Repositories table', async () => {
    await withTempDir(async (dir) => {
      const reportFile = path.join(dir, 'report.json');
      await writeFile(
        reportFile,
        trendReportJson({
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
                  repo: 'https://gitlab.com:8443/team/tools.git',
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
                  repo: 'https://gitlab.com:8443/team/tools.git',
                  users: [{ name: 'Bob', emails: ['bob@example.com'] }],
                },
              ],
            },
          ],
        }),
      );
      const output = path.join(dir, 'out');

      const result = await runCompile(
        reportFile,
        parseCompileOptions({ report: reportFile, output }),
      );

      const md = await readFile(path.join(output, 'report.md'), 'utf8');
      expect(md).toContain(
        ['- Repositories (2):', '    - github.com/acme/app', '    - gitlab.com/team/tools'].join(
          '\n',
        ),
      );
      // The Repositories table uses the same labels and shows the
      // per-repository contribution count and weighted points (one
      // contribution per period, size m × complexity medium → 4.5
      // points each, 9 per repository).
      expect(md).toContain(
        '| Repository | Commits | Contributions | Points | Users | Top languages |',
      );
      expect(md).toContain('| github.com/acme/app | 2 | 2 | 9 | 1 | TypeScript (20) |');
      expect(md).toContain('| gitlab.com/team/tools | 2 | 2 | 9 | 1 | TypeScript (20) |');
      // The per-repository comparison chart legend carries just the
      // repository names, not the host/org or the raw URLs.
      const svg = await readFile(
        path.join(result.assetsPath, 'repos-commits-per-period.svg'),
        'utf8',
      );
      expect(svg).toContain('>app</text>');
      expect(svg).toContain('>tools</text>');
      expect(svg).not.toContain('github.com');
      expect(svg).not.toContain('gitlab.com');
      expect(svg).not.toContain('git@github.com');
      expect(svg).not.toContain('https://gitlab.com');
    });
  });

  it('skips per-period charts for a single-period report', async () => {
    await withTempDir(async (dir) => {
      const reportFile = path.join(dir, 'report.json');
      await writeFile(
        reportFile,
        trendReportJson({
          periods: [
            {
              since: '2026-01-01T00:00:00.000Z',
              until: '2026-01-31T23:59:59.999Z',
              repositories: [
                {
                  repo: 'repo-a',
                  users: [{ name: 'Alice', emails: ['alice@example.com'] }],
                },
              ],
            },
          ],
        }),
      );
      const output = path.join(dir, 'out');

      await runCompile(reportFile, parseCompileOptions({ report: reportFile, output }));

      const md = await readFile(path.join(output, 'report.md'), 'utf8');
      expect(md).toContain('Time-based dynamics charts are skipped');
      const files = await readdir(path.join(output, 'assets'));
      expect(files).not.toContain('team-commits-per-period.svg');
      expect(files).toContain('alice-contributions-by-size.svg');
    });
  });

  it('omits LLM sections for a deterministic-only report', async () => {
    await withTempDir(async (dir) => {
      const reportFile = path.join(dir, 'report.json');
      await writeFile(
        reportFile,
        trendReportJson({
          llmEnabled: false,
          periods: [
            {
              since: '2026-01-01T00:00:00.000Z',
              until: '2026-01-31T23:59:59.999Z',
              repositories: [
                {
                  repo: 'repo-a',
                  users: [{ name: 'Alice', emails: ['alice@example.com'] }],
                },
              ],
            },
            {
              since: '2026-02-01T00:00:00.000Z',
              until: '2026-02-28T23:59:59.999Z',
              repositories: [
                {
                  repo: 'repo-a',
                  users: [{ name: 'Alice', emails: ['alice@example.com'] }],
                },
              ],
            },
          ],
        }),
      );
      const output = path.join(dir, 'out');

      await runCompile(reportFile, parseCompileOptions({ report: reportFile, output }));

      const md = await readFile(path.join(output, 'report.md'), 'utf8');
      expect(md).not.toContain('## LLM analysis summary');
      expect(md).toContain('LLM analysis: disabled');
      const files = await readdir(path.join(output, 'assets'));
      expect(files).toContain('alice-commits-per-period.svg');
      expect(files).toContain('alice-lines-per-period.svg');
      expect(files).not.toContain('work-types.svg');
      // Without LLM analysis only the commit leader and the busiest
      // period by commits are reported.
      expect(md).toContain('- Top contributor by commits: Alice (2 commits)');
      expect(md).toContain('- Busiest period by commits: 2026-01 (1 commits)');
      expect(md).not.toContain('Top contributor by contributions');
      expect(md).not.toContain('Top contributor by points');
      expect(md).not.toContain('Busiest period by contributions');
      expect(md).not.toContain('Busiest period by points');
    });
  });

  it('reports distinct top contributors by commits, contributions and points', async () => {
    await withTempDir(async (dir) => {
      const reportFile = path.join(dir, 'report.json');
      await writeFile(
        reportFile,
        trendReportJson({
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
                      deterministic: { commits: 10 },
                      llm: {
                        contributions: [fixtureContribution({ size: 's' })],
                      },
                    },
                    {
                      name: 'Bob',
                      emails: ['bob@example.com'],
                      deterministic: { commits: 3 },
                      llm: {
                        contributions: [
                          fixtureContribution({ size: 'xs' }),
                          fixtureContribution({ size: 'xs' }),
                          fixtureContribution({ size: 'xs' }),
                        ],
                      },
                    },
                    {
                      name: 'Carol',
                      emails: ['carol@example.com'],
                      deterministic: { commits: 5 },
                      llm: {
                        contributions: [fixtureContribution({ size: 'xl' })],
                      },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      );
      const output = path.join(dir, 'out');

      await runCompile(reportFile, parseCompileOptions({ report: reportFile, output }));

      const md = await readFile(path.join(output, 'report.md'), 'utf8');
      // Each metric has its own leader: Alice by commits (10), Bob by
      // LLM contributions (3), Carol by points (one xl-sized,
      // medium-complexity contribution weighs 12, more than Alice's s
      // and Bob's three xs).
      expect(md).toContain('- Top contributor by commits: Alice (10 commits)');
      expect(md).toContain('- Top contributor by contributions: Bob (3 contributions)');
      expect(md).toContain('- Top contributor by points: Carol (12 points)');
    });
  });

  it('reports distinct busiest periods by commits, contributions and points', async () => {
    await withTempDir(async (dir) => {
      const reportFile = path.join(dir, 'report.json');
      await writeFile(
        reportFile,
        trendReportJson({
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
                      deterministic: { commits: 10 },
                      llm: {
                        contributions: [fixtureContribution({ size: 'xs' })],
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
                      deterministic: { commits: 3 },
                      llm: {
                        contributions: [
                          fixtureContribution({ size: 'xs' }),
                          fixtureContribution({ size: 'xs' }),
                          fixtureContribution({ size: 'xs' }),
                        ],
                      },
                    },
                  ],
                },
              ],
            },
            {
              since: '2026-03-01T00:00:00.000Z',
              until: '2026-03-31T23:59:59.999Z',
              repositories: [
                {
                  repo: 'repo-a',
                  users: [
                    {
                      name: 'Alice',
                      emails: ['alice@example.com'],
                      deterministic: { commits: 5 },
                      llm: {
                        contributions: [fixtureContribution({ size: 'xl' })],
                      },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      );
      const output = path.join(dir, 'out');

      await runCompile(reportFile, parseCompileOptions({ report: reportFile, output }));

      const md = await readFile(path.join(output, 'report.md'), 'utf8');
      // Each metric peaks in its own period: January by commits (10),
      // February by LLM contributions (3), March by points (one
      // xl-sized, medium-complexity contribution weighs 12).
      expect(md).toContain('- Busiest period by commits: 2026-01 (10 commits)');
      expect(md).toContain('- Busiest period by contributions: 2026-02 (3 contributions)');
      expect(md).toContain('- Busiest period by points: 2026-03 (12 points)');
    });
  });

  it('renders the repository comparison chart for multiple repositories', async () => {
    await withTempDir(async (dir) => {
      const reportFile = path.join(dir, 'report.json');
      await writeFile(
        reportFile,
        trendReportJson({
          llmEnabled: false,
          periods: [
            {
              since: '2026-01-01T00:00:00.000Z',
              until: '2026-01-31T23:59:59.999Z',
              repositories: [
                {
                  repo: 'repo-a',
                  users: [{ name: 'Alice', emails: ['alice@example.com'] }],
                },
                {
                  repo: 'repo-b',
                  users: [{ name: 'Alice', emails: ['alice@example.com'] }],
                },
              ],
            },
            {
              since: '2026-02-01T00:00:00.000Z',
              until: '2026-02-28T23:59:59.999Z',
              repositories: [
                {
                  repo: 'repo-a',
                  users: [{ name: 'Alice', emails: ['alice@example.com'] }],
                },
                {
                  repo: 'repo-b',
                  users: [{ name: 'Alice', emails: ['alice@example.com'] }],
                },
              ],
            },
          ],
        }),
      );
      const output = path.join(dir, 'out');

      await runCompile(reportFile, parseCompileOptions({ report: reportFile, output }));

      const md = await readFile(path.join(output, 'report.md'), 'utf8');
      expect(md).toContain('## Repositories');
      expect(md).toContain(
        '![Commits per period, one line per repository.](assets/repos-commits-per-period.svg)',
      );
      // Deterministic-only reports keep the table free of LLM columns:
      // each repo has 2 commits (one per period) from Alice.
      expect(md).toContain('| Repository | Commits | Users | Top languages |');
      expect(md).not.toContain('| Repository | Commits | Contributions | Users | Top languages |');
      expect(md).toContain('| repo-a | 2 | 1 | TypeScript (20) |');
      expect(md).toContain('| repo-b | 2 | 1 | TypeScript (20) |');
    });
  });

  it('rejects an invalid report file with the file name in the error', async () => {
    await withTempDir(async (dir) => {
      const reportFile = path.join(dir, 'report.json');
      await writeFile(reportFile, '{}');

      await expect(
        runCompile(
          reportFile,
          parseCompileOptions({ report: reportFile, output: path.join(dir, 'out') }),
        ),
      ).rejects.toThrow(/Invalid report \(.*report\.json\)/);
    });
  });
});
