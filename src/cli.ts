import { Command } from 'commander';
import { parseCliOptions, resolveRawOptions } from './config.js';
import type { RawCliOptions } from './config.js';
import { runPipeline } from './pipeline.js';
import type { Report } from './report/index.js';

export function registerCommands(program: Command): void {
  program
    .argument('[repo...]', 'Git repository URL or local path (repeatable; default: DEV_PERF_REPOS)')
    .option('--since <date>', 'Start date, e.g. 2026-01-01 (any git date format)')
    .option('--until <date>', 'End date (default: today)')
    .option('--output <file>', 'Write the JSON report to a file (default: stdout)')
    .option(
      '--cache-dir <dir>',
      'Cache directory for cloned repos and LLM results (default: .dev-perf/cache)',
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
    .option('--verbose', 'Verbose logging')
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
 * environment variables).
 *
 * @param repos - Repositories from the command line (may be empty;
 * `DEV_PERF_REPOS` is the fallback).
 * @param options - Raw commander options for this invocation.
 * @returns The assembled report document.
 * @throws {Error} When the options fail validation; `GitError` when a
 * clone or git log fails; `Error` when the LLM phase fails.
 */
async function runAnalysis(repos: string[], options: RawCliOptions): Promise<Report> {
  const parsed = parseCliOptions(resolveRawOptions(repos, options));
  return runPipeline(parsed);
}
