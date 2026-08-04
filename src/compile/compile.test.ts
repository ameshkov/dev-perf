import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtureContribution, trendReportJson } from '../../test/fixtures/trend-report-builder.js';
import { runCompile } from './compile.js';
import { parseCompileOptions } from './options.js';

/** A two-period, two-user fixture report with LLM analysis. */
function llmReport() {
  return trendReportJson({
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
                deterministic: { commits: 4, linesAdded: 40 },
                llm: {
                  contributions: [fixtureContribution({ riskFlags: ['no-tests'] })],
                },
              },
              {
                name: 'Bob',
                emails: ['bob@example.com'],
                deterministic: { commits: 2, linesAdded: 20 },
                llm: {
                  contributions: [
                    fixtureContribution({
                      riskFlags: ['large-diff'],
                      qualitySignals: ['tests-added'],
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
                deterministic: { commits: 1, linesAdded: 5 },
                llm: {
                  contributions: [fixtureContribution({ riskFlags: ['no-tests', 'large-diff'] })],
                },
              },
              {
                name: 'Bob',
                emails: ['bob@example.com'],
                deterministic: { commits: 3, linesAdded: 15 },
              },
            ],
          },
        ],
      },
    ],
  });
}

/** Runs `fn` with a fresh temp directory, removed afterwards. */
async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-compile-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('runCompile', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('writes report.md and the chart assets for an LLM report', async () => {
    await withTempDir(async (dir) => {
      const reportFile = path.join(dir, 'report.json');
      await writeFile(reportFile, llmReport());
      const output = path.join(dir, 'out');

      const result = await runCompile(
        reportFile,
        parseCompileOptions({ report: reportFile, output }),
      );

      const md = await readFile(result.reportPath, 'utf8');
      expect(md).toContain('# Dev Performance Report');
      expect(md).toContain('## Executive summary');
      expect(md).toContain('## Team dynamics');
      expect(md).toContain('## Contributors');
      expect(md).toContain('## Individual dynamics');
      expect(md).toContain('### Alice');
      expect(md).toContain('### Bob');
      expect(md).toContain('## LLM analysis summary');
      expect(md).toContain('## Appendix');
      expect(md).toContain(
        '![Contributions per period, stacked by size (xs–xl).](assets/team-contributions-by-size.svg)',
      );
      // Executive summary key facts: the analyzed range, the
      // repositories and the people as nested bullet lists.
      expect(md).toContain(
        '- Analysis period: 2026-01-01T00:00:00.000Z → 2026-02-28T23:59:59.999Z',
      );
      expect(md).toContain(
        ['- Repositories (1):', '    - repo-a', '- People (2):', '    - Alice', '    - Bob'].join(
          '\n',
        ),
      );
      // The totals table carries a one-line description per metric.
      expect(md).toContain('| Metric | Value | Description |');
      expect(md).toContain('| Commits | 10 | Total commits in the analyzed range |');
      // The contributors table carries the per-user repository columns.
      expect(md).toContain('| Repos |');
      expect(md).toContain('| Top repo |');
      expect(md).toContain(
        '| Alice | 2 | 6 | 5 | 45 | 4 | 6 | 1 | TypeScript | completed | 1 | repo-a |',
      );
      // The individual sections link to the per-person reports.
      expect(md).toContain('[Full individual report →](people/alice.md)');
      // LLM cost is reported with the token usage breakdown: two users
      // over two periods of the fixture default (100 in / 50 cached in /
      // 20 out, $0.01 per user per period).
      expect(md).toContain('- LLM analysis cost: 400 in / 200 cached in / 80 out / $0.0400');
      expect(md).toContain(
        '| LLM cost | 400 in / 200 cached in / 80 out / $0.0400 | Estimated token usage and cost of the LLM analysis |',
      );
      expect(md).toContain('| User | Input tokens | Cached in | Output tokens | Cost |');
      expect(md).toContain('| Alice | 200 | 100 | 40 | $0.0200 |');
      expect(md).toContain('| Total | 400 | 200 | 80 | $0.0400 |');

      const files = await readdir(result.assetsPath);
      expect(files).toContain('team-points-per-period.svg');
      expect(files).toContain('team-work-types-per-period.svg');
      expect(files).toContain('team-commits-per-period.svg');
      expect(files).toContain('team-contributions-per-period.svg');
      expect(files).toContain('team-complexity-per-period.svg');
      expect(files).toContain('team-languages-per-period.svg');
      expect(files).toContain('team-risk-per-period.svg');
      expect(files).toContain('team-quality-per-period.svg');
      expect(files).toContain('team-risk-flags-per-contribution.svg');
      expect(files).toContain('team-quality-signals-per-contribution.svg');
      expect(files).not.toContain('team-contributions-and-points.svg');
      expect(files).toContain('alice-contributions-by-size.svg');
      expect(files).toContain('alice-contributions-by-complexity.svg');
      expect(files).toContain('alice-contributions-per-period.svg');
      expect(files).toContain('alice-contributions-by-complexity-per-period.svg');
      expect(files).toContain('alice-risk-per-period.svg');
      expect(files).toContain('alice-quality-per-period.svg');
      expect(files).toContain('alice-risk-per-contribution.svg');
      expect(files).toContain('alice-quality-per-contribution.svg');
      expect(files).toContain('alice-points-per-period.svg');
      expect(files).toContain('alice-work-types-per-period.svg');
      expect(files).toContain('alice-work-types.svg');
      expect(files).toContain('alice-commits-per-period.svg');
      expect(files).toContain('alice-contributions-and-cumulative-per-period.svg');
      expect(files).toContain('alice-lines-per-period.svg');
      expect(files).toContain('alice-languages-per-period.svg');
      expect(files).toContain('work-types.svg');
      expect(files).toContain('risk-distribution.svg');
      expect(files).toContain('quality-distribution.svg');
      // The team and LLM summary sections embed the new charts.
      expect(md).toContain('assets/team-complexity-per-period.svg');
      expect(md).toContain(
        '![Contributions per period (bars) and cumulative contributions (line).](assets/team-contributions-per-period.svg)',
      );
      expect(md).toContain(
        '![Points per period (size-weighted).](assets/team-points-per-period.svg)',
      );
      expect(md).toContain('assets/team-risk-per-period.svg');
      expect(md).toContain('assets/team-quality-per-period.svg');
      expect(md).toContain('assets/team-risk-flags-per-contribution.svg');
      expect(md).toContain('assets/team-quality-signals-per-contribution.svg');
      expect(md).toContain('assets/risk-distribution.svg');
      expect(md).toContain('assets/quality-distribution.svg');
      expect(md).not.toContain('assets/team-contributions-and-points.svg');
      // The points chart leads the stacked contributions chart, and
      // the contributions chart leads the commits chart in the team
      // dynamics section; the work-type chart sits between the
      // complexity and cumulative-contributions charts.
      expect(md.indexOf('assets/team-points-per-period.svg')).toBeLessThan(
        md.indexOf('assets/team-contributions-by-size.svg'),
      );
      expect(md.indexOf('assets/team-work-types-per-period.svg')).toBeLessThan(
        md.indexOf('assets/team-contributions-per-period.svg'),
      );
      expect(md.indexOf('assets/team-contributions-per-period.svg')).toBeLessThan(
        md.indexOf('assets/team-commits-per-period.svg'),
      );
      // The individual sections embed the four per-period charts of
      // every person; the signal charts stay in the per-person reports.
      expect(md).toContain(
        '![Contributions per period, stacked by complexity (low–high).](assets/alice-contributions-by-complexity-per-period.svg)',
      );
      expect(md).toContain(
        '![Points per period (size-weighted).](assets/alice-points-per-period.svg)',
      );
      expect(md).toContain('assets/alice-contributions-and-cumulative-per-period.svg');
      expect(md).not.toContain('assets/alice-risk-per-period.svg');
      expect(md).not.toContain('assets/alice-risk-per-contribution.svg');
      // The signal charts keep the top 5 flags plus `other`; the
      // per-period averages show the flag density of the work.
      expect(md).toContain(
        'Risk flags per period — share of contributions (top 5 flags plus other).',
      );
      expect(md).toContain(
        'Quality signals per period — share of contributions (top 5 signals plus other).',
      );
      expect(md).toContain('Share of contributions by risk flag (top 5 flags plus other).');
      expect(md).toContain('Share of contributions by quality signal (top 5 signals plus other).');
      expect(md).toContain('Average risk flags per contribution per period.');
      expect(md).toContain('Average quality signals per contribution per period.');
      // The fixture flags are tallied across the whole report.
      expect(md).toContain('- Most common risk flag: large-diff (2 contributions)');
      expect(md).toContain('| no-tests | 2 |');
      // The main report stays lean: no LLM overview, no languages,
      // complexity or whole-range sizes charts, no contributions
      // table — those live in the per-person reports.
      expect(md).not.toContain('**Overview:**');
      expect(md).not.toContain('alice-languages-per-period.svg');
      expect(md).not.toContain('alice-contributions-by-complexity.svg');
      expect(md).not.toContain('alice-contributions-by-size.svg');
      expect(md).not.toContain('| Fixture work |');
      expect(result.chartCount).toBeGreaterThan(15);
      expect(result.userCount).toBe(2);
    });
  });

  it('writes one full per-person report per user under people/', async () => {
    await withTempDir(async (dir) => {
      const reportFile = path.join(dir, 'report.json');
      await writeFile(reportFile, llmReport());
      const output = path.join(dir, 'out');

      const result = await runCompile(
        reportFile,
        parseCompileOptions({ report: reportFile, output }),
      );

      expect(result.peoplePath).toBe(path.join(output, 'people'));
      const peopleFiles = await readdir(result.peoplePath);
      expect(peopleFiles.sort()).toEqual(['alice.md', 'bob.md']);

      const alice = await readFile(path.join(result.peoplePath, 'alice.md'), 'utf8');
      expect(alice).toContain('# Alice — Individual report');
      expect(alice).toContain('| Commits | 5 |');
      // Every team-dynamics chart is embedded as its per-user
      // counterpart, with the people/ path prefix; the team-level
      // active-users chart has no per-user version.
      for (const chart of [
        'alice-points-per-period.svg',
        'alice-contributions-per-period.svg',
        'alice-contributions-by-complexity-per-period.svg',
        'alice-work-types-per-period.svg',
        'alice-contributions-and-cumulative-per-period.svg',
        'alice-contributions-by-size.svg',
        'alice-contributions-by-complexity.svg',
        'alice-work-types.svg',
        'alice-commits-per-period.svg',
        'alice-lines-per-period.svg',
        'alice-languages-per-period.svg',
        'alice-risk-per-period.svg',
        'alice-quality-per-period.svg',
        'alice-risk-per-contribution.svg',
        'alice-quality-per-contribution.svg',
      ]) {
        expect(alice).toContain(`../assets/${chart}`);
      }
      expect(alice).not.toContain('alice-active-users');
      // The LLM overview and the contributions table live here.
      expect(alice).toContain('**Overview:** Overview of the work in the period.');
      expect(alice).toContain('| Fixture work |');
      expect(alice).toContain('**Repositories:**');
      expect(alice).toContain('- repo-a: 5 commits');
      expect(alice).toContain('[Back to report](../report.md)');
    });
  });

  it('applies user filtering and recomputes the report', async () => {
    await withTempDir(async (dir) => {
      const reportFile = path.join(dir, 'report.json');
      await writeFile(reportFile, llmReport());
      const output = path.join(dir, 'out');

      await runCompile(
        reportFile,
        parseCompileOptions({ report: reportFile, output, excludeUser: ['bob@example.com'] }),
      );

      const md = await readFile(path.join(output, 'report.md'), 'utf8');
      expect(md).not.toContain('### Bob');
      expect(md).toContain('| Commits | 5 |');
      expect(md).toContain('| Active users | 1 |');
    });
  });

  it('merges identities through --map and lists the mapping in the appendix', async () => {
    await withTempDir(async (dir) => {
      const reportFile = path.join(dir, 'report.json');
      await writeFile(reportFile, llmReport());
      const output = path.join(dir, 'out');

      await runCompile(
        reportFile,
        parseCompileOptions({
          report: reportFile,
          output,
          map: ['alice@example.com=Alice Smith'],
        }),
      );

      const md = await readFile(path.join(output, 'report.md'), 'utf8');
      expect(md).toContain('### Alice Smith');
      expect(md).toContain('| alice@example.com | Alice Smith |');
    });
  });

  it('reads email mappings from the maps file', async () => {
    await withTempDir(async (dir) => {
      const reportFile = path.join(dir, 'report.json');
      const mapsFile = path.join(dir, 'maps.json');
      await writeFile(reportFile, llmReport());
      await writeFile(mapsFile, JSON.stringify({ 'alice@example.com': 'Alice Smith' }));

      await runCompile(
        reportFile,
        parseCompileOptions({ report: reportFile, output: path.join(dir, 'out'), mapsFile }),
      );

      const md = await readFile(path.join(dir, 'out', 'report.md'), 'utf8');
      expect(md).toContain('### Alice Smith');
    });
  });

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
      // contribution per period, size m → 3 points each).
      expect(md).toContain(
        '| Repository | Commits | Contributions | Points | Users | Top languages |',
      );
      expect(md).toContain('| github.com/acme/app | 2 | 2 | 6 | 1 | TypeScript (20) |');
      expect(md).toContain('| gitlab.com/team/tools | 2 | 2 | 6 | 1 | TypeScript (20) |');
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
