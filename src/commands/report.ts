import { Command } from 'commander';
import { parseCliOptions, resolveRawOptions } from '../config.js';
import type { RawCliOptions } from '../config.js';
import { runPipeline } from '../pipeline.js';
import type { TrendReport } from '../report/index.js';
import { collectOptionValues } from '../util/list.js';

/**
 * Registers every `report` option on the command, in help order. The
 * email-mapping options merge author identities at report time
 * (`--map`/`--maps-file`); the rest configure the analysis.
 *
 * @param command - The `report` command.
 * @returns The command, for chaining.
 */
function addReportOptions(command: Command): Command {
  return command
    .option('--since <date>', 'Start date, e.g. 2026-01-01 (any git date format)')
    .option('--until <date>', 'End date (default: today)')
    .option(
      '--unit <unit>',
      'Split the range into periods: day, week, month, quarter, year (requires --since)',
    )
    .option('--output <file>', 'Write the JSON report to a file (default: stdout)')
    .option(
      '--cache-dir <dir>',
      'Cache directory for cloned repos and LLM results (default: <tmpdir>/.dev-cache)',
    )
    .option('--refresh', 'Force re-clone and re-analysis, invalidating the LLM result cache')
    .option('--no-llm', 'Deterministic stats only, skip LLM analysis')
    .option('--model <model>', 'Model id, e.g. gpt-4.1 (required for LLM analysis)')
    .option(
      '--provider-url <url>',
      'OpenAI-compatible provider base URL (required for LLM analysis)',
    )
    .option('--api-key <key>', 'Provider API key (required for LLM analysis; or DEV_PERF_API_KEY)')
    .option('--limit-context <n>', 'Max context tokens for LLM analysis (default: 262144)')
    .option('--limit-output <n>', 'Max output tokens for LLM analysis (default: 65536)')
    .option(
      '--llm-retries <n>',
      'Retry a failed LLM analysis up to <n> more times, recreating the LLM runtime between attempts (default: 2)',
    )
    .option(
      '--map <email=name>',
      'Map an author email to a display name, merging identities (repeatable)',
      collectOptionValues,
      [],
    )
    .option('--maps-file <path>', 'JSON file with email-to-name mappings ({ "email": "Name" })')
    .option('--parallel <n>', 'Analyze up to <n> repositories in parallel (default: 1)')
    .option('--verbose', 'Verbose logging');
}

/**
 * Registers the `report` command on the program: it builds the JSON
 * report of per-user contribution metrics for the given repositories
 * and date range. All report options have a `DEV_PERF_*` environment
 * variable equivalent; the flag wins when both are set.
 *
 * @param program - The commander program to register the command on.
 */
export function registerReportCommand(program: Command): void {
  const command = program
    .command('report')
    .description('Build a JSON report of per-user contribution metrics')
    .argument(
      '[repo...]',
      'Git repository URL or local path (repeatable; default: DEV_PERF_REPOS)',
    );
  addReportOptions(command)
    .addHelpText(
      'after',
      '\nEvery option can also be set through a DEV_PERF_* environment variable; ' +
        'the flag wins when both are set (see README).\n',
    )
    .action(async (repos: string[] | undefined, options: RawCliOptions) => {
      await runAnalysis(repos ?? [], options);
    });
}

/**
 * Runs the analysis pipeline: resolve the raw options against the
 * `DEV_PERF_*` environment variables (flags win), validate them, then
 * clone → deterministic analysis → LLM phase (when enabled) → report
 * assembly, producing the report document. A run without `--no-llm`
 * requires `--model`, `--provider-url` and `--api-key` (or their
 * environment variables); `--unit` requires `--since`.
 *
 * @param repos - Repositories from the command line (may be empty;
 * `DEV_PERF_REPOS` is the fallback).
 * @param options - Raw commander options for this invocation.
 * @returns The assembled report document.
 * @throws {Error} When the options fail validation; `GitError` when a
 * clone or git log fails; `Error` when the LLM phase fails.
 */
async function runAnalysis(repos: string[], options: RawCliOptions): Promise<TrendReport> {
  const parsed = parseCliOptions(resolveRawOptions(repos, options));
  return runPipeline(parsed);
}
