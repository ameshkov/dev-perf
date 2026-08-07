import { Command } from 'commander';
import { parseReportOptions, resolveReportOptions } from '../config.js';
import { resolveDevPerfConfig } from '../config-file.js';
import type { DevPerfConfig } from '../config-file.js';
import { runPipeline } from '../pipeline.js';
import type { TrendReport } from '../report/index.js';

/**
 * Registers the `report` command on the program: it builds the JSON
 * report of per-user contribution metrics for the repositories and date
 * range configured through the YAML config file. The config file is the
 * single source of options — `--config <path>` selects it, else
 * `./config.yaml` auto-loads when it exists.
 *
 * @param program - The commander program to register the command on.
 */
export function registerReportCommand(program: Command): void {
  program
    .command('report')
    .description('Build a JSON report of per-user contribution metrics')
    .option('--config <path>', 'YAML config file (default: ./config.yaml when it exists)')
    .addHelpText('after', '\nAll settings come from the YAML config file (see README).\n')
    .action(async (options: { config?: string }) => {
      const { config, configPath } = await resolveDevPerfConfig(options.config);
      await runAnalysis(config, configPath);
    });
}

/**
 * Runs the analysis pipeline: load the config file, map it to the
 * report options, validate them, then clone → deterministic analysis →
 * LLM phase (when enabled) → report assembly, producing the report
 * document. A run with LLM analysis enabled requires the `model`,
 * `provider-url` and `api-key` config keys; `unit` requires `since`.
 *
 * @param config - The validated config file (empty when no file is in
 * effect).
 * @param configFile - The config file path, when one was in effect.
 * @returns The assembled report document.
 * @throws {Error} When the options fail validation; `GitError` when a
 * clone or git log fails; `Error` when the LLM phase fails.
 */
async function runAnalysis(
  config: DevPerfConfig,
  configFile: string | undefined,
): Promise<TrendReport> {
  const parsed = parseReportOptions(resolveReportOptions(config, configFile));
  return runPipeline(parsed);
}
