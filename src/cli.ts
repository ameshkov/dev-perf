import { Command } from 'commander';
import { parseCliOptions } from './config.js';
import type { Report } from './report/index.js';

/**
 * Raw options as parsed by commander before validation: limit options
 * are strings, and unset options are `undefined`. The validated,
 * defaulted shape is `CliOptions` from `src/config.ts`.
 */
interface RawCliOptions {
  since?: string;
  until?: string;
  output?: string;
  cacheDir?: string;
  refresh?: boolean;
  llm?: boolean;
  model?: string;
  providerUrl?: string;
  apiKey?: string;
  limitContext?: string;
  limitOutput?: string;
  verbose?: boolean;
}

export function registerCommands(program: Command): void {
  program
    .argument('<repo...>', 'Git repository URL or local path (repeatable)')
    .option('--since <date>', 'Start date, e.g. 2026-01-01 (any git date format)')
    .option('--until <date>', 'End date (default: today)')
    .option('--output <file>', 'Write the JSON report to a file (default: stdout)')
    .option(
      '--cache-dir <dir>',
      'Cache directory for cloned repos and LLM results (default: .dev-perf/cache)',
    )
    .option('--refresh', 'Force re-clone and re-analysis even if the cache is present')
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
    .action(async (repos: string[], options: RawCliOptions) => {
      await runAnalysis(repos, options);
    });
}

/**
 * Runs the full analysis pipeline: clone → deterministic analysis →
 * LLM analysis → report assembly, producing the report document
 * (docs/design.md §2, §7). Not implemented yet — the stub validates
 * the parsed options (design §3) and throws.
 *
 * @param repos - Repositories to analyze, as given on the command line.
 * @param options - Raw commander options for this invocation.
 * @returns The assembled report document (not yet implemented).
 * @throws {Error} When the options fail validation, or the not-implemented
 * error while the pipeline is still a stub.
 */
async function runAnalysis(repos: string[], options: RawCliOptions): Promise<Report> {
  parseCliOptions({ ...options, repos });
  throw new Error('The analysis pipeline is not implemented yet — see docs/design.md');
}
