import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { buildFixtureRepo, removeFixtureRepo } from '../test/fixtures/repo-builder.js';
import { trendReportJson } from '../test/fixtures/trend-report-builder.js';
import { registerCommands } from './cli.js';
import { trendReportSchema } from './report/schema.js';

function createProgram(): Command {
  const program = new Command();
  program.name('dev-perf');
  program.exitOverride();
  registerCommands(program);
  return program;
}

/**
 * The `report` subcommand of a registered program; `undefined` when it
 * is not registered (the option assertions then fail, surfacing a
 * missing command registration).
 */
function reportCommand(program: Command): Command | undefined {
  return program.commands.find((command) => command.name() === 'report');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('cli', () => {
  it('documents the report command in the top-level help', () => {
    const program = createProgram();
    const help = program.helpInformation();

    expect(help).toContain('Commands:');
    expect(help).toContain('report [options] [repo...]');
    // Commander wraps the description to fit the help column, so match
    // across the wrap instead of the exact padded line.
    expect(help).toMatch(/Build a JSON report of per-user contribution\s+metrics/);
  });

  it('documents the repository argument and all options in the report help', () => {
    const program = createProgram();
    const reportHelp = reportCommand(program)?.helpInformation() ?? '';

    expect(reportHelp).toContain('[repo...]');
    expect(reportHelp).toContain('--since <date>');
    expect(reportHelp).toContain('--until <date>');
    expect(reportHelp).toContain('--unit <unit>');
    expect(reportHelp).toContain('--output <file>');
    expect(reportHelp).toContain('--cache-dir <dir>');
    expect(reportHelp).toContain('--refresh');
    expect(reportHelp).toContain('--no-llm');
    expect(reportHelp).toContain('--model <model>');
    expect(reportHelp).toContain('--provider-url <url>');
    expect(reportHelp).toContain('--api-key <key>');
    expect(reportHelp).toContain('--limit-context <n>');
    expect(reportHelp).toContain('--limit-output <n>');
    expect(reportHelp).toContain('--llm-retries <n>');
    expect(reportHelp).toContain('--parallel <n>');
    expect(reportHelp).toContain('--verbose');
    expect(reportHelp).toContain('DEV_PERF_');
  });

  it('documents the compile command in the top-level help', () => {
    const program = createProgram();
    const help = program.helpInformation();

    expect(help).toContain('compile [options] <report>');
    // Commander wraps the description to fit the help column, so match
    // across the wrap instead of the exact padded line.
    expect(help).toMatch(/Compile a JSON report into a markdown report with\s+charts/);
  });

  it('documents the report argument and all options in the compile help', () => {
    const program = createProgram();
    const compileHelp =
      program.commands.find((command) => command.name() === 'compile')?.helpInformation() ?? '';

    expect(compileHelp).toContain('<report>');
    expect(compileHelp).toContain('--output <dir>');
    expect(compileHelp).toContain('--map <email=name>');
    expect(compileHelp).toContain('--maps-file <path>');
    expect(compileHelp).toContain('--include-user <name|email>');
    expect(compileHelp).toContain('--exclude-user <name|email>');
    expect(compileHelp).toContain('--repo <repo>');
    expect(compileHelp).toContain('--exclude-repo <repo>');
    expect(compileHelp).toContain('DEV_PERF_COMPILE_');
  });

  it('rejects unknown commands', async () => {
    const program = createProgram();
    await expect(program.parseAsync(['node', 'dev-perf', 'frobnicate'])).rejects.toThrow(
      /unknown command/,
    );
  });

  it('parses repositories and options, including the negated --no-llm flag', () => {
    const program = createProgram();
    let parsed: { repos: string[]; options: Record<string, unknown> } | undefined;

    reportCommand(program)?.action((repos: string[], options: Record<string, unknown>) => {
      parsed = { repos, options };
    });

    program.parse([
      'node',
      'dev-perf',
      'report',
      '--since',
      '2026-01-01',
      '--no-llm',
      '--verbose',
      'https://github.com/org/repo.git',
    ]);

    expect(parsed).toBeDefined();
    expect(parsed?.repos).toEqual(['https://github.com/org/repo.git']);
    expect(parsed?.options).toEqual(
      expect.objectContaining({
        since: '2026-01-01',
        llm: false,
        verbose: true,
      }),
    );
  });

  it('parses the --unit option', () => {
    const program = createProgram();
    let parsed: { repos: string[]; options: Record<string, unknown> } | undefined;

    reportCommand(program)?.action((repos: string[], options: Record<string, unknown>) => {
      parsed = { repos, options };
    });

    program.parse(['node', 'dev-perf', 'report', '--no-llm', '--unit', 'month', 'repo.git']);

    expect(parsed?.options).toEqual(expect.objectContaining({ unit: 'month' }));
  });

  it('rejects --unit without --since', async () => {
    const program = createProgram();
    await expect(
      program.parseAsync(['node', 'dev-perf', 'report', '--no-llm', '--unit', 'month', 'repo.git']),
    ).rejects.toThrow(/--since: required when --unit is set/);
  });

  it('rejects when neither positional arguments nor DEV_PERF_REPOS are given', async () => {
    const program = createProgram();
    await expect(program.parseAsync(['node', 'dev-perf', 'report'])).rejects.toThrow(
      'repos: at least one repository is required',
    );
  });

  it('fills options from DEV_PERF_* environment variables when flags are not passed', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'init',
        files: [{ path: 'a.txt', content: 'a\n' }],
      },
    ]);
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-cli-cache-'));
    const outFile = path.join(cacheDir, 'report.json');
    vi.stubEnv('DEV_PERF_NO_LLM', 'true');
    vi.stubEnv('DEV_PERF_OUTPUT', outFile);
    vi.stubEnv('DEV_PERF_CACHE_DIR', cacheDir);
    try {
      const program = createProgram();
      await program.parseAsync(['node', 'dev-perf', 'report', repo.url]);

      const result = trendReportSchema.safeParse(JSON.parse(await readFile(outFile, 'utf8')));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.parameters.llmEnabled).toBe(false);
        expect(result.data.periods[0].repositories).toHaveLength(1);
      }
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('takes repositories from DEV_PERF_REPOS when no positional arguments are given', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'init',
        files: [{ path: 'a.txt', content: 'a\n' }],
      },
    ]);
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-cli-cache-'));
    const outFile = path.join(cacheDir, 'report.json');
    vi.stubEnv('DEV_PERF_REPOS', repo.url);
    vi.stubEnv('DEV_PERF_NO_LLM', 'true');
    vi.stubEnv('DEV_PERF_OUTPUT', outFile);
    vi.stubEnv('DEV_PERF_CACHE_DIR', cacheDir);
    try {
      const program = createProgram();
      await program.parseAsync(['node', 'dev-perf', 'report']);

      const result = trendReportSchema.safeParse(JSON.parse(await readFile(outFile, 'utf8')));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.parameters.repos).toEqual([repo.url]);
        expect(result.data.periods[0].repositories).toHaveLength(1);
      }
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('runs the deterministic pipeline and writes a valid report to the output file', async () => {
    const repo = await buildFixtureRepo([
      {
        author: { name: 'Alice', email: 'alice@example.com' },
        date: '2026-01-01T10:00:00Z',
        message: 'init',
        files: [{ path: 'a.txt', content: 'a\n' }],
      },
    ]);
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-cli-cache-'));
    const outFile = path.join(cacheDir, 'report.json');
    try {
      const program = createProgram();
      await program.parseAsync([
        'node',
        'dev-perf',
        'report',
        '--no-llm',
        '--limit-context',
        '65536',
        '--limit-output',
        '32768',
        '--cache-dir',
        cacheDir,
        '--output',
        outFile,
        repo.url,
      ]);

      const result = trendReportSchema.safeParse(JSON.parse(await readFile(outFile, 'utf8')));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.parameters.repos).toEqual([repo.url]);
        expect(result.data.parameters.llmEnabled).toBe(false);
        expect(result.data.periods[0].repositories).toHaveLength(1);
        expect(result.data.periods[0].repositories[0].users).toHaveLength(1);
        expect(result.data.periods[0].repositories[0].users[0]).toMatchObject({
          name: 'Alice',
          llm: { status: 'skipped' },
        });
      }
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
      await removeFixtureRepo(repo);
    }
  });

  it('runs the compile command and writes the markdown report and assets', async () => {
    const reportFile = path.join(
      await mkdtemp(path.join(os.tmpdir(), 'dev-perf-cli-report-')),
      'report.json',
    );
    await mkdir(path.dirname(reportFile), { recursive: true });
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
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-cli-compile-'));
    try {
      const program = createProgram();
      await program.parseAsync(['node', 'dev-perf', 'compile', reportFile, '--output', outDir]);

      const md = await readFile(path.join(outDir, 'report.md'), 'utf8');
      expect(md).toContain('# Dev Performance Report');
      const assets = await readdir(path.join(outDir, 'assets'));
      expect(assets).toContain('alice-commits-per-period.svg');
    } finally {
      await rm(path.dirname(reportFile), { recursive: true, force: true });
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it('rejects non-numeric limit options with the option name in the error', async () => {
    const program = createProgram();
    await expect(
      program.parseAsync([
        'node',
        'dev-perf',
        'report',
        '--no-llm',
        '--limit-context',
        'nope',
        'https://github.com/org/repo.git',
      ]),
    ).rejects.toThrow(/--limit-context/);
  });

  it('rejects LLM-enabled runs without provider configuration', async () => {
    const program = createProgram();
    await expect(
      program.parseAsync(['node', 'dev-perf', 'report', 'https://github.com/org/repo.git']),
    ).rejects.toThrow(/required when LLM analysis is enabled/);
  });
});
