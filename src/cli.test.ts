import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { buildFixtureRepo, removeFixtureRepo } from '../test/fixtures/repo-builder.js';
import { registerCommands } from './cli.js';
import { trendReportSchema } from './report/schema.js';

function createProgram(): Command {
  const program = new Command();
  program.name('dev-perf');
  program.exitOverride();
  registerCommands(program);
  return program;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('cli', () => {
  it('documents the repository argument and all options in help', () => {
    const program = createProgram();
    const help = program.helpInformation();

    expect(help).toContain('[repo...]');
    expect(help).toContain('--since <date>');
    expect(help).toContain('--until <date>');
    expect(help).toContain('--unit <unit>');
    expect(help).toContain('--output <file>');
    expect(help).toContain('--cache-dir <dir>');
    expect(help).toContain('--refresh');
    expect(help).toContain('--no-llm');
    expect(help).toContain('--model <model>');
    expect(help).toContain('--provider-url <url>');
    expect(help).toContain('--api-key <key>');
    expect(help).toContain('--limit-context <n>');
    expect(help).toContain('--limit-output <n>');
    expect(help).toContain('--verbose');
    expect(help).toContain('DEV_PERF_');
  });

  it('parses repositories and options, including the negated --no-llm flag', () => {
    const program = createProgram();
    let parsed: { repos: string[]; options: Record<string, unknown> } | undefined;

    program.action((repos: string[], options: Record<string, unknown>) => {
      parsed = { repos, options };
    });

    program.parse([
      'node',
      'dev-perf',
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

    program.action((repos: string[], options: Record<string, unknown>) => {
      parsed = { repos, options };
    });

    program.parse(['node', 'dev-perf', '--no-llm', '--unit', 'month', 'repo.git']);

    expect(parsed?.options).toEqual(expect.objectContaining({ unit: 'month' }));
  });

  it('rejects --unit without --since', async () => {
    const program = createProgram();
    await expect(
      program.parseAsync(['node', 'dev-perf', '--no-llm', '--unit', 'month', 'repo.git']),
    ).rejects.toThrow(/--since: required when --unit is set/);
  });

  it('rejects when neither positional arguments nor DEV_PERF_REPOS are given', async () => {
    const program = createProgram();
    await expect(program.parseAsync(['node', 'dev-perf'])).rejects.toThrow(
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
      await program.parseAsync(['node', 'dev-perf', repo.url]);

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
      await program.parseAsync(['node', 'dev-perf']);

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

  it('rejects non-numeric limit options with the option name in the error', async () => {
    const program = createProgram();
    await expect(
      program.parseAsync([
        'node',
        'dev-perf',
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
      program.parseAsync(['node', 'dev-perf', 'https://github.com/org/repo.git']),
    ).rejects.toThrow(/required when LLM analysis is enabled/);
  });
});
