import { Command } from 'commander';

interface CliOptions {
  since?: string;
  until?: string;
  output?: string;
  cacheDir?: string;
  refresh?: boolean;
  llm?: boolean;
  model?: string;
  providerUrl?: string;
  apiKey?: string;
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
    .option('--verbose', 'Verbose logging')
    .action((repos: string[], options: CliOptions) => runAnalysis(repos, options));
}

/**
 * Runs the full analysis pipeline: clone → deterministic analysis →
 * LLM analysis → report assembly. Not implemented yet — see
 * docs/design.md for the complete design and implementation plan.
 */
async function runAnalysis(_repos: string[], _options: CliOptions): Promise<void> {
  throw new Error('The analysis pipeline is not implemented yet — see docs/design.md');
}
