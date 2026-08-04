import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { trendReportJson } from '../../test/fixtures/trend-report-builder.js';
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
              },
              {
                name: 'Bob',
                emails: ['bob@example.com'],
                deterministic: { commits: 2, linesAdded: 20 },
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

      const files = await readdir(result.assetsPath);
      expect(files).toContain('team-commits-per-period.svg');
      expect(files).toContain('team-languages-per-period.svg');
      expect(files).toContain('alice-contributions-by-size.svg');
      expect(files).toContain('alice-contributions-per-period.svg');
      expect(files).toContain('work-types.svg');
      expect(result.chartCount).toBeGreaterThan(10);
      expect(result.userCount).toBe(2);
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
