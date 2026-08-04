/**
 * End-to-end test for the compile path: the compiled CLI turns a
 * fixture JSON report into a markdown report with chart assets as a
 * child process, and the emitted files are checked exactly — the
 * report references every asset, the chart SVGs are non-empty, and
 * stdout carries nothing but the report path.
 *
 * The suite needs `pnpm build` to have produced `build/index.js`; it
 * is skipped when the build is missing so a plain `pnpm test` stays
 * green (the full gate `pnpm check` always builds first).
 */
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';
import { trendReportJson } from '../fixtures/trend-report-builder.js';

/** Compiled CLI entry point; the suite runs it as a child process. */
const BUILD_ENTRY = path.resolve(process.cwd(), 'build', 'index.js');

/**
 * The parent environment without `DEV_PERF_*` variables, so settings a
 * developer shell exports cannot leak into the child runs.
 */
function cleanEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('DEV_PERF_')),
  );
}

/**
 * A two-period fixture report with LLM analysis: two users, one
 * repository, contributions of different sizes and types.
 */
function fixtureReport(): string {
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
                  contributions: [
                    {
                      title: 'Feature A',
                      summary: 'What was done and how.',
                      types: ['feature'],
                      complexity: 'high',
                      complexityReasoning: 'Why the level was chosen.',
                      size: 'l',
                      sizeReasoning: 'Why the size was chosen.',
                      areas: ['src'],
                      commits: ['abc1234'],
                      qualitySignals: ['tests-added'],
                      riskFlags: [],
                    },
                    {
                      title: 'Fix B',
                      summary: 'What was done and how.',
                      types: ['bugfix'],
                      complexity: 'low',
                      complexityReasoning: 'Why the level was chosen.',
                      size: 'xs',
                      sizeReasoning: 'Why the size was chosen.',
                      areas: ['src'],
                      commits: ['def5678'],
                      qualitySignals: [],
                      riskFlags: ['no-tests'],
                    },
                  ],
                },
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
                llm: {
                  contributions: [
                    {
                      title: 'Feature C',
                      summary: 'What was done and how.',
                      types: ['feature'],
                      complexity: 'medium',
                      complexityReasoning: 'Why the level was chosen.',
                      size: 'm',
                      sizeReasoning: 'Why the size was chosen.',
                      areas: ['src'],
                      commits: ['fed3210'],
                      qualitySignals: [],
                      riskFlags: [],
                    },
                  ],
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

describe('e2e compile', () => {
  it('compiles a fixture report into report.md with chart assets', async () => {
    if (!existsSync(BUILD_ENTRY)) {
      return;
    }
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-e2e-compile-'));
    try {
      const reportFile = path.join(dir, 'report.json');
      const output = path.join(dir, 'out');
      await writeFile(reportFile, fixtureReport());

      const result = await execa(
        process.execPath,
        [BUILD_ENTRY, 'compile', reportFile, '--output', output],
        { env: cleanEnv(), cwd: dir },
      );

      // stdout carries nothing but the report path.
      expect(result.stdout).toBe(path.join(output, 'report.md'));
      const md = await readFile(path.join(output, 'report.md'), 'utf8');
      expect(md).toContain('# Dev Performance Report');
      expect(md).toContain('## Individual dynamics');
      expect(md).toContain('### Alice');
      // The per-user contributions table lives in the per-person report.
      expect(md).not.toContain('| Feature A | feature | high | l |');
      const aliceReport = await readFile(path.join(output, 'people', 'alice.md'), 'utf8');
      expect(aliceReport).toContain('| Feature A | feature | high | l |');
      expect(aliceReport).toContain('[Back to report](../report.md)');

      const assets = await readdir(path.join(output, 'assets'));
      expect(assets).toContain('team-contributions-by-size.svg');
      expect(assets).toContain('alice-contributions-by-size.svg');
      expect(assets).toContain('work-types.svg');
      // Every markdown file (the report and every per-person report)
      // references every asset, and every asset is a non-empty SVG.
      const peopleFiles = await readdir(path.join(output, 'people'));
      const markdown = [
        md,
        ...(await Promise.all(
          peopleFiles.map((file) => readFile(path.join(output, 'people', file), 'utf8')),
        )),
      ];
      for (const file of assets) {
        expect(markdown.some((text) => text.includes(`assets/${file}`))).toBe(true);
        const svg = await readFile(path.join(output, 'assets', file), 'utf8');
        expect(svg).toContain('<svg');
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('applies email mapping and user selection from the CLI', async () => {
    if (!existsSync(BUILD_ENTRY)) {
      return;
    }
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-e2e-compile-'));
    try {
      const reportFile = path.join(dir, 'report.json');
      const output = path.join(dir, 'out');
      await writeFile(reportFile, fixtureReport());

      await execa(
        process.execPath,
        [
          BUILD_ENTRY,
          'compile',
          reportFile,
          '--output',
          output,
          '--map',
          'alice@example.com=Alice Smith',
          '--exclude-user',
          'bob@example.com',
        ],
        { env: cleanEnv(), cwd: dir },
      );

      const md = await readFile(path.join(output, 'report.md'), 'utf8');
      expect(md).toContain('### Alice Smith');
      expect(md).not.toContain('### Bob');
      expect(md).toContain('| alice@example.com | Alice Smith |');
      expect(md).toContain('| Commits | 5 |');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
