import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withTempDir } from '../../test/helpers/temp-dir.js';
import { fixtureContribution, trendReportJson } from '../../test/fixtures/trend-report-builder.js';
import { setVerbose } from '../util/log.js';
import { appVersion } from '../version.js';
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

describe('runCompile', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('writes report.md and the chart assets for an LLM report', async () => {
    await withTempDir(async (dir) => {
      const reportFile = path.join(dir, 'report.json');
      await writeFile(reportFile, llmReport());
      const output = path.join(dir, 'out');
      const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      try {
        const result = await runCompile(
          reportFile,
          parseCompileOptions({ report: reportFile, output }),
        );

        // The startup version line and the command start/end markers
        // are always logged, even in quiet mode, mirroring report runs.
        const stderr = stderrWrite.mock.calls.map((call) => String(call[0])).join('');
        expect(stderr).toContain(`dev-perf ${appVersion}`);
        expect(stderr).toContain('starting compile');
        expect(stderr).toMatch(/finished compile in \d+ ms/);

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
          '| Alice | 2 | 9 | 5 | 45 | 4 | 6 | 2 | TypeScript | completed | 1 | repo-a |',
        );
        // The individual sections link to the per-person reports.
        expect(md).toContain('[Full individual report →](people/alice.md)');
        // LLM usage is reported with the token breakdown: two users over
        // two periods of the fixture default (100 in / 50 cached in /
        // 20 out per user per period).
        // The top contributors by commits, contributions and points:
        // Alice and Bob tie on commits (5), Alice leads on
        // contributions (2 vs 1) and on points (two m-sized,
        // medium-complexity contributions weigh 4.5 each), so the
        // master user order resolves every tie in favor of Alice.
        expect(md).toContain('- Top contributor by commits: Alice (5 commits)');
        expect(md).toContain('- Top contributor by contributions: Alice (2 contributions)');
        expect(md).toContain('- Top contributor by points: Alice (9 points)');
        // The busiest periods follow the same pattern: January leads on
        // commits (6 vs 4) and contributions (2 vs 1), and on points
        // (9 vs 4.5) the older period wins outright.
        expect(md).toContain('- Busiest period by commits: 2026-01 (6 commits)');
        expect(md).toContain('- Busiest period by contributions: 2026-01 (2 contributions)');
        expect(md).toContain('- Busiest period by points: 2026-01 (9 points)');
        expect(md).toContain(
          '| LLM usage | 400 in / 200 cached in / 80 out | Token usage of the LLM analysis |',
        );
        expect(md).toContain('### Usage');
        expect(md).toContain('| User | Input tokens | Cached in | Output tokens |');
        expect(md).toContain('| Alice | 200 | 100 | 40 |');
        expect(md).toContain('| Total | 400 | 200 | 80 |');

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
          '![Points per period (size × complexity).](assets/team-points-per-period.svg)',
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
          '![Points per period (size × complexity).](assets/alice-points-per-period.svg)',
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
        expect(md).toContain(
          'Share of contributions by quality signal (top 5 signals plus other).',
        );
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
      } finally {
        stderrWrite.mockRestore();
      }
    });
  });

  it('logs the chart rendering batch start before rendering, in verbose mode', async () => {
    await withTempDir(async (dir) => {
      const reportFile = path.join(dir, 'report.json');
      await writeFile(reportFile, llmReport());
      const output = path.join(dir, 'out');
      const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        await runCompile(
          reportFile,
          parseCompileOptions({ report: reportFile, output, verbose: true }),
        );

        const stderr = stderrWrite.mock.calls.map((call) => String(call[0])).join('');
        // The command start/end pair brackets the whole compile run:
        // the start line comes first, the outcome (with duration) last.
        expect(stderr).toContain('starting compile');
        expect(stderr).toMatch(/finished compile in \d+ ms/);
        // The batch start line precedes the per-chart completion lines.
        const renderStart = stderr.indexOf('compile: rendering ');
        const rendered = stderr.indexOf('compile: rendered ');
        expect(renderStart).toBeGreaterThanOrEqual(0);
        expect(stderr).toMatch(/compile: rendering \d+ charts/);
        expect(renderStart).toBeLessThan(rendered);
      } finally {
        stderrWrite.mockRestore();
        setVerbose(false);
      }
    });
  });

  it('logs the finish marker even when the report is invalid', async () => {
    await withTempDir(async (dir) => {
      const reportFile = path.join(dir, 'report.json');
      await writeFile(reportFile, 'not json');
      const output = path.join(dir, 'out');
      const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        // An invalid report throws before anything is written; the
        // start/end marker pair still brackets the failed compile.
        await expect(
          runCompile(reportFile, parseCompileOptions({ report: reportFile, output })),
        ).rejects.toThrow();

        const stderr = stderrWrite.mock.calls.map((call) => String(call[0])).join('');
        expect(stderr).toContain('starting compile');
        expect(stderr).toMatch(/finished compile in \d+ ms/);
      } finally {
        stderrWrite.mockRestore();
      }
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
      // The LLM analysis is split into one section per period, each
      // with its own overview and contributions table — not one lumped
      // whole-range overview and table.
      expect(alice).toContain('## 2026-01');
      expect(alice).toContain('## 2026-02');
      expect(alice).toContain('**Overview:** Overview of the work in the period.');
      // Each period's section has its own 1-row contributions table
      // (Alice has one fixture contribution per period), instead of one
      // table lumping both periods together.
      expect(alice.match(/\| Fixture work \|/g)).toHaveLength(2);
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
        parseCompileOptions({ report: reportFile, output, excludeUsers: ['bob@example.com'] }),
      );

      const md = await readFile(path.join(output, 'report.md'), 'utf8');
      expect(md).not.toContain('### Bob');
      expect(md).toContain('| Commits | 5 |');
      expect(md).toContain('| Active users | 1 |');
    });
  });

  it('merges identities through the users-map and lists the mapping in the appendix', async () => {
    await withTempDir(async (dir) => {
      const reportFile = path.join(dir, 'report.json');
      await writeFile(reportFile, llmReport());
      const output = path.join(dir, 'out');

      await runCompile(
        reportFile,
        parseCompileOptions({
          report: reportFile,
          output,
          maps: [{ email: 'alice@example.com', name: 'Alice Smith' }],
        }),
      );

      const md = await readFile(path.join(output, 'report.md'), 'utf8');
      expect(md).toContain('### Alice Smith');
      expect(md).toContain('| alice@example.com | Alice Smith |');
    });
  });
});
