import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { registerCommands } from './cli.js';

function createProgram(): Command {
  const program = new Command();
  program.name('dev-perf');
  program.exitOverride();
  registerCommands(program);
  return program;
}

describe('cli', () => {
  it('documents the repository argument and all options in help', () => {
    const program = createProgram();
    const help = program.helpInformation();

    expect(help).toContain('<repo...>');
    expect(help).toContain('--since <date>');
    expect(help).toContain('--until <date>');
    expect(help).toContain('--output <file>');
    expect(help).toContain('--cache-dir <dir>');
    expect(help).toContain('--refresh');
    expect(help).toContain('--no-llm');
    expect(help).toContain('--model <model>');
    expect(help).toContain('--provider-url <url>');
    expect(help).toContain('--api-key <key>');
    expect(help).toContain('--verbose');
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

  it('rejects when no repository is given', () => {
    const program = createProgram();
    expect(() => program.parse(['node', 'dev-perf'])).toThrow("missing required argument 'repo'");
  });

  it('fails with a not-implemented error when the analysis pipeline is invoked', async () => {
    const program = createProgram();
    await expect(
      program.parseAsync(['node', 'dev-perf', '--no-llm', 'https://github.com/org/repo.git']),
    ).rejects.toThrow(/not implemented yet/);
  });
});
