import { Command } from 'commander';
import { parseCompileOptions, resolveCompileOptions, runCompile } from '../compile/index.js';
import type { CompileResult, RawCompileOptions } from '../compile/index.js';

/** One option definition of the compile command. */
interface CompileOption {
  /** Commander flags, e.g. `--map <email=name>`. */
  flags: string;
  /** The option description. */
  description: string;
  /** Collect repeated values into a list. */
  repeatable?: boolean;
}

/** Every option of the compile command, in help order. */
const COMPILE_OPTIONS: CompileOption[] = [
  {
    flags: '--output <dir>',
    description: 'Output directory for report.md and the assets/ charts (default: dev-perf-report)',
  },
  {
    flags: '--map <email=name>',
    description: 'Map an author email to a display name, merging identities (repeatable)',
    repeatable: true,
  },
  {
    flags: '--maps-file <path>',
    description: 'JSON file with email-to-name mappings ({ "email": "Name" })',
  },
  {
    flags: '--include-user <name|email>',
    description: 'Keep only matching users (repeatable; matches display name or any email)',
    repeatable: true,
  },
  {
    flags: '--exclude-user <name|email>',
    description: 'Drop matching users (repeatable; cannot be combined with --include-user)',
    repeatable: true,
  },
  {
    flags: '--repo <repo>',
    description: 'Keep only these repositories (repeatable; as given on the command line)',
    repeatable: true,
  },
  {
    flags: '--exclude-repo <repo>',
    description: 'Drop these repositories (repeatable; cannot be combined with --repo)',
    repeatable: true,
  },
  { flags: '--verbose', description: 'Verbose logging' },
];

/**
 * Collects repeated option values into a list: commander calls the
 * collector with the previous list, so each occurrence appends.
 *
 * @param value - The option value of this occurrence.
 * @param previous - The values collected so far.
 * @returns The extended list.
 */
function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/**
 * Registers the `compile` command on the program: it turns a JSON
 * report (as written by `report`) into a markdown report with charts,
 * writing `report.md` and the chart SVGs into an output directory.
 * Repositories and users can be selected, and emails can be mapped to
 * a single user. All options have a `DEV_PERF_COMPILE_*` environment
 * variable equivalent (or `DEV_PERF_VERBOSE`); the flag wins when both
 * are set.
 *
 * @param program - The commander program to register the command on.
 */
export function registerCompileCommand(program: Command): void {
  const command = program
    .command('compile')
    .description('Compile a JSON report into a markdown report with charts')
    .argument(
      '<report>',
      'JSON report file (schema v2, as written by `report`; default: DEV_PERF_COMPILE_REPORT)',
    );
  for (const option of COMPILE_OPTIONS) {
    if (option.repeatable) {
      command.option(option.flags, option.description, collect, []);
    } else {
      command.option(option.flags, option.description);
    }
  }
  command
    .addHelpText(
      'after',
      '\nEvery option can also be set through a DEV_PERF_COMPILE_* environment variable; ' +
        'the flag wins when both are set (see README).\n',
    )
    .action(async (report: string | undefined, options: RawCompileOptions) => {
      await runCompilation(report, options);
    });
}

/**
 * Runs the compile pipeline: resolve the raw options against the
 * `DEV_PERF_COMPILE_*` environment variables (flags win), validate
 * them, then read the report, filter and merge identities, render the
 * charts and write `report.md` with the assets into the output
 * directory. The written report path is printed to stdout.
 *
 * @param report - The report file from the command line, if any
 * (`DEV_PERF_COMPILE_REPORT` is the fallback).
 * @param options - Raw commander options for this invocation.
 * @throws {Error} When the options fail validation, or the report or
 * maps file is invalid, or a chart fails to render.
 */
async function runCompilation(
  report: string | undefined,
  options: RawCompileOptions,
): Promise<void> {
  const parsed = parseCompileOptions(resolveCompileOptions(report, options));
  const result: CompileResult = await runCompile(parsed.report, parsed);
  // stdout carries nothing but the path of the written report.
  process.stdout.write(`${result.reportPath}\n`);
}
