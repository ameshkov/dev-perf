import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { buildFixtureRepo, removeFixtureRepo } from '../test/fixtures/repo-builder.js';
import { trendReportJson } from '../test/fixtures/trend-report-builder.js';
import { registerCommands } from './cli.js';
import { trendReportSchema } from './report/schema.js';
import { appVersion } from './version.js';

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
    expect(help).toContain('report [options]');
    // Commander wraps the description to fit the help column, so match
    // across the wrap instead of the exact padded line.
    expect(help).toMatch(/Build a JSON report of per-user contribution\s+metrics/);
  });

  it('documents only --config in the report help', () => {
    const program = createProgram();
    const reportHelp = reportCommand(program)?.helpInformation() ?? '';

    expect(reportHelp).toContain('--config <path>');
    expect(reportHelp).not.toContain('[repo...]');
    // Every functional setting now lives in the config file.
    for (const flag of [
      '--since',
      '--until',
      '--unit',
      '--output',
      '--cache-dir',
      '--refresh',
      '--no-llm',
      '--model',
      '--provider-url',
      '--api-key',
      '--limit-context',
      '--limit-output',
      '--llm-retries',
      '--map',
      '--parallel',
      '--verbose',
    ]) {
      expect(reportHelp).not.toContain(flag);
    }
  });

  it('documents the compile command in the top-level help', () => {
    const program = createProgram();
    const help = program.helpInformation();

    expect(help).toContain('compile [options]');
    // Commander wraps the description to fit the help column, so match
    // across the wrap instead of the exact padded line.
    expect(help).toMatch(/Compile a JSON report into a markdown report with\s+charts/);
  });

  it('documents only --config in the compile help', () => {
    const program = createProgram();
    const compileHelp =
      program.commands.find((command) => command.name() === 'compile')?.helpInformation() ?? '';

    expect(compileHelp).toContain('--config <path>');
    expect(compileHelp).not.toContain('<report>');
    for (const flag of [
      '--output',
      '--map',
      '--include-user',
      '--exclude-user',
      '--repo',
      '--exclude-repo',
      '--verbose',
    ]) {
      expect(compileHelp).not.toContain(flag);
    }
  });

  it('prints the application version for the version command', async () => {
    const program = createProgram();
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await program.parseAsync(['node', 'dev-perf', 'version']);

      expect(stdout).toHaveBeenCalledWith(`${appVersion}\n`);
    } finally {
      stdout.mockRestore();
    }
  });

  it('rejects unknown commands', async () => {
    const program = createProgram();
    await expect(program.parseAsync(['node', 'dev-perf', 'frobnicate'])).rejects.toThrow(
      /unknown command/,
    );
  });

  it('parses the --config option', () => {
    const program = createProgram();
    let options: Record<string, unknown> | undefined;

    reportCommand(program)?.action((parsed: Record<string, unknown>) => {
      options = parsed;
    });

    program.parse(['node', 'dev-perf', 'report', '--config', 'path/to/config.yaml']);

    expect(options).toBeDefined();
    expect(options).toEqual(expect.objectContaining({ config: 'path/to/config.yaml' }));
  });

  it('rejects when the config file carries no repositories', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-cli-cfg-'));
    const configFile = path.join(dir, 'config.yaml');
    await writeFile(configFile, ['llm: false', ''].join('\n'));
    try {
      const program = createProgram();
      await expect(
        program.parseAsync(['node', 'dev-perf', 'report', '--config', configFile]),
      ).rejects.toThrow(/repos: at least one repository is required/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects a unit without since from the config', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-cli-cfg-'));
    const configFile = path.join(dir, 'config.yaml');
    await writeFile(
      configFile,
      ['llm: false', 'repos:', '  - repo-a', 'unit: month', ''].join('\n'),
    );
    try {
      const program = createProgram();
      await expect(
        program.parseAsync(['node', 'dev-perf', 'report', '--config', configFile]),
      ).rejects.toThrow(/since: required when unit is set/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects LLM-enabled runs without provider configuration', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-cli-cfg-'));
    const configFile = path.join(dir, 'config.yaml');
    await writeFile(configFile, ['repos:', '  - https://github.com/org/repo.git', ''].join('\n'));
    try {
      const program = createProgram();
      await expect(
        program.parseAsync(['node', 'dev-perf', 'report', '--config', configFile]),
      ).rejects.toThrow(/required when LLM analysis is enabled/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects non-numeric limit options with the config key in the error', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-cli-cfg-'));
    const configFile = path.join(dir, 'config.yaml');
    await writeFile(
      configFile,
      ['repos:', '  - https://github.com/org/repo.git', 'limit-context: nope', ''].join('\n'),
    );
    try {
      const program = createProgram();
      await expect(
        program.parseAsync(['node', 'dev-perf', 'report', '--config', configFile]),
      ).rejects.toThrow(/limit-context: Invalid input/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('runs the deterministic pipeline from a config file and writes a valid report', async () => {
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
    const configFile = path.join(cacheDir, 'config.yaml');
    await writeFile(
      configFile,
      [
        'repos:',
        `  - ${repo.url}`,
        'llm: false',
        `cache-dir: ${cacheDir}`,
        `output: ${outFile}`,
        'limit-context: 65536',
        'limit-output: 32768',
        '',
      ].join('\n'),
    );
    try {
      const program = createProgram();
      await program.parseAsync(['node', 'dev-perf', 'report', '--config', configFile]);

      const result = trendReportSchema.safeParse(JSON.parse(await readFile(outFile, 'utf8')));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.parameters.repos).toEqual([{ repo: repo.url }]);
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

  it('runs the compile command from a config file and writes the markdown report and assets', async () => {
    const reportDir = await mkdtemp(path.join(os.tmpdir(), 'dev-perf-cli-report-'));
    const reportFile = path.join(reportDir, 'report.json');
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
    const configFile = path.join(outDir, 'config.yaml');
    await writeFile(
      configFile,
      ['compile:', `  report: ${reportFile}`, `  output: ${outDir}`, ''].join('\n'),
    );
    try {
      const program = createProgram();
      await program.parseAsync(['node', 'dev-perf', 'compile', '--config', configFile]);

      const md = await readFile(path.join(outDir, 'report.md'), 'utf8');
      expect(md).toContain('# Dev Performance Report');
      const assets = await readdir(path.join(outDir, 'assets'));
      expect(assets).toContain('alice-commits-per-period.svg');
    } finally {
      await rm(reportDir, { recursive: true, force: true });
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
